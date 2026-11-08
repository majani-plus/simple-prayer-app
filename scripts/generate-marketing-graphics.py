#!/usr/bin/env python3
"""
Generates the two marketing composites that show the real app in tilted device frames.

Run:  DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/lib uv run --with cairosvg --with pillow \
          --with fonttools scripts/generate-marketing-graphics.py

Outputs:
  website/public/og.png                               1200x630  Open Graph / social card
  docs/screenshots/graphics/play-feature-graphic.png  1024x500  Play feature graphic (no alpha)

Everything is derived, never hand-edited: the mark geometry, palette and Lora-to-outline
machinery are imported from scripts/generate-brand-assets.py, the parchment is the app's own
paper-noise tile, and the phone screens are the real captures under docs/screenshots/en/.
Re-run after the screenshots are re-captured.

Which screens, and why (owner, 2026-08-27: the card must show the family — tablet and watch
included). The rear device is the iPad Today board (light) — the biggest canvas, and its seal
rows read as "prayer app" at feed size. The front phone is the dark Qibla — the compass dial
is a single large shape that reads at any size, and pairing light and night paper shows the
dual theme. The round watch (the Wear Today hero, night paper always) overlaps in front: small,
unmistakably a watch, and the proof the app lives on the wrist. Devices bleed off the edges so
the visible screen area stays as large (therefore as legible) as possible.

The Open Graph card carries the wordmark and the approved trust line; the Play graphic keeps
the wordmark modest because the listing already shows title + icon directly beneath it, and
keeps everything essential out of the dead centre (Play overlays a video play button there)
and away from the outer margins (Play crops edges per surface).
"""

import base64
import importlib.util
import io
import os

import cairosvg
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, "docs", "screenshots", "en")

# The mark, palette and text-outline machinery live in the brand script; import it by path
# (the filename's hyphens rule out a plain `import`).
_spec = importlib.util.spec_from_file_location(
    "generate_brand_assets",
    os.path.join(ROOT, "scripts", "generate-brand-assets.py"),
)
brand = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(brand)

# Composites are rendered at 2x and downscaled once at the end, so rotated bezels and type
# stay crisp. All layout numbers in this file are in final (1x) pixels.
SS = 2

BEZEL_FILL = (23, 17, 11, 255)  # near-black warm bezel
SHADOW_INK = (46, 32, 12)  # warm shadow, not pure black — it sits on parchment


# --- SVG backplate: parchment + lockup ---------------------------------------------------------


def paper_svg(width: int, height: int, extra: str) -> str:
    """The app's own ground: paper colour, grain tile, ruled lines, soft vignette."""
    with open(os.path.join(ROOT, "assets", "images", "paper-noise.png"), "rb") as fh:
        tile = base64.b64encode(fh.read()).decode()
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
        f'width="{width}" height="{height}" viewBox="0 0 {width} {height}">'
        f"<defs>"
        f'<pattern id="grain" width="240" height="240" patternUnits="userSpaceOnUse">'
        f'<image xlink:href="data:image/png;base64,{tile}" width="240" height="240"/>'
        f"</pattern>"
        f'<pattern id="rules" width="8" height="4" patternUnits="userSpaceOnUse">'
        f'<rect width="8" height="1" fill="rgb(122,96,44)" fill-opacity="0.03"/>'
        f"</pattern>"
        f'<radialGradient id="vignette" cx="50%" cy="45%" r="80%">'
        f'<stop offset="55%" stop-color="rgb(122,96,44)" stop-opacity="0"/>'
        f'<stop offset="100%" stop-color="rgb(122,96,44)" stop-opacity="0.12"/>'
        f"</radialGradient>"
        f"</defs>"
        f'<rect width="{width}" height="{height}" fill="{brand.PAPER}"/>'
        f'<rect width="{width}" height="{height}" fill="url(#grain)"/>'
        f'<rect width="{width}" height="{height}" fill="url(#rules)"/>'
        f'<rect width="{width}" height="{height}" fill="url(#vignette)"/>'
        f"{extra}</svg>"
    )


def mark_fragment(color: str, x: float, y: float, height: float) -> tuple[str, float]:
    """The mosque mark with its bbox top-left at (x, y); returns (fragment, drawn width)."""
    bb = brand.MARK_BBOX
    unit = height / (bb[3] - bb[1])
    frag = (
        f'<g transform="translate({x - bb[0] * unit:.2f},{y - bb[1] * unit:.2f}) '
        f'scale({unit:.5f})">{brand.MARK_FULL.format(c=color)}</g>'
    )
    return frag, (bb[2] - bb[0]) * unit


def fitted_text(font_path: str, text: str, size: float, max_w: float) -> tuple[str, float]:
    """Lora set as outlines, shrunk (never clipped) until it fits `max_w`."""
    frag, w = brand.text_outline(font_path, text, size)
    if w > max_w:
        frag, w = brand.text_outline(font_path, text, size * max_w / w)
    return frag, w


