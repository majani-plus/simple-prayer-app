# Widgets — the Apple-side pass (owner runbook)

Ten minutes of clerical work in the Apple Developer portal + one EAS credentials pass. Nothing
here needs the code to be finished; doing it early unblocks the first iOS widget build. The
history: `plugins/withAppGroup.js` was parked on 2026-08-21 because `eas build` reused an App
Store provisioning profile that predated the App Group entitlement, and Xcode failed three times
on `application-groups`. An App Group is a **provisioning capability**, not just an entitlement
string — the App ID has to carry it and the profile has to be regenerated, not reused.

## Steps

1. **Apple Developer portal → Identifiers → `app.simpleprayer`** (the app's App ID):
   enable the **App Groups** capability.
2. **Identifiers → App Groups → register** `group.app.simpleprayer` (if it does not already
   exist), and assign it to the `app.simpleprayer` App ID.
3. Expect a **second App ID** to appear for the widget extension when the target first builds:
   **`app.simpleprayer.widget`**. It needs the same App Groups capability with the same group.
   EAS usually registers the identifier itself on the first build; if the build fails on the
   extension's profile, enable the capability on that App ID by hand and rebuild.
4. **Force EAS to regenerate profiles instead of reusing them.** Run the build with
   `EXPO_DEBUG=1 eas build -p ios --profile preview` and watch the capability-sync lines. If it
   still reuses a stale profile: `eas credentials` → iOS → select the profile(s) → delete, then
   build again so they are regenerated fresh. Last resort: `EXPO_NO_CAPABILITY_SYNC=1` with the
   capabilities managed fully by hand in the portal
   (see expo/fyi `provisioning-profile-missing-capabilities.md`).
5. Tell the session (or note here) that the pass is done, so `widgets-ios-config` — the one-line
   `app.json` change registering `./plugins/withAppGroup` + the apple-targets plugin — can merge
   to main. **Until then that branch must not merge**: with the entitlement registered but the
   Apple side missing, `bun run release:ios` fails on provisioning.

## Reminders

- `SENTRY_AUTH_TOKEN` is still missing on the `preview` EAS profile (OWNER-BLOCKED row 2b) — an
  Android `preview` build dies on it, and a widgets test build is exactly when it will bite.
- Nothing about the widgets adds push/APNs. The binary carries `aps-environment` since D175, but
  that is buddy mode's; the Live Activity is still driven entirely from the app and expects no
  push, so a widget or Live Activity bug is never a push problem.
