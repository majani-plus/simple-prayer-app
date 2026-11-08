#!/usr/bin/env python3
"""
Composes the App Store / Play store screens from the captured device frames.

    scripts/build-store-screens.py [--locale en|tr|ar] [--out docs/store-screens]

Each screen is a caption, the brand's diamond ornament, and one real device capture on the
app's own paper — a phone for most slots, the watch for one, and the pledge card for the
last. The plan — what each screen says and why — is `docs/STORE_SCREENS.md`; this script is
only the rendering of it, so change the captions there and here together.

Two things worth knowing before editing:

* **The paper is generated, not sampled.** The mount has to be the app's own background or the
  device frame reads as a sticker on a different surface. Sampling a patch out of a capture was
  the first attempt and it tiled the date line across the whole canvas, so the ground is the
  `bg` token with the same fine grain the app lays over it.
* **Arabic is shaped here, not by the font.** Pillow draws glyphs in the order it is given,
  so Arabic needs its letters joined and the run reversed before drawing. `arabic_reshaper`
  and `python-bidi` do that; without them the Arabic caption would render as disconnected
  letters in the wrong order, which is worse than not shipping it, so the script refuses.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
FONTS = ROOT / "node_modules" / "@expo-google-fonts"
SHOTS = ROOT / "docs" / "screenshots"

# --- canvas -------------------------------------------------------------------------------
# Two canvases share every drawing routine; `set_profile` swaps the numbers between them.
# "phone": Apple's 6.5" slot — Play accepts it as a phone screenshot, so one set serves both
# stores. "ipad": the 13" iPad slot at the capture's own pixel size — Play's tablet slots
# accept the same files (ratio 3:4 is within Play's 2:1 bound), so this set also serves 7"/10".
W, H = 1242, 2688

INK = (59, 50, 38)  # theme `ink`
ACCENT = (138, 100, 32)  # theme `accent`
MUTED = (113, 98, 65)  # theme `muted`

EYEBROW_TOP = 118
CAPTION_MAX_W = W - 190
ORNAMENT_GAP = 62
# Type/metric scale — 1.0 on the phone canvas; the tablet canvas is 1.66× wider, and scaling
# the header band by width would dwarf the device, so it takes a gentler hand-picked factor.
T = 1.0

# The device is wider than the mount is deep, and runs off the bottom edge rather than sitting
# inside a border. Two reasons: a frame with air on all four sides reads as a sticker laid on
# paper, and the empty band under it was the largest thing on the canvas. Bleeding it keeps the
# eye on the screen itself, and the ~7% that leaves the canvas is tab bar, which every one of the
# five frames repeats anyway.
DEVICE_TOP = 604
DEVICE_W = 1030
CORNER = 66

# The watch runs larger than life — its real screen is a sixth of the canvas width, and at
# true size it would be a postage stamp under a caption. ~62% of the canvas reads as a device
# held up to show you, and the AMOLED-dark capture survives the enlargement.
WATCH_W = 770
WATCH_BEZEL = 34


def set_profile(device: str) -> None:
    """Points every module-level metric at one canvas. Call before building a locale."""
    global W, H, EYEBROW_TOP, CAPTION_MAX_W, DEVICE_TOP, DEVICE_W, CORNER, T
    if device == "phone":
        W, H = 1242, 2688
        EYEBROW_TOP, CAPTION_MAX_W = 118, W - 190
        DEVICE_TOP, DEVICE_W, CORNER, T = 604, 1030, 66, 1.0
    else:  # ipad — canvas at the 13" capture's own size, so the frame never resamples oddly
        W, H = 2064, 2752
        EYEBROW_TOP, CAPTION_MAX_W = 128, W - 420
        DEVICE_TOP, DEVICE_W, CORNER, T = 812, 1560, 58, 1.35

# --- the eight slots: seven with a device on them, and the one that is not -----------------
# (key, source, capture): source "6.5" reads docs/screenshots/<locale>/light/6.5/<capture>.png,
# "watch" reads docs/screenshots/<locale>/watch/<capture>.png, None is the pledge card.
# The output name is the slot's position — that is the upload order on both stores.
SLOTS = [
    ("today", "6.5", "01-today-seal"),
    ("watch", "watch", "today"),
    ("history", "6.5", "02-history"),
    ("qibla", "6.5", "03-qibla"),
    ("reminders", "6.5", "04-reminders"),
    ("qada", "6.5", "05-qada"),
    ("pledge", None, None),
]

# The tablet set: the same story minus the watch (it has its own slide in the phone set) and
# minus the pledge (its card metrics are phone-tuned; six slides carry the listing fine).
SLOTS_IPAD = [
    ("today", "ipad13", "01-today-seal"),
    ("history", "ipad13", "02-history"),
    ("qibla", "ipad13", "03-qibla"),
    ("reminders", "ipad13", "04-reminders"),
    ("qada", "ipad13", "05-qada"),
]

# The two newest captures come out of a capture matrix that takes minutes per locale. A slot
# whose capture has not landed yet is skipped with a warning rather than failing the build,
# so the six that exist still compose; re-run once the matrix finishes.
OPTIONAL = {"watch"}

# One Arabic word per screen, set in Amiri — the same decorative register the app itself uses
# above its hero (الظهر over "Dhuhr until 4:58 pm"). It is embellishment, not information: it
# names the subject, carries the brand's script, and gives the top of the canvas something to be.
# The Arabic locale keeps it for exactly the reason the app does — there it reads as calligraphy
# over its own heading, not as a repetition.
EYEBROWS = {
    "today": "الصَّلاة",
    "watch": "المِعْصَم",
    "history": "السِّجِلّ",
    "qibla": "القِبْلَة",
    "reminders": "الأذان",
    "travel": "السَّفَر",
    "qada": "القَضاء",
    "pledge": "عَهْدُنا",
}

CAPTIONS = {
    "en": {
        "today": "Today\u2019s five prayers.\nTap one to mark it.",
        "watch": "Your prayers, on your wrist.",
        "travel": "Travel days are understood.",
        "history": "See how the month has gone",
        "qibla": "Know which way to face",
        "reminders": "A reminder for each prayer",
        "qada": "Make up what you missed,\none at a time",
        "pledge": "No ads. No account.\nEvery feature is free.",
        "wordmark": "Simple Prayer",
        "tagline": "five a day · never missed",
        "pill_today": "Works without internet",
        "pill_watch": "You can mark a prayer from the watch, without your phone",
        "pill_history": "You can change any day later",
        "pill_qibla": "It even senses how you hold the phone",
        "pill_reminders": "You can mark the prayer right from the notification",
        "pill_travel": "Shortened and joined prayers, never wrongly late",
        "pill_qada": "The number only goes down",
        "pledge_lines": [
            "No ads, and there never will be.",
            "No account, and no sign-up.",
            "Your prayer log stays on your phone.",
            "Works without an internet connection.",
        ],
    },
    "tr": {
        "today": "Bugünün beş vakti.\nİşaretlemek için birine dokun.",
        "watch": "Namazın, bileğinde.",
        "travel": "Yolculuk günlerini anlar.",
        "history": "Ay nasıl geçti, gör",
        "qibla": "Ne tarafa döneceğini bil",
        "reminders": "Her vakit için bir hatırlatma",
        "qada": "Kaçırdıklarını\nteker teker tamamla",
        "pledge": "Reklam yok. Hesap yok.\nBütün özellikler ücretsiz.",
        "wordmark": "Simple Prayer",
        "tagline": "günde beş vakit · hiçbiri kaçmasın",
        "pill_today": "İnternetsiz çalışır",
        "pill_watch": "Namazı saatten, telefon yanında olmadan da işaretleyebilirsin",
        "pill_history": "Her günü sonradan değiştirebilirsin",
        "pill_qibla": "Telefonu nasıl tuttuğunu bile fark eder",
        "pill_reminders": "Namazı bildirimin üzerinden de işaretleyebilirsin",
        "pill_travel": "Kısaltılan ve birleştirilen namazlar yanlışlıkla geç sayılmaz",
        "pill_qada": "Sayı yalnızca azalır",
        "pledge_lines": [
            "Reklam yok, hiçbir zaman da olmayacak.",
            "Hesap yok, kayıt yok.",
            "Namaz kaydın telefonunda kalır.",
            "İnternet olmadan da çalışır.",
        ],
    },
    "ar": {
        "today": "صلوات اليوم الخمس.\nنقرة واحدة تسجّلها.",
        "watch": "صلاتك على معصمك.",
        "travel": "أيام السفر مفهومة.",
        "history": "كيف مضى الشهر",
        "qibla": "إلى أين تتّجه",
        "reminders": "تذكير لكل صلاة",
        "qada": "قضاء ما فات،\nواحدة تلو الأخرى",
        "pledge": "بلا إعلانات. بلا حساب.\nكل الميزات مجانية.",
        "wordmark": "Simple Prayer",
        "tagline": "خمس صلوات في اليوم · لا تفوتك واحدة",
        "pill_today": "يعمل بلا إنترنت",
        "pill_watch": "يمكنك تسجيل الصلاة من الساعة، من دون هاتفك",
        "pill_history": "يمكنك تعديل أي يوم لاحقًا",
        "pill_qibla": "حتى إنه يلاحظ كيف تمسك هاتفك",
        "pill_reminders": "يمكنك تسجيل الصلاة من الإشعار نفسه",
        "pill_travel": "القصر والجمع — ولا تُسجَّل صلاة متأخرة خطأً",
        "pill_qada": "الرقم ينقص فقط",
        "pledge_lines": [
            "بلا إعلانات، ولن تكون هناك إعلانات أبدًا.",
            "بلا حساب، وبلا تسجيل.",
            "سجلّ صلاتك يبقى في هاتفك.",
            "يعمل بلا اتصال بالإنترنت.",
        ],
    },
}


def font(locale: str, size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    """Amiri for Arabic, Lora everywhere else — the app's own two faces."""
    if locale == "ar":
        name = "Amiri_700Bold.ttf" if bold else "Amiri_400Regular.ttf"
        path = FONTS / "amiri" / ("700Bold" if bold else "400Regular") / name
    else:
        name = "Lora_600SemiBold.ttf" if bold else "Lora_500Medium.ttf"
        path = FONTS / "lora" / ("600SemiBold" if bold else "500Medium") / name
    if not path.exists():
        sys.exit(f"missing font: {path}")
    return ImageFont.truetype(str(path), size)


