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
import re
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


def decode_rgba(shot):
    with tempfile.NamedTemporaryFile(suffix=".rgba", delete=False) as f:
        f.write(base64.b64decode(shot["b64"]))
        path = f.name
    try:
        r = subprocess.run(["node", str(ROOT / "test" / "scan-rgba.mjs"), path, str(shot["w"]), str(shot["h"])],
                           capture_output=True, text=True, timeout=60)
        return r.stdout
    finally:
        os.unlink(path)


def scan(page, selector):
    """Rasterises the on-screen QR SVG in the browser and decodes it with jsQR."""
    return decode_rgba(raster(page, selector))


IMG_PIXELS_JS = """([selector, scale]) => {
  const img = document.querySelector(selector);
  const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(img, 0, 0, w, h);
  const bytes = ctx.getImageData(0, 0, c.width, c.height).data;
  let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return {w: c.width, h: c.height, b64: btoa(bin)};
}"""

# Draws the story card for a dense build (40 mods, each with a shop link),
# whose QR is too big to sit beside the text, and returns its pixels at half
# size, the way a story app shrinks a picture.
DENSE_STORY_JS = """async () => {
  const qr = await import('./js/qr.js');
  const codec = await import('./js/codec.js');
  const { normalizeBuild } = await import('./js/model.js');
  const { drawStoryCard } = await import('./js/storycard.js');
  await qr.loadQrLib();
  // Varied text (a fixed pseudo-random sequence) so it does not compress away.
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed.toString(36); };
  const mods = Array.from({ length: 40 }, (_, i) => ({ category: i % 16, brand: 'Brand' + rnd(), part: 'Part ' + rnd(),
    partNumber: rnd().toUpperCase(), link: 'https://example.com/p/' + rnd() + rnd(), notes: 'note ' + rnd() }));
  const build = normalizeBuild({ year: '2019', make: 'Subaru', model: 'WRX STI', nickname: 'Dense Build', owner: '@example_owner',
    specs: [{ kind: 0, value: '450 whp' }], tags: ['Track'], mods });
  const url = codec.shareUrl(location.origin + location.pathname, await codec.encodeBuild(build));
  const grade = qr.gradeLink(url);
  if (!grade.ok) return { url, ok: false };
  const matrix = qr.moduleMatrix(grade.qr);
  const card = await drawStoryCard(build, matrix);
  const c = document.createElement('canvas'); c.width = card.width / 2; c.height = card.height / 2;
  const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(card, 0, 0, c.width, c.height);
  const bytes = ctx.getImageData(0, 0, c.width, c.height).data;
  let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return { url, ok: true, modules: matrix.length, w: c.width, h: c.height, b64: btoa(bin), png: card.toDataURL('image/png').split(',')[1] };
}"""


def scan_img(page, selector, scale=1):
    """Decodes the QR in a picture on the page (the story card). scale < 1
    shrinks it first, the way a story app does."""
    shot = page.evaluate(IMG_PIXELS_JS, [selector, scale])
    return decode_rgba(shot), shot["w"], shot["h"]


def stripe_share(png_bytes, box, colour, tol=40):
    """Share of pixels near colour inside box (fractions of width and height)."""
    from io import BytesIO
    from PIL import Image
    im = Image.open(BytesIO(png_bytes)).convert("RGB")
    w, h = im.size
    crop = im.crop((int(box[0] * w), int(box[1] * h), int(box[2] * w), int(box[3] * h)))
    px = list(crop.getdata())
    near = sum(1 for p in px if all(abs(p[i] - colour[i]) <= tol for i in range(3)))
    return near / max(1, len(px))


def png_size(data):
    """Width and height from a PNG file's header, or None if it is not a PNG."""
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    return int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big")


def node_value(expr):
    return subprocess.run(["node", "--input-type=module", "-e", expr], cwd=str(ROOT),
                          capture_output=True, text=True, timeout=60).stdout


def grab_download(page, click):
    with page.expect_download(timeout=15000) as info:
        click()
    d = info.value
    return d.suggested_filename, Path(d.path()).read_bytes()


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


