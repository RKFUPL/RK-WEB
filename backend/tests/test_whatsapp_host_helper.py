"""Unprivileged local tests of the independent host helper; no VPS/real Docker.

Host inspections and POSIX identity syscalls are mocked where Windows lacks them.
The Linux-only integration exercises actual directory-fd/rename/fsync semantics.
"""
from contextlib import nullcontext
import importlib.machinery
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import textwrap
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'deploy/host/rk-whatsapp-image-pin-sync'
loader = importlib.machinery.SourceFileLoader('rk_host_image_helper', str(SOURCE))
spec = importlib.util.spec_from_loader(loader.name, loader)
host = importlib.util.module_from_spec(spec)
loader.exec_module(host)
PINS = {'RK_BACKEND_IMAGE': 'rk-web-backend@sha256:' + 'a' * 64,
        'RK_FRONTEND_IMAGE': 'rk-web-frontend@sha256:' + 'b' * 64}
IDS = {'rk-web-backend': 'sha256:' + 'c' * 64, 'rk-web-frontend': 'sha256:' + 'd' * 64}


def metadata(mode=stat.S_IFREG | 0o600, uid=0, gid=0, links=1):
    return SimpleNamespace(st_mode=mode, st_uid=uid, st_gid=gid, st_nlink=links)


@pytest.fixture
def posix_flags(monkeypatch):
    for index, name in enumerate(('O_DIRECTORY', 'O_NOFOLLOW', 'O_CLOEXEC', 'O_NONBLOCK')):
        if not hasattr(os, name):
            monkeypatch.setattr(os, name, 1 << (24 + index), raising=False)


@pytest.fixture
def main_context(monkeypatch):
    monkeypatch.setattr(host, 'verify_host', lambda: None)
    monkeypatch.setattr(host, 'execution_locks', lambda: nullcontext())
    monkeypatch.setattr(host, 'protected_directory', lambda: nullcontext(17))
    monkeypatch.setattr(host, 'require_paused', lambda: None)
    monkeypatch.setattr(host, 'select_pins', lambda: dict(PINS))
    write = Mock()
    monkeypatch.setattr(host, 'atomic_replace', write)
    return write


@pytest.mark.parametrize('arguments', [[], ['--help'], ['--sync', 'extra'], ['--sync=/tmp/x'], ['--output', '/tmp/x'], ['--preflight', '--sync']])
def test_only_exact_supported_arguments_are_accepted(monkeypatch, arguments):
    verify = Mock()
    monkeypatch.setattr(host, 'verify_host', verify)
    assert host.main(arguments) == 2
    verify.assert_not_called()


def test_preflight_has_no_pin_write(main_context, capsys):
    assert host.main(['--preflight']) == 0
    main_context.assert_not_called()
    assert json.loads(capsys.readouterr().out) == {'whatsappImagePinPreflight': 'verified'}


@pytest.mark.parametrize('uid', [0, 1000])
def test_repository_copy_cannot_run_as_privileged_helper(monkeypatch, uid):
    monkeypatch.setattr(host.os, 'geteuid', lambda: uid, raising=False)
    with pytest.raises(host.Blocked, match='installed helper'):
        host.verify_host()


@pytest.mark.parametrize('unsafe', [metadata(uid=1000, mode=stat.S_IFREG | 0o755), metadata(mode=stat.S_IFREG | 0o777), metadata(mode=stat.S_IFLNK | 0o777)])
def test_installed_helper_must_be_root_owned_regular_and_unwritable(monkeypatch, tmp_path, unsafe):
    installed = (tmp_path / 'helper').absolute()
    monkeypatch.setattr(host, 'INSTALLED', installed)
    monkeypatch.setattr(host, '__file__', str(installed))
    monkeypatch.setattr(host.os, 'geteuid', lambda: 0, raising=False)
    monkeypatch.setattr(host, 'trusted_directory', lambda *_: None)
    monkeypatch.setattr(Path, 'lstat', lambda *_: unsafe)
    with pytest.raises(host.Blocked):
        host.verify_host()


def test_symlink_at_protected_path_ancestor_is_rejected(monkeypatch):
    monkeypatch.setattr(Path, 'lstat', lambda path: metadata(mode=stat.S_IFLNK | 0o777) if path.name == 'etc' else metadata(mode=stat.S_IFDIR | 0o755))
    with pytest.raises(host.Blocked):
        host.trusted_directory(host.PIN_DIRECTORY)


def test_successful_sync_emits_only_two_image_assignments(main_context, capsys):
    assert host.main(['--sync']) == 0
    main_context.assert_called_once_with(17, PINS)
    assert capsys.readouterr().out == host.pin_text(PINS)