def shape(text: str, locale: str) -> str:
    """Join and reorder Arabic. A no-op for the Latin locales."""
    if locale != "ar":
        return text
    try:
        import arabic_reshaper
        from bidi.algorithm import get_display
    except ImportError:
        sys.exit(
            "Arabic needs `arabic_reshaper` and `python-bidi`. Without them the caption renders\n"
            "as disconnected letters in the wrong order. Install them and re-run."
        )
    return get_display(arabic_reshaper.reshape(text))


PAPER = (236, 225, 197)  # theme `bg`, the app's light paper


_PAPER_CACHE: dict[tuple[int, int], Image.Image] = {}


def paper() -> Image.Image:
    """
    The mount: the app's paper, generated rather than sampled.

    Sampling a patch out of a capture was the first attempt and it tiled the date line across the
    whole canvas — there is no region of a real screen large enough to be certain it holds no ink.
    So the ground is built: the `bg` token, a vertical gradient, the app's ruled lines, and the
    same fine grain the app lays over its own paper.

    The gradient is very slight on purpose — about 4% from top to bottom. Enough that the sheet
    has a light source and the device sitting on it looks placed rather than pasted; not enough to
    be seen as a gradient, which would be a material the app does not use anywhere.
    """
    import random

    cached = _PAPER_CACHE.get((W, H))
    if cached is not None:
        return cached.copy()

    rng = random.Random(7)  # fixed, so a rebuild is byte-identical
    canvas = Image.new("RGB", (W, H), PAPER)
    px = canvas.load()

    top_lift, bottom_drop = 1.035, 0.975
    for y in range(H):
        # Lighter at the top, settling darker at the foot, as light falls on a page.
        k = top_lift + (bottom_drop - top_lift) * (y / (H - 1))
        base = tuple(max(0, min(255, int(c * k))) for c in PAPER)
        for x in range(W):
            n = rng.randint(-5, 5)
            px[x, y] = (
                max(0, min(255, base[0] + n)),
                max(0, min(255, base[1] + n)),
                max(0, min(255, base[2] + n)),
            )

    # The ruled lines the app bakes into its own paper texture, at the same rhythm and barely
    # there — they read as laid paper rather than as a lined pad.
    rule = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    rdraw = ImageDraw.Draw(rule)
    for y in range(150, H, 96):
        rdraw.line([(0, y), (W, y)], fill=(150, 126, 84, 16), width=2)
    canvas = Image.alpha_composite(canvas.convert("RGBA"), rule).convert("RGB")

    _PAPER_CACHE[(W, H)] = canvas
    return canvas.copy()


