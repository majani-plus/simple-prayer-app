# Privacy Policy — Simple Prayer

> **This file is the publishable text.** It is what `https://simpleprayer.app/privacy` must
> serve (see `docs/WEBSITE.md`) and what the privacy-policy URL in App Store Connect and Play
> Console must point at. Everything below is derived from the code, not from a template — the
> claims map onto `src/services/location.ts`, `src/services/purchases.ts`,
> `src/services/notifications.ts`, `src/services/export.ts`, `src/services/telemetry.ts`,
> `src/db/`, `src/stores/` and `app.json`'s `updates` block, and
> `src/__tests__/privacyClaims.test.ts` fails the build if the in-app copy drifts from them.
>
> **Before publishing, the owner must:** (1) confirm the effective date, (2) make
> `privacy@simpleprayer.app` actually deliver mail, (3) delete the bracketed tip-jar note
> below according to whether a RevenueCat key ships in the release, (4) delete "Checking for an app
> update" if `expo.updates.enabled` is ever turned back off, (5) delete "If the app crashes" if the
> Sentry DSN is ever removed — and never the other way around: while the DSN is configured, the
> guard test fails any build whose pledge or policy stops mentioning crash reports. Nothing else
> needs editing.

---

**Effective 15 September 2026.**

Simple Prayer does not collect anything about who you are or how you worship. There is no account,
no analytics, no advertising and no tracking. Your prayer log lives on your phone.

There is one exception, and you have to go and turn it on: if you add a **prayer buddy**, the
prayers you mark are sent to their phone. Nothing else about you goes with them — no name, no
location, nothing that says who you are — and if you never add a buddy, nothing you record leaves
your phone at all.

This page explains all of it, including the five cases where something does leave your phone —
because all five are real, and none of them identifies you.

## The short version

- **We collect nothing about you.** No name, no email, no advertising identifier, no usage
  analytics. The only thing we receive at all is anonymous crash reporting — whether the app
  crashed or ran cleanly — described below, and you can switch it off in Settings.
- **Everything you record stays on your phone** — prayer logs, history, qada counts, exempt days,
  settings. The one exception is buddy mode, which is off unless you turn it on: it sends the
  prayers you mark to a person you chose, and nothing else.
- **There is almost nothing of yours to delete from our side.** Without buddy mode we never
  receive anything you record at all. With it, the relay holds a pairing and at most a day of
  marks — and turning buddy mode off deletes both. Uninstalling the app removes everything on the
  phone.
- **Five things leave your phone toward the internet**, all described below: a city lookup that
  goes to your phone's own map service, an update check that carries no personal data, anonymous
  crash reporting (with an off switch in Settings), — only if you choose to leave a tip — a
  purchase through the App Store or Google Play, and — only if you add a buddy — the prayers you
  mark, carried to their phone.
- **If you use a watch, your phone copies your times and your marks to your own watch** — phone
  to watch, over the connection the two devices already have. It does not travel through us or
  through the internet. "Your watch and your other screens" below explains exactly what is
  copied.

## What is stored on your phone

All of the following is written to storage that belongs to the app on your device, and is never
uploaded anywhere:

- **Prayer logs** — for each prayer: prayed, prayed late, or missed; when you logged it; when a
  missed prayer was made up.
- **Exempt periods** — the start and end days you mark when exemption mode is on. These are
  health-related, and they are treated exactly like everything else here: written to your device,
  read only by the app on your device, never transmitted.
- **Qada counters and their history** — the per-prayer debt, and the record of increases,
  make-ups and "start fresh" resets that lets the app undo one.
- **Your settings** — calculation method, madhab, offsets, reminder configuration, theme,
  language, and your chosen location (its coordinates and city label, whether it came from the
  device or from a city you typed).
- **A count of the tips you have given**, if you ever give one. A number, nothing else.

Technically this is a SQLite database and two small key-value stores inside the app's own private
storage. Other apps cannot read them.

If you use your phone's own backup service (iCloud Backup, Google One backup), this data may be
included in **your** backup, under your own account and your own control. That backup is between
you and Apple or Google; we have no access to it and no way to ask for it.

## What leaves your phone, and to whom

### 1. Naming your city

Prayer times and the Qibla direction need to know roughly where you are. Two paths, and you choose
which:

- **"Use my location"** — the app asks for *approximate* location only, and only when you tap that
  button. It never asks for precise location, never asks for background or "Always" location, and
  never prompts on its own at launch. The position it receives is coarse, on the order of a few
  kilometres.
- **Typing a city** — you type a place name and pick from the results.

In both cases the app hands the coordinates or the typed name to **your phone's own map service**
— Apple's on iOS, Google's on Android — to turn it into a city name. That lookup is a network
service run by Apple or Google, so **this is the one moment your approximate position goes off
your device**. It goes to your phone's platform provider, under their privacy policy, and never
to us. We do not receive it, then or ever — the app has no server that your location is sent to,
and the city name that comes back stays on your phone.

We are explicit about this rather than claiming your location "never leaves your device", which
would not be true. What is true is that it never reaches us.

- Apple's privacy policy: https://www.apple.com/legal/privacy/
- Google's privacy policy: https://policies.google.com/privacy

You can skip this entirely: deny the location permission and choose a city by hand. The app works
completely, and nothing about it nags you to change your mind. You can also change or clear your
location at any time in Settings → Location.

### 2. Checking for an app update

When the app starts, it asks our update service whether a newer version of the app's code is
available, so that fixes can reach you without waiting for a store release. That request carries
only what is needed to answer it: which platform you are on, which version of the app you are
running, and a random identifier generated when the app was installed, which distinguishes one
installation from another and is not connected to you, your phone's identity, or anything you have
recorded in the app. Like any internet request it also carries your IP address.

This check is run for us by **Expo** (Expo/EAS Update), which operates the service on our behalf.
It sends no prayer log, no location, no settings and no personal information. It is the app asking
"is there a newer version?", and nothing more.

Expo's privacy policy: https://expo.dev/privacy

### 3. Leaving a tip (optional, and only if you use it)

Every feature in the app is free, and there are no paid features. A tip unlocks nothing. If you
choose to leave a tip in Settings, that is a normal in-app purchase:

- **Apple or Google processes the payment.** They handle your payment details. We never see your
  name, your card, or your billing address.
- **RevenueCat, Inc. handles the purchase on our behalf.** When you open the tip section, the app
  asks RevenueCat for the current prices; if you complete a tip, the store's purchase receipt is
  sent to RevenueCat to be validated. In doing so RevenueCat receives an anonymous identifier it
  generates for the installation, the purchase receipt or token, basic device and app information,
  and the IP address any internet request carries. That identifier is not linked to a name, an
  email or an account, because there is no account to link it to. The app does not ask RevenueCat
  to collect advertising identifiers.
- **We keep only a count.** The app stores, on your phone, how many tips you have given, so it can
  say thank you. Nothing more.

RevenueCat's privacy policy: https://www.revenuecat.com/privacy

If you never open the tip section, none of this happens.