@pytest.mark.parametrize('failed_stage', ['verify_host', 'execution_locks', 'protected_directory', 'require_paused', 'select_pins'])
def test_validation_failure_preserves_existing_pins(main_context, monkeypatch, failed_stage, tmp_path, capsys):
    target = tmp_path / 'images.env'
    target.write_text('existing-image-pins')
    main_context.side_effect = lambda *_: target.write_text('changed')
    monkeypatch.setattr(host, failed_stage, Mock(side_effect=host.Blocked('private-provider-output')))
    assert host.main(['--sync']) == 1
    main_context.assert_not_called()
    assert target.read_text() == 'existing-image-pins'
    assert 'private-provider-output' not in str(capsys.readouterr())


def test_changed_build_before_commit_preserves_pins(main_context, monkeypatch):
    monkeypatch.setattr(host, 'select_pins', Mock(side_effect=[PINS, {**PINS, 'RK_BACKEND_IMAGE': 'changed'}]))
    assert host.main(['--sync']) == 1
    main_context.assert_not_called()


@pytest.mark.parametrize('problem', ['active_timer', 'active_service', 'missing_unit', 'worker_container', 'refresh_container', None])
def test_host_quiescence_checks_all_timers_services_and_containers(monkeypatch, problem):
    seen = []
    def capture(args):
        seen.append(args)
        if args[0] == host.SYSTEMCTL:
            if problem == 'missing_unit':
                return 'LoadState=not-found\nActiveState=inactive'
            active = (problem == 'active_timer' and args[2].endswith('.timer')) or (problem == 'active_service' and args[2].endswith('.service'))
            return 'LoadState=loaded\nActiveState=' + ('active' if active else 'inactive')
        if problem == 'worker_container':
            return 'rk-whatsapp-worker'
        if problem == 'refresh_container':
            return 'rk-whatsapp-template-refresh'
        return 'rk-backend\nrk-frontend'
    monkeypatch.setattr(host, 'capture', capture)
    if problem:
        with pytest.raises(host.Blocked):
            host.require_paused()
    else:
        host.require_paused()
        assert len(seen) == 5


def test_service_failed_is_quiescent(monkeypatch):
    monkeypatch.setattr(host, 'capture', lambda args: ('LoadState=loaded\nActiveState=' + ('failed' if args[2].endswith('.service') else 'inactive')) if args[0] == host.SYSTEMCTL else '')
    host.require_paused()


def fake_inspect(reference):
    for variable, repository in host.IMAGES:
        if reference in (repository + ':latest', PINS[variable]):
            return {'id': IDS[repository], 'digests': [PINS[variable]]}
    raise AssertionError('Unexpected image reference')


def test_expected_builds_resolve_to_exact_local_repo_digests(monkeypatch):
    inspect = Mock(side_effect=fake_inspect)
    monkeypatch.setattr(host, 'inspect', inspect)
    assert host.select_pins() == PINS
    assert [call.args[0] for call in inspect.call_args_list] == ['rk-web-backend:latest', PINS['RK_BACKEND_IMAGE'], 'rk-web-frontend:latest', PINS['RK_FRONTEND_IMAGE']]


@pytest.mark.parametrize('failure', ['missing', 'wrong_repository', 'wrong_id', 'unavailable'])
def test_bad_image_digest_never_falls_back_to_tag(monkeypatch, failure):
    def inspect(reference):
        result = fake_inspect(reference)
        if reference == 'rk-web-backend:latest':
            if failure == 'missing':
                return {**result, 'digests': []}
            if failure == 'wrong_repository':
                return {**result, 'digests': ['evil-repo@sha256:' + 'a' * 64]}
        if reference == PINS['RK_BACKEND_IMAGE']:
            if failure == 'wrong_id':
                return {**result, 'id': IDS['rk-web-frontend']}
            if failure == 'unavailable':
                raise host.Blocked('not available')
        return result
    monkeypatch.setattr(host, 'inspect', inspect)
    with pytest.raises(host.Blocked):
        host.select_pins()


@pytest.mark.parametrize('info', [metadata(uid=1000), metadata(gid=1000), metadata(mode=stat.S_IFREG | 0o666), metadata(mode=stat.S_IFLNK | 0o777), metadata(links=2)])
def test_unsafe_file_metadata_is_rejected(info):
    with pytest.raises(host.Blocked):
        host.trusted_metadata(info, mode=0o600)


def test_expected_permissions_and_root_sticky_lock_directory():
    host.trusted_metadata(metadata(), mode=0o600)
    host.trusted_metadata(metadata(mode=stat.S_IFDIR | 0o1777), directory=True, sticky=True)
    with pytest.raises(host.Blocked):
        host.trusted_metadata(metadata(mode=stat.S_IFDIR | 0o777), directory=True, sticky=True)


