"""Opens Build Tag on an Android phone over the PC's paired adb link, with no public site.

The PC serves this folder on 127.0.0.1 only (nothing is reachable from the network, so no
firewall change), `adb reverse` maps the phone's own localhost:PORT to it, and the phone's
browser opens http://localhost:PORT/. A QR made this way links to localhost, so it opens on
that phone only: this is for testing before the site is public.

    python tools/phone.py --adb <path to adb.exe>            # serve, connect, open; stays up
    python tools/phone.py --adb <path to adb.exe> --check    # only: is the phone reachable?

The phone must be paired with this PC already, with Wireless debugging on (or USB), on the
same Wi-Fi, screen unlocked. It stops after --minutes (default 180) or Ctrl+C and removes
the port mapping. It installs nothing on the phone and changes no phone setting.
"""
import argparse
import functools
import http.server
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NOT_FOUND = ("Phone not found. On the phone: turn on Wireless debugging (or plug in the USB cable), "
             "stay on the same Wi-Fi as the PC and unlock the screen. Then run this again.")
CHROME = "com.android.chrome"


class Handler(http.server.SimpleHTTPRequestHandler):
    hits = []

    def log_message(self, *args):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")  # a fresh copy on every load while testing
        super().end_headers()

    def do_GET(self):
        Handler.hits.append(self.path)
        super().do_GET()


def adb_run(adb, *args, timeout=30):
    return subprocess.run([adb, *args], capture_output=True, text=True, timeout=timeout)


def find_phone(adb, want=None, wait=25):
    """Waits for a paired phone over Wi-Fi (found by mDNS) or USB; restarts adb once."""
    restarted, deadline = False, time.time() + wait
    while True:
        out = adb_run(adb, "devices").stdout
        rows = [l.split("\t")[:2] for l in out.splitlines()[1:] if "\t" in l]
        for serial, state in rows:
            if want and want not in serial:
                continue
            if state == "unauthorized":
                raise SystemExit("The phone is asking to allow this computer: tap Allow on the phone, then run this again.")
            if state == "device":
                return serial
        if time.time() > deadline:
            if restarted:
                raise SystemExit(NOT_FOUND)
            adb_run(adb, "kill-server")
            restarted, deadline = True, time.time() + 20
            continue
        adb_run(adb, "mdns", "services")
        time.sleep(2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--adb", default=shutil.which("adb"), help="path to adb.exe (Android platform-tools)")
    ap.add_argument("--device", default=None, help="adb serial, or part of it; found automatically when left out")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--minutes", type=float, default=180)
    ap.add_argument("--check", action="store_true", help="only check that the phone is reachable")
    a = ap.parse_args()
    if not a.adb or not Path(a.adb).exists():
        raise SystemExit("adb not found: pass --adb <path to adb.exe>.")

    serial = find_phone(a.adb, a.device)
    model = adb_run(a.adb, "-s", serial, "shell", "getprop", "ro.product.model").stdout.strip()
    if a.check:
        print(f"Phone ready: {model} ({serial}).")
        return

    server = http.server.ThreadingHTTPServer(("127.0.0.1", a.port), functools.partial(Handler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f"http://localhost:{a.port}/"
    mapping = f"tcp:{a.port}"
    try:
        r = adb_run(a.adb, "-s", serial, "reverse", mapping, mapping)
        if r.returncode != 0:
            raise SystemExit("Could not map the port on the phone: " + (r.stderr or r.stdout).strip())
        if mapping not in adb_run(a.adb, "-s", serial, "reverse", "--list").stdout:
            raise SystemExit("The port mapping did not stick on the phone.")
        has_chrome = CHROME in adb_run(a.adb, "-s", serial, "shell", "pm", "list", "packages", CHROME).stdout
        start = ["-s", serial, "shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", url]
        adb_run(a.adb, *(start + (["-p", CHROME] if has_chrome else [])))
        before, t0 = len(Handler.hits), time.time()
        while len(Handler.hits) == before and time.time() - t0 < 20:
            time.sleep(0.5)
        if len(Handler.hits) == before:
            print(f"Opened {url} on {model}, but the page has not loaded yet: unlock the phone and check the browser.")
        else:
            time.sleep(4)
            files = sorted({p.split("#")[0].split("?")[0] for p in Handler.hits[before:]})
            print(f"Build Tag is open on {model} at {url} ({'Chrome' if has_chrome else 'default browser'}); "
                  f"the phone loaded {len(files)} files: {', '.join(files)}. "
                  f"Up for {a.minutes:g} minutes; Ctrl+C stops it.", flush=True)
        end = time.time() + a.minutes * 60
        while time.time() < end:
            time.sleep(5)
    except KeyboardInterrupt:
        pass
    finally:
        adb_run(a.adb, "-s", serial, "reverse", "--remove", mapping)
        server.shutdown()
        print(f"Stopped; {len(Handler.hits)} page loads served.")


if __name__ == "__main__":
    sys.exit(main())
