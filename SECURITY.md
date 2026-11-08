# Security

## How to report a problem

Please email **privacy@simpleprayer.app**. Do not open a public issue for a security problem.

Tell us what you found, how to make it happen, and what someone could do with it. We will reply,
tell you how the fix is going, and thank you by name when it ships if you would like that.

There is no bug bounty. We are a small team, and we cannot pay for reports. We are still very
grateful for them.

## What is in scope

- **This app**: the iPhone and Android apps, their widgets, the Apple Watch and Wear OS apps, and
  the Manuscript watch face, all built from this repository.
- **The buddy relay**: the server that carries buddy marks between phones, at
  `relay.simpleprayer.app`. Its code is in
  [majani-plus/simple-prayer-relay](https://github.com/majani-plus/simple-prayer-relay).

Examples of what we want to hear about:

- anything that lets one phone read, change or delete another phone's buddy data on the relay;
- anything that lets someone send notifications to a phone they are not paired with;
- the app sending something that [docs/PRIVACY_POLICY.md](docs/PRIVACY_POLICY.md) does not
  mention;
- a way to read the prayer log or settings of the app from another app on the same phone.

## What is out of scope

- Services we do not run: Apple, Google, Expo, Sentry, RevenueCat and Cloudflare. Please report
  those to them.
- The website, simpleprayer.app, unless the problem affects the app or the relay. It is a static
  site with no accounts and no forms.
- Attacks that need someone's unlocked phone in your hands.
- Load and denial-of-service testing against the relay. Please do not run these.
- Reports from automated scanners with no working example.
- Copies of the app that other people have built and published. We cannot fix those.

## Please

- Only test against your own phones and your own buddy pairs.
- Do not try to read anyone else's data.
- Give us a reasonable time to fix the problem before you talk about it in public.
