#!/usr/bin/env python3
"""
Generates every brand raster asset from the mosque mark (Claude Design option 6c).

Run:  uv run --with cairosvg scripts/generate-brand-assets.py
      (or: python3 scripts/generate-brand-assets.py  with cairosvg installed)

The mark is stroke-based in a 64x64 viewBox and has four optical sizes: strokes get heavier
and details drop away as the mark gets smaller, so it stays legible at 16pt. Sizes above are
"full"; the small variants are used by the in-app <Logo> component (src/components/Logo.tsx).

Everything here is derived, never hand-edited — re-run this script after changing the mark.
Outputs (all under assets/):
  images/icon.png                     1024  legacy/general app icon (gold tile, cream mark)
  images/icon-light.png               1024  iOS 18 light appearance (opaque gold)
  images/icon-dark.png                1024  iOS 18 dark appearance (transparent bg)
  images/icon-tinted.png              1024  iOS 18 tinted appearance (grayscale, transparent)
  images/android-icon-foreground.png  1024  adaptive foreground, mark inside the 66dp keyline circle
  images/android-icon-background.png  1024  adaptive background, solid gold
  images/android-icon-monochrome.png  1024  Android 13+ themed icon layer (alpha-only silhouette)
  images/splash-icon.png               512  light splash mark (gold on transparent)
  images/splash-icon-dark.png          512  dark splash mark (cream on transparent)
  images/favicon.png                    64  web favicon
  appicon.icon/Assets/mosque.svg      1024  layer art for Apple's Icon Composer (.icon) bundle
"""

import base64
import os
import subprocess
import sys

import cairosvg
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMAGES = os.path.join(ROOT, "assets", "images")
ICON_BUNDLE = os.path.join(ROOT, "assets", "appicon.icon")
STORE = os.path.join(ROOT, "docs", "screenshots", "graphics")
FONTS = os.path.join(ROOT, "node_modules", "@expo-google-fonts", "lora")

# Brand colors (docs/DESIGN.md)
GOLD = "#8A6420"
CREAM = "#F3E7C8"
PAPER = "#ECE1C5"
NIGHT = "#241B10"

# --- The mark, in a 64x64 viewBox -------------------------------------------------------------
# Optical size "full": dome + finial + two minarets with finials + ground line.
MARK_FULL = """
<path d="M18 42A14 14 0 0 1 46 42" stroke="{c}" stroke-width="3.4" stroke-linecap="round" fill="none"/>
<path d="M32 26v-5" stroke="{c}" stroke-width="2.6" stroke-linecap="round"/>
<circle cx="32" cy="18" r="2.6" fill="{c}"/>
<path d="M10.5 42V29M53.5 42V29" stroke="{c}" stroke-width="3.4" stroke-linecap="round"/>
<circle cx="10.5" cy="25" r="2.6" fill="{c}"/>
<circle cx="53.5" cy="25" r="2.6" fill="{c}"/>
<path d="M7 46h50" stroke="{c}" stroke-width="3.4" stroke-linecap="round"/>
"""

# Optical size "small": heavier strokes, finial dropped — used where the mark renders tiny
# (favicon, notification small icon). Mirrors the <Logo> component's "small" variant.
MARK_SMALL = """
<path d="M18 42A14 14 0 0 1 46 42" stroke="{c}" stroke-width="6" stroke-linecap="round" fill="none"/>
<path d="M11 42V30M53 42V30" stroke="{c}" stroke-width="6" stroke-linecap="round"/>
<path d="M8 47h48" stroke="{c}" stroke-width="6" stroke-linecap="round"/>
"""

# Tightest box each optical size occupies inside the 64-unit viewBox, stroke included.
MARK_BBOX = (5.3, 15.4, 58.7, 47.7)  # x0, y0, x1, y1
MARK_BBOX_SMALL = (5.0, 27.0, 59.0, 50.0)


def svg_document(
    color: str,
    size: int,
    scale: float,
    bg: str | None = None,
    radius_ratio: float = 0.0,
    optical: str = "full",
) -> str:
    """
    Compose a square SVG of `size` px containing the mark scaled so the 64-unit viewBox occupies
    `scale` of the canvas, centred on the mark's own bounding box (not the viewBox), so the mark is
    optically centred rather than mathematically centred on empty space.
    """
    art = MARK_SMALL if optical == "small" else MARK_FULL
    bbox = MARK_BBOX_SMALL if optical == "small" else MARK_BBOX
    box = 64.0
    drawn = size * scale
    unit = drawn / box
    cx = (bbox[0] + bbox[2]) / 2
    cy = (bbox[1] + bbox[3]) / 2
    tx = size / 2 - cx * unit
    ty = size / 2 - cy * unit

    background = ""
    if bg:
        if radius_ratio:
            r = size * radius_ratio
            background = f'<rect width="{size}" height="{size}" rx="{r}" ry="{r}" fill="{bg}"/>'
        else:
            background = f'<rect width="{size}" height="{size}" fill="{bg}"/>'

    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" '
        f'viewBox="0 0 {size} {size}">{background}'
        f'<g transform="translate({tx},{ty}) scale({unit})">{art.format(c=color)}</g></svg>'
    )


