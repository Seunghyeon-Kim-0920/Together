# Together

Together is a multilingual multi-city travel planner. It compares complete door-to-door travel time across available transport modes, proposes an efficient city order, creates shareable itineraries and PDFs, stores private trips, and tracks group expenses.

The interface supports Korean, English, French, Japanese, and Chinese. The project runs as a responsive website and installable PWA, and includes a reproducible workflow for a signed Android APK/App Bundle using a Trusted Web Activity (TWA).

## Current implementation status

This repository is an early product implementation, not a production travel booking system.

- Route optimization, transport alternatives, share links, PDF export, profiles, saved trips, expense categories, and equal splits have UI and domain implementations.
- Protected records use the authenticated user's server-side identity and Cloudflare D1 storage.
- Global city search uses the no-key Open-Meteo Geocoding endpoint backed by GeoNames for the current non-commercial beta. Search results include provider attribution, and dynamic city coordinates/time zones are validated again before routing.
- Rail and coach options for up to four selected cities are checked against Transitous/MOTIS public timetables with bounded concurrency, cancellation, caching, and a 12-second batch deadline. Coverage is best-effort and provider/source specific.
- Flights remain explicitly labelled planning estimates. They include modeled city-to-airport, check-in/security, air time, operational buffer, and airport-to-city time, but do not claim a live flight exists or that the result is a measured historical average.
- The public web build is deployed at `https://together-travel-0920.ocvi-85.chatgpt.site`. Production authentication-backed CRUD still needs a real signed-in-account verification pass; monitoring, a privacy policy, and broader security/accessibility testing remain pre-launch work.
- Android source and automation target v0.2.0 (version code 2) for `com.together.travel`. The release certificate remains linked to the deployed origin through `public/.well-known/assetlinks.json`; signing material must never enter Git.

## Local development

Prerequisites: Node.js 22.13 or newer.

```bash
npm ci
npm run dev
```

Open the local URL printed by vinext. Local D1 behavior is configured by `vite.config.ts`; apply the migrations in `drizzle/` before testing persistent profile, trip, and expense APIs.

Useful verification commands:

```bash
npm run pwa:check
npm run typecheck
npm run lint
npm test
```

`npm test` performs a production build plus domain and rendered-HTML tests.

## PWA behavior

The web manifest contains regular 192 px and 512 px icons, a dedicated maskable icon, standalone display metadata, and a stable root application ID. The production-only service-worker registration is intentionally small.

The service worker caches versioned static assets and provides a minimal offline page. It never caches API, authentication, or user-specific HTML responses, so saved private data is not exposed through a shared browser cache. Trip editing still requires a network connection.

Validate a deployed build as well as the local files with:

```bash
npm run pwa:check -- https://your-production-domain.example
```

## Android APK / App Bundle

Android packaging uses Bubblewrap and a Trusted Web Activity, so the Android app loads the same deployed HTTPS PWA rather than carrying a second, divergent frontend. `android/twa-manifest.template.json` is source-controlled; generated Gradle files and signing files are ignored. Verified, versioned APK/AAB deliverables are intentionally published under `release/`.

The current release is documented in `release/README.md`. Android v0.2.0 uses version code 2, minimum SDK 23, target/compile SDK 36, and package ID `com.together.travel`. The APK certificate SHA-256 must match the checked-in Digital Asset Links statement.

Configure these GitHub repository secrets:

| Secret | Purpose |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | Base64-encoded release keystore |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password |
| `ANDROID_KEY_ALIAS` | Signing-key alias |
| `ANDROID_KEY_PASSWORD` | Signing-key password |

Then run the **Build signed Android APK** workflow manually with the deployed site URL, monotonically increasing version code, version name, and package ID. The workflow:

1. validates the live HTTPS PWA;
2. restores the signing key only on the ephemeral runner;
3. generates and builds the TWA project;
4. uploads the signed APK/App Bundle, checksums, and `assetlinks.json` as a private workflow artifact.

After each signing-key change, publish the generated `assetlinks.json` at:

```text
https://together-travel-0920.ocvi-85.chatgpt.site/.well-known/assetlinks.json
```

Redeploy the website before distributing the APK. The certificate fingerprint, Android package ID, and deployed Digital Asset Links statement must match; otherwise Android opens the site as a Custom Tab instead of a verified TWA.

For a configured local Android toolchain, the manifest preparation step is:

```powershell
$env:TOGETHER_SITE_URL = "https://your-production-domain.example"
$env:ANDROID_PACKAGE_ID = "com.together.travel"
$env:ANDROID_VERSION_CODE = "2"
$env:ANDROID_VERSION_NAME = "0.2.0"
$env:ANDROID_KEY_ALIAS = "together-release"
npm run android:prepare
```

Do not commit a keystore, passwords, generated Android project files, unsigned Android outputs, `.env` files, or local logs. Only verified, signed, versioned APK/AAB deliverables belong under `release/`.

## Deployment and storage

`.openai/hosting.json` declares the deployed Sites project and D1 binding. Database migrations are checked in; authenticated production CRUD must still be verified with a real account. Public share snapshots must not include private profile data or expense records.

GitHub Actions CI validates the PWA contract, TypeScript, lint, production build, and tests on pull requests and `main`.

## Repository safety

The repository ignores local logs, TypeScript build caches, Cloudflare/vinext output, generated Android projects, signing material, and unversioned Android outputs. Versioned deliverables under `release/` are deliberately tracked. Before publishing, inspect `git status`, staged files, and the remote destination; never use a blanket commit if unrelated or sensitive files are present.
