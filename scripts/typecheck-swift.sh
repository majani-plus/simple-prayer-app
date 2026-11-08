#!/usr/bin/env bash
# Type-check every Swift target, which `swiftc -parse` does not.
#
# `-parse` only checks syntax, so a call passing an argument the callee does not declare sails
# through it and dies in `xcodebuild` twenty minutes into an EAS build. That is exactly what
# happened: `buddies` was added to ScheduleColumn and read in ScheduleRow, parse-checked clean,
# and failed the archive. Same idea as the Kotlin rule in CLAUDE.md — the cheap check local, so
# the expensive one never finds it.
#
# No Xcode (Linux CI) means no check, not a failure: CI already runs typecheck/lint/test, and the
# Swift here is only ever built on a Mac.
set -euo pipefail

if ! command -v xcrun >/dev/null 2>&1; then
  echo "typecheck-swift: no xcrun, skipping (not a Mac)"
  exit 0
fi

cd "$(dirname "$0")/.."

ios_sdk=$(xcrun --sdk iphoneos --show-sdk-path)
watch_sdk=$(xcrun --sdk watchos --show-sdk-path)
status=0

check() {
  local name=$1 sdk=$2 triple=$3
  shift 3
  printf '  %-22s' "$name"
  if xcrun swiftc -typecheck -sdk "$sdk" -target "$triple" "$@" >"/tmp/typecheck-swift-$name.log" 2>&1; then
    echo 'ok'
  else
    echo 'FAILED'
    grep 'error:' "/tmp/typecheck-swift-$name.log" | head -10 || true
    status=1
  fi
}

echo 'Type-checking Swift targets:'
check widget       "$ios_sdk"   arm64-apple-ios17.0        targets/widget/*.swift
check notify       "$ios_sdk"   arm64-apple-ios16.4        targets/notify/*.swift
check watch        "$watch_sdk" arm64_32-apple-watchos10.0 targets/watch/*.swift
check watch-widget "$watch_sdk" arm64_32-apple-watchos10.0 targets/watch-widget/*.swift

exit "$status"