*[Owner: if the release ships without a RevenueCat key, the tip jar is not present in the app at
all. In that case replace this whole section with: "The app has no purchases, no paid features and
no payment processing of any kind." Restore it in the release where the key ships.]*

### 4. If the app crashes (and you can turn this off)

If the app crashes, it sends us one crash report, so we can find the bug and fix it. Here is
exactly what is in it:

- **where the app's own code was when it crashed** (a stack trace),
- **your device model and operating system version** (say, an iPhone 13 on iOS 18), and the app's
  version.

The same report, with the same contents, is also sent for one error the app catches and survives:
a failure to open or upgrade its database when it starts. And so that we can tell "crashes rarely"
from "crashes constantly", the reporting also sends an anonymous marker when the app starts and
ends a session — app version and device class, nothing more. The ratio of clean sessions to
crashed ones is the number we watch.

And what is *not* in any of it: no prayer log, no location, no city, no name, no email, and no
record of what you did in the app — no screenshots, no screen recordings, no tap-by-tap trail. We
have configured the reporting to strip personal information, and we never tag reports with any
kind of user identity — there is none in this app to tag them with. A crash report tells us the
app broke; it cannot tell us who you are.

The reports are processed for us by **Sentry**, on their servers in the European Union, and are
deleted after 90 days. Like any internet request, the report reaches Sentry from your IP address;
we have told the SDK not to attach it to the report.

**You can switch this off** in Settings, any time. It takes effect the next time the app starts —
the switch says so — and from then on the app sends neither crash reports nor session markers. It
changes nothing else about the app.

Sentry's privacy policy: https://sentry.io/privacy/

### 5. Prayer buddies (optional, off until you turn it on)

Buddy mode lets you and someone you choose (a partner, a sibling, a friend) see that the other
prayed today. It is off when you install the app. Nothing in the app asks you to use it, and you
can turn it off again at any time.

**What your buddy sees.** That you prayed. Late counts as prayed. That is all.

**What your buddy never sees.** A prayer you missed. A prayer you have not marked yet. An excused
day. Your qada count, your streak, your history, or anything from any day but today. An empty row
means nothing arrived. It does not mean you did not pray, and the app has no way to say that.

#### When you mark a prayer, step by step

To reach your buddy's phone, the mark passes through a small server of ours called the relay
(`relay.simpleprayer.app`). Here is everything that happens.

**1. What your phone sends to the relay.**

- Your phone's random id, and a secret that proves the message comes from your phone. The relay
  made both when you turned buddy mode on. Neither is linked to you or to your phone.
- A random id for the link between you and this buddy.
- The day and the prayer, for example "8 November, Dhuhr".
- One word: "prayed", or "cleared" if you undo the mark.
- The language your app is in, and whether you want buddy notifications yourself. Your buddy's
  phone keeps these so it can write to you in your language next time.
- The text of the notification, already written by your phone in your buddy's language: "Your
  buddy prayed Dhuhr". With it comes a second copy with a gap where a name goes: "{} prayed
  Dhuhr". If your buddy has turned buddy notifications off, there is no text.

Like any request on the internet, the message also carries your phone's IP address.

**2. What the relay keeps, and for how long.**

- **The mark** (the link id, the day, the prayer, the word, and which phone it is for). It is
  deleted as soon as your buddy's phone collects it. If it is never collected, it cannot be
  collected after **24 hours**, and the hourly clean-up deletes it.
- **The link**: two random phone ids that are paired. It is deleted when either of you removes the
  other or turns buddy mode off, or after 90 days with nothing sent.
- **Your phone's record**: its random id, a hash of its secret (a fingerprint the relay can check
  but cannot turn back into the secret), and its push token, stored encrypted. It is deleted when
  you turn buddy mode off, or after 90 days in which your phone never contacts the relay.
- **An invite code**, while you are adding a buddy. It works once, and for 24 hours at most.
- **Counters that limit how many requests one phone can make.** Each counter is named after your
  phone's random id, or after an HMAC of your IP address: a scrambled form made with a secret key.
  The IP address itself is never written down. Counters are deleted after 24 hours at most.

The relay does not store your language or the notification text. It passes them on and forgets
them. It keeps **no logs**: not of requests, not of IP addresses, not of who sent what to whom. If
the relay itself breaks, it sends an error report to Sentry with the request, the ids and the IP
address removed first. The relay runs on Cloudflare, whose network carries the connection to it.

**3. The doorbell.** The relay then asks **Expo**, a push service, to send a notification to your
buddy's phone. Expo hands it to **Apple** (on an iPhone) or **Google** (on Android), and they
deliver it. The notification carries the text "Your buddy prayed Dhuhr", and with it the link id,
the day, the prayer, the word, your app language and your notification choice. So this message passes through Expo's service and through Apple's or Google's, under their
own privacy policies.

If your buddy's phone has a name saved for you, it puts that name into the text as the
notification arrives: "Amina prayed Dhuhr". That name is added on their phone. It was never sent
by anyone. Undoing a mark sends a silent notification with no text. If a notification is lost, your
buddy's phone collects the mark from the relay the next time the app opens.

**4. What is never sent.** Your name. The name, icon and colour you chose for your buddy, or the
ones they chose for you. Your location, phone number or email address. A missed prayer, a prayer
not marked yet, or whether a prayer was late. Excused days, qada, your streak and your history.

**5. What someone reading the relay could learn.** Suppose someone could read everything stored on
the relay: one of us, or someone who broke in. They would see which random ids are paired with
which. For marks not yet collected, and never older than 24 hours, they would see that a random id
"prayed Dhuhr on 8 November". They would not see a name, a phone number, a location or a language.
They could not use the push tokens, because those are encrypted with a key that is not stored with
them.

