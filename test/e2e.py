"""End-to-end dry run in real browsers: iPhone Safari (WebKit, iPhone 15 profile),
Android Chrome (Chromium, Pixel 7 profile) and Edge on a phone-size screen.

An owner builds a car, the rendered sticker is scanned by a real QR decoder,
and the scanned link is opened on a second, fresh phone the way a stranger at a
show would. Also checks hostile and damaged links, backups, printing and the
page's security policy.

Run: python test/e2e.py [--browser webkit|android|edge|all]   (screenshots in test/out/)
"""
import argparse
import base64
import functools
import http.server
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "test" / "out"
PHONE = dict(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)

results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + (f"  ({detail})" if detail else ""), flush=True)


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def start_server():
    handler = functools.partial(Quiet, directory=str(ROOT))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f"http://127.0.0.1:{server.server_address[1]}/"


def launch(p, kind):
    """Returns (browser, phone context options, label)."""
    if kind == "webkit":
        device = dict(p.devices["iPhone 15"])
        device.pop("default_browser_type", None)
        return p.webkit.launch(), device, "iPhone Safari (WebKit)"
    if kind == "android":
        device = dict(p.devices["Pixel 7"])
        device.pop("default_browser_type", None)
        for channel in ("chrome", "msedge"):
            try:
                return p.chromium.launch(channel=channel), device, f"Android Chrome profile (Pixel 7) on {channel}"
            except Exception:  # noqa: BLE001 - try the next installed browser
                continue
        return p.chromium.launch(), device, "Android Chrome profile (Pixel 7) on chromium"
    for channel in ("msedge", "chrome"):
        try:
            return p.chromium.launch(channel=channel), PHONE, f"{channel} phone screen"
        except Exception:  # noqa: BLE001 - try the next installed browser
            continue
    return p.chromium.launch(), PHONE, "chromium phone screen"


def watch(page, sink):
    def on_console(m):
        if m.type == "error":
            where = m.location or {}
            sink.append(f"console error at {where.get('url', '?')}:{where.get('lineNumber', '?')} "
                        f"(page {page.url[:60]}): {m.text}")
    page.on("console", on_console)
    page.on("pageerror", lambda e: sink.append(f"pageerror: {e}"))


RASTER_JS = """async ([selector, w]) => {
  const svg = document.querySelector(selector);
  const markup = new XMLSerializer().serializeToString(svg);
  const img = new Image();
  const url = URL.createObjectURL(new Blob([markup], {type: 'image/svg+xml'}));
  await new Promise((ok, bad) => { img.onload = ok; img.onerror = bad; img.src = url; });
  const vb = svg.viewBox.baseVal, h = Math.round(w * vb.height / vb.width);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  URL.revokeObjectURL(url);
  const bytes = ctx.getImageData(0, 0, w, h).data;
  let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return {w, h, b64: btoa(bin), png: c.toDataURL('image/png').split(',')[1]};
}"""


def raster(page, selector, width=900):
    return page.evaluate(RASTER_JS, [selector, width])


def scan(page, selector):
    """Rasterises the on-screen QR SVG in the browser and decodes it with jsQR."""
    shot = raster(page, selector)
    with tempfile.NamedTemporaryFile(suffix=".rgba", delete=False) as f:
        f.write(base64.b64decode(shot["b64"]))
        path = f.name
    try:
        r = subprocess.run(["node", str(ROOT / "test" / "scan-rgba.mjs"), path, str(shot["w"]), str(shot["h"])],
                           capture_output=True, text=True, timeout=60)
        return r.stdout
    finally:
        os.unlink(path)


def add_mod(page, category, brand, part, pn="", notes="", link=""):
    page.select_option("select[name=category]", label=category)
    page.fill("input[name=brand]", brand)
    page.fill("input[name=part]", part)
    page.fill("input[name=partNumber]", pn)
    page.fill("input[name=link]", link)
    page.fill("input[name=notes]", notes)
    page.click("form.mod-form button[type=submit]")


def wait_for_qr(page, link_before=None):
    page.wait_for_function(
        """(before) => { const a = [...document.querySelectorAll('a')].find(x => x.textContent === 'See what people see');
             return a && a.getAttribute('href') && a.getAttribute('href').includes('#1') && a.getAttribute('href') !== before; }""",
        arg=link_before, timeout=10000)
    return page.get_attribute("a:text-is('See what people see')", "href")


