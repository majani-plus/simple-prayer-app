---
title: "A buddy relay that knows as little as possible"
description: "What Simple Prayer's buddy relay receives, what it stores and for how long, and why we chose not to make it end-to-end encrypted."
date: "2026-11-08"
order: 6
tags: [privacy, cloudflare-workers, push-notifications, buddy-mode]
---

Buddy mode lets two people see that the other prayed today. To carry that between phones, Simple Prayer runs a small server, the relay: a Cloudflare Worker with a D1 database, public under MIT. This post covers what a phone sends to it, what it keeps and for how long, and what it cannot hide. It also explains why the relay is not end-to-end encrypted.

## What buddy mode shares

You can pair with up to five people. For each prayer, a phone sends one of two words: `prayed` or `cleared` (an undo). A late prayer is sent as `prayed`. There is no word for missed, not yet, excused, or a count, and no history: only today counts (D174). The relay's `protocol.ts` has exactly two states:

```ts
export const MARK_STATES = ['prayed', 'cleared'] as const;
```

## What the phone sends

When you first turn buddy mode on, the phone calls `POST /device`. The relay creates a random 128-bit device id and a random 256-bit secret, returns both once, and stores only the SHA-256 of the secret. The phone keeps the secret in the iOS keychain, or encrypted under an Android Keystore key (D180). Every later request carries `Authorization: Bearer <device_id>.<secret>`. There is no account or password. The phone also sends its Expo push token, and pairing uses a one-time eight-character code that lasts 24 hours.

When you mark a prayer, the phone sends one request per buddy to `POST /send`. The body looks like this:

```json
{
  "pairId": "3f1c…",
  "day": "2026-11-08",
  "prayer": "dhuhr",
  "state": "prayed",
  "lang": "en",
  "notify": true,
  "title": "Your buddy prayed Dhuhr",
  "titleNamed": "{} prayed Dhuhr"
}
```

`lang` and `notify` describe the sender: the language to write to them in, and whether they want notifications. `title` and `titleNamed` are the notification text, already written for the receiver.

The relay checks every body before it touches the database (`validate.ts`). Bodies are at most 2 KB. The day must be within two days of the server's date. Notification text has a length limit, and the relay refuses control characters and anything that looks like a link. That last rule stops one phone from using another phone's notifications to show an advert.

## What the relay stores, and for how long

The whole database is one migration file, `migrations/0001_init.sql`, with five tables:

| Table | What it holds | How long it lives |
|---|---|---|
| `devices` | random device id, SHA-256 of the secret, push token encrypted with AES-GCM, last seen time | until buddy mode is turned off, or 90 days with no activity |
| `invites` | the 8-character code and who made it | 24 hours, or until it is used |
| `pairs` | a random pair id and the two device ids | until either side unpairs, or 90 days unused |
| `inbox` | to which device, pair, day, prayer, `prayed` or `cleared` | deleted when the phone collects it, and after 24 hours in any case |
| `quota` | rate-limit counters keyed by a device id or an HMAC of an IP address | at most 24 hours |

There is no name, email, phone number, location, IP address, user agent, language or log line in any table. The push token is encrypted with a key that exists only in the Worker's secrets, so a copy of the database cannot be used to send a notification. Rate limits count per caller using an HMAC of the IP address with another Worker secret. The relay never writes the IP address itself.

An hourly cron job deletes everything that has expired. Unpairing and leaving buddy mode delete at once, including any marks still waiting.

The relay keeps no logs. `wrangler.jsonc` turns Workers Logs off, Logpush is not set up, and the source has no `console.log`. We do use Sentry, for one purpose: to know when the relay is broken. It sends errors only. `beforeSend` removes the request, its headers, its body and the user, and replaces ids, push tokens and invite codes in error messages with placeholders (`sentry.ts`). Cloudflare's own aggregate edge analytics still exist, and they hold nothing per caller.

If someone copied the whole database, they would learn which random ids are paired with which, and at most 24 hours of "some device was told that some pair prayed Maghrib".

## The push is a doorbell, the inbox is the truth

This rule from D175 shapes the whole design. A push notification can wake a phone, but it is not a reliable way to deliver data. iOS does not promise to run the app for a silent push. A person can swipe a notification away before the app ever sees it.

So `POST /send` first writes the mark into the receiver's `inbox` table. Only then does it ask Expo to send a push. A push that does arrive is applied at once. But the receiving app also pulls its inbox when it opens, when it returns to the foreground, about twice a minute while it is on screen, and after you mark a prayer. When it has a mark, it acknowledges it, and the acknowledgement deletes the row:

```ts
// Collecting is deleting.
await db
  .prepare(`DELETE FROM inbox WHERE to_device = ? AND id IN (${holes})`)
  .bind(deviceId, ...ids)
  .run();
```

