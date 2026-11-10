"""Checks the repo is safe to make public, then (only with --go) publishes it.

Default is a dry run: it runs every check and prints what it would do, and
touches nothing outside this folder. With --go it makes the public GitHub repo
DnA-Arkitecs/car-build-qr if missing, pushes the main branch, turns on GitHub
Pages from main, and waits until the site answers.

    python tools/publish.py --deny-file <path to a private deny list>          # dry run
    python tools/publish.py --deny-file <path> --go                            # publish

--deny-file: a private file of strings that must never appear in this repo
(names of people and firms). Only YAML list lines of the form  - 'regex'  are
read, as case-insensitive regular expressions; a file with none fails the
check. The file stays outside the repo, so the names in it are never published.
Every check runs over the tracked files and over every commit's diff.

Publishing is an outside write: run --go only on the owner's typed yes.
"""
import argparse
import json
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OWNER, NAME = "DnA-Arkitecs", "car-build-qr"
SITE = f"https://dna-arkitecs.github.io/{NAME}/"
DESCRIPTION = "List a car's mods, print a QR sticker, and anyone at a show scans it to see the full build. No app, no account, no server."

SECRET_PATTERNS = [
    r"-----BEGIN [A-Z ]*PRIVATE KEY-----", r"\bghp_[A-Za-z0-9]{20,}", r"\bgithub_pat_[A-Za-z0-9_]{20,}",
    r"\bsk-[A-Za-z0-9]{20,}", r"\bAKIA[0-9A-Z]{16}\b", r"\bxox[abp]-[A-Za-z0-9-]{10,}", r"password\s*[:=]\s*\S+",
    # any email address except GitHub's and Anthropic's noreply ones (commit trailers)
    # and the reserved example.com/.net/.org test domains (RFC 2606)
    r"\b[A-Za-z0-9._%+-]+@(?!users\.noreply\.github\.com\b|anthropic\.com\b|(?:[A-Za-z0-9-]+\.)*example\.(?:com|net|org)\b)"
    r"[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b",
    r"\b[A-Za-z]:\\Users\\", r"\b[A-Za-z]:/Users/", r"/home/[a-z]", r"/Users/[A-Za-z]",
]
PNG_TEXT_CHUNKS = (b"tEXt", b"iTXt", b"zTXt", b"eXIf")


def run(*cmd, **kw):
    return subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace", **kw)


def deny_patterns(path):
    pats = []
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        line = line.strip()
        m = re.match(r"^-\s*'(.*)'\s*(#.*)?$", line) or re.match(r'^-\s*"(.*)"\s*(#.*)?$', line)
        if m:
            pats.append(m.group(1))
    return [re.compile(p, re.I) for p in pats]


def scan_text(name, text, deny, secrets):
    found = []
    for rx in deny:
        if rx.search(text):
            found.append(f"{name}: matches a deny-list pattern")
    if name == "tools/publish.py":
        return found  # holds the secret patterns themselves
    for rx in secrets:
        m = rx.search(text)
        if m:
            found.append(f"{name}: looks like a secret, an address or a private path ({m.group(0)[:40]!r})")
    return found