def wrap(draw: ImageDraw.ImageDraw, text: str, fnt, max_w: int) -> list[str]:
    lines: list[str] = []
    for paragraph in text.split("\n"):
        words, line = paragraph.split(), ""
        for word in words:
            trial = f"{line} {word}".strip()
            if draw.textlength(trial, font=fnt) <= max_w or not line:
                line = trial
            else:
                lines.append(line)
                line = word
        lines.append(line)
    return lines


def draw_caption(canvas: Image.Image, text: str, locale: str, size: int, top: int) -> int:
    """Draws the caption centred under the eyebrow; returns the y below it."""
    draw = ImageDraw.Draw(canvas)
    fnt = font(locale, size, bold=True)
    raw_lines = wrap(draw, text, fnt, CAPTION_MAX_W)
    line_h = int(size * 1.34)
    y = top
    for line in raw_lines:
        shaped = shape(line, locale)
        w = draw.textlength(shaped, font=fnt)
        draw.text(((W - w) / 2, y), shaped, font=fnt, fill=INK)
        y += line_h
    return y


def draw_ornament(canvas: Image.Image, y: int) -> None:
    """The diamond the app draws between its own sections."""
    draw = ImageDraw.Draw(canvas)
    s = round(13 * T)
    cx = W / 2
    draw.polygon([(cx, y - s), (cx + s, y), (cx, y + s), (cx - s, y)], fill=ACCENT)
    for direction in (-1, 1):
        x0 = cx + direction * (s + round(34 * T))
        x1 = cx + direction * (s + round(250 * T))
        draw.line([(x0, y), (x1, y)], fill=(214, 199, 166), width=round(3 * T))


