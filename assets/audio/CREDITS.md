# Audio credits

The app ships four adhan recitations, selectable in Settings → Reminders. This file records
where each came from, what was done to it, and how it is credited in the app.

> **Not covered by the MIT licence.** The four recordings below are not part of the open-source
> licence that covers this repository's code. No licence was found for any of them, and the
> rights to them are not confirmed. If you build and publish your own version, replace them with
> recordings you have the rights to use. See also `THIRD_PARTY_NOTICES.md`.

## The four recitations

| Voice | Files | Full length | Notification clip |
|---|---|---|---|
| Makkah | `adhan_makkah.mp3` · `adhan_makkah_clip.caf` | 3:22 | 28.0 s |
| Nasser Alqatami | `adhan_alqatami.mp3` · `adhan_alqatami_clip.caf` | 2:19 | 27.0 s |
| Mufti Ismail Musa Menk | `adhan_menk.mp3` · `adhan_menk_clip.caf` | 2:33 | 28.0 s |
| Sabah Fakhri | `adhan_fakhry.mp3` · `adhan_fakhry_clip.caf` | 2:36 | 28.0 s |

### Provenance

**Owner decision, 2026-08-20.** The owner sourced these four recordings from sites offering
them as royalty-free downloads, and chose them over a set of licence-verified alternatives
(Wikimedia Commons: a CC-BY Makkah recitation, a CC0 Istanbul one, a CC-BY Konya one, and the
CC0 recording previously shipped) on the grounds that none of the alternatives sounded right.

Recorded plainly, because this file exists to keep provenance auditable rather than to make a
case: **no licence document was located for any of the four**, and no per-file licence could be
verified the way the previously shipped recording's CC0 dedication was (that verification is
kept below). Each is a recording of a named, living or recently-living reciter. Naming a
reciter is attribution, not a licence, and the app being free rather than paid narrows exposure
without changing the rights position or either store's requirement that a developer hold rights
to what they ship.

The owner's position, recorded verbatim: *"We will mention their names anyway to attribute
their work. If we get a complaint then we'll act accordingly. In all cases this app is free and
not commercial."*

Practical consequence for whoever reads this next: if a complaint arrives, the fix is small and
already scoped — the selector is data-driven, so a voice can be dropped or swapped for one of
the verified alternatives above without touching any logic.

### Attribution string for the About screen

Each voice is named at the point of choice in Settings, and the About screen carries:

> Adhan recitations by Nasser Alqatami, Mufti Ismail Musa Menk and Sabah Fakhri, and a
> recitation from Makkah. Trimmed and level-matched for use as a notification sound.

### Why two files per voice

The two formats are not a preference, they are two different playback paths:

- **`.caf` — iOS notification sound.** Apple requires notification audio in Linear PCM, MA4
  (IMA/ADPCM), µLaw or aLaw, packaged as `.aiff`, `.wav` or `.caf`, and **under 30 seconds**;
  a longer file makes iOS silently substitute the default sound. IMA4 is the codec in Apple's
  own documented example (`afconvert … -d ima4 -f caff`), and it cuts each clip from ~2.3 MB
  to ~0.6 MB.
- **`.mp3` — Android notification sound, and in-app playback on both platforms.** Android has
  no 30-second rule, so Android plays the whole recitation as the channel sound. 96 kbps mono
  is transparent for voice at notification volume.

So an iPhone user hears the opening of the adhan and a fade; an Android user hears all of it.
That asymmetry is stated in the app rather than hidden — see `settings.reminders.*` in the
locale files.

### Processing applied

Every file is a derivative. Uniformly, for all four:

1. **Downmixed to mono** and resampled to 44.1 kHz.
2. **Loudness-normalised** to **−14 LUFS** integrated, true peak −1.5 dBFS (EBU R128
   two-pass `loudnorm`). This is what makes switching voices in Settings not change how loud
   the phone is, and keeps all four dignified at low volume in a quiet room.
3. **Clip cut from the opening**, with a 0.05 s fade in and a 1.4 s fade out ending in true
   digital silence, so there is no click at either edge and the clip ends on a fade rather
   than a cut.

Per-file trims, as directed by the owner after listening:

| Voice | Trim | Clip |
|---|---|---|
| Makkah | starts at 0.33 s (where the voice begins) | 0:00–0:28 of the trimmed file |
| Nasser Alqatami | none | 0:00–**0:27** — ends on the phrase, not mid-word |
| Mufti Ismail Musa Menk | **first 9 s removed** (leading room tone) | 0:00–0:28 of the trimmed file |
| Sabah Fakhri | **first 2 s removed** | 0:00–0:28 of the trimmed file |