def diamond_rule(x: float, y: float, w: float) -> str:
    """The app's hairline-with-◆ section ornament."""
    cx = x + w / 2
    return (
        f'<line x1="{x}" y1="{y}" x2="{cx - 16}" y2="{y}" '
        f'stroke="{brand.HAIRLINE}" stroke-width="1.5"/>'
        f'<line x1="{cx + 16}" y1="{y}" x2="{x + w}" y2="{y}" '
        f'stroke="{brand.HAIRLINE}" stroke-width="1.5"/>'
        f'<rect x="{cx - 6}" y="{y - 6}" width="12" height="12" fill="{brand.DIAMOND}" '
        f'transform="rotate(45 {cx} {y})"/>'
    )


def render_backplate(width: int, height: int, extra: str) -> Image.Image:
    png = cairosvg.svg2png(
        bytestring=paper_svg(width, height, extra).encode(),
        output_width=width * SS,
        output_height=height * SS,
    )
    return Image.open(io.BytesIO(png)).convert("RGBA")


# --- Phone frames -------------------------------------------------------------------------------


def phone_layer(
    shot_path: str, screen_w: float, tilt: float, dim: float = 1.0, radius_ratio: float = 0.16
) -> Image.Image:
    """
    A screenshot inside a thin dark bezel with rounded corners, tilted by `tilt` degrees
    (positive = counter-clockwise). `dim` < 1 pushes a phone back visually. Built at SS scale.
    `radius_ratio` shapes the corner: 0.16 reads as a phone, ~0.055 as a tablet.
    """
    shot = Image.open(shot_path).convert("RGB")
    sw = round(screen_w * SS)
    sh = round(sw * shot.height / shot.width)
    shot = shot.resize((sw, sh), Image.LANCZOS)

    bezel = round(sw * 0.028)
    radius = round(sw * radius_ratio)
    w, h = sw + 2 * bezel, sh + 2 * bezel

    body = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(body)
    draw.rounded_rectangle([0, 0, w - 1, h - 1], radius=radius, fill=BEZEL_FILL)
    screen_mask = Image.new("L", (sw, sh), 0)
    ImageDraw.Draw(screen_mask).rounded_rectangle(
        [0, 0, sw - 1, sh - 1], radius=radius - bezel, fill=255
    )
    body.paste(shot, (bezel, bezel), screen_mask)
    # A hairline sheen on the bezel edge so the frame separates from its own shadow.
    draw.rounded_rectangle(
        [0, 0, w - 1, h - 1], radius=radius, outline=(90, 74, 48, 160), width=SS
    )

    if dim < 1.0:
        rgb = ImageEnhance.Brightness(body.convert("RGB")).enhance(dim)
        rgb.putalpha(body.split()[3])
        body = rgb

    return body.rotate(tilt, expand=True, resample=Image.BICUBIC)