def draw_eyebrow(canvas: Image.Image, key: str, y: int) -> int:
    """
    The Arabic word above the caption, in Amiri and accent gold.

    Always Arabic, in every locale, because that is what the app does with it: the Today hero
    sets الظهر over "Dhuhr until 4:58 pm" whatever language the app is in. It is the brand's
    script used as ornament, and it gives the top of the canvas a shape instead of a margin.
    """
    word = EYEBROWS.get(key)
    if word is None:
        return y
    draw = ImageDraw.Draw(canvas)
    fnt = font("ar", round(74 * T))
    shaped = shape(word, "ar")
    w = draw.textlength(shaped, font=fnt)
    draw.text(((W - w) / 2, y), shaped, font=fnt, fill=ACCENT)
    return y + round(108 * T)


def draw_pill(canvas: Image.Image, text: str, locale: str, y: int) -> int:
    """
    One short supporting fact, in the app's own chip shape.

    The captions carry the message; this carries the detail that would otherwise crowd them, and
    it fills the band between the rule and the device that was previously bare paper. Bordered
    rather than filled, so it reads as the app's unselected chip and never competes with the
    caption above it.
    """
    draw = ImageDraw.Draw(canvas)
    shaped = shape(text, locale)
    pad_x, h = round(46 * T), round(86 * T)
    # Turkish runs long, so the type steps down until the pill fits the caption's measure.
    # It never reaches the floor with the current copy; the floor only guards a future line.
    for size in range(round(40 * T), round(29 * T), -2):
        fnt = font(locale, size)
        tw = draw.textlength(shaped, font=fnt)
        if tw + pad_x * 2 <= CAPTION_MAX_W:
            break
    box_w = tw + pad_x * 2
    x0 = (W - box_w) / 2
    draw.rounded_rectangle([x0, y, x0 + box_w, y + h], h / 2, outline=(206, 188, 150), width=3)
    draw.text(((W - tw) / 2, y + (h - fnt.size * 1.32) / 2), shaped, font=fnt, fill=MUTED)
    return y + h


