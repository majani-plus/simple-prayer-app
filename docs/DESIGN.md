# Design Language — "Paper & Seal" (from Claude Design explorations 2a + 3a)

Source of truth: the "Prayer Tracker Explorations" design canvas (internal notes).
Chosen options: **2a** (Today — seal morphs into three choices) and **3a** (Qibla — compass dial in the same paper language).

## Mood

Warm aged paper / manuscript. Serif typography (Lora) with Arabic calligraphy accents (Amiri). Gold-brown ink
palette. Soft rounded cards floating on textured parchment. One accent family (gold-brown), plus a
burnt-orange for "late", a muted red-brown for "missed", and a deep green reserved exclusively for
qibla alignment. Everything literary and calm — a devotional object, not a dashboard.

## Palette (light "paper" theme) — design values, retuned for WCAG AA (D53, D56)

The word-carrying quiet tones were darkened from the extracted design values so every word clears
AA 4.5:1 on the surfaces it actually sits on, then re-lightened to the *lightest* compliant values
(D56) so the page keeps its warmth — each shipped tone is its design parent darkened
hue-preservingly, and the register keeps the parents' darkest→lightest order. Decorative values
(borders, hairlines, seal glyph) are still extracted verbatim. `src/theme/tokens.ts` is the
authoritative source; its test computes every ratio. Inline hex values elsewhere in this document
are the original design's and are kept for provenance — tokens win where they differ.

| Token | Shipped hex | Design hex | Usage |
|---|---|---|---|
| paper.bg | `#ece1c5` | — | Screen background (with texture, below) |
| paper.card | `rgba(255,252,242,.7)` | — | Card fill (default rows, info cards); `.85` next-prayer row, `.45` quiet rows, `.9`–`.97` elevated/expanded |
| ink.primary | `#2b2115` | — | Primary text |
| ink.strong | `#5a4413` | — | Emphasized numerals/time, needle center, compass pointer |
| accent | `#8a6420` | — | Prayed seal fill, active tab icon, Arabic calligraphy, primary buttons |
| accent.deep | `#7c5a16` | — | "Prayed" option text in open seal; active tab label + Today countdown caption (small text on bare bg, per D53) |
| gold.header | `#72613d` (4.62:1 on bg) | `#7a6842` | Header/date text, secondary labels, status pill text |
| gold.muted | `#716241` (4.58:1) | `#8d7b52` | Captions, quiet times, cardinal letters |
| gold.faint | `#75623b` (4.53:1) | `#a08650` | Arabic row names, hints/footnotes, ⋯ affordances |
| gold.soft | `#716345` (4.52:1) | `#ab9668` | Inactive tab icons/labels |
| gold.dashed | `#9e854d` (3.04:1 on quiet card) | `#b39a63` | Unlogged seal dashed border + dot — held AT the graphics bar; its lightness means "empty" |
| late | `#a75d2d` (4.65:1 on bright card) | `#b0622f` | Late seal fill + "Late" option + attention captions |
| missed | `#a5522f` | — | Missed seal outline/icon + "Missed" option |
| border.strong | `#c9a75c` | — | Next-prayer card border, expanded seal border, highlighted info card |
| border.mid | `#cdb98a` / `#c2ac7e` | — | Buttons/pills outline |
| border.faint | `rgba(166,124,46,.35)` / `.3` / `.22` | — | Hairline dividers, quiet card borders |
| diamond | `#a2792c` (3.04:1 on bg) | `#a67c2e` | ◆ divider ornament, streak number (large-text bar) |
| seal.fg | `#faf4e4` | — | Icon color on filled seals |
| aligned (green) | `#3f6f42`, text `#f2f7ee` / `#2f5632`, tints `rgba(63,111,66,.12/.4/.55)` | — | Qibla aligned state ONLY |

## Paper texture (background)