def test_lock_uses_nofollow_and_rejects_held_lock(monkeypatch, posix_flags):
    opened = Mock(return_value=52)
    closed = Mock()
    monkeypatch.setattr(host.os, 'open', opened)
    monkeypatch.setattr(host.os, 'close', closed)
    monkeypatch.setattr(host.os, 'fstat', lambda _: metadata())
    flock = Mock(side_effect=BlockingIOError())
    monkeypatch.setitem(sys.modules, 'fcntl', SimpleNamespace(flock=flock, LOCK_EX=2, LOCK_NB=4))
    with pytest.raises(BlockingIOError):
        host.lock_file(17, 'rk-whatsapp-worker')
    flags = opened.call_args.args[1]
    assert flags & os.O_NOFOLLOW and flags & os.O_CLOEXEC
    assert opened.call_args.kwargs['dir_fd'] == 17
    assert opened.call_args.args[0] == 'rk-whatsapp-worker.lock'
    closed.assert_called_once_with(52)


def test_held_execution_lock_blocks_sync(main_context, monkeypatch):
    monkeypatch.setattr(host, 'execution_locks', Mock(side_effect=host.Blocked('held')))
    assert host.main(['--sync']) == 1
    main_context.assert_not_called()


def test_atomic_replace_permissions_fsync_and_fixed_target(monkeypatch, posix_flags):
    operations = []
    content = []
    class Output(io.StringIO):
        def fileno(self):
            return 52
        def close(self):
            content.append(self.getvalue())
            super().close()
    monkeypatch.setattr(host.os, 'stat', lambda *args, **kwargs: metadata())
    monkeypatch.setattr(host.os, 'open', lambda *args, **kwargs: operations.append(('open', args, kwargs)) or 52)
    monkeypatch.setattr(host.os, 'fchown', lambda *args: operations.append(('chown', args)), raising=False)
    monkeypatch.setattr(host.os, 'fchmod', lambda *args: operations.append(('chmod', args)), raising=False)
    monkeypatch.setattr(host.os, 'fstat', lambda _: metadata())
    monkeypatch.setattr(host.os, 'fdopen', lambda *args, **kwargs: Output())
    monkeypatch.setattr(host.os, 'fsync', lambda value: operations.append(('fsync', value)))
    monkeypatch.setattr(host.os, 'replace', lambda *args, **kwargs: operations.append(('replace', args, kwargs)))
    host.atomic_replace(17, PINS)
    assert content == [host.pin_text(PINS)]
    assert ('chown', (52, 0, 0)) in operations
    assert ('chmod', (52, 0o600)) in operations
    replaced = next(row for row in operations if row[0] == 'replace')
    assert replaced[1][1] == 'images.env'
    assert replaced[2] == {'src_dir_fd': 17, 'dst_dir_fd': 17}
    assert operations.index(('fsync', 52)) < operations.index(replaced) < operations.index(('fsync', 17))


@pytest.mark.parametrize('info', [metadata(mode=stat.S_IFLNK | 0o777), metadata(uid=1000), metadata(mode=stat.S_IFREG | 0o644), metadata(links=2)])
def test_existing_symlink_or_wrong_permissions_rejected_before_write(monkeypatch, posix_flags, info):
    monkeypatch.setattr(host.os, 'stat', lambda *args, **kwargs: info)
    opened = Mock()
    monkeypatch.setattr(host.os, 'open', opened)
    with pytest.raises(host.Blocked):
        host.atomic_replace(17, PINS)
    opened.assert_not_called()


def test_subprocess_environment_is_fixed_and_errors_are_redacted(monkeypatch):
    monkeypatch.setenv('DOCKER_HOST', 'malicious')
    monkeypatch.setenv('PYTHONPATH', 'writable-repo')
    call = Mock(side_effect=subprocess.CalledProcessError(1, 'docker', output='private-token', stderr='private-env'))
    monkeypatch.setattr(host.subprocess, 'check_output', call)
    with pytest.raises(host.Blocked) as failure:
        host.docker('ps', '--format', '{{.Names}}')
    assert 'private-token' not in str(failure.value) and 'private-env' not in str(failure.value)
    assert call.call_args.kwargs['env'] == host.CLEAN_ENV
    assert call.call_args.kwargs['cwd'] == '/opt/apps/rashi-kapoor/rk-web'
    assert call.call_args.args[0][:5] == ['/usr/bin/docker', '--host', 'unix:///var/run/docker.sock', '--config', str(host.DOCKER_CONFIG)]
    assert host.DOCKER_CONFIG.as_posix() == '/etc/rk-whatsapp/docker-cli'