def draw_device(canvas: Image.Image, shot: Path, top: int) -> None:
    """
    The real capture, rounded and shadowed, running off the bottom of the canvas.

    It is deliberately not contained: a frame with air on all four sides reads as a sticker laid
    on the paper, and the empty band beneath it was the largest single thing on the canvas. What
    leaves the frame is the tab bar, which all five device screens repeat anyway.
    """
    device = Image.open(shot).convert("RGB")
    scale = DEVICE_W / device.width
    device = device.resize((DEVICE_W, int(device.height * scale)), Image.LANCZOS)

    mask = Image.new("L", device.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, device.width, device.height], CORNER, fill=255)

    x = (W - device.width) // 2
    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle(
        [x + 10, top + 16, x + device.width + 10, top + device.height + 16],
        CORNER,
        fill=(90, 74, 44, 80),
    )
    canvas.paste(
        Image.alpha_composite(
            canvas.convert("RGBA"), shadow.filter(ImageFilter.GaussianBlur(26))
        ).convert("RGB"),
        (0, 0),
    )
    canvas.paste(device, (x, top), mask)

    ImageDraw.Draw(canvas).rounded_rectangle(
        [x, top, x + device.width, top + device.height], CORNER, outline=(199, 180, 141), width=3
    )


def draw_watch_device(canvas: Image.Image, shot: Path, band_top: int) -> None:
    """
    The watch capture in a watch-shaped case, centred in the band under the pill.

    The raw capture is the watch's real display, 416 × 496 — at true size a postage stamp under
    a 1242-wide caption, so it runs larger than life, the way a watch is shown held up to the
    camera. LANCZOS at ~1.85× is safe here because the content is AMOLED-dark with large type;
    the case's dark bezel then absorbs what little softness the enlargement adds, so it reads
    as a device photographed close, not as a blurry screenshot.

    The case is drawn, not photographed: a dark rounded body in the ink family, a crown and a
    side button on the right edge, and the same gold hairline the phone frame carries so the
    two devices read as one set. The body's corners are much rounder than the display's — that
    is the real proportion of the hardware, not a stylisation.
    """
    screen = Image.open(shot).convert("RGB")
    scale = WATCH_W / screen.width
    screen = screen.resize((WATCH_W, round(screen.height * scale)), Image.LANCZOS)

    body_w = screen.width + WATCH_BEZEL * 2
    body_h = screen.height + WATCH_BEZEL * 2
    body_r = int(body_w * 0.38)
    x0 = (W - body_w) // 2
    # A little above the band's centre — optically centred, and the deeper foot of paper
    # below matches how the phone slots weight their canvas toward the top.
    y0 = band_top + max(48, int((H - band_top - body_h) * 0.40))

    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle(
        [x0 + 10, y0 + 18, x0 + body_w + 10, y0 + body_h + 18], body_r, fill=(90, 74, 44, 90)
    )
    canvas.paste(
        Image.alpha_composite(
            canvas.convert("RGBA"), shadow.filter(ImageFilter.GaussianBlur(30))
        ).convert("RGB"),
        (0, 0),
    )

    draw = ImageDraw.Draw(canvas)
    case = (38, 32, 25)

    # Crown and side button first, so the body covers their roots and they only peek out.
    crown_x = x0 + body_w - 8
    crown_y = y0 + int(body_h * 0.22)
    draw.rounded_rectangle(
        [crown_x, crown_y, crown_x + 30, crown_y + 118], 14, fill=case, outline=(96, 82, 58), width=2
    )
    button_y = y0 + int(body_h * 0.46)
    draw.rounded_rectangle([crown_x, button_y, crown_x + 20, button_y + 160], 10, fill=case)

    draw.rounded_rectangle(
        [x0, y0, x0 + body_w, y0 + body_h], body_r, fill=case, outline=(199, 180, 141), width=3
    )

    # Concentric with the case: an inner rounded rect with radius (case − bezel) is inside the
    # case by construction. A shallower screen radius let the dark screen corners poke past the
    # case's much rounder corners onto the paper (owner caught it on the composed slot). The
    # watch's own clock sits within its safe area, clear of the curve, so the deep radius is safe.
    screen_r = max(0, body_r - WATCH_BEZEL)
    mask = Image.new("L", screen.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, screen.width, screen.height], screen_r, fill=255)
    canvas.paste(screen, (x0 + WATCH_BEZEL, y0 + WATCH_BEZEL), mask)