Someone who controlled the relay while it was running could see more: each message as it passes,
with its notification text and the IP address it came from. This is because the relay is not
end-to-end encrypted.

**6. Why it is not end-to-end encrypted.** End-to-end encryption would mean only the two phones can
read a mark, and the relay cannot. We chose not to do this. Even with it, the relay would still
have to know which phone to wake, and when. That is most of what there is to see. What encryption
would hide is which prayer was marked. The notification text has no name in it, so there is little
else for it to hide. We decided this small gain was not worth the extra parts it would add to the
app.

**7. Check it yourself.** The relay's code is public:
https://github.com/majani-plus/simple-prayer-relay. Everything it stores is in one file,
`migrations/0001_init.sql`, and every request it accepts is in `src/routes.ts`. In the app, the
only code that talks to the relay is `src/services/buddyRelay.ts`, and the app's code is public
too: https://github.com/majani-plus/simple-prayer-app.

| | What it is |
|---|---|
| **Sent** to the relay | Random phone id and secret, random link id, day, prayer, "prayed" or "cleared", your app language and notification choice, the notification text, your IP address |
| **Kept** on the relay | The mark until collected (24 hours at most); the link and your phone's record until you leave or 90 quiet days; an invite code for 24 hours; rate-limit counters for 24 hours. No logs |
| **Never sent** | Your name, your buddy's nickname, icon or colour, your location, phone number or email, missed or late prayers, unmarked prayers, excused days, qada, streak, history |

**No account.** Pairing works by a one-time code that expires in 24 hours. There is still no
sign-up, no email address and no password anywhere in this app.

**What your buddy is called is yours alone.** You pick an icon, a colour and a name for each buddy,
on your phone. They never learn what you chose, and none of it is sent to the relay or to them. Two
people who paired with each other may picture each other completely differently.

**Leaving.** Removing a buddy takes effect immediately. It deletes the link from the relay, along
with any mark waiting between you. You do not need their agreement, and they are not told who ended
it. Turning buddy mode off removes every link and deletes your phone's record from the relay.

### 6. Nothing else

That is the complete list. In particular:

- **No analytics.** There is no analytics or usage-tracking SDK in this app of any kind. Crash
  reporting above is the whole of our telemetry: it speaks only when the app breaks, and never
  about you.
- **No advertising and no ad networks**, now or later.
- **No account, no sign-in, no email address.**
- **No leaderboards, no profiles, nothing public.** Buddy mode shares one thing with one person
  you chose, and there is no feed, no ranking, no follower count and nowhere for anybody else to
  see anything. Your worship is not content.

## Your watch and your other screens

The app also shows your prayers on an Apple Watch, on a Wear OS watch, in home-screen and
lock-screen widgets, and on tablets. None of these talk to the internet, and none of them send
anything to us. Two of them are worth explaining plainly.