Reproducing any one of them, using Menk as the example:

```sh
# full: trim, mono, normalise
ffmpeg -y -ss 9.0 -i adhan-mufti-ismail-musa-menk.mp3 \
  -af "pan=mono|c0=c0,aresample=44100,loudnorm=I=-14:TP=-1.5:LRA=11" \
  -c:a libmp3lame -b:a 96k -ar 44100 -ac 1 adhan_menk.mp3

# clip: cut from the trimmed full, faded
ffmpeg -y -t 28.0 -i adhan_menk.mp3 \
  -af "afade=t=in:st=0:d=0.05,afade=t=out:st=26.6:d=1.4" \
  -c:a pcm_s16le -ar 44100 -ac 1 /tmp/adhan_menk.wav
afconvert -f caff -d ima4 /tmp/adhan_menk.wav adhan_menk_clip.caf
```

Verify a `.caf` with `afinfo`, not `ffprobe` — ffmpeg cannot read IMA4 CAF and reports a valid
file as invalid.

### Filenames

Android turns each bundled sound into a resource name, which must be lowercase alphanumeric
with underscores. Hence `adhan_makkah`, never `adhan-makkah`. Renaming one of these with a
hyphen will fail the Android build.

---

## The free set: the FOSS build's recitations

The FOSS Android build (`FOSS_BUILD=1`, `docs/BUILD_YOURSELF.md`) is meant for F-Droid, which
accepts only media under a free licence. It ships **none** of the four recordings above
(`scripts/foss-prepare.ts` deletes them from the build checkout) and offers these three instead,
from `assets/audio/free/`. All three come from Wikimedia Commons. The normal build does not ship
them.

| Voice (id) | File | Length | Licence | Author |
|---|---|---|---|---|
| Makkah (`makkah`) | `adhan_free_makkah.mp3` | 3:10 | CC BY 3.0 | Seyfula Islam |
| Istanbul (`istanbul`) | `adhan_free_istanbul.mp3` | 0:50 | CC0 1.0 | Viceskeeni2 |
| Beautiful adhan (`beautiful`) | `adhan_free_beautiful.mp3` | 2:34 | CC0 1.0 | Adam-synagda |

Each licence was checked on 2026-11-09 the same way as the CC0 recording below: the Commons
wikitext, and the Commons API (`prop=imageinfo&iiprop=extmetadata`), whose answers are quoted.

**Makkah.** <https://commons.wikimedia.org/wiki/File:Adhan,_Great_Mosque_of_Mecca_-_Jan_21,_2013.webm>
- "Adhan, Great Mosque of Mecca - Jan 21, 2013", a video (VP8/Vorbis, 3:17), recorded 2013-01-21.
- Source: YouTube video `KYi-PuOqVnA`, “"AZAAN" in makkah”, channel Seyfula Islam.
- Wikitext: `{{YouTube CC-BY|Seyfula Islam}}` and `{{LicenseReview|…|user=MZaplotnik|date=2018-07-19}}`:
  a Commons reviewer confirmed the YouTube licence.
- API: `License: cc-by-3.0`, `UsageTerms: "Creative Commons Attribution 3.0"`,
  `AttributionRequired: true`, `Artist: Seyfula Islam`.

**Istanbul.** <https://commons.wikimedia.org/wiki/File:Adhan_in_Istanbul.webm>
- "Adhan in Istanbul", a video (VP9/Opus, 0:50), recorded 2025-09-05. Part of an adhan heard in the
  street, not the whole call.
- Wikitext: `{{own}}`, `{{self|cc-zero}}`.
- API: `License: cc0`, `UsageTerms: "Creative Commons Zero, Public Domain Dedication"`,
  `AttributionRequired: false`, `Artist: Viceskeeni2`.

**Beautiful adhan.** The CC0 recording recorded in detail in the next section, now used whole
(2:34) rather than as the 27.75 s clip that once shipped.

**Not used: Konya.** <https://commons.wikimedia.org/wiki/File:Hminsec150_Konya.webm> (CC BY 3.0,
Frans van der Vaart, from YouTube `qIsD6OOOyEQ`) was processed and then dropped on 2026-11-09: its
Commons licence review is still open (`{{LicenseReview}}` with no reviewer), and it is only 58 s
of an adhan.

### What CC BY requires, and where we do it

CC BY 3.0 asks for the author, the title or a link, the licence, and a note that the work was
changed. The FOSS build's About screen names the author and licence
(`settings.about.audio.attributionFree`), and says the recordings were trimmed and level-matched. This file and
`THIRD_PARTY_NOTICES.md` carry the links. CC0 asks for nothing; the two CC0 authors are named
anyway.

