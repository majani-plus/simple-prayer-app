# Contributing to Simple Prayer

Thank you for wanting to help. This page explains how to set up the project, which checks to run,
and the rules the app follows. Please read "The why" before you change how anything works.

If you want to help with a language, read [docs/TRANSLATING.md](docs/TRANSLATING.md) instead. It
has its own steps.

## The why

Simple Prayer is a tool to encourage prayer. It is not a ledger of everything a person has prayed.

The heart of the app is a small moment: you open it, see which prayer is due, tap "prayed", and
feel good. Nothing should stand between a person and that tap. The app should be simple enough for
a child or a grandparent to use, even though there are many settings underneath. Those settings
should never get in the way of someone who does not need them.

What this means when you make a change:

- **Fewer steps wins.** A feature that does the common case in one tap is better than one that
  covers every case in four. Leaving out a rare case is often the right call.
- **Never turn it into an audit.** Nothing should show a list of unmarked prayers to work through,
  or ask people to explain themselves.
- **Be gentle about logging.** People forget to log. The app fills gaps in a kind way and does not
  ask questions. Anyone who cares can fix a day in History.
- **Two kinds of user, both first class.** Some people track every prayer. Others only want times
  and the qibla. Neither should ever feel pushed, blocked, or like they are using the app wrong.
- **Correct where it matters.** Prayer times, a missed prayer, a qada count: these must be right,
  because a mistake could hurt someone. Extra precision for its own sake is not a reason to add
  anything.
- **Not built for engagement.** The app does not try to keep people in it. If a feature lets
  someone get what they need without opening the app (from a widget or a notification), that is a
  good thing.

## Setting up

You need [bun](https://bun.sh), and Xcode (for iOS) or Android Studio (for Android). The project
uses bun for everything. Please do not use npm, yarn or pnpm.

```sh
bun install
bun run ios        # or: bun run android
```

The first run makes a development build of the app and installs it on a simulator or emulator.
After that, `bunx expo start` starts the dev server, and you press `i` or `a` to open the app.

The app uses Expo SDK 58. Expo changes often, so check APIs against the
[SDK 58 docs](https://docs.expo.dev/versions/v58.0.0/) rather than memory.

## Checks

Run these before you open a pull request. CI runs the first three on every pull request.

```sh
bun run typecheck
bun run lint
bun run test       # Jest, run through bun. Not `bun test`.
```

Two more, only when you change native code, because the checks above do not see it:

- **Changed Kotlin?** Run `cd android && ./gradlew :<module>:compileReleaseKotlin` for the module
  you changed. The `android/` folder is generated; `bun run android` makes it the first time.
- **Changed Swift?** Run `bun run typecheck:swift`.

## The rules

These keep the app what it is. A pull request that breaks one will be asked to change.

- **No ads, no analytics and no accounts.** No tracking SDKs of any kind.
- **The core works offline.** Prayer times, the log, reminders and the qibla never need the
  internet. Anything that sends data must be declared in
  [docs/PRIVACY_POLICY.md](docs/PRIVACY_POLICY.md), and `src/__tests__/privacyClaims.test.ts`
  checks this.
- **Coarse location only.** The app never asks for precise location, and never for location
  "Always" or in the background.
- **Prayer logic is pure TypeScript in `src/domain/`.** No React or React Native imports there,
  and full unit tests. Swift and Kotlin show what the phone has worked out. They do not calculate.
- **The prayer day is decided in one place: `src/domain/dates.ts`.** A prayer day runs from Fajr
  to the next Fajr. Do not work out day boundaries anywhere else.
- **No user-facing text in the code.** Every string goes through the translation files in
  `src/i18n/locales/`, in all three languages.
- **All text follows [docs/TONE.md](docs/TONE.md).** Plain words, short sentences, no idioms and no
  marketing voice.
- **States are never shown by colour alone.** Prayed, late, missed and excused always have an icon
  and a word too.
- **Never shame or nag.** A missed prayer is never written as a failure. Streak and qada text looks
  forward with hope. Excused days are never shown as missed.
- **Tips are "tips".** Never "donation" or "charity", in any language. A tip unlocks nothing.

## How decisions work

Product decisions are recorded in [docs/DECISIONS.md](docs/DECISIONS.md), one row per decision,
with the reason. The log is append-only: a decision is never quietly undone. If you want to change
one, open an issue and say which decision and why. If it is accepted, a new row records the change.

Decision IDs (D1, D2, and so on) are given by the maintainers. In a pull request that needs a new
decision, describe it in the PR and leave the ID to us.

## Pull requests

1. For anything larger than a small fix, open an issue first, so we can agree on the approach
   before you spend time on it.
2. Make a branch from `main`. Keep each pull request to one change.
3. Add or update tests. Logic in `src/domain/` needs unit tests.
4. Run the checks above.
5. If you changed text, change it in every language the app ships (English, Arabic, Turkish and
   Urdu), or say in the PR which languages still need text.
6. Open the pull request and fill in the template. Screenshots help for anything you can see.

A maintainer will review it. We may ask for changes, and we may say no to a change that does not
fit "The why" above. That is never a comment on you.

## Licence

The code is under the [MIT licence](LICENSE). By sending a contribution, you agree that it is
licensed under MIT too.

The name "Simple Prayer", the mosque mark and the app's look are not covered by the licence. See
[TRADEMARKS.md](TRADEMARKS.md).

## Security

Please do not report security problems in a public issue. See [SECURITY.md](SECURITY.md).