def draw_wear_device(canvas: Image.Image, shot: Path, band_top: int) -> None:
    """
    The Play variant of the watch slide: the WEAR capture in a round drawn case — a circle
    bezel, a crown stub, the same gold hairline as every other frame — so the watch on the
    Play listing is the watch a Play user will actually wear (owner, 2026-08-28).
    """
    screen = Image.open(shot).convert("RGB")
    d = round(WATCH_W * 0.92)
    screen = screen.resize((d, d), Image.LANCZOS)
    bezel = 30
    body = d + 2 * bezel
    x0 = (W - body) // 2
    y0 = band_top + max(48, int((H - band_top - body) * 0.40))
    case = (38, 32, 25)

    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).ellipse(
        [x0 + 10, y0 + 18, x0 + body + 10, y0 + body + 18], fill=(90, 74, 44, 90)
    )
    canvas.paste(
        Image.alpha_composite(
            canvas.convert("RGBA"), shadow.filter(ImageFilter.GaussianBlur(30))
        ).convert("RGB"),
        (0, 0),
    )

    draw = ImageDraw.Draw(canvas)
    # Crown stub first, so the case covers its root and it only peeks out.
    crown_w, crown_h = 34, 120
    draw.rounded_rectangle(
        [x0 + body - 10, y0 + (body - crown_h) // 2, x0 + body - 10 + crown_w,
         y0 + (body + crown_h) // 2],
        16, fill=case, outline=(96, 82, 58), width=2,
    )
    draw.ellipse([x0, y0, x0 + body, y0 + body], fill=case, outline=(199, 180, 141), width=3)
    mask = Image.new("L", (d, d), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, d - 1, d - 1], fill=255)
    canvas.paste(screen, (x0 + bezel, y0 + bezel), mask)


