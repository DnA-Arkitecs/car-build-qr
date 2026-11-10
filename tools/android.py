"""Builds the Android app (a debug APK) and, with --install, puts it on a paired phone.

    python tools/android.py --toolchain <toolchain.json>              # build dist/BuildTag-debug.apk
    python tools/android.py --toolchain <toolchain.json> --install    # build, install, open it

<toolchain.json> names a local JDK, Gradle and Android SDK:
    {"java_home": ..., "gradle": ..., "sdk": ..., "gradle_user_home": ...}
The page files are copied into the app first, so the app always runs the same
page as the website. The debug signing key is made on first build in
android/.android-user (kept out of git); keep it, or the next install has to
remove the old app first. Installing needs the phone paired with this PC and
Wireless debugging on (see tools/phone.py).
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ANDROID = ROOT / "android"
ASSETS = ANDROID / "app" / "src" / "main" / "assets" / "web"
APK_OUT = ANDROID / "app" / "build" / "outputs" / "apk" / "debug" / "app-debug.apk"
DIST = ROOT / "dist" / "BuildTag-debug.apk"
PACKAGE = "io.github.dnaarkitecs.buildtag"
WEB_FILES = ["index.html", "icon.svg", "icon-180.png", "css", "js", "vendor/qrcode.js"]


def copy_page():
    if ASSETS.exists():
        shutil.rmtree(ASSETS)
    for item in WEB_FILES:
        src, dst = ROOT / item, ASSETS / item
        dst.parent.mkdir(parents=True, exist_ok=True)
        if src.is_dir():
            shutil.copytree(src, dst)
        else:
            shutil.copy2(src, dst)
    return sum(1 for p in ASSETS.rglob("*") if p.is_file())


def build(tc, online):
    env = os.environ.copy()
    env.update(JAVA_HOME=tc["java_home"], ANDROID_HOME=tc["sdk"], GRADLE_USER_HOME=tc["gradle_user_home"],
               ANDROID_USER_HOME=str(ANDROID / ".android-user"))
    env["PATH"] = str(Path(tc["java_home"]) / "bin") + os.pathsep + env["PATH"]
    cmd = [tc["gradle"], "--no-daemon", "--console=plain", "-p", str(ANDROID), "assembleDebug"]
    if not online:
        cmd.insert(1, "--offline")
    r = subprocess.run(cmd, cwd=ANDROID, env=env)
    if r.returncode != 0 or not APK_OUT.exists():
        raise SystemExit("The Android build failed; nothing was installed.")
    DIST.parent.mkdir(exist_ok=True)
    shutil.copy2(APK_OUT, DIST)
    return DIST


def install(adb, apk, device):
    sys.path.insert(0, str(ROOT / "tools"))
    from phone import find_phone, adb_run  # noqa: E402 - sibling helper
    serial = find_phone(adb, device)
    r = adb_run(adb, "-s", serial, "install", "-r", str(apk), timeout=180)
    if "Success" not in r.stdout:
        raise SystemExit("Install failed: " + (r.stdout + r.stderr).strip()[-400:])
    adb_run(adb, "-s", serial, "shell", "am", "start", "-n", f"{PACKAGE}/.MainActivity")
    model = adb_run(adb, "-s", serial, "shell", "getprop", "ro.product.model").stdout.strip()
    return serial, model


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--toolchain", required=True)
    ap.add_argument("--install", action="store_true")
    ap.add_argument("--online", action="store_true", help="let Gradle download missing build parts")
    ap.add_argument("--device", default=None)
    a = ap.parse_args()
    tc = json.loads(Path(a.toolchain).read_text(encoding="utf-8"))
    print(f"Packed {copy_page()} page files into the app.", flush=True)
    apk = build(tc, a.online)
    print(f"Built {apk.relative_to(ROOT)} ({apk.stat().st_size // 1024} KB).", flush=True)
    if a.install:
        adb = str(Path(tc["sdk"]) / "platform-tools" / ("adb.exe" if os.name == "nt" else "adb"))
        serial, model = install(adb, apk, a.device)
        print(f"Installed and opened Build Tag on {model} ({serial}).")


if __name__ == "__main__":
    main()
