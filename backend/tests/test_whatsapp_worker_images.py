"""Deployment regression: digest pins must never inherit a worker build.

Compose integration uses the real local CLI and an isolated, synthetic .env;
image/systemd tests mock inspection only. No container or provider is executed.
"""
import importlib.util
import os
from pathlib import Path
import shlex
import shutil
from unittest.mock import patch

import pytest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('whatsapp_images', ROOT / 'scripts/whatsapp_images.py')
images = importlib.util.module_from_spec(spec)
spec.loader.exec_module(images)
BACKEND = 'rk-web-backend@sha256:' + 'a' * 64
FRONTEND = 'rk-web-frontend@sha256:' + 'b' * 64
PINS = {'RK_BACKEND_IMAGE': BACKEND, 'RK_FRONTEND_IMAGE': FRONTEND}
IDENTITIES = {'backend': 'sha256:' + 'c' * 64, 'frontend': 'sha256:' + 'd' * 64}


@pytest.fixture
def compose():
    binary = os.environ.get('RK_COMPOSE_TEST_BINARY')
    if binary:
        return [binary]
    if shutil.which('docker'):
        return ['docker', 'compose']
    if shutil.which('docker-compose'):
        return ['docker-compose']
    pytest.skip('Local Compose CLI unavailable; run with RK_COMPOSE_TEST_BINARY on staging.')


@pytest.fixture
def isolated_compose(tmp_path):
    for name in ('docker-compose.yml', 'deploy/docker-compose.release.yml', 'deploy/docker-compose.worker.yml'):
        target = tmp_path / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / name, target)
    (tmp_path / '.env').write_text('NEXT_PUBLIC_SITE_URL=https://example.invalid\nSYNTHETIC_SENTINEL=not-a-secret\n')
    return tmp_path


def test_real_compose_merge_removes_build_and_preserves_environment_network(compose, isolated_compose):
    version = images.capture(compose + ['version', '--short'], cwd=isolated_compose)
    assert version
    release, worker = images.merged_models(PINS, compose=compose, cwd=isolated_compose)
    # Reproduce the before state that caused "build tag cannot contain a digest".
    assert release['services']['backend']['build']['dockerfile'] == 'Dockerfile.backend'
    assert release['services']['backend']['image'] == BACKEND
    assert release['services']['frontend']['image'] == FRONTEND
    with pytest.raises(images.ValidationError, match='no build configuration'):
        images.validate_models(release, release, PINS)
    assert worker['services']['backend'].get('build') is None
    assert worker['services']['backend']['environment'] == release['services']['backend']['environment']
    assert worker['services']['backend']['environment']['SYNTHETIC_SENTINEL'] == 'not-a-secret'
    assert worker['networks'] == release['networks']
    assert set(worker['services']['backend']['networks']) == {'rk-internal'}
    assert set(worker['services']['frontend']['networks']) == {'rk-internal'}
    # Same worker model is used by both systemd execution paths.
    for name, command in (('worker', 'whatsapp-worker'), ('template-refresh', 'whatsapp-template-refresh')):
        unit = (ROOT / f'deploy/systemd/rk-whatsapp-{name}.service').read_text()
        start = next(line.split('=', 1)[1] for line in unit.splitlines() if line.startswith('ExecStart='))
        tokens = shlex.split(start)
        assert tokens[:2] == ['/usr/bin/flock', '-E']
        assert '--no-deps' in tokens and tokens[tokens.index('--pull') + 1] == 'never'
        assert tokens[tokens.index('--name') + 1] == 'rk-whatsapp-' + name
        assert tokens[-7:] == ['backend', 'python', '-m', 'flask', '--app', 'wsgi:app', command]
        files = [tokens[index + 1] for index, token in enumerate(tokens) if token == '-f']
        assert files == ['docker-compose.yml', 'deploy/docker-compose.release.yml', 'deploy/docker-compose.worker.yml']
        assert 'ExecStartPre=/usr/bin/python3 scripts/whatsapp_images.py validate --pins /etc/rk-whatsapp/images.env --require-running' in unit
        assert 'User=root' in unit and 'WorkingDirectory=/opt/apps/rashi-kapoor/rk-web' in unit
        assert 'TimeoutStartSec=' in unit and 'SuccessExitStatus=75' in unit


@pytest.mark.parametrize('text', ['', 'RK_BACKEND_IMAGE=latest',
    f'RK_BACKEND_IMAGE={BACKEND}\n',
    f'RK_BACKEND_IMAGE={BACKEND}\nRK_FRONTEND_IMAGE={FRONTEND}\nSECRET=private',
    f'RK_BACKEND_IMAGE={BACKEND}\nRK_FRONTEND_IMAGE={FRONTEND}\nRK_BACKEND_IMAGE={BACKEND}'])
def test_missing_mutable_or_non_image_pin_files_rejected(text):
    with pytest.raises(images.ValidationError):
        images.pins_from_text(text)


def test_exact_two_immutable_image_references_accepted():
    assert images.pins_from_text(f'# Image-only\nRK_BACKEND_IMAGE={BACKEND}\nRK_FRONTEND_IMAGE={FRONTEND}\n') == PINS


def test_actual_compose_reports_service_build_tags(compose, isolated_compose):
    refs = images.built_references(compose=compose, cwd=isolated_compose)
    assert set(refs) == {'backend', 'frontend'}
    for service, reference in refs.items():
        assert reference.endswith('-' + service)


def test_sync_failure_does_not_replace_protected_pins(capsys):
    from contextlib import nullcontext
    with patch.object(images, 'paused_locks', return_value=nullcontext()), patch.object(images, 'built_references', return_value={'backend': 'backend', 'frontend': 'frontend'}), patch.object(images, 'select_pins', side_effect=images.ValidationError('Built image has no usable local RepoDigest.')), patch.object(images, 'atomic_write') as write, patch('sys.argv', ['whatsapp_images.py', 'sync']):
        assert images.main() == 1
    write.assert_not_called()
    assert 'blocked' in capsys.readouterr().out


