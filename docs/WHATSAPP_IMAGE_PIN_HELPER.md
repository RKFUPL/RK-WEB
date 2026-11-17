# Host-installed WhatsApp image-pin helper

This local change fixes the failed deployment at commit
`cd1a65ceac9183af910e5c7a396119f0bf9f29ac`: `sudo -n python3
scripts/whatsapp_images.py sync` required interactive authentication. Granting
passwordless Python or a repository script would let writable deployment code run
arbitrary commands as root. That command is removed. The repository script now
supports only read-only `check-paused` and `validate` operations.

## Security boundary

The administrator installs the separately reviewed helper at
`/usr/local/sbin/rk-whatsapp-image-pin-sync`, **root:root 0755**, beneath protected
root-owned directories. The deployment account cannot replace it or its parents.
The helper verifies its installed path, ownership, permissions and path ancestors.
It uses `/usr/bin/python3 -I` with standard-library imports only. Isolated Python
excludes the repository/script directory and user packages and ignores Python
environment injection. It never imports or executes repository code as root.

Only `--preflight` and `--sync`, with no additional arguments, are accepted. The
helper executes `/usr/bin/systemctl` and `/usr/bin/docker` only, in the fixed
project `/opt/apps/rashi-kapoor/rk-web`. It supplies a clean environment, a fixed
local Docker socket, and a protected `/etc/rk-whatsapp/docker-cli` configuration
directory. It never invokes Compose or a shell, loads application `.env`, contacts
Meta, starts a container/service, modifies gates or touches MongoDB.

Both commands verify installed timer/service quiescence and the absence of named
worker/refresh containers, and take the two existing nonblocking execution locks.
Lock opens use directory descriptors, `O_NOFOLLOW`, root ownership, regular-file
and hard-link checks. Root-owned sticky `/run/lock` is supported; an untrusted
symlink/precreated lock fails closed. The same restrictions protect the pin
directory and existing `images.env`; an existing file must be root:root 0600.

`--preflight` checks installed paths, permissions, paused state and available
execution locks without changing image pins. `--sync` inspects only
`rk-web-backend:latest` and `rk-web-frontend:latest` and their exact expected
repository digests. The build tags locate the builds; **only real RepoDigests are
written**, after local digest inspection proves the same image ID. There is no
mutable-tag/image-ID fallback. A second read detects changes before commit.

Synchronization writes exactly `RK_BACKEND_IMAGE` and `RK_FRONTEND_IMAGE` to one
fixed target. The temporary file is exclusive/no-follow, root:root 0600, written
and fsynced before directory-relative atomic rename; the directory is fsynced
afterward. All validation failures preserve prior pins. A filesystem error after
the rename can leave the new atomic file in place while the command fails; the
workflow stops and leaves jobs paused for inspection, rather than claiming an
unperformed rollback.

After commit, stdout contains only the two non-secret image assignments. Other
helper failures expose a fixed safe diagnostic, never raw subprocess output or
application environment. The root-only pin file remains 0600; the helper does not
make it readable by the deployment account.

This adds a narrow sudo capability. The existing deploy account's access to the
Docker daemon is already powerful; this change neither grants nor expands that
separate permission. Root-owned file protection cannot defend against an actor
who already has unrestricted host-root/Docker authority.

## Exact sudoers scope

The provided `deploy/sudoers/rk-whatsapp-image-pin-sync` contains:

```sudoers
athul ALL=(root) NOPASSWD: NOSETENV: /usr/local/sbin/rk-whatsapp-image-pin-sync --preflight, /usr/local/sbin/rk-whatsapp-image-pin-sync --sync
```

There are no wildcard arguments and no permission for Python, Docker, a shell,
`install`, arbitrary scripts or `NOPASSWD: ALL`. The helper itself also rejects
extra arguments. The GitHub `VPS_USER` must be the existing `athul` account. If it
is not, stop and have the administrator review the intended account; do not
broaden the rule. Host policy must be checked with the actual `visudo` version.

## One-time installation by the VPS administrator

**Do not push this workflow until installation and preflight succeed.** These
commands are instructions for an approved administrator, not commands executed
during this task. Timers must stay paused and all five sending gates stay OFF.
No command below starts a WhatsApp worker or inventory refresh.

The helper is not yet on the VPS main checkout. Transfer only these two reviewed
files from the local candidate, independently of the deployment workflow. From
the repository in Windows PowerShell:

```powershell
scp -i "$env:USERPROFILE\.ssh\id_ed25519_hostinger_vps" deploy/host/rk-whatsapp-image-pin-sync athul@187.127.175.69:/tmp/rk-whatsapp-image-pin-sync.reviewed
scp -i "$env:USERPROFILE\.ssh\id_ed25519_hostinger_vps" deploy/sudoers/rk-whatsapp-image-pin-sync athul@187.127.175.69:/tmp/rk-whatsapp-image-pin-sync.sudoers.reviewed
ssh -i "$env:USERPROFILE\.ssh\id_ed25519_hostinger_vps" athul@187.127.175.69
```

Obtain the administrator's existing interactive root session (`sudo -i`, entering
the password privately). Do not grant passwordless installation commands. Copy
into a private root-owned review directory **before** inspecting/executing code;
validate the copied bytes against the reviewed candidate hashes:

```sh
set -eu
test ! -L /root/rk-whatsapp-image-pin-review
/usr/bin/install -d -o root -g root -m 0700 /root/rk-whatsapp-image-pin-review
/usr/bin/install -o root -g root -m 0600 /tmp/rk-whatsapp-image-pin-sync.reviewed /root/rk-whatsapp-image-pin-review/helper
/usr/bin/install -o root -g root -m 0600 /tmp/rk-whatsapp-image-pin-sync.sudoers.reviewed /root/rk-whatsapp-image-pin-review/sudoers
printf '%s\n' \
  'a6efbf38abfc59ad2b16d98f7ffaba447e16fa68fc64b6f715d7f0f77971b815  /root/rk-whatsapp-image-pin-review/helper' \
  'b29a68fd192ef42b207e9bb7e8c7bcaf5f75c0d1cd1666d68be9c15ebc60b313  /root/rk-whatsapp-image-pin-review/sudoers' \
  | /usr/bin/sha256sum -c -
/usr/bin/python3 -I -c 'import ast,pathlib; ast.parse(pathlib.Path("/root/rk-whatsapp-image-pin-review/helper").read_text()); print("helper syntax: valid")'
/usr/sbin/visudo -cf /root/rk-whatsapp-image-pin-review/sudoers
```

Expected: both hashes `OK`, Python syntax valid, sudoers parsed OK. Review these
root-owned copies, not a moving writable repository file. If the candidate bytes
change, obtain a newly reviewed hash; do not bypass hash checks or silently
normalize source bytes. `.gitattributes` enforces LF for these installable files.

Still in the administrator shell, inspect protected directory ownership with
`namei -l /usr/local/sbin /etc/sudoers.d /etc/rk-whatsapp`. Stop on unexpected
symlinks or writable ownership; do not blindly change existing host directories.
Then install the reviewed helper and policy atomically:

```sh
test ! -L /etc/rk-whatsapp
test ! -L /etc/rk-whatsapp/docker-cli
/usr/bin/install -d -o root -g root -m 0700 /etc/rk-whatsapp
/usr/bin/install -d -o root -g root -m 0700 /etc/rk-whatsapp/docker-cli
# Keep this dedicated Docker CLI config directory empty; no credentials needed.
/usr/bin/install -o root -g root -m 0755 /root/rk-whatsapp-image-pin-review/helper /usr/local/sbin/.rk-whatsapp-image-pin-sync.new
/usr/bin/mv -T /usr/local/sbin/.rk-whatsapp-image-pin-sync.new /usr/local/sbin/rk-whatsapp-image-pin-sync
/usr/bin/install -o root -g root -m 0440 /root/rk-whatsapp-image-pin-review/sudoers /etc/sudoers.d/.rk-whatsapp-image-pin-sync.new
/usr/sbin/visudo -cf /etc/sudoers.d/.rk-whatsapp-image-pin-sync.new
/usr/bin/mv -T /etc/sudoers.d/.rk-whatsapp-image-pin-sync.new /etc/sudoers.d/rk-whatsapp-image-pin-sync
/usr/sbin/visudo -cf /etc/sudoers.d/rk-whatsapp-image-pin-sync
/usr/sbin/visudo -c
/usr/bin/stat -c '%U:%G %a %n' /usr/local/sbin/rk-whatsapp-image-pin-sync /etc/sudoers.d/rk-whatsapp-image-pin-sync
/usr/local/sbin/rk-whatsapp-image-pin-sync --preflight
```

