# iOS native inbox checks (Mac)

The standard Mac gate `npm run ios:check` compiles and runs these checks before
the unsigned iOS build. It stops on a failure; it does not sign or install the app.

To run only the inbox checks from the repository root on a Mac with Xcode selected:

```sh
build_dir="$(mktemp -d -t wallet-inbox-check)"
xcrun swiftc -swift-version 5 -parse-as-library \
  ios/App/App/IOSAutomationInbox.swift ios/Tests/IOSAutomationInboxChecks.swift \
  -o "$build_dir/inbox-checks"
"$build_dir/inbox-checks"
```

Only synthetic data is used, in a freshly allocated temporary directory. The executable checks consent, scope revocation, persisted reopen, token-safe acknowledgements, exact decimal-string preservation, UTF-16 bounds, TypeScript/Swift source identifiers, concurrent writes and corrupt-file protection. It never opens or changes the real wallet database.

These host checks are **not** an iOS build or a device test. Also build `ios/App/App.xcodeproj` in Xcode and verify App Intent discovery, notifications/SMS/Wallet variable mapping, first-run permissions, device lock/restart, delayed inbox processing, opt-out, duplicate/refund handling, budget permissions and PDF/OCR on an iPhone. The capture actions save a local inbox while the app is closed; the shared TypeScript ledger pipeline processes it when the app opens. There is no claim that an expense or budget is updated while the app is closed.

Use the device checklist in `docs/IOS_PERSONAL_INSTALL_KO.md`, including household /
utilities / telecommunications categories and remembered merchant descriptions.
Preserve the exact build output when a check fails, but never include Apple
credentials, signing keys, raw bank notifications or personal statement files.