def test_root_helper_is_independent_and_sudo_scope_is_exact():
    source = SOURCE.read_text(encoding='utf-8')
    assert source.startswith('#!/usr/bin/python3 -I\n')
    assert 'scripts.whatsapp_images' not in source and 'docker compose' not in source
    assert 'shell=True' not in source and 'sys.path' not in source
    sudoers = (ROOT / 'deploy/sudoers/rk-whatsapp-image-pin-sync').read_text()
    rules = [line for line in sudoers.splitlines() if line and not line.startswith('#')]
    assert rules == ['athul ALL=(root) NOPASSWD: NOSETENV: /usr/local/sbin/rk-whatsapp-image-pin-sync --preflight, /usr/local/sbin/rk-whatsapp-image-pin-sync --sync']
    assert '*' not in rules[0]


@pytest.mark.parametrize('sudo_failure', [1, 127])
def test_missing_or_unconfigured_helper_stops_workflow_before_git_or_build(tmp_path, sudo_failure):
    workflow = (ROOT / '.github/workflows/deploy.yml').read_text()
    script = textwrap.dedent(workflow.split('          script: |\n', 1)[1])
    bash = shutil.which('bash') if os.name != 'nt' else r'C:\Program Files\Git\bin\bash.exe'
    if not bash or not Path(bash).exists():
        pytest.skip('Local shell unavailable.')
    # Override only shell functions in this local test: no production path or sudo
    # is touched. A missing helper is simulated as the sudo command's failure.
    harness = 'cd() { :; }\nsudo() { return ' + str(sudo_failure) + '; }\ngit() { echo UNEXPECTED_GIT; }\ndocker() { echo UNEXPECTED_DOCKER; }\n' + script
    path = tmp_path / 'workflow.sh'
    path.write_text(harness, encoding='utf-8', newline='\n')
    result = subprocess.run([bash, str(path)], capture_output=True, text=True)
    assert result.returncode == sudo_failure
    assert 'UNEXPECTED_' not in result.stdout + result.stderr


def test_helper_sync_failure_never_reaches_application_replacement(tmp_path):
    workflow = (ROOT / '.github/workflows/deploy.yml').read_text()
    script = textwrap.dedent(workflow.split('          script: |\n', 1)[1])
    bash = shutil.which('bash') if os.name != 'nt' else r'C:\Program Files\Git\bin\bash.exe'
    if not bash or not Path(bash).exists():
        pytest.skip('Local shell unavailable.')
    harness = '''
cd() { :; }
sudo() { case "$3" in --preflight) return 0 ;; --sync) return 1 ;; *) return 99 ;; esac; }
systemctl() { printf 'inactive\n'; }
git() { :; }
python3() { :; }
docker() {
  case "$1 $2" in 'compose build') echo BUILD_REACHED ;; 'ps --format') : ;; *) echo UNEXPECTED_REPLACEMENT; return 99 ;; esac
}
''' + script
    path = tmp_path / 'sync-failure.sh'
    path.write_text(textwrap.dedent(harness), encoding='utf-8', newline='\n')
    result = subprocess.run([bash, str(path)], capture_output=True, text=True)
    assert result.returncode == 1
    assert 'BUILD_REACHED' in result.stdout
    assert 'UNEXPECTED_REPLACEMENT' not in result.stdout + result.stderr


@pytest.mark.skipif(os.name != 'posix', reason='Native directory-fd/ownership acceptance requires Linux.')
def test_linux_atomic_replace_preserves_file_until_all_validations_pass(tmp_path, monkeypatch):
    # Mock only root identity/ownership; the atomic open/replace/fsync operations
    # are real and remain within a temporary, non-production directory.
    directory = os.open(tmp_path, os.O_RDONLY | os.O_DIRECTORY)
    target = tmp_path / 'images.env'
    target.write_text('old-pins')
    real_fstat = os.fstat
    monkeypatch.setattr(host, 'check_pin_file', lambda _: None)
    monkeypatch.setattr(host.os, 'fchown', lambda *_: None)
    monkeypatch.setattr(host.os, 'fstat', lambda descriptor: metadata(mode=real_fstat(descriptor).st_mode))
    try:
        with pytest.raises(host.Blocked):
            host.atomic_replace(directory, {**PINS, 'RK_BACKEND_IMAGE': 'latest'})
        assert target.read_text() == 'old-pins'
        host.atomic_replace(directory, PINS)
        assert target.read_text() == host.pin_text(PINS)
        assert stat.S_IMODE(target.stat().st_mode) == 0o600
        assert list(tmp_path.iterdir()) == [target]
    finally:
        os.close(directory)
