#!/usr/bin/env bash
#
# Puts a directly-installable Android APK on the website, for people who do not use Google Play
# (owner, 2026-08-28).
#
#   ./scripts/publish-apk.sh            # build a fresh APK on EAS, then publish it
#   ./scripts/publish-apk.sh --latest   # publish the newest finished apk-profile build instead
#   ./scripts/publish-apk.sh --url <u>  # publish a specific artifact URL
#
# ## Why EAS builds it rather than this machine
#
# A locally-assembled APK would be signed with a debug key or a keystore that lives on one laptop.
# EAS holds the project's real Android credentials, so an APK it builds is signed with the same key
# every time — which is what lets someone update a side-loaded copy in place instead of having to
# uninstall first. The `production-apk` profile is the store profile with `buildType: apk`, so the
# download is the store build in a different container, not a different app.
#
# The APK is NOT committed: it is ~90 MB, it changes every release, and git is the wrong place for
# a build artifact. This script fetches it into `website/public/` (git-ignored) right before a
# site deploy, and writes the version/size beside it so the page can state them honestly.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PUBLIC="$ROOT/website/public"
APK_PATH="$PUBLIC/simple-prayer.apk"
META_PATH="$ROOT/website/src/apk.generated.json"
PROFILE="production-apk"

mode="build"
url=""
while [ $# -gt 0 ]; do
  case "$1" in
    --latest) mode="latest"; shift ;;
    --url) mode="url"; url="${2:?--url needs an artifact URL}"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 1 ;;
  esac
done

cd "$ROOT"

case "$mode" in
  build)
    echo "==> building the APK on EAS (profile $PROFILE)"
    bunx eas build --profile "$PROFILE" --platform android --non-interactive
    ;;
  latest)
    echo "==> using the newest finished $PROFILE build"
    ;;
  url)
    echo "==> using the artifact URL given"
    ;;
esac

if [ "$mode" != "url" ]; then
  # `--json` needs `--non-interactive`; the newest finished build for this profile wins.
  url="$(bunx eas build:list --platform android --status finished --limit 20 --json \
        --non-interactive 2>/dev/null \
        | python3 -c "
import json, sys
builds = json.load(sys.stdin)
for b in builds:
    if b.get('buildProfile') == '$PROFILE':
        print((b.get('artifacts') or {}).get('applicationArchiveUrl') or '')
        break
")"
fi

[ -n "$url" ] || { echo "no APK artifact found — build one first" >&2; exit 1; }

echo "==> downloading $url"
mkdir -p "$PUBLIC"
curl -fL --progress-bar "$url" -o "$APK_PATH"

# The page states the version and size, so both are read from the artifact rather than typed.
VERSION="$(python3 -c "
import json
print(json.load(open('$ROOT/app.json'))['expo']['version'])
")"
BYTES="$(wc -c < "$APK_PATH" | tr -d ' ')"
MB="$(python3 -c "print(f'{$BYTES / 1000 / 1000:.0f}')")"

python3 - "$META_PATH" "$VERSION" "$MB" <<'PY'
import json
import sys

path, version, mb = sys.argv[1], sys.argv[2], sys.argv[3]
# Written by scripts/publish-apk.sh — never edited by hand.
json.dump({'version': version, 'sizeMb': int(mb), 'file': '/simple-prayer.apk'},
          open(path, 'w'), indent=2)
open(path, 'a').write('\n')
print(f'wrote {path}: {version}, {mb} MB')
PY

echo "==> $APK_PATH ($MB MB, version $VERSION)"
echo "Now rebuild the site (cd website && bun run build) so the download button picks it up."