def watch_layer(shot_path: str, diameter: float, tilt: float) -> Image.Image:
    """
    The round Wear capture in a circular bezel with a stub crown — instantly "a watch" at any
    size. The capture's content circle fills its square; the mask simply crops that circle.
    """
    shot = Image.open(shot_path).convert("RGB")
    d = round(diameter * SS)
    shot = shot.resize((d, d), Image.LANCZOS)

    bezel = round(d * 0.045)
    w = d + 2 * bezel
    body = Image.new("RGBA", (w, w), (0, 0, 0, 0))
    draw = ImageDraw.Draw(body)
    # Crown stub first, so the case draws over its root.
    crown_w, crown_h = round(d * 0.07), round(d * 0.16)
    draw.rounded_rectangle(
        [w - crown_w - SS, (w - crown_h) // 2, w - 1, (w + crown_h) // 2],
        radius=crown_w // 2,
        fill=BEZEL_FILL,
    )
    body = body.rotate(0)  # keep the draw handle honest after the stub
    draw = ImageDraw.Draw(body)
    draw.ellipse([0, 0, w - 1 - crown_w // 2, w - 1], fill=BEZEL_FILL)
    mask = Image.new("L", (d, d), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, d - 1, d - 1], fill=255)
    body.paste(shot, (bezel, bezel), mask)
    draw.ellipse(
        [0, 0, w - 1 - crown_w // 2, w - 1], outline=(90, 74, 48, 160), width=SS
    )
    return body.rotate(tilt, expand=True, resample=Image.BICUBIC)


def drop_shadow(layer: Image.Image, blur: float, opacity: float) -> tuple[Image.Image, int]:
    """Soft shadow from the layer's own silhouette; returns (shadow, padding to subtract)."""
    b = round(blur * SS)
    pad = b * 3
    silhouette = Image.new("L", (layer.width + 2 * pad, layer.height + 2 * pad), 0)
    silhouette.paste(layer.split()[3].point(lambda v: round(v * opacity)), (pad, pad))
    shadow = Image.new("RGBA", silhouette.size, SHADOW_INK + (0,))
    shadow.putalpha(silhouette.filter(ImageFilter.GaussianBlur(b)))
    return shadow, pad


def compose(
    backplate: Image.Image,
    phones: list[tuple[Image.Image, tuple[float, float], tuple[float, float]]],
    final_size: tuple[int, int],
) -> Image.Image:
    """Paste (layer, position, shadow offset) triples rear-to-front, then downscale to 1x RGB."""
    canvas = backplate
    for layer, (x, y), (dx, dy) in phones:
        shadow, pad = drop_shadow(layer, blur=16, opacity=0.36)
        canvas.paste(
            shadow,
            (round((x + dx) * SS) - pad, round((y + dy) * SS) - pad),
            shadow,
        )
        canvas.paste(layer, (round(x * SS), round(y * SS)), layer)
    return canvas.resize(final_size, Image.LANCZOS).convert("RGB")


# --- The two composites -------------------------------------------------------------------------


def build_og() -> None:
    """1200x630 Open Graph card: lockup left, the phone pair right, both phones bleeding off."""
    w, h = 1200, 630

    mark, _ = mark_fragment(brand.GOLD, 96, 120, 120)
    title, title_w = fitted_text(brand.LORA["semibold"], "Simple Prayer", 76, 440)
    tagline, _ = fitted_text(brand.LORA["italic"], "Free forever. No ads.", 42, 440)
    lockup = (
        mark
        + f'<g fill="{brand.INK}" transform="translate(96,372)">{title}</g>'
        + diamond_rule(96, 424, title_w)
        + f'<g fill="{brand.MUTED}" transform="translate(96,498)">{tagline}</g>'
    )

    # Rear: the iPad Today board bleeding off the top-right (the seal rows say "prayer app").
    # Front: the dark Qibla phone (dual theme + a dial that reads at feed size). The round
    # watch overlaps front-most — small, unmistakable, the "everywhere" claim in one glance.
    tablet = phone_layer(
        os.path.join(SHOTS, "light", "ipad13", "01-today-seal.png"), 470, 6, dim=0.96,
        radius_ratio=0.055,
    )
    front = phone_layer(os.path.join(SHOTS, "dark", "6.5", "03-qibla.png"), 300, -5)
    watch = watch_layer(os.path.join(SHOTS, "wear", "today.png"), 205, -6)
    out = compose(
        render_backplate(w, h, lockup),
        [
            (tablet, (700, -132), (10, 16)),
            (front, (555, 130), (14, 20)),
            (watch, (940, 372), (12, 16)),
        ],
        (w, h),
    )
    path = os.path.join(ROOT, "website", "public", "og.png")
    out.save(path)
    print(f"  {os.path.relpath(path, ROOT)}  {out.size[0]}x{out.size[1]} {out.mode}")


def build_play() -> None:
    """
    1024x500 Play feature graphic. Play may overlay a play button dead centre and crops the
    outer edges per surface, so the lockup sits in the left third, the phones in the right
    third, and nothing that must be read touches the centre circle or the margins. The
    wordmark stays modest — the listing shows the title and icon right below this asset.
    """
    w, h = 1024, 500
    cx = 250

    mark, mark_w = mark_fragment(brand.GOLD, 0, 0, 110)
    mark = mark_fragment(brand.GOLD, cx - mark_w / 2, 116, 110)[0]
    title, title_w = fitted_text(brand.LORA["semibold"], "Simple Prayer", 44, 300)
    tagline, tag_w = fitted_text(brand.LORA["italic"], "Free forever. No ads.", 30, 300)
    lockup = (
        mark
        + f'<g fill="{brand.INK}" transform="translate({cx - title_w / 2:.1f},296)">{title}</g>'
        + diamond_rule(cx - title_w / 2, 326, title_w)
        + f'<g fill="{brand.MUTED}" transform="translate({cx - tag_w / 2:.1f},376)">{tagline}</g>'
    )

    tablet = phone_layer(
        os.path.join(SHOTS, "light", "ipad13", "01-today-seal.png"), 390, 6, dim=0.96,
        radius_ratio=0.055,
    )
    front = phone_layer(os.path.join(SHOTS, "dark", "6.5", "03-qibla.png"), 245, -5)
    watch = watch_layer(os.path.join(SHOTS, "wear", "today.png"), 165, -6)
    out = compose(
        render_backplate(w, h, lockup),
        [
            (tablet, (590, -105), (8, 12)),
            (front, (470, 108), (12, 16)),
            (watch, (800, 300), (10, 12)),
        ],
        (w, h),
    )
    path = os.path.join(ROOT, "docs", "screenshots", "graphics", "play-feature-graphic.png")
    out.save(path)
    print(f"  {os.path.relpath(path, ROOT)}  {out.size[0]}x{out.size[1]} {out.mode}")


def main() -> None:
    print("marketing composites")
    build_og()
    build_play()


if __name__ == "__main__":
    main()