Expected: helper root:root 755, sudoers root:root 440, sudoers checks pass, preflight
returns `whatsappImagePinPreflight=verified`. The administrator must confirm an
existing `/etc/rk-whatsapp/images.env` is root:root 600 and a normal single-link
file. Do not print its contents, modify application `.env`, rotate keys or start
units to make preflight pass. If ownership/path/locks/paused checks fail, investigate
and obtain authorization for the precise correction. Installation does not run
`--sync`; it does not change the current image pins.

Exit the root shell, returning to `athul`, then verify passwordless access:

```sh
sudo -n /usr/local/sbin/rk-whatsapp-image-pin-sync --preflight
test ! -w /usr/local/sbin/rk-whatsapp-image-pin-sync
test ! -w /usr/local/sbin
test ! -w /etc/sudoers.d
```

Expected: preflight succeeds without a password, all writeability tests return 0.
The administrator can inspect `sudo -l -U athul` privately to confirm the exact two
new commands and absence of any newly added broad grant. Check the host's existing
effective ACLs/rules rather than assuming a mode listing proves all permissions.
Only then review and authorize any main push/deployment. None is performed here.

## Deployment sequence and non-root validation

The workflow remains on `main`; it performs these steps:

1. `sudo -n /usr/local/sbin/rk-whatsapp-image-pin-sync --preflight`, before git or
   image changes; missing helper, sudo denial, active jobs/locks or unsafe files
   stop the workflow here. Independent non-root paused checks remain as well.
2. Existing fetch/reset to `origin/main`, then base `docker compose build`.
3. `sudo -n /usr/local/sbin/rk-whatsapp-image-pin-sync --sync` redirects the two
   image references to a `mktemp` file owned by the deploy account, under umask 077.
   A failure stops before application replacement. The protected file stays 0600.
4. Non-root `python3 scripts/whatsapp_images.py validate --pins "$pin_file"`
   verifies actual release/worker merged JSON, immutable digests, local image IDs,
   absence of backend build, environment equality and existing networks. Only
   validated assignments are exported into the non-root deployment shell.
5. The three-file release Compose function runs `up -d --no-build --pull never`.
   It uses the verified **immutable** images; base-only up would use mutable build
   tags and is therefore replaced. Existing application `.env` and networks remain.
6. Health check and non-root `validate --pins "$pin_file" --require-running`
   prove both containers use the selected images. Final paused/preflight checks
   confirm jobs stayed quiescent. The temporary image-only file is removed on exit.

The supplied current deployment built valid new digests while old containers
continued running. Pre-replacement validation therefore checks pins against
**builds**, and post-replacement validation additionally checks **running** images.
Do not require new pins to match the old running images before replacement.
The helper never hardcodes the supplied current digest hashes.

No deployment step starts, enables, restarts or invokes worker/refresh services
or timers, installs host files/policies, changes gates, runs outbox work or refreshes
Meta. An image-pin change is not authority to resume dispatch. The stable outbox,
key continuity and provider checks in the final readiness report remain required.

If a helper/Compose/image validation fails, leave timers paused and containers
unchanged; investigate. If sync succeeds but a later check fails, pins may name
the new builds while containers remain old. Do not start workers: the existing
systemd image-parity precheck blocks that mismatch. Reconcile the reviewed build
and pin identities before a separately authorized retry/rollback.

## Validation evidence

Final local test results are recorded in `WHATSAPP_FINAL_PRODUCTION_READINESS.md`.
Tests cover invalid arguments, missing/denied helper access before git/build,
timer/service/container/lock blocks, missing/wrong/unavailable RepoDigests, image
identity changes, symlinks/ownership/modes/hardlinks, atomic file ordering, pin
preservation on validation failure, fixed subprocess environment, exact sudo
scope and main workflow order. Real Compose 5.5.0 merge tests use a synthetic
environment. No test touches production or sends a message.

Native `visudo` and Linux filesystem acceptance must be performed on the approved
host; the Windows test environment cannot establish those host facts. Sudo's
manual is [sudoers](https://www.sudo.ws/docs/man/sudoers.man/); Python isolated-mode
behavior is documented in [Python command-line options](https://docs.python.org/3/using/cmdline.html#cmdoption-I).
