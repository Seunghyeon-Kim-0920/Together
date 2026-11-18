#!/bin/bash
# Read/build validation only: never signs, installs, publishes, or edits accounts.
set -euo pipefail
if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Run this check on a Mac with Xcode. Windows cannot validate an iOS build."
  exit 1
fi
task_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$task_root"
command -v node >/dev/null
command -v npm >/dev/null
xcodebuild -version
xcrun --find swiftc >/dev/null
xcrun --sdk iphoneos --show-sdk-version
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 22 || (major === 22 && minor < 13)) { console.error("Node.js 22.13 or later is required."); process.exit(1); }'
npm ci
npm test
npm run lint
npm run ios:sync
task_build_dir="$(mktemp -d "${TMPDIR:-/tmp/}wallet-diary-ios-check.XXXXXX")"
echo "Native host checks and unsigned build output: $task_build_dir"
# Compile the same inbox used by the iPhone app against host Foundation.
# This uses only the synthetic temporary-directory fixtures, not a real ledger.
xcrun swiftc -swift-version 5 -parse-as-library \
  ios/App/App/IOSAutomationInbox.swift ios/Tests/IOSAutomationInboxChecks.swift \
  -o "$task_build_dir/inbox-checks"
"$task_build_dir/inbox-checks"
echo "Native inbox host checks passed. iPhone behavior is still unverified."
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug \
  -destination 'generic/platform=iOS' -derivedDataPath "$task_build_dir/DerivedData" \
  CODE_SIGNING_ALLOWED=NO build
echo "Unsigned iOS build passed. This is NOT an installable signed IPA."
echo "Next: open Xcode, choose your Personal Team and connected iPhone, and run the device checklist."