FAKE_APP = """window.__appCalls = [];
window.BuildTagApp = {
  saveFile: (name, type, b64) => { window.__appCalls.push(['save', name, type, atob(b64).slice(0, 4)]); return 'ok'; },
  print: (title) => { window.__appCalls.push(['print', title]); },
  copyText: (text) => { window.__appCalls.push(['copy', text]); return true; },
};"""


def app_mode_checks(browser, phone, base, c, errors):
    """The page as the Android app runs it: window.BuildTagApp stands in for the
    app's bridge (android/app/src/main/java/.../MainActivity.java)."""
    public = subprocess.run(["node", "--input-type=module", "-e",
                             "import { PUBLIC_URL } from './js/config.js'; process.stdout.write(PUBLIC_URL)"],
                            cwd=str(ROOT), capture_output=True, text=True, timeout=60).stdout
    ctx = browser.new_context(**phone)
    ctx.add_init_script(FAKE_APP)
    app = ctx.new_page()
    watch(app, errors)
    app.goto(base)
    app.wait_for_selector("h1")
    app.fill("input[name=make]", "Honda")
    app.fill("input[name=model]", "Civic Si")
    add_mod(app, "Suspension", "Tein", "Flex Z coilovers", "VSQ88-C1AS3")
    local = wait_for_qr(app)
    scanned = scan(app, ".sticker-preview svg")
    calls = lambda: app.evaluate("() => window.__appCalls")  # noqa: E731
    c("in the app, the QR points at the public site", scanned.startswith(public + "#1")
      and scanned.split("#", 1)[1] == local.split("#", 1)[1], scanned[:60])
    c("in the app, the preview opens inside the app", local.startswith(base + "#1"))
    app.click("button:text-is('Copy link')")
    c("in the app, Copy link goes through the phone's clipboard", ["copy", scanned] in calls())
    app.locator("button", has_text="SVG").first.click()
    app.wait_for_function("() => window.__appCalls.some(x => x[0] === 'save')", timeout=5000)
    save = next(x for x in calls() if x[0] == "save")
    c("in the app, a download is saved through the phone", save[1].endswith(".svg") and save[2] == "image/svg+xml"
      and save[3] == "<svg", str(save))
    app.locator(".print-buttons button:enabled").first.click()
    c("in the app, print opens the phone's print screen", any(x[0] == "print" for x in calls()))
    app.wait_for_selector("img.story-preview:not([hidden])", timeout=10000)
    c("in the app, the story card has no web share button (the app saves it instead)",
      not app.locator("button:text-is('Share to a story')").is_visible())
    app.click("button:text-is('Download story card')")
    app.wait_for_function("() => window.__appCalls.some(x => x[0] === 'save' && x[1].endsWith('-story.png'))", timeout=5000)
    story = next(x for x in calls() if x[0] == "save" and x[1].endswith("-story.png"))
    c("in the app, the story card is saved through the phone", story[2] == "image/png" and story[3] == "\x89PNG", str(story)[:80])
    app.goto(local)
    app.wait_for_selector("#build-title")
    app.locator(".mod button:text-is('Copy')").first.click()
    c("in the app, a part number copies through the phone", ["copy", "VSQ88-C1AS3"] in calls())
    ctx.close()


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
    page.click("label.scene-chip:has-text('Night meet')")
    page.fill("input[name=specValue0]", "350 whp")
    page.fill("input[name=specValue1]", "330 wtq")
    page.fill("input[name=specNote]", "Dynojet, 93 octane")
    page.fill("input[name=tags]", "Daily, Stage 2, daily")
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

    # ---------- v2: sticker shapes, downloads, story card ----------
    for shape, view_box in (("Tech tag", "0 0 1500 1000"), ("Round slap", "0 0 1000 1000")):
        page.click(f"label.shape-chip:has-text('{shape}')")
        page.wait_for_function("(vb) => { const s = document.querySelector('.sticker-preview svg'); return s && s.getAttribute('viewBox') === vb"
                               " && (vb !== '0 0 1000 1000' || s.querySelector('textPath')); }", arg=view_box, timeout=5000)
        page.locator("section[aria-labelledby=h-qr]").screenshot(path=str(OUT / f"{tag}-shape-{shape.split()[-1].lower()}.png"), caret="initial")
        c(f"the {shape.lower()} scans to the exact link", scan(page, ".sticker-preview svg") == link)
    c("the round slap's print sizes are offered, with the dash card", page.locator("button[data-format=r3]").count() == 1
      and page.locator("button[data-format=s3]").count() == 0 and page.locator("button[data-format=card]").count() == 1)
    page.click("label.shape-chip:has-text('Square')")
    page.wait_for_function("() => !document.querySelector('.sticker-preview svg textPath') && document.querySelector('.sticker-preview svg').getAttribute('viewBox') === '0 0 1000 1000'")
    name, data = grab_download(page, lambda: page.click("button:has-text('Download SVG')"))
    svg_text = data.decode("utf-8", "replace")
    c("the SVG download carries its fonts and nothing that runs", name.endswith(".svg") and svg_text.startswith("<svg")
      and svg_text.count("data:font/woff2;base64,") == 2 and "<script" not in svg_text and "Chakra Petch" in svg_text,
      f"{name}, {len(data) // 1024} KB")
    name, data = grab_download(page, lambda: page.click("button:text-is('Download PNG')"))
    c("the PNG download is a 4-inch sticker at 300 dpi", png_size(data) == (1200, 1200), f"{name} {png_size(data)}")
    (OUT / f"{tag}-sticker-download.png").write_bytes(data)
    page.wait_for_selector("img.story-preview:not([hidden])", timeout=15000)
    story_scan, sw, sh = scan_img(page, "img.story-preview")
    c("the story card is 1080 x 1920 and its QR scans to the exact link", (sw, sh) == (1080, 1920) and story_scan == link,
      f"{sw}x{sh}, scanned {story_scan[:40]!r}")
    half_scan, _, _ = scan_img(page, "img.story-preview", 0.5)
    c("the story card's QR still scans at half size", half_scan == link, f"scanned {half_scan[:40]!r}")
    name, data = grab_download(page, lambda: page.click("button:text-is('Download story card')"))
    c("the story card downloads as a PNG", name.endswith("-story.png") and png_size(data) == (1080, 1920), name)
    (OUT / f"{tag}-story-card.png").write_bytes(data)

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
    c("the scan opens the build with no app or account", view.text_content("#build-title") == "Blue Thunder")
    c("every mod shows", all(s in text for s in ("Invidia Q300 cat-back", "KW V3 coilovers", "Enkei RPF1 18x9.5 +38")))
    c("part numbers and notes show", "HS15SSTGTC" in text and "Set 1 inch below stock" in text)
    c("mods are grouped by category", view.locator("section.group").count() == 3)
    c("the scan page wears the owner's style", view.get_attribute("article.viewer", "data-scene") == "night"
      and view.evaluate("getComputedStyle(document.body).backgroundColor") == "rgb(12, 14, 26)")
    strip = view.locator(".spec-strip").inner_text().lower()
    c("the spec strip shows the numbers", "350 whp" in strip and "330 wtq" in strip and "power" in strip, strip.replace("\n", " "))
    c("tags show once each, and the spec note shows", view.locator(".pills li").count() == 2
      and "Dynojet, 93 octane" in text)
    c("a build number is stamped", view.locator(".serial").count() == 1
      and any(ch.isdigit() for ch in view.inner_text(".serial")))
    loaded = view.evaluate("performance.getEntriesByType('resource').map(r => r.name)")
    c("the scan page loads no editor and no QR maker", not any(("qrcode.js" in u or "builder.js" in u or "paste.js" in u) for u in loaded),
      ", ".join(u.rsplit("/", 1)[-1] for u in loaded))
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
    c("a link with a chat app's trailing ')' still opens", view.text_content("#build-title") == "Blue Thunder")

    # ---------- every v0.1 sticker still opens ----------
    v01 = node_value("import { V01_BLUE_THUNDER } from './test/fixtures.mjs'; process.stdout.write(V01_BLUE_THUNDER)")
    view.goto(base + "#" + v01)
    view.wait_for_function("() => document.querySelector('#build-title') && document.querySelector('#build-title').textContent.includes('(test build)') && document.querySelectorAll('.mod').length === 8")
    c("the v0.1 Blue Thunder sticker link opens, all 8 mods, in the default style",
      view.text_content("#build-title") == "Blue Thunder (test build)" and view.locator(".mod").count() == 8
      and view.get_attribute("article.viewer", "data-scene") == "tech")

    # ---------- each style, side by side ----------
    backgrounds = {"tech": "rgb(20, 22, 25)", "night": "rgb(12, 14, 26)", "sheet": "rgb(233, 231, 225)", "trail": "rgb(36, 38, 31)"}
    for scene, bg in backgrounds.items():
        payload = view.evaluate("""async (scene) => {
          const m = await import('./js/codec.js');
          return m.encodeBuild({ year: '2019', make: 'Subaru', model: 'WRX STI', nickname: 'Blue Thunder', owner: '@example_owner',
            scene, specs: [{ kind: 0, value: '350 whp' }, { kind: 1, value: '330 wtq' }, { kind: 2, value: '3,150 lb' }, { kind: 6, value: '18x9.5 +38' }],
            tags: ['Daily', 'Stage 2'], specNote: 'Dynojet, 93 octane',
            mods: [{ category: 2, brand: 'Invidia', part: 'Q300 cat-back', partNumber: 'HS15SSTGTC', notes: 'Titanium tips' },
                   { category: 8, brand: 'KW', part: 'V3 coilovers', partNumber: '35267005' }] });
        }""", scene)
        view.goto(base + "#" + payload)
        view.wait_for_function("(s) => document.querySelector(`article.viewer[data-scene=${s}]`)", arg=scene)
        view.evaluate("document.fonts.ready")
        view.wait_for_timeout(150)
        view.screenshot(path=str(OUT / f"{tag}-scene-{scene}.png"), caret="initial")
        c(f"the {scene} style shows its colours", view.evaluate("getComputedStyle(document.body).backgroundColor") == bg)

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
      view.text_content("#build-title") == "<img src=x onerror=alert(1)>" and not dialogs
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
    story25 = ""
    for _ in range(20):  # the card is redrawn a moment after the QR
        story25, _, _ = scan_img(page, "img.story-preview", 0.5)
        if story25 == big:
            break
        page.wait_for_timeout(300)
    c("the 25-mod story card's QR scans at half size", story25 == big, f"scanned {story25[:40]!r}")
    dense = page.evaluate(DENSE_STORY_JS)
    dense_scan = decode_rgba(dense) if dense.get("ok") else ""
    if dense.get("png"):
        (OUT / f"{tag}-story-card-dense.png").write_bytes(base64.b64decode(dense["png"]))
    c("a dense build's story card gets the wide QR, which scans at half size",
      dense.get("ok") and dense["modules"] + 8 > 130 and dense_scan == dense["url"],
      f"modules {dense.get('modules')}, scanned {dense_scan[:40]!r}")
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
    c("a 25-mod build switches the round slap off and keeps the tech tag",
      page.locator("input[name=shape][value=slap]").is_disabled() and page.locator("input[name=shape][value=tag]").is_enabled())
    page.click("label.shape-chip:has-text('Tech tag')")
    page.wait_for_selector("button[data-format=t6]")
    c("only tag sizes that scan can be printed", page.locator("button[data-format=t35]").is_disabled()
      and page.locator("button[data-format=t6]").is_enabled())
    page.click("button[data-format=t6]")
    c("print builds a sheet of two 6 x 4 tags", page.locator(".print-area svg").count() == 2
      and page.locator(".print-area svg").first.get_attribute("width") == "6in")
    c("the printed 6 x 4 tag scans", scan(page, ".print-area svg") == big)
    # The hidden on-screen preview comes first in the page; a printed copy
    # must still draw its own hazard stripe (Tech style, yellow #ffd21f).
    page.emulate_media(media="print")
    tag_png = page.locator(".print-area svg").first.screenshot()
    page.emulate_media(media="screen")
    share = stripe_share(tag_png, (0.06, 0.11, 0.37, 0.15), (0xff, 0xd2, 0x1f))
    c("the printed tag keeps its hazard stripe", share > 0.3, f"{share:.0%} of the stripe band is yellow")

    # ---------- paste a list the owner already wrote ----------
    paster = browser.new_context(**phone)
    pp = paster.new_page()
    watch(pp, errors)
    pp.goto(base)
    pp.wait_for_selector("h1")
    pp.click("button:text-is('Paste a list')")
    pp.fill("textarea[name=paste]", "Finally dialed in 🔥\n450whp / 400wtq\nMODS:\n- Cobb Accessport V3 - Stage 2 tune\n"
            "- Invidia Q300 cat-back (HS15SSTGTC)\n- BC Racing BR coilovers (lowered 1.5 in)\nWheels: Enkei RPF1 18x9.5 +38\n#wrx #subaru")
    pp.click("button:text-is('Read my list')")
    pp.wait_for_selector("ol.paste-preview li")
    c("a pasted caption shows every mod found before adding", pp.locator("ol.paste-preview li").count() == 4,
      pp.locator(".paste-result").inner_text().replace("\n", " | ")[:200])
    pp.click("button:text-is('Add 4 mods')")
    pp.wait_for_function("() => document.querySelectorAll('.mod-row').length === 4", timeout=5000)
    rows = pp.locator(".mod-row").all_inner_texts()
    low = [r.lower() for r in rows]  # the category label is upper-cased by the style sheet
    c("pasted mods land with their categories and part numbers", "tune / ecu" in low[0] and "HS15SSTGTC" in rows[1]
      and "suspension" in low[2] and "wheels & tires" in low[3], " | ".join(r.replace("\n", " ") for r in rows)[:240])
    c("power and torque in the caption fill the spec strip", pp.input_value("input[name=specValue0]") == "450 whp"
      and pp.input_value("input[name=specValue1]") == "400 wtq")
    wait_for_qr(pp)
    c("the pasted build makes a QR", pp.locator(".sticker-preview svg").count() == 1)
    pp.screenshot(path=str(OUT / f"{tag}-5-pasted.png"), full_page=True, caret="initial")
    paster.close()

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

    if kind == "android":
        app_mode_checks(browser, phone, base, c, errors)

    # Playwright's WebKit screenshots add a <style> tag of their own, which the
    # page's policy (rightly) refuses. The app itself adds no inline style, which
    # the source check below proves, so only that one message is set aside.
    tool_noise = "Refused to apply a stylesheet because its hash, its nonce, or 'unsafe-inline'"
    real = [e for e in errors if not (kind == "webkit" and tool_noise in e)]
    c("no console errors or blocked loads anywhere", not real, "; ".join(real[:3]))
    # js/exportfile.js is the one file allowed to write "<style": it puts the
    # fonts inside downloaded SVG files, never into the page (the page's policy
    # would refuse it, and the console check above would fail).
    files = [ROOT / "index.html", *sorted((ROOT / "js").glob("*.js"))]
    source = "".join(f.read_text(encoding="utf-8") for f in files)
    page_source = "".join(f.read_text(encoding="utf-8") for f in files if f.name != "exportfile.js")
    # A bare style= attribute is refused; SVG presentation attributes such as
    # font-style="italic" are not inline styles and are allowed.
    c("the app adds no inline style or script", not re.search(r"(?<![\w.-])style\s*=(?!=)", source)
      and all(s not in source for s in ("setAttribute('style'", ".style.cssText", "onclick=", "eval(", "new Function", "innerHTML", "insertAdjacentHTML", "document.write"))
      and "<style" not in page_source)
    c("the page's policy still allows nothing from other sites", all(s in (ROOT / "index.html").read_text(encoding="utf-8") for s in (
        "default-src 'self'", "script-src 'self'", "style-src 'self'", "connect-src 'self'", "object-src 'none'")))
    browser.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--browser", choices=["webkit", "android", "edge", "all"], default="all")
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # page text in the details can be any language
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