# --- Play Store feature graphic ---------------------------------------------------------------
# Everything below is drawn from assets this repo already owns: the mark geometry above, the
# app's own paper-grain tile (assets/images/paper-noise.png) and the app's own typeface (Lora,
# from node_modules/@expo-google-fonts). Type is converted to outlines with fontTools so the
# output does not depend on any font being installed on the machine that renders it.

# Ink colours from src/theme/tokens.ts (paperLight).
INK = "#2b2115"
MUTED = "#8d7b52"
DIAMOND = "#a67c2e"
HAIRLINE = "rgba(166,124,46,0.35)"

LORA = {
    "semibold": os.path.join(FONTS, "600SemiBold", "Lora_600SemiBold.ttf"),
    "italic": os.path.join(FONTS, "400Regular_Italic", "Lora_400Regular_Italic.ttf"),
}


def text_outline(font_path: str, text: str, size: float) -> tuple[str, float]:
    """
    Sets `text` as SVG path data at `size` px, with the baseline at y=0 and the first glyph's
    origin at x=0.

    @returns `(svg_fragment, advance_width_px)` — the caller positions it with a transform.
    """
    font = TTFont(font_path)
    upem = font["head"].unitsPerEm
    cmap = font.getBestCmap()
    glyphs = font.getGlyphSet()
    hmtx = font["hmtx"]
    scale = size / upem

    parts: list[str] = []
    pen_x = 0
    for char in text:
        name = cmap.get(ord(char))
        if name is None:
            continue
        pen = SVGPathPen(glyphs)
        glyphs[name].draw(pen)
        commands = pen.getCommands()
        if commands:
            parts.append(
                f'<path d="{commands}" '
                f'transform="translate({pen_x * scale:.3f},0) scale({scale:.6f},{-scale:.6f})"/>'
            )
        pen_x += hmtx[name][0]
    return "".join(parts), pen_x * scale


def feature_graphic(width: int = 1024, height: int = 500) -> str:
    """
    The Play Store feature graphic: the mark, the wordmark and the promise, on the app's own
    paper. Play crops this asset on some surfaces, so nothing that has to be read sits in the
    outer eighth of either axis.
    """
    with open(os.path.join(IMAGES, "paper-noise.png"), "rb") as fh:
        tile = base64.b64encode(fh.read()).decode()

    # Play crops the outer edges on some surfaces, so the whole lockup is centred inside a safe
    # box and the type is shrunk (never clipped) until it fits.
    safe = width - 2 * 72
    gap = 72.0
    mark_h = 176.0
    unit = mark_h / (MARK_BBOX[3] - MARK_BBOX[1])
    mark_w = (MARK_BBOX[2] - MARK_BBOX[0]) * unit

    title_size = 66.0
    title, title_w = text_outline(LORA["semibold"], "Simple Prayer Times", title_size)
    if mark_w + gap + title_w > safe:
        title_size *= (safe - mark_w - gap) / title_w
        title, title_w = text_outline(LORA["semibold"], "Simple Prayer Times", title_size)
    tagline, tagline_w = text_outline(LORA["italic"], "Every feature is free. No ads.", title_size * 0.54)

    block_w = mark_w + gap + max(title_w, tagline_w)
    mark_x = (width - block_w) / 2
    mark_y = height / 2 - mark_h / 2
    mark = (
        f'<g transform="translate({mark_x - MARK_BBOX[0] * unit:.2f},'
        f'{mark_y - MARK_BBOX[1] * unit:.2f}) scale({unit:.5f})">'
        f"{MARK_FULL.format(c=GOLD)}</g>"
    )
    text_x = mark_x + mark_w + gap
    rule_w = max(title_w, tagline_w)

    # A short ◆ rule between the wordmark and the promise — the app's own section ornament.
    rule_y = height / 2 + 26
    rule = (
        f'<line x1="{text_x}" y1="{rule_y}" x2="{text_x + rule_w / 2 - 16}" y2="{rule_y}" '
        f'stroke="{HAIRLINE}" stroke-width="1.5"/>'
        f'<line x1="{text_x + rule_w / 2 + 16}" y1="{rule_y}" x2="{text_x + rule_w}" y2="{rule_y}" '
        f'stroke="{HAIRLINE}" stroke-width="1.5"/>'
        f'<rect x="{text_x + rule_w / 2 - 7}" y="{rule_y - 7}" width="14" height="14" '
        f'fill="{DIAMOND}" transform="rotate(45 {text_x + rule_w / 2} {rule_y})"/>'
    )

    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
        f'width="{width}" height="{height}" viewBox="0 0 {width} {height}">'
        f"<defs>"
        f'<pattern id="paper" width="240" height="240" patternUnits="userSpaceOnUse">'
        f'<image xlink:href="data:image/png;base64,{tile}" width="240" height="240"/>'
        f"</pattern>"
        f"</defs>"
        f'<rect width="{width}" height="{height}" fill="{PAPER}"/>'
        f'<rect width="{width}" height="{height}" fill="url(#paper)"/>'
        f"{mark}"
        f'<g fill="{INK}" transform="translate({text_x},{height / 2 - 6})">{title}</g>'
        f"{rule}"
        f'<g fill="{MUTED}" transform="translate({text_x},{rule_y + 56})">{tagline}</g>'
        f"</svg>"
    )