def draw_pledge(canvas: Image.Image, locale: str, top: int) -> None:
    """
    Screen 6: no device frame. The four promises, each in the app's own card.

    Plain centred lines on bare paper read as a list someone forgot to design — the owner's word
    was bland, and it was fair. These are the card the app uses everywhere else: a rounded panel a
    shade lighter than the ground, a hairline in the accent's family, the diamond as its marker.
    Four of them stacked give the canvas the same rhythm the app's own screens have, and the mark
    closes it.
    """
    draw = ImageDraw.Draw(canvas)
    lines = CAPTIONS[locale]["pledge_lines"]
    rtl = locale == "ar"

    card_w, card_h, gap = 968, 168, 26
    x0 = (W - card_w) / 2

    # One size for all four cards, chosen so the longest line fits inside the marker gutter and
    # the padding on the far side. Set by measurement rather than by eye: "Works without an
    # internet connection." ran out through the card's edge at a fixed 52, and the Turkish and
    # Arabic lines are longer again.
    text_room = card_w - 106 - 62
    fnt = font(locale, 52)
    for size in range(52, 33, -2):
        fnt = font(locale, size)
        if max(draw.textlength(shape(line, locale), font=fnt) for line in lines) <= text_room:
            break

    mark_path = ROOT / "assets" / "images" / "splash-icon.png"
    mark_h = 0
    if mark_path.exists():
        probe = Image.open(mark_path)
        mark_h = int(probe.height * 210 / probe.width) + 110

    # The wordmark and its line close the screen, so they are part of the block being centred.
    name_fnt = font(locale, 62, bold=True)
    tag_fnt = font(locale, 40)
    tail_h = 150

    block_h = len(lines) * card_h + (len(lines) - 1) * gap + mark_h + tail_h
    y = top + max(60, int((H - top - block_h) * 0.34))

    for line in lines:
        # The card: a shade lighter than the paper, with the app's hairline.
        draw.rounded_rectangle(
            [x0, y, x0 + card_w, y + card_h], 34, fill=(245, 238, 218), outline=(214, 199, 166), width=3
        )
        cy = y + card_h / 2
        d = 12
        mx = x0 + card_w - 62 if rtl else x0 + 62
        draw.polygon([(mx, cy - d), (mx + d, cy), (mx, cy + d), (mx - d, cy)], fill=ACCENT)

        shaped = shape(line, locale)
        tw = draw.textlength(shaped, font=fnt)
        tx = x0 + card_w - 106 - tw if rtl else x0 + 106
        draw.text((tx, cy - fnt.size * 0.72), shaped, font=fnt, fill=INK)
        y += card_h + gap

    if mark_path.exists():
        mark = Image.open(mark_path).convert("RGBA")
        side = 190
        mark = mark.resize((side, int(mark.height * side / mark.width)), Image.LANCZOS)
        canvas.paste(mark, ((W - mark.width) // 2, y + 46), mark)
        y += 46 + mark.height

    # The name stays Latin in every locale — it is the name on both stores.
    name = CAPTIONS[locale]["wordmark"]
    nw = draw.textlength(name, font=name_fnt)
    draw.text(((W - nw) / 2, y + 34), name, font=name_fnt, fill=INK)

    tag = shape(CAPTIONS[locale]["tagline"], locale)
    tw = draw.textlength(tag, font=tag_fnt)
    draw.text(((W - tw) / 2, y + 34 + 84), tag, font=tag_fnt, fill=MUTED)


# The iPad set never says "phone" about the device in the reader's hands (owner, 2026-08-28).
IPAD_PILLS = {
    "en": {"pill_qibla": "It even senses how you hold the tablet"},
    "tr": {"pill_qibla": "Tableti nasıl tuttuğunu bile fark eder"},
    "ar": {"pill_qibla": "حتى إنه يلاحظ كيف تمسك جهازك اللوحي"},
}


def build(locale: str, out_root: Path, device: str = "phone") -> None:
    set_profile(device)
    slots = SLOTS if device == "phone" else SLOTS_IPAD
    out = out_root / locale if device == "phone" else out_root / locale / "ipad"
    out.mkdir(parents=True, exist_ok=True)
    expected = {f"{i:02d}-{key}.png" for i, (key, _, _) in enumerate(slots, start=1)}
    if device == "phone":
        expected.add("02-watch-play.png")
    for index, (key, source, shot_name) in enumerate(slots, start=1):
        shot = None
        if source == "watch":
            shot = SHOTS / locale / "watch" / f"{shot_name}.png"
        elif source == "ipad13":
            shot = SHOTS / locale / "light" / "ipad13" / f"{shot_name}.png"
        elif source is not None:
            shot = SHOTS / locale / "light" / "6.5" / f"{shot_name}.png"
        if shot is not None and not shot.exists():
            if key in OPTIONAL:
                print(f"  !! skipping {index:02d}-{key}: no capture at {shot.relative_to(ROOT)}")
                continue
            sys.exit(f"missing capture: {shot}")

        canvas = paper()
        caption = CAPTIONS[locale][key]
        size = round((76 if source is None else 64) * T)

        # Arabic word, caption, rule — then either a pill and a device, or the promises.
        after_eyebrow = draw_eyebrow(canvas, key, EYEBROW_TOP)
        below = draw_caption(canvas, caption, locale, size, top=after_eyebrow)
        rule_y = below + ORNAMENT_GAP - 30
        draw_ornament(canvas, rule_y)

        if source is None:
            draw_pledge(canvas, locale, rule_y)
        else:
            pill = CAPTIONS[locale].get(f"pill_{key}")
            if device == "ipad":
                pill = IPAD_PILLS[locale].get(f"pill_{key}", pill)
            pill_bottom = rule_y + 54
            if pill is not None:
                pill_bottom = draw_pill(canvas, pill, locale, rule_y + 54)
            if source == "watch":
                draw_watch_device(canvas, shot, pill_bottom + 40)
            elif T == 1.0:
                # The phone canvas keeps its fixed, already-shipped device line.
                draw_device(canvas, shot, DEVICE_TOP)
            else:
                draw_device(canvas, shot, max(DEVICE_TOP, pill_bottom + round(64 * T)))

        target = out / f"{index:02d}-{key}.png"
        canvas.save(target, "PNG", optimize=True)
        print(f"  → {target.relative_to(ROOT)}")

    # The Play listing shows the watch slide with a ROUND Wear case (the watch a Play user
    # will wear); swap it in for 02-watch.png when uploading to Play (handoff §3).
    if device == "phone":
        wear_shot = SHOTS / locale / "wear" / "today.png"
        if wear_shot.exists():
            canvas = paper()
            after_eyebrow = draw_eyebrow(canvas, "watch", EYEBROW_TOP)
            below = draw_caption(canvas, CAPTIONS[locale]["watch"], locale, 64, top=after_eyebrow)
            rule_y = below + ORNAMENT_GAP - 30
            draw_ornament(canvas, rule_y)
            pill_bottom = draw_pill(canvas, CAPTIONS[locale]["pill_watch"], locale, rule_y + 54)
            draw_wear_device(canvas, wear_shot, pill_bottom + 40)
            target = out / "02-watch-play.png"
            canvas.save(target, "PNG", optimize=True)
            print(f"  → {target.relative_to(ROOT)}")
        else:
            print(f"  !! skipping 02-watch-play: no capture at {wear_shot.relative_to(ROOT)}")

    # The slot set has changed once already; a leftover from the old numbering sitting next to
    # the new set would upload in the wrong order, so anything not in the plan is removed.
    for stale in sorted(out.glob("*.png")):
        if stale.name not in expected:
            stale.unlink()
            print(f"  ×  removed stale {stale.relative_to(ROOT)}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--locale", choices=["en", "tr", "ar", "all"], default="all")
    ap.add_argument("--device", choices=["phone", "ipad", "all"], default="all")
    ap.add_argument("--out", default="docs/store-screens")
    args = ap.parse_args()
    out_root = ROOT / args.out
    devices = ["phone", "ipad"] if args.device == "all" else [args.device]
    for device in devices:
        for locale in (["en", "tr", "ar"] if args.locale == "all" else [args.locale]):
            print(f"building {locale} ({device})")
            build(locale, out_root, device)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
