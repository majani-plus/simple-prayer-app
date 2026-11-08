# Store screens — the plan

What goes on the App Store and Play listings, in what order, and why. The captured phone
frames live under `docs/screenshots/<locale>/light/6.5/`, and the watch capture under
`docs/screenshots/<locale>/watch/`; the composed store screens (caption + device) are built
from them by `scripts/build-store-screens.py` into `docs/store-screens/<locale>/`.

---

## The value proposition, re-evaluated

Before deciding what to show, what is actually worth saying. Ranked by what makes someone
switch, using our market research rather than instinct:

1. **Free, with no ads — ever.** This is the category's number-one switching driver, and it is
   not a normal UX complaint: 55–75% of critical reviews at the big prayer apps are ad-driven,
   and users describe gambling and nudity ads appearing during dhikr as a religious offence,
   not an annoyance. The slot for a beautiful, genuinely free tracker is vacant because Pillars
   broke its "free forever" promise and paywalled widgets and pre-prayer reminders.
2. **It is calm and beautiful.** The reason to pick this over the other free ones. This does not
   need saying in words — every screenshot says it — but it is why the frames must be real, and
   why the caption must never fight the image for attention.
3. **Prayer times you can trust.** Table stakes, but credibility is the whole game in Turkey and
   the Gulf: the authority is named on screen ("Auto (Diyanet)"), and every prayer can be nudged
   by minutes to match a local mosque's calendar.
4. **Tracking that encourages rather than audits.** One tap. Never a backlog to reconcile, never
   a day you forgot turned into a day you missed.
5. **Then:** the qibla, reminders that actually arrive, qada that counts down, excused days.

What we are NOT going to claim: that it is the most accurate, the most complete, or the most
anything. The tone rule from the website applies here — warm and plain, no catchphrases, and
readable by someone whose English is their second or third language.

---

## What changed from the first plan, and why

The original six slots opened with **two Today screens** — the hero, then the seal expanded.
At full size they are different; at the thumbnail size a store actually shows in search
results they are the same picture twice, and the first two slots are the two that nearly
everybody sees. That was a wasted slot.

They are now **merged into one frame**: Today with the seal open shows the times, the
countdown, the streak and the signature gesture in a single image. The freed slot goes to
**Reminders**, which earns it — unreliable notifications are the category's number-two
complaint, and the adhan selector is a real answer to it.

The old slot 6 was "Settings, scrolled to the pledge". It never worked: the route lands at the
top of Settings, so every capture showed Location and Calculation under a caption promising
"No ads. No account. Free forever." Scrolling needs a touch the capture environment cannot
deliver, and reordering the screen to float the pledge to the top would be staging a layout
that does not exist. So the pledge becomes **a designed card rather than a fake screenshot** —
honest, because it is presented as a statement and not as a picture of the app.

The second revision grew the set to eight; the third (owner review, 2026-08-28) settled it at
**seven**. **The watch** earns slot 2: it is the strongest proof of "least friction wins" —
marking a prayer without even taking the phone out — and no competitor in the free tier has
one. **Travel** lost its slot the same day it was reviewed: the frame was a Today screen with
one banner — "barely anything to see" — and a slide that needs explaining is not carrying its
weight; travel mode still lives in the descriptions. The reminders slide gained a REAL
notification banner in frame (a `simctl push` of the app's own copy — a real notification, not
a composite; `scripts/reshoot-reminders.sh`), and its pill was rewritten to what both platforms
can honestly show. The qibla pill carries the hold-detection differentiator.

---

## The seven screens

Order matters more than count. The App Store shows the first three in search results and Play
shows roughly the first three or four, so the pitch is front-loaded: what it is, what it feels
like to use, and that it is free — before anything niche.

Each screen is a caption and, under the ornament, one short supporting fact in a pill.

| # | Frame | Caption (en) | Pill (en) |
|---|---|---|---|
| 1 | Today, Fajr's seal open on Prayed · Late · Missed | **Today's five prayers. Tap one to mark it.** | Works without internet |
| 2 | The watch's Today screen, in a drawn watch case | **Your prayers, on your wrist.** | You can mark a prayer from the watch, without your phone |
| 3 | History — month calendar, streak, completion | **See how the month has gone** | You can change any day later |
| 4 | Qibla — dial, Makkah on the ring, turn guidance | **Know which way to face** | It even senses how you hold the phone |
| 5 | Reminders, a REAL adhan notification banner in frame | **A reminder for each prayer** | You can mark the prayer right from the notification |
| 6 | Qada — per-prayer counters, pace, clear date | **Make up what you missed, one at a time** | The number only goes down |
| 7 | Designed card (no device frame) | **No ads. No account. Every feature is free.** | — |

