"""Validate/synchronize image-only worker pins; never build, pull or run a container.

All subprocess output is captured. In particular Compose's resolved environment
must never reach deployment logs. Sync requires stopped timers/services, locks,
and root; validation is read-only and runs before either systemd command.
"""
import argparse
from contextlib import contextmanager
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
PIN_FILE = Path('/etc/rk-whatsapp/images.env')
SERVICES = {'backend': 'RK_BACKEND_IMAGE', 'frontend': 'RK_FRONTEND_IMAGE'}
NAMES = ('rk-whatsapp-worker', 'rk-whatsapp-template-refresh')
IMMUTABLE = re.compile(r'[a-z0-9][a-z0-9._:/-]*@sha256:[a-f0-9]{64}')


class ValidationError(Exception):
    pass


def capture(args, *, env=None, cwd=ROOT):
    try:
        return subprocess.check_output(args, cwd=cwd, env=env, stderr=subprocess.PIPE,
                                       text=True, timeout=120).strip()
    except (subprocess.SubprocessError, OSError):
        # Command output can contain application secrets. Never forward it.
        raise ValidationError('Required local Docker/Compose/systemd inspection failed; inspect privately.') from None


def pins_from_text(text):
    pins = {}
    for line in text.splitlines():
        if not line.strip() or line.lstrip().startswith('#'):
            continue
        name, sep, value = line.partition('=')
        if not sep or name not in SERVICES.values() or name in pins or not IMMUTABLE.fullmatch(value):
            raise ValidationError('Image file must contain exactly two immutable repository digest assignments.')
        pins[name] = value
    if set(pins) != set(SERVICES.values()):
        raise ValidationError('Both backend and frontend immutable image pins are required.')
    return pins


def read_pins(path):
    try:
        return pins_from_text(path.read_text(encoding='utf-8'))
    except OSError:
        raise ValidationError('Image pin file is unavailable.') from None


def compose_args(worker=False, compose=None):
    args = list(compose or ['docker', 'compose']) + ['-f', 'docker-compose.yml', '-f', 'deploy/docker-compose.release.yml']
    if worker:
        args += ['-f', 'deploy/docker-compose.worker.yml']
    return args


def merged_models(pins, *, compose=None, cwd=ROOT):
    env = {**os.environ, **pins}
    try:
        release = json.loads(capture(compose_args(compose=compose) + ['config', '--format', 'json'], env=env, cwd=cwd))
        worker = json.loads(capture(compose_args(True, compose) + ['config', '--format', 'json'], env=env, cwd=cwd))
    except ValueError:
        raise ValidationError('Compose did not return a valid merged JSON model.') from None
    validate_models(release, worker, pins)
    return release, worker


def validate_models(release, worker, pins):
    try:
        for service, key in SERVICES.items():
            if release['services'][service]['image'] != pins[key] or worker['services'][service]['image'] != pins[key]:
                raise ValidationError('Merged Compose image does not match its reviewed pin.')
        backend = worker['services']['backend']
        # !reset null is serialized as an ABSENT build key by Compose 5.5.0.
        # Both absence and explicit null mean no build; an empty map is unsafe.
        if backend.get('build') is not None:
            raise ValidationError('Worker backend must have no build configuration (null/absent).')
        if set(backend['networks']) != {'rk-internal'}:
            raise ValidationError('Worker must use the existing rk-internal network.')
        for model in (release, worker):
            if set(model['services']['frontend']['networks']) != {'rk-internal'}:
                raise ValidationError('Frontend must retain the existing network.')
        if release['networks'] != worker['networks']:
            raise ValidationError('Worker network definition differs from the release network.')
        original = {k: v for k, v in release['services']['backend'].items() if k != 'build'}
        effective = {k: v for k, v in backend.items() if k != 'build'}
        if original != effective:
            raise ValidationError('Worker override changed backend settings besides removing build.')
    except (KeyError, TypeError):
        raise ValidationError('Merged Compose model lacks the required service/network settings.') from None


def inspect_image(reference):
    try:
        # Project only non-secret identity fields, never image ENV or full inspect.
        result = json.loads(capture(['docker', 'image', 'inspect', '--format',
            '{"id":{{json .Id}},"digests":{{json .RepoDigests}}}', reference]))
        if not re.fullmatch(r'sha256:[a-f0-9]{64}', result['id']):
            raise ValueError()
        return result
    except (ValueError, KeyError, TypeError):
        raise ValidationError('Local image identity could not be verified.') from None


def built_references(*, compose=None, cwd=ROOT):
    command = list(compose or ['docker', 'compose']) + ['-f', 'docker-compose.yml', 'config']
    try:
        model = json.loads(capture(command + ['--format', 'json'], cwd=cwd))
        # Compose 5.5.0 config --images returns ALL services even when a service
        # argument is supplied. Bind each default tag to the actual project name,
        # then verify it is present in Compose's own rendered image inventory.
        rendered = set(capture(command + ['--images'], cwd=cwd).splitlines())
        refs = {service: model['services'][service].get('image') or model['name'] + '-' + service
                for service in SERVICES}
        if len(set(refs.values())) != 2 or not set(refs.values()).issubset(rendered):
            raise ValidationError('Cannot identify the Compose-built service images.')
        return refs
    except (ValueError, KeyError, TypeError):
        raise ValidationError('Cannot identify the Compose-built service images.') from None