def inspect_fixture(reference):
    for service, key in images.SERVICES.items():
        if reference in {service, 'rk-web-' + service, PINS[key]}:
            return {'id': IDENTITIES[service], 'digests': [PINS[key]]}
    raise images.ValidationError('Image is unavailable locally.')


def test_sync_uses_actual_inspectable_repo_digests_of_builds():
    with patch.object(images, 'inspect_image', side_effect=inspect_fixture):
        assert images.select_pins({'backend': 'rk-web-backend', 'frontend': 'rk-web-frontend'}) == PINS


@pytest.mark.parametrize('failure', ['no_repo_digest', 'missing_local_digest', 'wrong_image', 'wrong_repository'])
def test_no_tag_or_image_id_fallback_when_digest_unavailable(failure):
    def inspect(reference):
        result = inspect_fixture(reference)
        if reference == 'rk-web-backend':
            if failure == 'no_repo_digest':
                return {**result, 'digests': []}
            if failure == 'wrong_repository':
                return {**result, 'digests': ['unrelated@sha256:' + 'a' * 64]}
        if reference == BACKEND:
            if failure == 'missing_local_digest':
                raise images.ValidationError('Missing local image.')
            if failure == 'wrong_image':
                return {**result, 'id': IDENTITIES['frontend']}
        return result
    with patch.object(images, 'inspect_image', side_effect=inspect):
        with pytest.raises(images.ValidationError):
            images.select_pins({'backend': 'rk-web-backend', 'frontend': 'rk-web-frontend'})


@pytest.mark.parametrize('stale', [False, True])
def test_systemd_preflight_requires_pins_match_builds_and_running_containers(stale):
    def capture(args, **_kwargs):
        assert args[:3] == ['docker', 'container', 'inspect']
        service = args[-1].removeprefix('rk-')
        return 'sha256:' + 'e' * 64 if stale else IDENTITIES[service]
    with patch.object(images, 'inspect_image', side_effect=inspect_fixture), patch.object(images, 'capture', side_effect=capture), patch.object(images, 'built_references', return_value={'backend': 'backend', 'frontend': 'frontend'}):
        if stale:
            with pytest.raises(images.ValidationError, match='running application'):
                images.validate_local_images(PINS, require_running=True)
        else:
            images.validate_local_images(PINS, require_running=True)


def test_stale_available_pin_rejected_before_dispatch():
    def inspect(reference):
        result = inspect_fixture(reference)
        return {**result, 'id': 'sha256:' + 'e' * 64} if reference == BACKEND else result
    with patch.object(images, 'inspect_image', side_effect=inspect), patch.object(images, 'built_references', return_value={'backend': 'backend', 'frontend': 'frontend'}):
        with pytest.raises(images.ValidationError, match='Stale image pin'):
            images.validate_local_images(PINS)


@pytest.mark.parametrize('active', ['timer', 'service', 'container', None])
def test_sync_requires_paused_timers_services_and_no_running_job(active):
    def capture(args, **_kwargs):
        if args[0] == 'systemctl':
            return 'active' if active and args[2].endswith('.' + active) else 'inactive'
        return 'rk-whatsapp-worker' if active == 'container' else 'rk-backend\nrk-frontend'
    with patch.object(images, 'capture', side_effect=capture):
        if active:
            with pytest.raises(images.ValidationError):
                images.require_paused()
        else:
            images.require_paused()


def test_failed_inspection_never_echoes_subprocess_secrets():
    import subprocess
    with patch.object(images.subprocess, 'check_output', side_effect=subprocess.CalledProcessError(1, 'docker', output='private-token', stderr='private-env')):
        with pytest.raises(images.ValidationError) as failure:
            images.capture(['docker', 'compose', 'config'])
    assert 'private-token' not in str(failure.value)
    assert 'private-env' not in str(failure.value)


@pytest.mark.skipif(os.name != 'posix', reason='Atomic root:root permissions require Linux staging.')
def test_atomic_image_only_write_preserves_old_file_on_validation_failure(tmp_path):
    target = tmp_path / 'images.env'
    target.write_text('previous')
    with patch.object(images, 'PIN_FILE', target), patch.object(images.os, 'geteuid', return_value=0), patch.object(images.os, 'fchown'), patch.object(images.Path, 'stat', autospec=True) as stat:
        from types import SimpleNamespace
        stat.return_value = SimpleNamespace(st_uid=0, st_mode=0o40700)
        with pytest.raises(images.ValidationError):
            images.atomic_write(target, {'RK_BACKEND_IMAGE': 'latest', 'RK_FRONTEND_IMAGE': FRONTEND})
    assert target.read_text() == 'previous'


def test_workflow_orders_safety_and_pin_sync_without_running_whatsapp():
    workflow = (ROOT / '.github/workflows/deploy.yml').read_text()
    assert workflow.index('systemctl show') < workflow.index('git reset --hard')
    assert workflow.index('docker compose build') < workflow.index('scripts/whatsapp_images.py sync') < workflow.index('docker compose up -d --no-build --pull never')
    assert workflow.index('curl -fsS') < workflow.index('scripts/whatsapp_images.py validate --require-running')
    assert 'sudo -n python3 scripts/whatsapp_images.py sync' in workflow
    for forbidden in ('systemctl start', 'systemctl restart', 'systemctl enable', 'flask --app wsgi:app whatsapp-worker', 'flask --app wsgi:app whatsapp-template-refresh'):
        assert forbidden not in workflow