Slot 2 consumes the watch capture (`docs/screenshots/<locale>/watch/today.png`, the watch's
real 416 × 496 display); the build skips it with a warning — never a failure — while the
capture has not landed. Slot 5's banner is pushed by `scripts/reshoot-reminders.sh` (the app's
own notification copy, permission pre-granted with applesimutils).

**Per-store variants.** `02-watch-play.png` is the same slide with the WEAR capture in a round
drawn case — upload it in place of `02-watch.png` on Play, so each store shows the watch its
users wear. The **tablet set** (`<locale>/ipad/01…05`, 2064 × 2752) reuses the phone captions
at tablet scale; its qibla pill says "tablet", never "phone", and the same files serve ASC's
13" slot and Play's 7"/10" slots.

The reminders pill's claim is true on BOTH platforms, differently shaped: Android shows the
"I prayed" button on the notification itself; iOS reveals it on a long-press (the category is
registered on both — D92/D105). The wording claims the act, not the button's placement.

### Localized captions

Authored in each language, not translated, and using the words the app itself uses — `kaza
namazları`, `قضاء الفوائت`, `ezan`, `أذان` — so the listing and the product never disagree.

| # | Türkçe | العربية |
|---|---|---|
| 1 | Bugünün beş vakti. İşaretlemek için birine dokun. | صلوات اليوم الخمس. نقرة واحدة تسجّلها. |
| 2 | Namazın, bileğinde. | صلاتك على معصمك. |
| 3 | Ay nasıl geçti, gör | كيف مضى الشهر |
| 4 | Ne tarafa döneceğini bil | إلى أين تتّجه |
| 5 | Her vakit için bir hatırlatma | تذكير لكل صلاة |
| 6 | Kaçırdıklarını teker teker tamamla | قضاء ما فات، واحدة تلو الأخرى |
| 7 | Reklam yok. Hesap yok. Bütün özellikler ücretsiz. | بلا إعلانات. بلا حساب. كل الميزات مجانية. |

And the pills:

| # | Türkçe | العربية |
|---|---|---|
| 1 | İnternetsiz çalışır | يعمل بلا إنترنت |
| 2 | Namazı saatten, telefon yanında olmadan da işaretleyebilirsin | يمكنك تسجيل الصلاة من الساعة، من دون هاتفك |
| 3 | Her günü sonradan değiştirebilirsin | يمكنك تعديل أي يوم لاحقًا |
| 4 | Telefonu nasıl tuttuğunu bile fark eder | حتى إنه يلاحظ كيف تمسك هاتفك |
| 5 | Namazı bildirimin üzerinden de işaretleyebilirsin | يمكنك تسجيل الصلاة من الإشعار نفسه |
| 6 | Sayı yalnızca azalır | الرقم ينقص فقط |
| 7 | — | — |

---

## How the screens are composed

One template, so the seven read as a set rather than seven posters.

- **Canvas** 1242 × 2688 — Apple's 6.5" slot, and accepted by Play as a phone screenshot, so a
  single set serves both stores.
- **Ground** the app's own paper (`#ece1c5`) with its noise, so the frame and the screen inside
  it are the same material. Nothing else in the app's palette is invented here.
- **Caption** Lora, ink `#3b3226`, centred at the top, at most two lines. Sized to stay legible
  at the thumbnail a store actually renders in search results, which is roughly a sixth of the
  canvas width.
- **The brand's diamond ornament** under the caption, in accent gold — the same mark the app
  draws between its own sections.
- **Device frame** the real capture, rounded to the device's corner radius, on a soft shadow,
  inset from the canvas edges so the paper reads as a mount rather than a border.
- **The watch (screen 2)** is the one drawn case in the set: the capture is the watch's real
  display, but the watch's body cannot be captured, so the script draws it — a dark rounded
  case in the ink family, a crown and side button, and the same gold hairline the phone frame
  carries. The display runs at about 1.85× its real size; larger than life on purpose, the way
  a watch is shown held up to the camera, and the dark screen survives the enlargement.
- **Arabic** the whole composition mirrors: the caption sets right-to-left in Amiri, and the
  ornament and device keep their optical centre.
- **Screen 8** drops the device entirely: caption, ornament, and the four promises set as a
  short list, on the same paper.

## What is real, and what is arranged

Every device frame is a real capture of the real app, seeded by
`scripts/seed-screenshot-data.py` with one internally consistent story — the streak, the
calendar, the percentages, the qada count and its projected clear date all agree because the
app computed each of them from the same log.

Two states are *arranged* rather than waited for, and both are states the app genuinely
produces: the seal is pinned open (a user taps to get there), and the qibla is given a heading
so the dial reads as aligned (a user turns the phone to get there). The capture environment
cannot deliver a touch to a simulator or rotate a device that has no compass. Nothing is
composited, retouched, or drawn: the pixels inside every device frame are pixels the app drew.
