# Third-party notices

Simple Prayer's own code is under the MIT licence (`LICENSE`). This file lists the work of other
people that this repository contains, changes, or ships inside the app, and the terms each one
comes under. The full licence texts are in `licenses/`.

Libraries installed from npm and not changed by us are not listed here. Each one carries its own
licence in its package.

## Prayer times: adhan-js

- **What:** the prayer-time engine, from npm (`adhan`).
- **Source:** https://github.com/batoulapps/adhan-js
- **Licence:** MIT, Copyright (c) 2016 Batoul Apps. Full text: `licenses/MIT-adhan.txt`.
- **Our changes:** `patches/adhan@4.4.6.patch` replaces the built files of adhan 4.4.6 with a
  build of a newer upstream commit (D187, D201). The patch is under the same MIT licence.

## Fonts

| Font | Made by | Licence | Full text |
|---|---|---|---|
| Lora | The Lora Project Authors (Cyreal) | SIL Open Font License 1.1, with Reserved Font Name "Lora" | `licenses/OFL-1.1.txt` |
| Amiri | The Amiri Project Authors (Khaled Hosny) | SIL Open Font License 1.1 | `licenses/OFL-1.1.txt` |
| Noto Naskh Arabic | The Noto Project Authors | SIL Open Font License 1.1 | `licenses/OFL-1.1.txt` |
| Noto Nastaliq Urdu | The Noto Project Authors | SIL Open Font License 1.1 | `licenses/OFL-1.1.txt` |
| Material Symbols | Google | Apache License 2.0 | `licenses/Apache-2.0.txt` |

Lora, Amiri, Noto Naskh Arabic and Noto Nastaliq Urdu come from the `@expo-google-fonts` packages. Material Symbols
comes from `@expo-google-fonts/material-symbols` and from the two Material Symbols Rounded files
in `assets/fonts/`. The fonts are not changed. Because the name "Lora" is reserved, a changed
version of that font could not be called "Lora".

- Lora: Copyright 2011 The Lora Project Authors (https://github.com/cyrealtype/Lora-Cyrillic),
  with Reserved Font Name "Lora".
- Amiri: Copyright 2010-2022 The Amiri Project Authors (https://github.com/aliftype/amiri).
- Noto Naskh Arabic: Copyright 2022 The Noto Project Authors (https://github.com/notofonts/arabic).
- Noto Nastaliq Urdu: Copyright 2022 The Noto Project Authors (https://github.com/notofonts/nastaliq).

## Hijri calendar: the Umm al-Qura month table

- **What:** the table of Umm al-Qura month lengths in `src/domain/hijri.ts`
  (`UMM_AL_QURA_MONTH_LENGTHS`, AH 1300–1600). It was taken from ICU (International Components
  for Unicode).
- **Licence:** Unicode License v3, Copyright © 1991-2023 Unicode, Inc. Full text:
  `licenses/Unicode-3.0.txt`.

## City list: GeoNames

- **What:** `website/data/cities.tsv`, the cities the website offers when you choose a location
  by hand. Built from GeoNames `cities15000` and `alternateNamesV2`.
- **Source:** https://www.geonames.org/
- **Licence:** Creative Commons Attribution 4.0 (CC BY 4.0),
  https://creativecommons.org/licenses/by/4.0/. The website credits GeoNames on its support
  page.

## Patched libraries

We change two libraries with `bun patch`. The patch files show exactly what we changed.

| Library | Licence | Patch |
|---|---|---|
| drizzle-orm 0.45.4 | Apache License 2.0 (`licenses/Apache-2.0.txt`) | `patches/drizzle-orm@0.45.4.patch` |
| expo-notifications 58.1.7 | MIT, Copyright (c) 2015-present 650 Industries, Inc. (aka Expo) | `patches/expo-notifications@58.1.7.patch` |

Each patch is under the licence of the library it changes.

## Agent skills: Argent

- **What:** the skills in `.agents/skills/` (`argent-*`), used by coding agents to run the app on
  simulators and devices. They are tools for working on the code, not part of the app.
- **Source:** https://github.com/software-mansion/argent (version v0.31.0, see
  `skills-lock.json`).
- **Licence:** Apache License 2.0, Software Mansion S.A. Full text: `licenses/Apache-2.0.txt`.

## Adhan recordings: not covered

The four adhan recordings in `assets/audio/` (Makkah, Nasser Alqatami, Mufti Ismail Musa Menk,
Sabah Fakhri) are **not covered by the MIT licence**.

- No licence was found for any of them.
- The rights to them are not confirmed.
- The reciters are named in the app as attribution. Naming them is not a licence.

**If you build and publish your own version, replace these recordings** with ones you have the
rights to use. The voice list is data, so a recording can be swapped without changing any logic.
See `assets/audio/CREDITS.md` for where each one came from.