def select_pins(refs):
    pins = {}
    for service, reference in refs.items():
        built = inspect_image(reference)
        # Select a real RepoDigest of this exact repository, never synthesize a
        # manifest reference from a config Image ID or fall back to a mutable tag.
        repository = reference.split('@', 1)[0]
        if ':' in repository.rsplit('/', 1)[-1]:
            repository = repository.rsplit(':', 1)[0]
        candidates = sorted(d for d in (built.get('digests') or [])
                            if IMMUTABLE.fullmatch(d) and d.split('@')[0] == repository)
        if not candidates:
            raise ValidationError('Built image has no usable local RepoDigest; publish/load a reviewed digest before deployment.')
        pin = candidates[0]
        if inspect_image(pin)['id'] != built['id']:
            raise ValidationError('Repository digest does not identify the Compose-built image.')
        pins[SERVICES[service]] = pin
    return pins


def validate_local_images(pins, *, require_running=False):
    refs = built_references()
    for service, key in SERVICES.items():
        pin = pins[key]
        pinned, built = inspect_image(pin), inspect_image(refs[service])
        if pinned['id'] != built['id'] or pin not in (built.get('digests') or []):
            raise ValidationError('Stale image pin: it differs from the locally deployed build.')
        if require_running:
            running = capture(['docker', 'container', 'inspect', '--format',
                '{{if .State.Running}}{{.Image}}{{end}}', 'rk-' + service])
            if running != pinned['id']:
                raise ValidationError('Image pin does not match the running application container.')


def require_paused():
    for name in NAMES:
        for suffix in ('timer', 'service'):
            state = capture(['systemctl', 'show', name + '.' + suffix, '--property=ActiveState', '--value'])
            allowed = {'inactive'} if suffix == 'timer' else {'inactive', 'failed'}
            if state not in allowed:
                raise ValidationError('Authorized operator must pause both WhatsApp timers and services before deployment.')
    running = capture(['docker', 'ps', '--format', '{{.Names}}']).splitlines()
    if set(running).intersection(NAMES):
        raise ValidationError('A WhatsApp worker/refresh container is still running.')


@contextmanager
def paused_locks():
    import fcntl  # Production-only Linux operation; not needed for read-only config tests.
    handles = []
    try:
        for name in NAMES:
            handle = open('/run/lock/' + name + '.lock', 'a')
            handles.append(handle)
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        require_paused()
        yield
        require_paused()
    except BlockingIOError:
        raise ValidationError('WhatsApp execution lock is held; no image pins changed.') from None
    finally:
        for handle in reversed(handles):
            handle.close()


def atomic_write(path, pins):
    if os.geteuid() != 0 or path != PIN_FILE:
        raise ValidationError('Pin synchronization requires root and the protected image-only path.')
    directory = path.parent
    if directory.is_symlink() or path.is_symlink():
        raise ValidationError('Protected image path must not be a symlink.')
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    if directory.stat().st_uid != 0 or directory.stat().st_mode & 0o022:
        raise ValidationError('Protected image directory must be root-owned and not group/world writable.')
    content = ''.join(f'{key}={pins[key]}\n' for key in SERVICES.values())
    pins_from_text(content)
    temporary = None
    try:
        fd, temporary = tempfile.mkstemp(prefix='.images-', dir=directory)
        with os.fdopen(fd, 'w', encoding='utf-8', newline='\n') as output:
            os.fchmod(output.fileno(), 0o600)
            os.fchown(output.fileno(), 0, 0)
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
        temporary = None
        directory_fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        if temporary:
            os.unlink(temporary)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=['check-paused', 'sync', 'validate'])
    parser.add_argument('--pins', type=Path, default=PIN_FILE)
    parser.add_argument('--require-running', action='store_true')
    args = parser.parse_args()
    try:
        if args.operation == 'check-paused':
            require_paused()
        elif args.operation == 'sync':
            if args.pins != PIN_FILE:
                raise ValidationError('Sync only writes the protected image-only configuration.')
            with paused_locks():
                pins = select_pins(built_references())
                merged_models(pins)
                validate_local_images(pins, require_running=args.require_running)
                atomic_write(args.pins, pins)
        else:
            pins = read_pins(args.pins)
            merged_models(pins)
            validate_local_images(pins, require_running=args.require_running)
        print(json.dumps({'whatsappImageConfiguration': 'verified', 'operation': args.operation}))
    except (ValidationError, OSError) as error:
        reason = str(error) if isinstance(error, ValidationError) else 'Protected local configuration unavailable.'
        print(json.dumps({'whatsappImageConfiguration': 'blocked', 'reason': reason}))
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