Base `#ece1c5` + two layers:
1. SVG fractal noise: `feTurbulence baseFrequency=0.75 numOctaves=2`, color matrix toward warm brown, alpha 0.09, 240×240 tile.
2. Ruled lines: `repeating-linear-gradient(180deg, rgba(122,96,44,.025) 0 1px, transparent 1px 4px)`.
Plus inner vignette on the screen: `inset 0 0 60px rgba(122,96,44,.1)`.
RN implementation: pre-render the noise tile as a bundled image (or Skia noise); keep it subtle.
Shipped: the tile at 0.8 opacity on light paper, re-inked in `textureInk` at 0.5 on night paper
(`PaperBackground.tsx`; turned down a pinch at the owner's ask, 2026-10-10).

## Typography

- **Lora** (serif) — everything Latin: headers, names, buttons, captions (italic for captions/hints).
- **Amiri** — Arabic calligraphy names (المغرب etc.) and Arabic UI when locale=ar.
- **Material Symbols Rounded** (FILL=1 for filled, FILL=0 for outlined tab icons) — bundle the font, subset if practical. Glyphs used: check, schedule, close, circle, notifications, notifications_active, today, calendar_month, explore, menu_book, settings, my_location, mosque, check_circle, task_alt, turn_right, turn_left, electric_bolt, workspace_premium.
- Numerals always `font-variant-numeric: tabular-nums`.
- Key sizes (from 2a @390px width), quiet tier raised app-wide by D74 (owner's fourth small-type report; audience skews older): header date 14px/500 (design 13); streak number 20px/600 + "day streak" 13.5px italic (design 12); hero Arabic 30px Amiri; hero name+time 23px (time 700); countdown 14px italic; row name 18px/600 (design 17; next: 20px); row Arabic 16px Amiri; value time 14px — raised from the design's 12.5 in two steps, D67 then D74; the prayer rows' own secondary line sits higher still after a third owner report (2026-08-24): row time 15.5px, row caption 15px italic (current row: 19px/700); captions/descriptions elsewhere 13.5px italic (design 12; D67 for prayer rows, D74 everywhere); seal option labels 10px/600 (design 8.5); tab labels 12px (design 10.5); footer hints 13px italic (design 12, D74). The emphasised sizes held their ground on purpose — only the quiet tier rose, so hierarchy compresses a step but never inverts.

## Signature components

### Header + hero (Today)
- Row: date left, streak right (baseline-aligned).
- Divider with centered ◆ ornament (letter-spaced, on paper-colored chip) sitting on a 1px hairline `rgba(166,124,46,.35)`; hero section bounded top+bottom by these hairlines.
- Hero: Arabic name (Amiri 30px, `#8a6420`) → "Maghrib **8:47 pm**" → italic countdown (the mode line) → reminder pill (filled `#8a6420` when on, outlined when off; icon notifications_active/notifications; 999px radius).
- **Hero modes (D66, layout amended by D67):** both count down to the same instant (a window ends exactly when the next prayer starts), so the framing carries the whole distinction — and it is carried **entirely on elements every mode renders**: the owner rejected the earlier chip row ("adding another row … this jitter"), so the three modes are layout-identical, the same rows at the same sizes, nothing appears or disappears. **DUE** (current prayer unlogged): the instant renders "**until** 8:47 pm" in the accent gold, and the countdown line reads "2 hours 7 minutes **left to pray**" in accent, led by a 14px seal echo — hollow check in a dashed accent ring — riding *inside* the line at caption height. **WAITING** (current logged prayed/late): plain start time in ink, countdown line "**Isha prayed** · next in 2 hours 7 minutes" led by a small filled gold disc — the prayed prayer is NAMED (D68): a bare "prayed" directly under the next prayer's name was misread as that prayer being prayed. **PLAIN** (exempt day, no current window, `missed` edited in from History, unlogged Fajr after sunrise): the unadorned original, no glyph. The reminder pill is present in **every** mode (a pill that comes and goes is jitter) and always belongs to the NEXT prayer — the one whose arrival ends the countdown. A mode switch cross-fades in place with a 6px rise (opacity/transform only, never layout); the rise is dropped under reduced motion. Icon + words, never colour alone: glyph, "until", and "left to pray"/"prayed" change together.

### Prayer row (2a, emphasis amended by D58, three tiers by D66)
- Card: radius 14px, padding 10–14px; three emphasis tiers (D66): **CURRENT** — the prayer whose window contains now, **logged or not** — gets brighter fill, `#c9a75c` border, soft shadow `0 2px 10px -4px rgba(138,100,32,.3)`, larger type, and holds it for as long as the window is open: the row's weight says which window you are in, the seal says whether it is still owed. **NEXT** — the upcoming prayer, only once the current one is logged (or when no window contains now at all): the quiet card keeps its accent countdown caption and gains a soft italic "next ·" word plus a 1px `borderMid` ring, both **fading in** at the moment the log lands (the word rises 4px; rise dropped under reduced motion). Never the bright card — no fill change, no glow, no larger type — so the two emphasised rows can never be confused. **REST** stays quiet. After Isha, current is yesterday's Isha and next is tomorrow's Fajr (not in the list): no NEXT ring anywhere, never on today's past Fajr. Exempt days: no CURRENT, no NEXT.
- Left column: name + Arabic side by side; below: time + italic caption ("prayed", "prayed late", "missed", "in 2 h 07 m", "upcoming", "not marked"; on the current row while unlogged the accent deadline line "now · until 8:47 pm" / Fajr "now · until sunrise 6:14 am" / post-sunrise "now" — once logged the caption is the status word while the register stays; on the NEXT tier "next · in 2 h 07 m").
- Right: **the seal** (48px circle):
  - prayed: fill `#8a6420`, icon check, shadow `0 2px 8px -2px rgba(138,100,32,.5)`
  - late: fill `#b0622f`, icon schedule
  - missed: transparent, border `1.5px solid #a5522f`, icon close, color `#a5522f`
  - unlogged, past: transparent, border `1.5px dashed` gold.dashed, icon circle, color gold.dashed
  - unlogged, CURRENT (D58): transparent, border `1.5px dashed` accent, **icon check 20px**, color accent — the dashed ring is the exclusive mark of "awaiting your hand"; the ghosted check telegraphs tap-to-complete and can never be misread as the filled prayed disc
  - FUTURE (D58): transparent, border `1px solid` border.mid, **icon circle 10px**, color soft — dormant on purpose; structurally distinct (border style, weight, glyph size) so inert is never colour-alone-different from actionable
  - exempt (derived from a recorded period, never picked by hand — D64): soft fill `rgba(255,252,242,.9)`, border `1px solid #cdb98a`, crescent glyph (`bedtime`), color `#8d7b52` — distinct by shape from every other seal state, reads as rest, never as failure or prohibition. On an exempt day a stored prayed/late mark keeps its own skin (amendment 2), inert.
- **Current-seal gesture (D58, D75):** tap = prayed, tap again = undo; no pill on the current row (an open window cannot yet be late or missed), and no long-press since congregation tracking was removed. Past rows keep the morph below; History's DayDetail keeps it for every editable prayer.
- **Morph:** wrap is a 48px→160px pill (`width 160ms cubic-bezier(.4,0,.2,1)`), expanded: bg `rgba(255,252,242,.97)`, border `#c9a75c`, shadow `0 3px 12px -4px rgba(138,100,32,.45)`. Face fades out 100ms while the options fade in 120ms — one cross-fade, no hold (the mockup's 240ms width, 150ms face and 70ms-delayed 180ms options made the choices readable only at ~250ms; owner, 2026-09-13: nobody should wait to watch a seal open before they can act). The tap targets are live from the first frame either way. Options: three 50×44px stacked icon+label buttons (Prayed `#7c5a16` / Late `#b0622f` / Missed `#a5522f`), press scale 0.9. Picking closes and sets; picking current status clears to unlogged.
- Press feedback everywhere, sized to the surface (D74): compact controls (seals, pills, chips, steppers) scale 0.9–0.95, 120ms; full-width rows and cards (settings rows, option cards) do NOT scale — even 0.98 reads as the screen wobbling at that width — they dim to 0.7 opacity instead, same duration and easing.
- **Haptics fire on the press, never on touch-down.** The selection tick rides `onPress` (the committed tap), so a finger that lands on a seal and scrolls away stays silent. One haptic per action: a pick gets the host surface's confirm haptic (Success on Today, Medium impact on repair surfaces) and no tick under it; opening the pill gets the tick alone.

### Buddy avatars (D174)

A buddy appears as a **30pt badge beside the prayer's name**, on the prayers they have marked
today (24 on the first build; the first device pass found it too small to read). Several stack
with a −9 overlap, in roster order. The same badge is 30 under the hero's countdown, 40 in the
Buddies list, and 22 on the large widget and on the one-row Now strip (D182).

- **Initials by default**, taken live from the name you gave them: two words give one letter each
  (Amina Bint → AB), one word gives its first two (Amina → AM), and the letters are read as
  characters so an Arabic or Turkish name has initials too. A picture is a choice, not the default —
  letters already identify a person, which is also why every buddy can default to initials where
  five identical crescents would have been identity by colour alone.
- **Drawn as a badge**: a ring in the paper's own colour and a soft gold shadow, so it reads as
  pressed onto the row rather than printed in it. The ring is what separates overlapping discs and
  what stops a dark colour dissolving into night paper.
- **Beside the name, not on the time line.** It sits where the eye already is, centred rather than
  on the text baseline (a badge on a baseline looks dropped). The row's height is set by the 48pt
  seal opposite, so a 30pt badge cannot grow it — the no-jitter rule still holds.

- **Icon + colour, always both.** Ten icons × eight colours; uniqueness is on the pair, so two
  buddies may share one half but never both. `firstFreeAvatar` walks the two lists **diagonally**,
  so consecutive buddies differ in icon *and* colour — nested loops would have handed the first
  five people five colours of one icon, which is identity by colour alone.
- **The palette is in `theme/tokens.ts`** (`buddyDiscLight` / `buddyDiscNight`), and the icons are
  all glyphs already in the bundled Material Symbols subset, so the feature adds no font weight.
  Each disc is the tone that *just* clears its bars — glyph 4.5:1 on the disc, disc 3:1 on every
  card it can sit on — because a disc darkened for safety loses the hue that identifies it (D56's
  argument, applied to a new family). `tokens.test.ts` caps them from above as well as below.
- **No green and no gold.** Green is reserved for qibla alignment; gold is the app's own accent and
  a buddy must never look like the app talking about itself. `stone` sits on gold's hue at a third
  of its saturation, so it reads as a warm grey.
- **The slot has a fixed height**, occupied or not, so a mark arriving never moves the row — the
  same rule as the three hero modes being layout-identical.
- **Empty means empty.** No "no one yet", no "be first", no count, no placeholder. A prayer with no
  avatars is a prayer nothing arrived for, and it must never read as a comparison or a reproach.
- **Nowhere else** but the large home-screen widget (D177) and the one-row Now strip (D182 —
  Android 4×1, iOS medium), and only for the current prayer there. Not a watch, tile, watch face, Live
  Activity or lock screen.

### Tab bar
- 5→4 items (Today, History, Qibla, Settings), top hairline `rgba(166,124,46,.3)`.
- Active: `#8a6420`, filled icon, 600 label; inactive: `#ab9668`, outlined icon (FILL 0). Icon 21px, label 10.5px Lora.

### Qibla (3a)
- Header row: "Qibla · City" + Recalibrate pill (my_location icon, outlined `#cdb98a` on `rgba(255,252,242,.7)`).
- Calligraphy القِبلة (Amiri 26px) over ◆ hairline; status pill below (outlined → green filled `#3f6f42` when aligned; icons explore/check_circle).
- Dial 288px: ring border color animates gold→green; radial paper-white gradient fill; inner shadow. 36 ticks (major every 3rd: 2×14px `rgba(122,96,44,.55)`; minor 1×8px `.28`), transform-origin 50% 144px. Cardinals N/E/S/W counter-rotated to stay upright, N emphasized (16px/700 `#5a4413`).
- Makkah badge: 38px circle at qibla bearing on the ring edge (transform-origin 50% 142px), fill accent→green, icon mosque→check when aligned, label "Makkah" 10.5px/600 below, counter-rotated.
- Needle: 4×78px rounded, gradient accent→transparent tail, rotates by (heading−qibla) diff; center pin 16px `#5a4413` with paper halo; fixed top triangle marker `#5a4413`.
- Motion: dial/needle/kaaba transform 420ms `cubic-bezier(.3,.7,.3,1)` when idle (in RN: Reanimated spring; while sensor-driven use direct + smoothing, no transition fighting).
- Info cards row: 3× radius-14 cards (label 11px italic `#8d7b52`, value 20px/700). Middle "Qibla bearing" card highlighted: brighter bg + `#c9a75c` border (green-tinted border when aligned).
- Guidance card: icon turn_left/turn_right/task_alt + bold title ("Turn 38° to the left" / "Aligned — you may begin") + italic sub. Aligned: green tint bg `rgba(63,111,66,.12)`, border `.4`, text `#2f5632`.
- Footer hint italic `#a08650`.
- **Never color-only:** aligned = snap + label change + icon change + seal, not just green.

### History (D183)
- A manuscript page read top to bottom: **streak hero** (40pt numeral, best beside a hope-framed hint, a 76pt `ProgressRing` of the 7-day completion rate captioned "this week") → the **calendar card** with a `StatusBar` of the month under the grid (hidden when nothing is logged; exempt days left out) → hairline → **Your record**: 7/30 switch, completion card with its bar, five per-prayer bar rows ("12 of 14"), callouts, all-time, empty card.
- `StatusBar`: 8pt pill track `borderFaint`, fills prayed `accent` → late `late` → missed `missed`, 1pt paper gap between fills, widths animate 320ms. `ProgressRing`: track `borderFaint`, arc `accent`, 420ms. Every bar and ring sits beside its words — never colour alone.
- Calendar day cells: thin ring segments (5 slots) in status colors; today outlined `#c9a75c`; exempt days a soft neutral dot; empty past days dashed like unlogged. Cells are keyed by grid position and memoised; a month change crossfades the grid 160ms (none under reduce motion).

### Settings / Qada (extend the language — no mockups exist)
- Same paper bg, hairline+◆ section dividers, radius-14 cards, Lora/Amiri, italic captions, gold-brown scale.
- Qada screen: descending per-prayer counters as large tabular numerals with thin progress rings; "forgive & archive" as a quiet, warm text action — not a red destructive button.
- Settings rows: grouped cards, 44px+ targets, chevrons `#a08650`.

### Sheets: a tappable row always wears a surface (D143)

Every row a finger can press inside a bottom sheet is a **radius-14 card with a hairline** — the
menu actions of the ⋯ sheet, the excused-days sheets, the day pickers, all of it. Never a
bare line of text with a press handler on it. Owner's rule, 2026-08-30: *"Sure it looks nice being
just text, but without some visual guide it's not accessible when you don't see a visual
button/clickable area."* The card draws the edge the eye aims at and the margin the thumb needs;
without one, a menu is a paragraph that happens to respond.

- **Metrics:** 48pt minimum height, `spacing.lg` horizontal padding, `spacing.sm` between rows —
  the air is part of it, because two targets that touch read as one.
- **Emphasis** (a sheet's primary choice) is never colour alone: the hairline firms up, the word
  takes the accent, and its weight rises. It does NOT borrow the next-prayer row's gold glow;
  that treatment means one thing and stays reserved for it.
- **A chevron means "this leads somewhere else"** — a settings row into a screen, a day-picker row
  into the next step of the sheet. A menu action that does its thing and closes has no chevron:
  the surface already says it is pressable, and a chevron would promise a journey.
- Built one way only, so it cannot drift: `components/SheetKit`'s `SheetRow` (and `SheetAction`,
  which is a `SheetRow` whose content is its label).

## The mark / logo (Claude Design option 6c)

A mosque silhouette — dome arc, finial, two minarets, ground line — drawn as strokes in a 64×64 viewBox.
Cream `#F3E7C8` on gold `#8A6420` for the app icon; gold on paper for light surfaces; cream on night paper in dark.
Wordmark pairing: "Simple Prayer" in Lora 600 with the italic tagline *five a day · never missed*.

**Four optical sizes** (the mark gets heavier and sheds detail as it shrinks, so it survives to 16pt):

| Variant | Used at | Strokes | Details |
|---|---|---|---|
| full | ≥40pt | 3.4 (dome/minarets/ground), 2.6 finial | dome + finial + dot + 2 minarets + 2 minaret dots + ground |
| medium | 28–39pt | 4.2 / 3.2 finial | drops the minaret dots |
| small | 20–27pt | 6 | drops the finial entirely; minarets shortened (`M11 42V30`), ground `M8 47h48` |
| tiny | <20pt | 8 | dome + ground only (`M19 41A13 13 0 0 1 45 41`, `M9 48h46`) |

In-app: `src/components/Logo.tsx` (react-native-svg) picks the variant from `size` automatically.
Raster assets: **generated, never hand-edited** — `scripts/generate-brand-assets.py` (needs
`DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/lib uv run --with cairosvg`) emits every icon/splash/favicon
from the same geometry. Re-run it if the mark changes; keep `Logo.tsx` in sync.

**Icon variants shipped**
- iOS: `assets/appicon.icon` — Apple **Icon Composer** bundle (gold fill + cream `mosque.svg` layer),
  so iOS 26 derives light / dark / tinted / clear itself. PNG fallbacks for the iOS 18 trio also exist
  (`icon-light/-dark/-tinted.png`) if the `.icon` path ever needs replacing.
- Android adaptive: cream foreground + solid gold background + **monochrome** layer for Android 13+
  themed icons. The mark is scaled so its furthest corner sits inside the 66/108 keyline circle
  (safe radius 313px on a 1024px canvas) — it therefore survives *every* OEM mask shape, circle included.
- Splash: paper `#ece1c5` + gold mark (light) / night `#241b10` + cream mark (dark), 128pt wide.
- `favicon.png` and `notification-icon.png` use the heavier **small** optical variant so they stay legible.

## Dark "night paper" theme

Darkened parchment — deep warm browns, softened golds. Guidance (to be refined in M8):
bg ≈ `#221a10`–`#2a2014` with the same noise/rule texture at low alpha; cards `rgba(42,32,18,.7)`;
text `#e8dcc0` / strong `#d4b06a`; accent stays gold family (`#c9a75c`/`#a67c2e` swap roles);
late/missed slightly lifted for contrast; aligned green lifted (`#5d8f60`). Maintain WCAG AA.
Follows system, manual override in Settings.

## Wide windows — tablets, foldables, landscape (D123–D125)

The language above is authored at a 390pt phone. Three things extend it, and nothing else changes:

- **The page has a maximum measure.** From 600pt of window width the content is a 600pt column,
  centred on the paper. The type scale has been *raised* four times for an older audience (D67, D74),
  so a wide window must never become a wide column of the same type — it would read as a wall rather
  than a page. The paper, its texture and its vignette still fill the glass; only the column is bound.
- **The ◆ rule turns vertical.** `VerticalDivider` is the *same* ornament at the same size on the same
  hairline, rotated: two flexing segments with the ◆ between them, so the paper's texture runs through
  the break instead of being covered. A two-pane spread must read as one divided sheet, not two
  screens pushed together. Panes sit in a plain logical row and therefore mirror themselves in Arabic;
  the compass dial inside a pane still never mirrors.
- **Drawings grow; lettering does not shrink below 10pt.** The calendar's rings grow with their column
  (capped at 48, where the frozen day numeral starts to look adrift) and the compass dial rises from
  288 to 380. But every label on the dial scales with it, so a dial small enough to set its cardinals
  under the 10pt floor **sheds them instead** — the same move the mosque mark makes as it shrinks to
  16pt. The 160pt glance dial on the Today dashboard keeps its ticks, needle and badge glyph, and its
  caption says in words what the lettering would have said.

## RTL (Arabic)

Full mirror: rows, seals, chevrons, calendar order, compass labels stay geographic (do NOT mirror the dial).
Amiri becomes the primary UI face for Arabic; check number/digit rendering (Western vs Arabic-Indic — follow locale default, keep tabular alignment).

## Animation principles

Reanimated, UI-thread. Durations 120–420ms, standard easing from design (`cubic-bezier(.4,0,.2,1)` UI, `(.3,.7,.3,1)` dial). Press = scale on compact controls, opacity dim on full-width rows (D74). No bounces except subtle spring on seal set. Countdown ticks once/second without re-rendering the row list (isolate the text node).