**Your watch holds a copy of your times and your marks.** So that the watch keeps working when
your phone is in another room, your phone sends it a bundle covering about two weeks: the prayer
times for those days, the words already translated, the direction of the qibla, when your
reminders are due, and — because the watch shows your seals — **which prayers you have marked,
and which days are marked excused**. That bundle travels **from your phone to your watch** over
the connection the two devices already have (Bluetooth or your own Wi-Fi, handled by Apple or
Google's own watch software). It does not pass through any server of ours, and we never see it.

The same is true in reverse: when you mark a prayer on the watch, the watch holds that single
mark until your phone is reachable, hands it to the phone, and the phone writes it into your
log. If you stop using the watch, deleting the watch app removes its copy.

Exempt days are health-related, so to be exact about them: the excused-day flag for each day in
that two-week window is part of the bundle above, because the watch draws those days as excused
rather than as missed. It stays between your phone and your watch, exactly like everything else
here.

**Widgets and the watch read the same kind of copy on your own device.** A widget, a
complication, a tile and the always-on notification are drawn by the system, not by the app, so
the app leaves them a small pre-written summary in storage that belongs to the app on your device.
Nothing about a widget or a complication leaves your device.

**Location on the watch.** If you open the qibla compass on the Apple Watch, watchOS asks the
watch for permission to read your heading — which way the watch is pointing. It is used to turn
the compass dial and nothing else, it is never written down, and it never leaves the watch. The
direction of the qibla itself was already worked out on your phone.

**The "Manuscript" watch face** (the separate watch-face app on Google Play) is a design file
rather than a program: it contains no code that can run, no network access, and it collects
nothing. It shows the prayer information the Simple Prayer watch app provides. Without that app
installed, it is simply a watch face.

## Notifications

Adhan alerts, pre-reminders and end-of-window nudges are **local notifications**. Your phone
schedules them from times the app calculated on your phone. No message travels over a network, and
their text is generated on your device and stays there.

Buddy notifications are the exception, and only exist if you add a buddy. Those arrive as push
notifications, so the app registers a push token with Apple's or Google's notification service —
which is a random identifier for your installation, not for you. The words in a buddy notification
are written by your buddy's phone, in your language, and passed through. Our relay does not write
them, and nothing in them names you. "When you mark a prayer, step by step" above shows
exactly what they carry.

## Exporting your data

Settings → Data lets you export everything the app has stored as a CSV or JSON file. The app writes
that file into its own temporary storage and hands it to your phone's standard share sheet — you
decide where it goes, and it goes only there. It is not uploaded anywhere by the app. The temporary
copy is deleted the next time you export.

## Permissions the app asks for

- **Approximate location** — to calculate prayer times and the Qibla direction, as described above.
  Optional; the app works with a city you choose by hand. Foreground only.
- **Notifications** — to deliver the reminders you turn on. Optional.
- **Exact alarms, run at startup, vibrate (Android)** — so reminders fire at the right minute and
  survive a restart. These are scheduling permissions; they read nothing.
- **On the watch: heading (Apple Watch) and notifications (Wear OS)** — the heading turns the
  qibla dial on your wrist and never leaves the watch; the notification permission lets the Wear
  app sound the adhan when your phone is away. Both optional, both asked for on the watch itself.

The app blocks precise location, camera, microphone, contacts and activity recognition outright, so
they cannot be requested even by accident.

## Children

The app is suitable for all ages and is rated accordingly. Because we collect no personal
information from anyone, we collect none from children either — there is nothing here to age-gate,
no profile to build and no data to sell.

## Your choices

- **Use a city instead of your location** — nothing is ever sent to a map service except the city
  name you type.
- **Turn off crash reports** in Settings, any time. The app keeps working exactly the same.
- **Export your data** at any time, in a plain format you can open anywhere.
- **Turn off buddy mode**, if you ever turned it on. That deletes every pairing and your
  installation's record from the relay, and removes your buddies from this phone.
- **Delete everything** by uninstalling the app. That removes the database and all settings from
  your device. There is no copy anywhere else, and no account to close. If you had buddy mode on,
  turn it off first — an uninstalled app cannot tell the relay to forget the pairing, though the
  relay drops it by itself after 90 quiet days.
- **Ask us for your data, or for it to be deleted** — write to the address below. We hold almost
  nothing about you to give you or to delete: crash reports carry no identity we could look you up
  by, and they delete themselves after 90 days. Buddy mode's relay holds a pairing between two
  random identifiers and at most a day of marks, with nothing that would let us find you in it —
  turning buddy mode off deletes it, and we cannot look it up for you because there is no name or
  address on it. The other exception is a tip, if you have given one: the record of that purchase
  sits with Apple or Google and with RevenueCat, and we will pass a deletion request on to them.

## The website

`simpleprayer.app` sets no cookies, runs no analytics and embeds no third-party trackers. It does
not know you visited.

One page does more than show words. `simpleprayer.app/times` shows today's prayer times, so it needs
to know where you are. You can let your browser tell it, or you can pick a city from a list. Either
way the location stays on your device. The page works the times out itself, and it is not allowed to
send anything to us or to anyone else.

The location you choose is saved in your browser so the page does not have to ask again. It is not a
cookie, and it is never sent anywhere. If you add the page to your home screen, your browser also
keeps a copy of the pages themselves so they still work with no internet. That copy is our own
pages, nothing about you. You can remove all of it by clearing this site's data in your browser
settings.

## Changes to this policy

If the app ever starts doing something this page does not describe, this page changes first, the
date at the top changes with it, and the change is called out in the release notes. Given what this
app is, we do not expect that to happen often.

## Contact

Questions about privacy: **privacy@simpleprayer.app**

---

*Simple Prayer is made by Majani Plus LLC, New Cairo, Egypt. It is free, contains no advertising, and asks nothing
of you.*
