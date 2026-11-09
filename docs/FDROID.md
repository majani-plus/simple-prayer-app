# Getting Simple Prayer into F-Droid and IzzyOnDroid

The version without Google (`FOSS_BUILD=1`, D212) is what both stores take. GitHub Releases
already carries it: every `release/vX.Y.Z` tag gets a signed `simple-prayer-foss.apk`. The
store text, icon and screenshots are in `fastlane/metadata/android/`, which both stores read.

Both submissions go in from the owner's own account. Nothing below needs to be done twice:
once a store has the app, it follows new release tags by itself.

## Our signing key

`~/Backups/simple-prayer-foss-release.jks`, alias `simpleprayer-foss`, with the password beside
it in `simple-prayer-foss-release.txt`. Keep a copy in a password manager. Losing it means
everyone on this version must reinstall to update.

SHA-256 of the certificate (stores and `assetlinks.json` ask for it):

```
57:2D:CE:EA:F6:81:C6:AA:FC:97:52:77:EB:99:F7:55:59:53:24:4D:3C:0C:77:11:68:3D:2D:D6:B0:98:1E:AF
```

For CI to sign release APKs by itself, add four repository secrets once (Settings → Secrets and
variables → Actions), or run:

```sh
base64 -i ~/Backups/simple-prayer-foss-release.jks | gh secret set FOSS_KEYSTORE_BASE64
gh secret set FOSS_KEYSTORE_PASSWORD   # paste the password from the .txt file
gh secret set FOSS_KEY_PASSWORD        # the same password
printf simpleprayer-foss | gh secret set FOSS_KEY_ALIAS
```

Until then, `foss-android.yml` builds the APK on the tag and attaches nothing; sign the CI
artifact by hand:

```sh
apksigner sign --ks ~/Backups/simple-prayer-foss-release.jks --ks-key-alias simpleprayer-foss \
  --out simple-prayer-foss.apk app-release.apk
gh release upload release/vX.Y.Z simple-prayer-foss.apk --clobber
```

## IzzyOnDroid (fast: usually days)

IzzyOnDroid takes our signed APK from GitHub Releases. Open an issue at
<https://gitlab.com/IzzyOnDroid/repo/-/issues> with this text:

> **App:** Simple Prayer (`app.simpleprayer`)
> **Source:** https://github.com/majani-plus/simple-prayer-app (MIT)
> **APK:** the `simple-prayer-foss.apk` asset on each GitHub release
> (https://github.com/majani-plus/simple-prayer-app/releases)
> **Signing certificate SHA-256:** 57:2D:CE:EA:F6:81:C6:AA:FC:97:52:77:EB:99:F7:55:59:53:24:4D:3C:0C:77:11:68:3D:2D:D6:B0:98:1E:AF
> **Metadata:** fastlane layout in `fastlane/metadata/android/` (en-US, ar, tr-TR, ur)
>
> Prayer times, Qibla and a gentle prayer log. This APK is built from source by our CI with no
> Google services, no crash reporting and no tip jar (`FOSS_BUILD=1`, see
> `.github/workflows/foss-android.yml`, which fails on any non-free dependency). The optional
> prayer-buddy feature talks to our own relay, which is also open source (MIT):
> https://github.com/majani-plus/simple-prayer-relay. The adhan recordings in this build are
> CC0 / CC BY 3.0 from Wikimedia Commons (`assets/audio/CREDITS.md`).

## F-Droid main repository (slower: weeks to months)

F-Droid builds from source on its own servers. Fork <https://gitlab.com/fdroid/fdroiddata>,
add `metadata/app.simpleprayer.yml` with the content below, and open a merge request. Their
reviewers often ask for changes; the open questions are noted after the recipe.

```yaml
Categories:
  - Time
License: MIT
AuthorName: Ronny Majani
WebSite: https://simpleprayer.app
SourceCode: https://github.com/majani-plus/simple-prayer-app
IssueTracker: https://github.com/majani-plus/simple-prayer-app/issues
Changelog: https://github.com/majani-plus/simple-prayer-app/blob/HEAD/CHANGELOG.md

AutoName: Simple Prayer

RepoType: git
Repo: https://github.com/majani-plus/simple-prayer-app.git

Builds:
  - versionName: 1.7.0
    versionCode: 65
    commit: release/v1.7.0
    sudo:
      - apt-get update
      - apt-get install -y nodejs npm openjdk-17-jdk-headless
      - npm install -g bun@1.4.3
    init: bun install --frozen-lockfile
    output: android/app/build/outputs/apk/release/app-release-unsigned.apk
    prebuild:
      - export FOSS_BUILD=1
      - bun scripts/foss-prepare.ts
      - bunx expo prebuild -p android --clean --no-install
    build:
      - export FOSS_BUILD=1
      - cd android
      - gradle :app:assembleRelease

AllowedAPKSigningKeys: 572dceeaf681c6aafc975277eb99f7555953244d3c0c7711683d2dd6b0981eaf

AutoUpdateMode: Version
UpdateCheckMode: Tags ^release/v.*$
UpdateCheckData: package.json|"versionCode":\s*(\d+)|package.json|"version":\s*"([^"]+)"
CurrentVersion: 1.7.0
CurrentVersionCode: 65
```

(`AllowedAPKSigningKeys` is the SHA-256 above, lowercase, without colons or spaces; it only
matters if F-Droid later builds reproducibly and ships our signature. Remove the line if
reviewers prefer to sign with F-Droid's own key, the default.)

Questions F-Droid reviewers are likely to raise:

- **bun.** Their build server may refuse a tool installed from npm. The fallback is
  `npm install` without a lockfile in `init`; versions then float within package.json's ranges.
- **Prebuilt binaries in node_modules** (React Native's and Hermes' Maven artefacts). Other
  React Native apps are in F-Droid; their reviewers know the usual `scandelete` lines.
- **Signing.** Expo's template signs release builds with a debug key. F-Droid re-signs, so the
  output path may need to be `app-release.apk` rather than `-unsigned`.
- **Anti-features.** None should apply: no Google, no tracking, no non-free assets, and the relay
  is free software. If a reviewer asks, the relay is opt-in and only for prayer buddies.

The F-Droid build has a different signature from ours, so people cannot switch between the
F-Droid and GitHub/Izzy versions without reinstalling, the same as between either and Google
Play. That is normal for F-Droid apps.