The inbox has a unique key on `(to_device, pair_id, day, prayer)`. A retried or repeated send updates the row that is already there, so the table cannot grow. The relay only sends a push when a row actually changed. If the widget and the app both send the same mark, the second one is silent.

A push also has to arrive in time to matter. Visible buddy pushes go at high priority, because at normal priority Apple and Google may hold them back (D194). The push itself expires after six hours, since the inbox will deliver the mark anyway. On Android they arrive on a high-importance channel that still has no sound and no vibration (D196).

## Names never leave a phone

Each person gives each buddy a nickname, an icon and a colour, on their own phone. Those never travel. The relay has no language and no text of its own, so the sending phone writes the notification in the receiver's language. It writes two versions:

- `title`: "Your buddy prayed Dhuhr"
- `titleNamed`: "{} prayed Dhuhr"

The receiving phone fills in `{}` with its own nickname for the sender, as the notification arrives (D179). On iOS a notification service extension does this. On Android a messaging service does it, before handing the message on to Expo's own handler. Both read a small map of pair id to nickname that the app saves on the device. If anything fails, the phone shows `title` unchanged.

The sender never learns what they are called on the other phone, and the relay never sees a name, because nobody sends it one. If a buddy has asked not to be notified, the sender leaves the text out, and the push is a silent data message.

## Why a server at all

There was a simpler option with no server of ours: each phone could send pushes directly to the other phone's Expo push token. Then nothing would ever reach us.

We rejected it because it cannot revoke (D175). If you remove a buddy, their phone still has your push token and can keep sending until they remove you too. A leaked invite would work forever. Buddy mode is aimed at couples and families, and for that audience, that is not acceptable. With the relay, unpairing deletes the `pairs` row. The other phone's next send gets a 404, and its link ends.

## Why it is not end-to-end encrypted

We considered end-to-end encryption and decided against it. Here is why.

First, what the relay and the push services see today. When a mark is sent, the relay sees the pair id, the day, the prayer, the state and the notification text. It stores the first four in `inbox` for up to 24 hours. It does not store the text. For a visible notification, the text "Your buddy prayed Dhuhr" and the push data pass through Expo's push service and then Apple's or Google's. Those services can read them.

End-to-end encryption would hide the prayer, the day and the text from the relay and from Expo, Apple and Google. It would not hide the rest:

- The relay must know which device to deliver to, so it must know who is paired with whom.
- A mark is usually sent within moments of someone tapping a prayer. Encryption does not change when a request arrives.
- Any server sees the network address of each request, and the push services see the device they deliver to.

That routing data and timing are the real exposure, and end-to-end encryption cannot remove them. The time of a send, with the rough location a network address gives, often points to the prayer anyway.

D175 also counted a cost: a phone must decrypt the message before it shows the notification, which needs native code on the receiving side. Since D179, that native code exists for nicknames, so this cost is smaller than it was. The owner looked at the question again on 2026-11-08 and kept the design:

> It's already private, the only thing gained is not seeing which prayer was prayed.

Buddy mode is off by default, the app never suggests it, and the relay's code is public, so anyone can check what it does.

## Read the code

- [migrations/0001_init.sql](https://github.com/majani-plus/simple-prayer-relay/blob/main/migrations/0001_init.sql): the whole database
- [src/db.ts](https://github.com/majani-plus/simple-prayer-relay/blob/main/src/db.ts): every SQL statement the relay runs
- [src/routes.ts](https://github.com/majani-plus/simple-prayer-relay/blob/main/src/routes.ts): every endpoint
- [src/crypto.ts](https://github.com/majani-plus/simple-prayer-relay/blob/main/src/crypto.ts) and [src/auth.ts](https://github.com/majani-plus/simple-prayer-relay/blob/main/src/auth.ts): secret hashes, token encryption, the IP HMAC
- [src/push.ts](https://github.com/majani-plus/simple-prayer-relay/blob/main/src/push.ts) and [src/protocol.ts](https://github.com/majani-plus/simple-prayer-relay/blob/main/src/protocol.ts): what goes to Expo
- [src/sentry.ts](https://github.com/majani-plus/simple-prayer-relay/blob/main/src/sentry.ts) and [wrangler.jsonc](https://github.com/majani-plus/simple-prayer-relay/blob/main/wrangler.jsonc): errors only, logs off
- [src/services/buddyPush.ts](https://github.com/majani-plus/simple-prayer-app/blob/main/src/services/buddyPush.ts) and [src/hooks/useBuddySync.ts](https://github.com/majani-plus/simple-prayer-app/blob/main/src/hooks/useBuddySync.ts): the app side
- [docs/DECISIONS.md](https://github.com/majani-plus/simple-prayer-app/blob/main/docs/DECISIONS.md): D174 to D180, D194 and D196
