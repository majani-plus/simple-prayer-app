# Tone: how Simple Prayer writes

This guide covers everything with words in it: the app, the website, the store listings, the store
screenshots, the notifications and the release notes. They all use one voice.

If you write copy for Simple Prayer, in any language, please read this first.

---

## The one-line test

> **Would a ten-year-old, or someone reading English as their third language, understand this the
> first time they read it? And does it sound like a person, not an advert?**

Both halves matter. Plain but cold fails. Warm but full of slogans also fails.

---

## Who is reading

Most people who use this app do not read English as their first language. The app is for Muslims
everywhere, and English is only the language the website opens in. That one fact decides most of
the rules below. To a learner, an idiom is not a nice touch. It is a wall.

Readers are also often older, or tired, or opening the app in the two minutes before a prayer.
Copy is read once, in a hurry.

---

## Why the app sounds the way it does

The app is a tool to encourage prayer. It is not a record of everything a person has done. Opening
it, tapping "prayed" and feeling good should be simple enough for a child or a grandparent. Some
people only want prayer times and the qibla, and the app must never make them feel they are using
it wrong.

So the words in it never shame, never nag and never ask anyone to explain themselves.

---

## Rules

**Say the concrete thing.** If a phrase means something specific, write that instead.

- Instead of "The streak bends before it breaks", write "Missing one prayer does not always end
  your streak."
- Instead of "Your month at a glance", write "See how the month has gone."

**No idioms, no metaphors, no figures of speech.** They do not survive a second language, and many
do not survive a first. Examples of the kind of phrase to avoid: *at a glance, report card, the
usual culprit, task killers.*

**No catchphrases and no marketing voice.** No "Everything you need", no "Simply beautiful", no
short fragments used as slogans. If it would look at home on a billboard, it is wrong here.

**No superlatives and no comparisons.** Never "the best", "the most accurate" or "the only". Never
name another app.

**Short sentences.** Past about twenty words, split it. Two plain sentences are better than one
clever one.

**No dash asides.** Do not break a sentence in the middle with a long dash to add a thought. Write
a second sentence instead.

**A list of three only when there are three real things.** A list of three sounds smooth, which is
why machine-written text uses it so often. Use it when the thing really has three parts.

**Ordinary words.** Use the word someone would say out loud: *use*, not *utilise*; *change*, not
*modify*; *works without internet*, not *fully functional offline*.

**No jargon the reader never agreed to.** Not *window*, *nudge*, *unlogged*, *backlog*,
*override*, *suppressed*, *sync*. These are our words for our machinery, not theirs.

**Warm, never childish.** "Your prayer log is kept on your phone" is plain, warm and true at once.
That is the voice. Do not write down to anyone.

**Honest, in both directions.** Never make a claim bigger than it is, and never quietly make one
smaller either. If a rewrite changes what a sentence promises, the rewrite is wrong. Check every
change against what the code actually does.

**Never shame, never interrogate.** No copy asks the user to account for themselves. A missed
prayer is never written as a failure.

**States are never shown by colour alone.** Prayed, late, missed and excused each have an icon and
a word as well as a colour. Copy that says "the green ones" or "tap the red one" breaks this.

---

## Per language

Arabic and Turkish are **written, not translated**. A locale file is not a copy of the English one.
A sentence that reads well in English is not automatically the sentence to write in another
language.

Each language has its own habits to avoid:

- **Arabic**: an ornate literary register, saj' (rhyming or balanced phrases for effect), chains of
  three or more nouns in a row, and the inflated voice of app-store Arabic (*تجربة فريدة*, *بكل
  سهولة ويسر*). Write clear modern standard Arabic, in the voice of a good explainer, not of an
  essay. An ornate Arabic page is the same wall for a non-fluent Arabic reader that an English
  idiom is.
- **Turkish**: long chains of participles that hide the verb, stacked noun phrases, and the
  breathless voice of Turkish app listings (*hayatınızı kolaylaştıran…*). Split the long ones.

**Religious and prayer words stay exactly as people say them**, in every language: namaz, kaza,
kıble, ezan, imsak, Diyanet, صلاة، قضاء، قبلة، أذان، الشروق، الحيض والنفاس, and the prayer names.
Never simplify these. They are the words people actually use, and getting them right is part of
being trusted.

Turkish is usually the longest of the three, and Arabic text is drawn 15% larger. Both break a
layout before English does, so check them, not just the English.

---

## Things you must never write

- **Never** "donate", "donation", "charity", "sadaqah", "zakat", "bağış" or "تبرع", anywhere in the
  app or the store listings. The app has optional tips that unlock nothing. Apple rejects apps that
  call these donations, so always say "tip" or "support".
- **No price or promotion words in a store title, icon or developer name.** Google Play does not
  allow it. "Free" is fine in a description or a screenshot. Even there, prefer a statement that
  cannot be argued with: "Every feature is free", not "Free forever".
- **No ALL CAPS and no emoji** in store listings or in the app.
- **No user-facing text written straight into the code.** Every string goes through the
  translation files.

---

## Worked examples

| Instead of | Write |
|---|---|
| A streak that forgives | If you miss a day |
| Your month at a glance | See how the month has gone |
| Two taps to log a prayer | Today's five prayers. Tap one to mark it. |
| Times you can trust | How the times are calculated |
| Reminders that behave | Reminders |
| Battery optimisation is the usual culprit | Battery settings are usually the cause |
| That's the whole business model | That is the only money in it |
| Free forever | Every feature is free |
| It won't nag you about it | The app will not keep asking |

---

## Before you ship a line

1. Read it out loud. Does a person talk like that?
2. Which word would a learner look up? Replace it.
3. Which sentence would they read twice? Split it.
4. Does it still promise exactly what the code does?
5. Were the other two languages written by a fluent speaker, or copied from the English?
