# Getting Simple Prayer into F-Droid

The version without Google (`FOSS_BUILD=1`, D212) is what F-Droid takes. GitHub Releases
already carries it: every `release/vX.Y.Z` tag gets a signed `simple-prayer-foss.apk`, on a GitHub
Release under the plain tag `vX.Y.Z` (GitHub's download links break on a tag with a slash). The
store text, icon and screenshots are in `fastlane/metadata/android/`, which F-Droid reads.

The submission goes in from the owner's own GitLab account. It is done once: after that, F-Droid
follows new release tags by itself.

## Our signing key

`~/Backups/simple-prayer-foss-release.jks`, alias `simpleprayer-foss`, with the password beside
it in `simple-prayer-foss-release.txt`. Keep a copy in a password manager. Losing it means
everyone on this version must reinstall to update.

SHA-256 of the certificate (stores and `assetlinks.json` ask for it):

```
57:2D:CE:EA:F6:81:C6:AA:FC:97:52:77:EB:99:F7:55:59:53:24:4D:3C:0C:77:11:68:3D:2D:D6:B0:98:1E:AF
```

CI signs release APKs by itself: the four repository secrets (`FOSS_KEYSTORE_BASE64`,
`FOSS_KEYSTORE_PASSWORD`, `FOSS_KEY_PASSWORD`, `FOSS_KEY_ALIAS`) were set on 2026-11-09. If they are
ever lost, set them again from the backup:

```sh
base64 -i ~/Backups/simple-prayer-foss-release.jks | gh secret set FOSS_KEYSTORE_BASE64
gh secret set FOSS_KEYSTORE_PASSWORD   # paste the password from the .txt file
gh secret set FOSS_KEY_PASSWORD        # the same password
printf simpleprayer-foss | gh secret set FOSS_KEY_ALIAS
```

## IzzyOnDroid: not submitted

IzzyOnDroid's App Inclusion Policy (https://izzyondroid.org/docs/general/AppInclusionPolicy/,
"AI policy") rejects apps whose code is fully or partly written by generative AI tools, and much of
this app's code was written with Claude. Submitting would mean hiding that, so we don't. Their 30 MB
per-APK limit would also be a problem: the universal APK is about 134 MB, and arm64 alone is about
50 MB, mostly React Native's native libraries. Requests now go to Codeberg
(https://codeberg.org/IzzyOnDroid/repodata/issues), not GitLab.

People who want the APK without F-Droid get it from GitHub Releases or the website's /install page.

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
  - versionName: 1.7.1
    versionCode: 66
    commit: release/v1.7.1
    sudo:
      - apt-get update
      - apt-get install -y openjdk-17-jdk-headless xz-utils
      - curl -Lo node.tar.xz https://nodejs.org/dist/v24.22.2/node-v24.22.2-linux-x64.tar.xz
      - echo "48cc0e21e048790e54c0cf5749c2725005313d652651c40b7a21feb9697aaf75  node.tar.xz" | sha256sum -c -
      - tar xJf node.tar.xz --strip-components=1 -C /usr/local
      - npm install -g bun@1.4.3
    init: bun install --frozen-lockfile
    output: android/app/build/outputs/apk/release/app-release-unsigned.apk
    prebuild:
      - export FOSS_BUILD=1
      - bun scripts/foss-prepare.ts
      - bunx expo prebuild -p android --clean --no-install
      - sed -i -e '/signingConfig signingConfigs.debug/d' android/app/build.gradle
    build:
      - export FOSS_BUILD=1
      - cd android
      - gradle :app:assembleRelease

AllowedAPKSigningKeys: 572dceeaf681c6aafc975277eb99f7555953244d3c0c7711683d2dd6b0981eaf

AutoUpdateMode: Version
UpdateCheckMode: Tags ^release/v.*$
UpdateCheckData: package.json|"versionCode":\s*(\d+)|package.json|"version":\s*"([^"]+)"
CurrentVersion: 1.7.1
CurrentVersionCode: 66
```

(`AllowedAPKSigningKeys` is the SHA-256 above, lowercase, without colons or spaces; it only
matters if F-Droid later builds reproducibly and ships our signature. Remove the line if
reviewers prefer to sign with F-Droid's own key, the default.)

Questions F-Droid reviewers are likely to raise:

- **bun.** Their build server may refuse a tool installed from npm. The fallback is
  `npm install` without a lockfile in `init`; versions then float within package.json's ranges.
- **Prebuilt binaries in node_modules** (React Native's and Hermes' Maven artefacts). Other
  React Native apps are in F-Droid; their reviewers know the usual `scandelete` lines.
- **Signing.** Expo's template signs release builds with the debug key; the prebuild step deletes
  that line so Gradle writes `app-release-unsigned.apk`, which F-Droid signs.
- **Node.** The recipe installs Node 24.22.2 (the repo's pin, `website/.node-version`) from
  nodejs.org with a checked SHA-256, since Debian's Node is too old for Expo SDK 58.
- **Anti-features.** None should apply: no Google, no tracking, no non-free assets, and the relay
  is free software. If a reviewer asks, the relay is opt-in and only for prayer buddies.

The F-Droid build has a different signature from ours, so people cannot switch between the
F-Droid and GitHub/Izzy versions without reinstalling, the same as between either and Google
Play. That is normal for F-Droid apps.
