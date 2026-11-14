"""Credential-safe Git/build-context audit. Prints paths/rules, never values.

Models the Docker ignore syntax used by this repository, including parent
exclusions and ordered negation. Unknown syntax fails rather than guessing.
An actual Docker image inspection remains a separate deployment check.
"""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess


def compile_pattern(pattern):
    pattern = pattern.strip("/")
    if any(c in pattern for c in "[]\\"):
        raise ValueError("unsupported_dockerignore_syntax")
    regex, index = "", 0
    while index < len(pattern):
        if pattern[index:index + 3] == "**/":
            regex += "(?:.*/)?"; index += 3
        elif pattern[index:index + 2] == "**":
            regex += ".*"; index += 2
        elif pattern[index] == "*":
            regex += "[^/]*"; index += 1
        elif pattern[index] == "?":
            regex += "[^/]"; index += 1
        else:
            regex += re.escape(pattern[index]); index += 1
    return re.compile("^" + regex + "$")


class DockerIgnore:
    def __init__(self, text):
        self.rules = []
        for line in text.splitlines():
            line = line.strip()
            if not line or line.startswith("#") or line == ".":
                continue
            negative = line.startswith("!")
            self.rules.append((negative, compile_pattern(line[1:] if negative else line)))

    def ignored(self, path):
        path = str(path).replace(os.sep, "/").strip("/")
        parts = path.split("/")
        parents = ["/".join(parts[:i]) for i in range(1, len(parts) + 1)]
        ignored = False
        for negative, regex in self.rules:
            if any(regex.fullmatch(part) for part in parents):
                ignored = not negative
        return ignored


def context_files(root, matcher):
    for directory, dirs, files in os.walk(root, followlinks=False):
        relative = Path(directory).relative_to(root)
        dirs[:] = [name for name in dirs if not matcher.ignored((relative / name).as_posix())]
        for name in files:
            path = relative / name
            if not matcher.ignored(path.as_posix()):
                yield path.as_posix()


def sensitive_path(path):
    item = Path(path)
    name = item.name.lower()
    if name != ".env.example" and (name == ".env" or name.startswith(".env.") or name.startswith(".dev.vars")):
        return True
    return (item.suffix.lower() in {".pem", ".key", ".p12", ".pfx", ".bson", ".dump", ".sql", ".zip", ".7z", ".archive", ".kdbx"}
            or "private" in item.parts or "secrets" in item.parts
            or name.endswith(".json") and any(word in name for word in ("credentials", "service-account")))


PATTERNS = {
    "private_key": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "meta_access_token": re.compile(r"\bEAA[A-Za-z0-9]{40,}"),
    "credential_mongo_uri": re.compile(r"mongodb(?:\+srv)?://[^\s/]+:[^\s@]+@"),
    "aws_access_key": re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
}


def local_secret_values(root):
    values = set()
    for relative in (".env", ".env.local", "backend/.env", "backend/.env.local", "frontend/.env.local"):
        path = root / relative
        if not path.is_file():
            continue
        for line in path.read_text(encoding="utf-8-sig").splitlines():
            key, sep, value = line.partition("=")
            value = value.strip().strip("\"'")
            if sep and re.search(r"SECRET|TOKEN|PASSWORD|MONGO|OUTBOX_KEY", key) and len(value) >= 12:
                values.add(value)
    return values


def scan(root, paths, secrets=()):
    findings = []
    for relative in paths:
        path = root / relative
        if path.is_symlink():
            findings.append({"file": relative, "rule": "symlink_requires_review"}); continue
        if sensitive_path(relative):
            findings.append({"file": relative, "rule": "sensitive_path"}); continue
        raw = path.read_bytes()
        if b"\x00" in raw:
            continue
        text = raw.decode("utf-8-sig", errors="replace")
        for name, pattern in PATTERNS.items():
            if pattern.search(text):
                findings.append({"file": relative, "rule": name})
        if any(secret in text for secret in secrets):
            findings.append({"file": relative, "rule": "known_local_secret"})
    return findings


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--git", action="store_true", help="Scan tracked and non-ignored untracked files instead of build context.")
    args = parser.parse_args()
    root = args.root.resolve()
    if args.git:
        paths = subprocess.check_output(["git", "ls-files", "--cached", "--others", "--exclude-standard"], cwd=root, text=True).splitlines()
        paths = [path for path in paths if (root / path).is_file()]
    else:
        matcher = DockerIgnore((root / ".dockerignore").read_text(encoding="utf-8-sig"))
        paths = list(context_files(root, matcher))
    findings = scan(root, paths, local_secret_values(root))
    print(json.dumps({"mode": "git" if args.git else "modeled_docker_context", "filesScanned": len(paths), "findings": findings}, sort_keys=True))
    return int(bool(findings))


if __name__ == "__main__":
    raise SystemExit(main())
