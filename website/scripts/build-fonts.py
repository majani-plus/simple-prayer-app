#!/usr/bin/env python3
"""Build the self-hosted, subsetted web fonts from the exact TTFs the app bundles.

The site's privacy pledge ("no third-party requests") has to be true of the site itself, so the
fonts are served from /fonts rather than a Google Fonts CDN. Sources are the same
@expo-google-fonts packages the app uses (repo root node_modules), so app and site render the
same faces. Output is committed; re-run only if the strings on the site change (the Amiri subset
is pinned to the Arabic actually rendered) or the app's font packages are upgraded.

Run from website/:  uv run --with fonttools --with brotli python3 scripts/build-fonts.py
"""

import subprocess
import sys
from pathlib import Path

WEBSITE = Path(__file__).resolve().parent.parent
REPO = WEBSITE.parent
FONTS_SRC = REPO / "node_modules" / "@expo-google-fonts"
OUT = WEBSITE / "public" / "fonts"

# Lora carries all Latin UI text. Basic Latin + Latin-1 + punctuation/quotes/dashes/ellipsis,
# and the ◆ ornament the design language uses as a divider.
#
# U+2192 was listed here for "arrows used in support copy" and is a dead declaration: no Lora face
# contains it, checked against the shipped TTFs. Neither does any face contain U+2190, which the
# Arabic support copy actually used seventeen times — so both arrows were being drawn by a system
# fallback at a different weight and colour, mid-sentence. The copy uses `·` instead, which every
# shipped face has. U+25C6 is kept for the same honest reason it is documented: nothing has it
# either, and that is recorded as a known issue rather than fixed inside a locale milestone.
LATIN_UNICODES = (
    "U+0000-00FF,U+0100-017F,U+2013-2014,U+2018-201D,U+2022,U+2026,U+2039-203A,"
    "U+25C6,U+00B7,U+2212"
)

# The Arabic pages carry the full Arabic block plus the punctuation, digits and degree sign that
# appear inside Arabic copy. Shaping features are kept ('*') so initial/medial/final forms and
# ligatures still work. Latin letters are deliberately excluded — they fall through to Lora,
# matching the app.
#
# Two faces use this subset, for the same division of labour the app settled in D135: Noto Naskh
# Arabic carries UI and body text, where it has four weights and reads clearly at caption sizes,
# and Amiri stays for the calligraphy. Amiri was doing both jobs here as it was in the app, and
# the site reproduced the app's exact defect — `.hint` landed at 12.8px in Amiri 400, which is
# the combination D54 exists to prevent.
ARABIC_UNICODES = (
    "U+0600-06FF,U+0020-003F,U+005B-0060,U+00AB,U+00BB,U+00B0,U+00B7,"
    "U+2013-2014,U+2018-201D,U+2026,U+200C-200F,U+2212"
)

# The Latin pages (en/tr) render only a handful of Amiri strings, so they load a tiny subset
# pinned to those glyphs instead of the full ~85 KB Arabic face (spec-website §8.4). `.arabic` in
# global.css tries this family first and falls back to full Amiri for anything outside it.
#
# What is pinned, and why each part is here:
#   - the CTA calligraphy, حافظوا على الصلاة
#   - the seal demo's prayer name, المغرب
#   - every prayer name the times card can show beside its Latin name, including الجمعة for
#     Friday's Dhuhr. Without these the home page's schedule would pull the full face down on
#     every visit, which is the whole thing this subset exists to avoid.
#
# Re-run `bun run fonts` if any of these strings changes.
AMIRI_CTA_TEXT = (
    "حافظوا على الصلاة "
    "الفجر الظهر العصر المغرب العشاء الجمعة"
)

JOBS = [
    ("lora/400Regular/Lora_400Regular.ttf", "lora-400.woff2", LATIN_UNICODES, None),
    ("lora/400Regular_Italic/Lora_400Regular_Italic.ttf", "lora-400-italic.woff2", LATIN_UNICODES, None),
    ("lora/600SemiBold/Lora_600SemiBold.ttf", "lora-600.woff2", LATIN_UNICODES, None),
    ("lora/700Bold/Lora_700Bold.ttf", "lora-700.woff2", LATIN_UNICODES, None),
    ("noto-naskh-arabic/400Regular/NotoNaskhArabic_400Regular.ttf", "noto-naskh-400.woff2", ARABIC_UNICODES, None),
    ("noto-naskh-arabic/600SemiBold/NotoNaskhArabic_600SemiBold.ttf", "noto-naskh-600.woff2", ARABIC_UNICODES, None),
    ("amiri/400Regular/Amiri_400Regular.ttf", "amiri-400.woff2", ARABIC_UNICODES, None),
    ("amiri/700Bold/Amiri_700Bold.ttf", "amiri-700.woff2", ARABIC_UNICODES, None),
    ("amiri/400Regular/Amiri_400Regular.ttf", "amiri-cta-400.woff2", None, AMIRI_CTA_TEXT),
    # Urdu is set in Nastaliq, the script style Urdu readers expect (Naskh reads as Arabic to
    # them). Same Arabic-block subset; only /ur pages use or preload it.
    ("noto-nastaliq-urdu/400Regular/NotoNastaliqUrdu_400Regular.ttf", "nastaliq-400.woff2", ARABIC_UNICODES, None),
    ("noto-nastaliq-urdu/700Bold/NotoNastaliqUrdu_700Bold.ttf", "nastaliq-700.woff2", ARABIC_UNICODES, None),
]


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    for src_rel, out_name, unicodes, text in JOBS:
        src = FONTS_SRC / src_rel
        if not src.exists():
            print(f"missing source font: {src} — run `bun install` at the repo root first", file=sys.stderr)
            return 1
        out = OUT / out_name
        cmd = [
            sys.executable, "-m", "fontTools.subset", str(src),
            f"--output-file={out}",
            "--flavor=woff2",
            "--no-hinting",
            "--desubroutinize",
        ]
        if unicodes:
            # Open-ended unicode subsets keep every layout feature so any text in range shapes.
            cmd += ["--layout-features=*", f"--unicodes={unicodes}"]
        else:
            # Text-pinned subsets rely on fontTools' default feature list, which already covers
            # Arabic shaping (ccmp/init/medi/fina/rlig/liga/calt/mark/mkmk/kern) — keeping '*'
            # here triples the file for glyphs these exact strings never use.
            cmd.append(f"--text={text}")
        subprocess.run(cmd, check=True)
        print(f"{out_name}: {out.stat().st_size / 1024:.1f} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