### Attribution string for the FOSS build's About screen

> Adhan recordings from Wikimedia Commons: Makkah by Seyfula Islam, under CC BY 3.0; Istanbul by
> Viceskeeni2 and “Beautiful adhan” by Adam-synagda, both public domain (CC0). Trimmed and
> level-matched for use as a notification sound.

### Processing

The same chain as the four above, with the loudness pass done in two passes (measure, then apply
linearly), and the video tracks dropped:

1. Downmixed to mono (both channels averaged) and resampled to 44.1 kHz.
2. Loudness-normalised to −14 LUFS integrated, true peak −1.5 dBFS (the results measure −14.4 to
   −14.7 LUFS).
3. A 0.05 s fade in and a 1.4 s fade out, so neither edge clicks. The Makkah video ends right
   after the last phrase, so the fade out matters.
4. mp3, 96 kbps, mono. No `.caf` clip: the FOSS build is Android only, and Android plays the
   whole file.

| Voice | Trim |
|---|---|
| Makkah | starts at 7.3 s, where the voice begins (crowd sound before it); runs to the end |
| Istanbul | none |
| Beautiful adhan | none |

Source files, as downloaded from `upload.wikimedia.org` on 2026-11-09 (SHA-256):

```
f4acc1bcc6e7919fce60b21162a3c794952c562a6df7b6aa7971f80d191eb5f0  Adhan,_Great_Mosque_of_Mecca_-_Jan_21,_2013.webm
ba0d10961d2ea2ebcb5f255383ae7dc60d980e8cfe9dab425b1ac7c85eb3e99a  Adhan_in_Istanbul.webm
35fe06b08fe80505c550c33fed8a783fa9901ddc81ac884958b4be048f5b2a79  Beautiful_adhan.ogg
```

Reproducing one, using Makkah as the example:

```sh
# pass 1: measure
ffmpeg -ss 7.3 -i "Adhan,_Great_Mosque_of_Mecca_-_Jan_21,_2013.webm" -vn \
  -af "pan=mono|c0=0.5*c0+0.5*c1,aresample=44100,loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json" \
  -f null -
# pass 2: put the measured_* values from pass 1 in, then fade (the result is 189.78 s long)
ffmpeg -ss 7.3 -i "Adhan,_Great_Mosque_of_Mecca_-_Jan_21,_2013.webm" -vn \
  -af "pan=mono|c0=0.5*c0+0.5*c1,aresample=44100,loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=…:measured_TP=…:measured_LRA=…:measured_thresh=…:offset=…:linear=true,afade=t=in:st=0:d=0.05,afade=t=out:st=188.378:d=1.4" \
  -c:a libmp3lame -b:a 96k -ar 44100 -ac 1 adhan_free_makkah.mp3
```

---

## Removed: `adhan.wav` (“Beautiful adhan”, CC0)

Shipped until 2026-08-20, then removed at the owner's request — not for any licence problem,
but because the 27.75 s clip was only the opening takbirs rather than a full adhan. Since
2026-11-09 the whole recording is back in the FOSS build only, as `free/adhan_free_beautiful.mp3`
(see "The free set" above).

Worth knowing if it is ever wanted back: **the recording itself was not short.** The source is
a complete 2:34 adhan; the 27.75 s was our own trim, made when a notification sound was the
only playback path the app had. With the current two-path design it would play in full on
Android like any other voice.

| Field | Value |
|---|---|
| Title | **Beautiful adhan** (`Beautiful adhan.ogg`) |
| Source page | <https://commons.wikimedia.org/wiki/File:Beautiful_adhan.ogg> |
| Author / uploader | **Adam-synagda** (Wikimedia Commons), declared "Own work" |
| Original | Ogg Vorbis, 2 min 34 s, 44.1 kHz, ~64 kbps |
| Licence | **CC0 1.0 Universal — Public Domain Dedication** |

The dedication was verified two ways rather than read off the rendered page: the Commons
wikitext carries `{{self|Cc-zero}}`, and the Commons API (`prop=imageinfo&iiprop=extmetadata`)
returns `License: cc0`, `UsageTerms: "Creative Commons Zero, Public Domain Dedication"` and
**`AttributionRequired: false`**. Under CC0 the author waives copyright worldwide, so the
recording may be used for any purpose including commercial redistribution inside a closed-source
app, with no attribution and no share-alike obligation.

This is the standard the four current recordings could not be held to, and it is kept here so a
future reader can see the difference at a glance.
