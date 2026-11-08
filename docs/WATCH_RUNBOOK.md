# Watch platform runbook (Milestone V) — the owner-blocked pass

What the owner must do on the Apple and Google portals before the watch builds can ship, in
order, with the reasons. Modeled on `docs/WIDGETS_APPLE_RUNBOOK.md`, which this extends — read
that one first if the App Group rows there are still open.

## Apple (before a V3 EAS build can succeed)

1. **Register two new App IDs** on the developer portal:
   - `app.simpleprayer.watchkitapp` — the watch app.
   - `app.simpleprayer.watchkitapp.watchwidget` — the watch complications extension.
   (Exact IDs are pinned by `targets/watch*/expo-target.config.js` once V3 lands; if V3 chooses
   different suffixes, this row and the target configs must agree — the EAS credentials step
   looks targets up by exact name and bundle id.)
2. **App Groups capability** on both new App IDs, with the group `group.app.simpleprayer`
   attached. The group is shared infrastructure (D92i) — the WATCH-side app and its complication
   extension share a watch-local container under the same name. (An iPhone↔watch App Group does
   NOT bridge devices; that is what WCSession is for. The group here is watch-internal.)
3. **Regenerate provisioning profiles, never reuse** — an App Group is a provisioning
   capability; the widget round burned three builds learning this (WIDGETS_APPLE_RUNBOOK).
4. **EAS credentials for the two new targets.** Watch app targets sit outside EAS's documented
   app-extension path (eas-cli #2578 closed unresolved), so if `eas credentials` cannot mint
   profiles for them, the fallback is `credentials.json` with one entry per target name
   (app, widgets, watch app, watch widget). Budget a session with the owner for this on the
   first V3 build.
5. **No new entitlements beyond the group.** The watch targets add none of their own. The binary
   does now carry `aps-environment` — D175 reversed D49 so buddy mode can send remote
   notifications — but nothing on the wrist uses push, and no watch target should request it. No
   Always location either; the watch app carries its own
   `NSLocationWhenInUseUsageDescription` ONLY if the qibla page reads the watch's own heading —
   V4 decides; if it ships heading-only (no location), no new usage string exists.

## Google Play (before V7 can release)

1. **Wear OS form factor track**: Play Console → Test and release → Advanced settings → Form
   factors → Add form factor → Wear OS. The Wear AAB releases there, same package name
   (`app.simpleprayer`), same signing key, its own versionCode range (the build sets a disjoint
   scheme so phone and wear codes can never collide).
2. **Closed testing first — mandatory.** Wear releases must pass a closed track before
   production. Add the owner's own Google account as tester.
3. **Listing gates the Wear review checks**: the phrase "Wear OS" present in the store listing
   text; at least one Wear screenshot (1:1, round frame content); tested on round AND square
   displays (the V0a mockups carry both; the emulator script covers both).
4. **The watch face is a SEPARATE Play listing.** A Watch Face Format face is a resource-only
   AAB that Play refuses to accept inside an app AAB. New app entry, own package name (e.g.
   `app.simpleprayer.face` — decide at V6b, then it is permanent), Wear OS form factor, same
   icon rule: a single-face app's icon must be the face itself, circular, scaled to the edges
   (WO-G4). Its store listing needs the same "Wear OS" phrase + screenshots.
5. **Battery/AOD discipline is a listing concern**: Play shows battery warnings on power-hungry
   faces; the face's always-on variant stays ≤15% lit pixels (WO-P7) and ≤10 MB ambient memory
   (WO-P8) by design (V0a's AOD board).

## What never happens (so nobody re-opens it)

- No APNs / FCM push for watch updates — D49 is permanent; everything travels device-to-device.
- No Apple "watch face": watchOS has no third-party face API, and `.watchface` sharing is broken
  in watchOS 26 (Apple DTS acknowledged, no workaround). The iOS wrist story is complications +
  the watch app; if sharing is ever fixed, a curated Apple-face configuration can be revisited
  as its own decision.
- No paywalled watch anything — everything free, as the whole app is (and as the market research
  says the category's angriest reviews demand).