def write_png(path: str, svg: str, size: int) -> None:
    cairosvg.svg2png(bytestring=svg.encode(), write_to=path, output_width=size, output_height=size)
    print(f"  {os.path.relpath(path, ROOT)}")


def write_feature_graphic() -> None:
    os.makedirs(STORE, exist_ok=True)
    path = os.path.join(STORE, "play-feature-graphic-1024x500.png")
    cairosvg.svg2png(
        bytestring=feature_graphic().encode(),
        write_to=path,
        output_width=1024,
        output_height=500,
    )
    print(f"  {os.path.relpath(path, ROOT)}")


def main() -> None:
    # `--feature-only` regenerates just the Play feature graphic, so a store-asset tweak never
    # rewrites every app icon as a side effect.
    if "--feature-only" in sys.argv:
        print("store graphics")
        write_feature_graphic()
        return

    os.makedirs(IMAGES, exist_ok=True)
    os.makedirs(os.path.join(ICON_BUNDLE, "Assets"), exist_ok=True)

    print("app icons")
    # Apple renders the icon into its own rounded mask, so the tile is drawn full-bleed square.
    write_png(os.path.join(IMAGES, "icon.png"), svg_document(CREAM, 1024, 0.72, bg=GOLD), 1024)
    write_png(os.path.join(IMAGES, "icon-light.png"), svg_document(CREAM, 1024, 0.72, bg=GOLD), 1024)
    # iOS 18 dark + tinted appearances composite over a system-provided backdrop, so no background.
    write_png(os.path.join(IMAGES, "icon-dark.png"), svg_document(CREAM, 1024, 0.72), 1024)
    write_png(os.path.join(IMAGES, "icon-tinted.png"), svg_document("#FFFFFF", 1024, 0.72), 1024)

    print("android adaptive icon")
    # Android masks adaptive icons with arbitrary shapes; only a 66/108 diameter circle is
    # guaranteed visible. Scale so the mark's furthest corner sits inside that circle on every
    # device shape: safe radius = 0.5 * (66/108) * 1024 = 313px.
    corner = ((MARK_BBOX[2] - MARK_BBOX[0]) ** 2 + (MARK_BBOX[3] - MARK_BBOX[1]) ** 2) ** 0.5 / 2
    android_scale = (313 / corner) * 64 / 1024
    write_png(
        os.path.join(IMAGES, "android-icon-foreground.png"),
        svg_document(CREAM, 1024, android_scale),
        1024,
    )
    write_png(
        os.path.join(IMAGES, "android-icon-background.png"),
        f'<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">'
        f'<rect width="1024" height="1024" fill="{GOLD}"/></svg>',
        1024,
    )
    # Themed icons are tinted from the alpha channel; the fill colour itself is discarded.
    write_png(
        os.path.join(IMAGES, "android-icon-monochrome.png"),
        svg_document("#000000", 1024, android_scale),
        1024,
    )

    print("splash + favicon")
    write_png(os.path.join(IMAGES, "splash-icon.png"), svg_document(GOLD, 512, 0.86), 512)
    write_png(os.path.join(IMAGES, "splash-icon-dark.png"), svg_document(CREAM, 512, 0.86), 512)
    write_png(
        os.path.join(IMAGES, "favicon.png"),
        svg_document(CREAM, 64, 0.66, bg=GOLD, optical="small"),
        64,
    )
    # Android status-bar notification icon: alpha-only silhouette, heavier optical size.
    write_png(
        os.path.join(IMAGES, "notification-icon.png"),
        svg_document("#FFFFFF", 96, 0.72, optical="small"),
        96,
    )

    print("store graphics")
    write_feature_graphic()

    print("Icon Composer layer art")
    layer = os.path.join(ICON_BUNDLE, "Assets", "mosque.svg")
    with open(layer, "w") as fh:
        fh.write(svg_document(CREAM, 1024, 0.72))
    print(f"  {os.path.relpath(layer, ROOT)}")

    print("\nDone. Colors: gold %s, cream %s, paper %s, night %s" % (GOLD, CREAM, PAPER, NIGHT))


if __name__ == "__main__":
    main()