def suite(p, kind, base, tag):
    errors = []
    browser, phone, label = launch(p, kind)
    check(f"[{tag}] browser launched", True, f"{label} {browser.version}")

    def c(name, ok, detail=""):
        check(f"[{tag}] {name}", ok, detail)

    # ---------- the owner builds a car on a phone ----------
    owner = browser.new_context(**phone)
    page = owner.new_page()
    watch(page, errors)
    page.on("dialog", lambda d: d.accept())
    page.goto(base)
    page.wait_for_selector("h1")
    page.fill("input[name=year]", "2019")
    page.fill("input[name=make]", "Subaru")
    page.fill("input[name=model]", "WRX STI")
    page.fill("input[name=trim]", "Limited")
    page.fill("input[name=nickname]", "Blue Thunder")
    page.fill("input[name=owner]", "@example_owner")
    c("cancel is hidden while adding", not page.locator("button:text-is('Cancel')").is_visible())
    add_mod(page, "Exhaust", "Invidia", "Q300 cat-back", "HS15SSTGTC", "Titanium tips", "https://www.example-parts.com/q300")
    add_mod(page, "Suspension", "KW", "V3 coilovers", "35267005")
    add_mod(page, "Wheels & tires", "Enkei", "RPF1 18x9.5 +38", "3798956538SP", "Silver")
    add_mod(page, "Other", "Junk", "Delete me")
    c("four mods listed", page.locator(".mod-row").count() == 4)
    page.locator(".mod-row").nth(3).locator("button:text-is('Remove')").click()
    c("remove asks, then removes", page.locator(".mod-row").count() == 3)
    page.locator(".mod-row").nth(1).locator("button:text-is('Edit')").click()
    c("cancel shows while editing", page.locator("button:text-is('Cancel')").is_visible())
    page.fill("input[name=notes]", "Set 1 inch below stock")
    page.click("form.mod-form button[type=submit]")
    c("edit saves in place", "KW V3 coilovers" in page.locator(".mod-row").nth(1).inner_text()
      and page.locator(".mod-row").count() == 3)
    page.fill("input[name=part]", "Bad link test")
    page.fill("input[name=link]", "javascript:alert(1)")
    page.click("form.mod-form button[type=submit]")
    c("a script link is refused in the form", "web address" in page.locator(".form-error").inner_text()
      and page.locator(".mod-row").count() == 3)
    page.fill("input[name=link]", "https://example.com/" + "a" * 320)
    page.click("form.mod-form button[type=submit]")
    c("a too-long link is refused, not cut short", "too long" in page.locator(".form-error").inner_text())
    page.fill("input[name=link]", "")
    page.fill("input[name=part]", "")
    c("the error clears when the owner types", page.locator(".form-error").inner_text() == "")

    link = wait_for_qr(page)
    c("link points at this page with a digits-only build", link.startswith(base + "#1") and link[len(base) + 1:].isdigit(),
      f"{len(link)} characters")
    meter = page.locator(".meter").inner_text()
    c("sticker check says it is easy to scan", "Easy to scan" in meter, meter)
    page.screenshot(path=str(OUT / f"{tag}-1-owner-builder.png"), full_page=True, caret="initial")
    page.locator("section[aria-labelledby=h-qr]").screenshot(path=str(OUT / f"{tag}-builder.png"), caret="initial")
    c("the rendered sticker scans to the exact link", scan(page, ".sticker-preview svg") == link)

    page.reload()
    page.wait_for_selector(".mod-row")
    c("the build is still there after a reload", page.locator(".mod-row").count() == 3)

    # ---------- a stranger scans it on another phone ----------
    stranger = browser.new_context(**phone)
    view = stranger.new_page()
    watch(view, errors)
    dialogs = []
    view.on("dialog", lambda d: (dialogs.append(d.message), d.dismiss()))
    t0 = time.perf_counter()
    view.goto(link)
    view.wait_for_selector("#build-title")
    load_ms = (time.perf_counter() - t0) * 1000
    text = view.inner_text("body")
    c("the scan opens the build with no app or account", view.inner_text("#build-title") == "Blue Thunder")
    c("every mod shows", all(s in text for s in ("Invidia Q300 cat-back", "KW V3 coilovers", "Enkei RPF1 18x9.5 +38")))
    c("part numbers and notes show", "HS15SSTGTC" in text and "Set 1 inch below stock" in text)
    c("mods are grouped by category", view.locator("section.group").count() == 3)
    finds = view.locator("a:text-is('Find this part')")
    c("each mod has a find-this-part link", finds.count() == 3
      and finds.first.get_attribute("href").startswith("https://www.google.com/search?q=Invidia"))
    owner_link = view.locator("a:has-text(\"Owner's link\")")
    c("an owner's link shows the site it goes to", owner_link.count() == 1
      and "(example-parts.com)" in owner_link.inner_text()
      and owner_link.get_attribute("href") == "https://www.example-parts.com/q300")
    c("the scan page loads fast", load_ms < 1500, f"{load_ms:.0f} ms on a local server")
    weight = view.evaluate("""performance.getEntriesByType('resource').concat(performance.getEntriesByType('navigation'))
        .reduce((s, r) => s + (r.transferSize || r.encodedBodySize || r.decodedBodySize || 0), 0)""")
    if weight:
        c("the scan page is light", weight < 150_000, f"{weight / 1024:.0f} KB")
    hosts = view.evaluate("[...new Set(performance.getEntriesByType('resource').map(r => new URL(r.name).host))]")
    c("nothing loads from another site", all(h == base.split('/')[2] for h in hosts), ", ".join(hosts))
    view.screenshot(path=str(OUT / f"{tag}-2-stranger-view.png"), full_page=True, caret="initial")
    view.screenshot(path=str(OUT / f"{tag}-view.png"), caret="initial")
    view.emulate_media(color_scheme="dark")
    view.screenshot(path=str(OUT / f"{tag}-3-stranger-view-dark.png"), full_page=True, caret="initial")
    view.emulate_media(color_scheme="light")
    view.goto(link + ").")
    view.wait_for_selector("#build-title")
    c("a link with a chat app's trailing ')' still opens", view.inner_text("#build-title") == "Blue Thunder")

    # ---------- hostile and damaged links ----------
    evil = view.evaluate("""async () => {
      const m = await import('./js/codec.js');
      return m.encodeBuild({ nickname: '<img src=x onerror=alert(1)>', about: '<script>alert(2)</script>',
        mods: [{ brand: '<b>bold</b>', part: '"><svg onload=alert(3)>', link: 'https://example.com/ok' },
               { part: 'Login trick', link: 'https://shop.example.com@evil.example.net/' }] });
    }""")
    view.goto(base + "#" + evil)
    view.wait_for_selector("#build-title")
    view.wait_for_timeout(300)
    c("script in a link shows as plain text and never runs",
      view.inner_text("#build-title") == "<img src=x onerror=alert(1)>" and not dialogs
      and view.locator("main img, main script, main b").count() == 0)
    c("only plain web links survive; a login-style link is dropped",
      view.locator("a:has-text(\"Owner's link\")").count() == 1
      and view.locator("a:has-text(\"Owner's link\")").get_attribute("href") == "https://example.com/ok"
      and view.locator("a[href^='javascript']").count() == 0)
    view.goto(base + "#1" + "0" * 34)
    view.wait_for_selector("[role=alert]")
    c("a damaged link shows a clear message", "damaged" in view.inner_text("[role=alert]"))
    view.goto(base + "#2abc")
    view.wait_for_selector("[role=alert]")
    c("a foreign link shows a clear message", "not one this app made" in view.inner_text("[role=alert]"))

    # ---------- a big build from a backup file ----------
    fixture = subprocess.run(["node", "--input-type=module", "-e",
                              "import { realisticBuild } from './test/fixtures.mjs'; process.stdout.write(JSON.stringify(realisticBuild()))"],
                             cwd=str(ROOT), capture_output=True, text=True, timeout=60).stdout
    backup = OUT / "backup-25-mods.json"
    backup.write_text(json.dumps({"app": "Build Tag", "format": 1, "build": json.loads(fixture)}), encoding="utf-8")
    page.set_input_files("input[type=file]", str(backup))
    page.wait_for_function("() => document.querySelectorAll('.mod-row').length === 25", timeout=10000)
    c("a backup file restores all 25 mods", page.locator(".mod-row").count() == 25)
    big = wait_for_qr(page, link)
    meter = page.locator(".meter").inner_text()
    c("a 25-mod build is offered a 4-inch sticker", "4-inch sticker" in meter, meter)
    c("the 25-mod sticker scans to the exact link", scan(page, ".sticker-preview svg") == big)
    three = page.locator("button[data-format=s3]")
    four = page.locator("button[data-format=s4]")
    card = page.locator("button[data-format=card]")
    c("sizes too dense to scan are switched off", three.is_disabled() and four.is_enabled() and card.is_enabled())

    page.evaluate("""() => { window.__prints = [];
      window.print = () => window.__prints.push((new Error().stack || '').split('\\n').slice(1, 6).join(' | ')); }""")
    card.click()
    page.wait_for_timeout(300)
    n_svg, prints = page.locator(".print-area svg").count(), page.evaluate("() => window.__prints")
    c("print builds one dash card", n_svg == 1 and len(prints) == 1,
      f"{n_svg} cards, print called {len(prints)}" + ("" if len(prints) == 1 else ": " + " || ".join(prints)[:600]))
    page.emulate_media(media="print")
    c("in print, only the sheet shows", page.locator(".print-area").is_visible()
      and not page.locator("section[aria-labelledby=h-mods]").is_visible())
    page.screenshot(path=str(OUT / f"{tag}-4-print-dash-card.png"), full_page=True, caret="initial")
    shot = raster(page, ".print-area svg", 600)
    (OUT / f"{tag}-dash-card.png").write_bytes(base64.b64decode(shot["png"]))
    c("the printed dash card scans", scan(page, ".print-area svg") == big)
    page.emulate_media(media="screen")
    c("on screen, the editor is back after printing", page.locator("section[aria-labelledby=h-mods]").is_visible()
      and not page.locator(".print-area").is_visible())
    four.click()
    c("print builds a sheet of two 4-inch stickers", page.locator(".print-area svg").count() == 2)

    # ---------- the owner on a new phone: edit a copy ----------
    newphone = browser.new_context(**phone)
    np = newphone.new_page()
    watch(np, errors)
    np.on("dialog", lambda d: d.accept())
    np.goto(big)
    np.click("button:text-is('This is my car: edit a copy')")
    np.wait_for_selector(".mod-row")
    c("edit a copy loads the build into the editor", np.locator(".mod-row").count() == 25
      and np.input_value("input[name=nickname]") == "Blue Thunder")

    # Playwright's WebKit screenshots add a <style> tag of their own, which the
    # page's policy (rightly) refuses. The app itself adds no inline style, which
    # the source check below proves, so only that one message is set aside.
    tool_noise = "Refused to apply a stylesheet because its hash, its nonce, or 'unsafe-inline'"
    real = [e for e in errors if not (kind == "webkit" and tool_noise in e)]
    c("no console errors or blocked loads anywhere", not real, "; ".join(real[:3]))
    source = "".join(f.read_text(encoding="utf-8") for f in [ROOT / "index.html", *sorted((ROOT / "js").glob("*.js"))])
    c("the app adds no inline style or script", all(s not in source for s in ("<style", "style=", "setAttribute('style'", "onclick=", "eval(", "new Function")))
    browser.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--browser", choices=["webkit", "android", "edge", "all"], default="all")
    args = ap.parse_args()
    kinds = ["webkit", "android", "edge"] if args.browser == "all" else [args.browser]
    OUT.mkdir(parents=True, exist_ok=True)
    server, base = start_server()
    with sync_playwright() as p:
        for kind in kinds:
            try:
                suite(p, kind, base, {"webkit": "iphone", "android": "android"}.get(kind, "edge"))
            except Exception as e:  # noqa: BLE001 - report and carry on to the next browser
                check(f"[{kind}] suite ran to the end", False, repr(e)[:300])
    server.shutdown()
    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)} of {len(results)} checks passed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