def checks(deny_file):
    problems = []
    status = run("git", "status", "--porcelain")
    if status.stdout.strip():
        problems.append("uncommitted changes:\n" + status.stdout)
    branch = run("git", "rev-parse", "--abbrev-ref", "HEAD").stdout.strip()
    if branch != "main":
        problems.append(f"on branch {branch}, not main")
    files = [f for f in run("git", "ls-files").stdout.splitlines() if f]
    deny = deny_patterns(deny_file) if deny_file else []
    if deny_file and not deny:
        problems.append(f"no patterns read from {deny_file}")
    secrets = [re.compile(p) for p in SECRET_PATTERNS]
    for f in files:
        p = ROOT / f
        if p.stat().st_size > 1_000_000:
            problems.append(f"{f} is over 1 MB")
        if p.suffix.lower() in {".png", ".jpg", ".jpeg", ".ico", ".gif", ".webp"}:
            data = p.read_bytes()
            if p.suffix.lower() == ".png" and any(c in data for c in PNG_TEXT_CHUNKS):
                problems.append(f"{f}: the image carries text metadata; strip it")
            elif p.suffix.lower() != ".png":
                problems.append(f"{f}: only PNG images are checked; convert it or check it by hand")
            continue
        problems += scan_text(f, p.read_text(encoding="utf-8", errors="replace"), deny, secrets)
    # Every commit's changes too, so nothing removed later is still in history.
    history = run("git", "log", "-p", "--all", "--format=commit %H", "--", ".", ":(exclude)tools/publish.py", ":(exclude)*.png")
    problems += scan_text("git history", history.stdout, deny, secrets)
    log = run("git", "log", "--format=%an <%ae>").stdout.splitlines()
    for who in set(log):
        if not who.endswith("@users.noreply.github.com>"):
            problems.append(f"a commit is authored by {who}: use the GitHub noreply address")
    unit = run("npm", "test", shell=sys.platform == "win32")
    if unit.returncode != 0:
        problems.append("unit tests fail:\n" + unit.stdout[-2000:])
    e2e = run(sys.executable, "test/e2e.py", timeout=600)
    if e2e.returncode != 0:
        problems.append("browser dry run fails:\n" + e2e.stdout[-2000:])
    return files, problems, unit, e2e


def token():
    out = subprocess.run(["git", "credential", "fill"], input="protocol=https\nhost=github.com\n\n",
                         capture_output=True, text=True, check=True).stdout
    return next(l.split("=", 1)[1] for l in out.splitlines() if l.startswith("password="))


def api(tok, method, path, body=None):
    req = urllib.request.Request("https://api.github.com/" + path, method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": f"Bearer {tok}", "Accept": "application/vnd.github+json"})
    try:
        with urllib.request.urlopen(req) as r:
            text = r.read().decode()
            return r.status, (json.loads(text) if text else {})
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")


def publish():
    tok = token()
    status, _ = api(tok, "GET", f"repos/{OWNER}/{NAME}")
    if status == 404:
        status, repo = api(tok, "POST", "user/repos", {"name": NAME, "private": False, "description": DESCRIPTION,
                                                       "homepage": SITE, "has_wiki": False, "has_projects": False})
        assert status == 201, repo
        print("Made public repo", repo["html_url"])
    push = run("git", "push", f"https://github.com/{OWNER}/{NAME}.git", "main:main")
    if push.returncode != 0:
        raise SystemExit("push failed:\n" + push.stderr)
    print("Pushed main")
    status, pages = api(tok, "GET", f"repos/{OWNER}/{NAME}/pages")
    if status == 404:
        status, pages = api(tok, "POST", f"repos/{OWNER}/{NAME}/pages", {"source": {"branch": "main", "path": "/"}})
        assert status in (201, 409), pages
    for _ in range(30):
        try:
            with urllib.request.urlopen(SITE) as r:
                if r.status == 200 and b"Build Tag" in r.read():
                    print("Live:", SITE)
                    return
        except urllib.error.HTTPError:
            pass
        time.sleep(20)
    print("Pushed, but the site is not live yet; check", SITE, "in a few minutes.")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--deny-file", required=True)
    ap.add_argument("--go", action="store_true", help="publish (outside write; needs the owner's yes)")
    args = ap.parse_args()
    files, problems, unit, e2e = checks(args.deny_file)
    tests = re.search(r"ℹ pass (\d+)", unit.stdout)
    dry = re.search(r"(\d+) of (\d+) checks passed", e2e.stdout)
    print(f"{len(files)} tracked files checked; unit tests passed: {tests.group(1) if tests else '?'}; "
          f"browser dry run: {dry.group(0) if dry else '?'}")
    if problems:
        print("NOT SAFE TO PUBLISH:")
        for p in problems:
            print(" -", p)
        sys.exit(1)
    print("All checks pass.")
    if not args.go:
        print(f"Dry run: would make public repo {OWNER}/{NAME}, push main, turn on Pages, site {SITE}")
        return
    publish()


if __name__ == "__main__":
    main()
