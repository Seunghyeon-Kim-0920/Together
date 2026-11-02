# Security dependency maintenance

## v1.8.17 (2026-11-02)

The production dependency audit for v1.8.16 detected vulnerable versions. The v1.8.17 dependency patch keeps application behavior and Firebase 12.19.0 unchanged:

| Component | Patched version |
| --- | --- |
| Capacitor Android, iOS, Core, CLI | 8.5.1 |
| DOMPurify (via jsPDF) | 3.4.17 |
| RE2JS (via Firestore) | 2.8.7 |
| grpc-js (via Firestore) | 1.13.6 |

Capacitor packages are pinned together. The Swift PM declaration also uses 8.5.1; an iOS source update is not an IPA build or device verification.

The overrides in package.json are deliberately scoped to their parent dependency. Firestore 4.17.2 declares grpc-js `~1.9.0`, which does not include the security fix. The scoped 1.13.6 override stays in grpc-js major version 1 and retains proto-loader major/minor 0.7. It requires the local Firestore emulator integration tests to pass before release. The app does not run a gRPC server; Firestore's browser entry does not use its Node gRPC transport. This does not justify leaving a vulnerable Node dependency installed.

DOMPurify 3.4.17 and RE2JS 2.8.7 remain within their parents' declared ranges. Do not use `npm audit fix --force` to downgrade Firebase, omit the audit, or lower its severity threshold to conceal a failure. Revisit the grpc-js override when Firebase changes its declared dependency.

Release gates: production npm audit at moderate severity; lint/typecheck and application tests; local Firestore emulator tests; web build and native sync; Android unit tests; original signing certificate, package/version, packaged assets and bundle validation. Local and GitHub signed-release build scripts run the audit before packaging. The local release verifier requires both audit and build success markers for the current version. No audit guarantees the absence of undiscovered vulnerabilities or replaces real-device testing.

Firestore emulator 1.22.0 on this Windows/JDK installation needs process-local JVM options `-Duser.language=en -Duser.country=US`: its Korean rule-validation message bundle is missing and can otherwise strand a transaction. Use those options for the local emulator only; do not change application timeouts, rules or users' language settings. The full 28-test emulator suite passed with the security-patched dependency tree and those JVM options.

### Upstream advisories

- [Capacitor](https://github.com/advisories/GHSA-rvm3-566m-v7fv)
- [grpc-js certificate authentication](https://github.com/advisories/GHSA-m9gg-hp2v-232j)
- [grpc-js error disclosure](https://github.com/advisories/GHSA-f596-whhp-79r4)
- [DOMPurify detached-node handling](https://github.com/advisories/GHSA-mrv2-3pqr-j5jr)
- [DOMPurify XHTML handling](https://github.com/advisories/GHSA-c6gr-qvv4-5v3f)
- [RE2JS lookbehind matching](https://github.com/advisories/GHSA-gg6h-894w-4m9c)
