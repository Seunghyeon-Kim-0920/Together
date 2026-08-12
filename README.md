# Together

Together is a multilingual multi-city travel planner. It compares city-to-city time for trains and coaches with complete door-to-door time for flights, proposes an efficient city order, creates shareable itineraries and PDFs, stores trips in the current browser, and tracks group expenses.

The interface supports Korean, English, French, Japanese, and Chinese. The project runs as a responsive website and installable PWA, and includes a reproducible workflow for a signed Android APK/App Bundle using a Trusted Web Activity (TWA).

## Current implementation status

This repository is an early product implementation, not a production travel booking system.

- Route optimization, transport alternatives, share links, PDF export, profiles, saved trips, expense categories, and equal splits have UI and domain implementations.
- Trips, profiles, participants, and expenses are stored without login in the current browser's local storage. They are not synchronized to another browser or device and can be lost if browser storage is cleared.
- Global city search uses the no-key Open-Meteo Geocoding endpoint backed by GeoNames for the current non-commercial beta. Search results include provider attribution, and dynamic city coordinates/time zones are validated again before routing.
- City lists have no product-level count cap. Routes with up to 10 cities use exact optimization; larger lists use a deterministic scalable approximation while preserving the chosen start and end cities.
- Rail and coach options are checked against Transitous/MOTIS public timetables with bounded concurrency, cancellation, caching, a maximum of 12 provider pair lookups per request, and a 12-second batch deadline. Pairs outside that free-provider budget use clearly labelled regional planning estimates. Coverage is best-effort and provider/source specific.
- Flights remain explicitly labelled planning estimates. They include modeled city-to-airport, check-in/security, air time, operational buffer, and airport-to-city time, but do not claim a live flight exists or that the result is a measured historical average.
- The public web build is deployed at `https://together-travel-0920.ocvi-85.chatgpt.site`. Monitoring, a privacy policy, provider-capacity planning, and broader security/accessibility testing remain pre-launch work.
- Android source and automation target v0.3.0 (version code 3) for `com.together.travel`. The release certificate remains linked to the deployed origin through `public/.well-known/assetlinks.json`; signing material must never enter Git.

## Local development

Prerequisites: Node.js 22.13 or newer.

```bash
npm ci
npm run dev
```

Open the local URL printed by vinext. The product UI persists profiles, trips, participants, and expenses in browser storage. `vite.config.ts`, the D1 binding, and migrations under `drizzle/` remain for legacy private API compatibility but are not used by the login-free UI.

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

The service worker caches versioned static assets, including the local Natural Earth map, and provides a minimal offline page. It never caches API responses or browser-local profile, trip, participant, and expense records. Saved records can be viewed and edited without a network connection; live city search and timetable checks still require one.

Validate a deployed build as well as the local files with:

```bash
npm run pwa:check -- https://your-production-domain.example
```

## Android APK / App Bundle

Android packaging uses Bubblewrap and a Trusted Web Activity, so the Android app loads the same deployed HTTPS PWA rather than carrying a second, divergent frontend. `android/twa-manifest.template.json` is source-controlled; generated Gradle files and signing files are ignored. Verified, versioned APK/AAB deliverables are intentionally published under `release/`.

The current release is documented in `release/README.md`. Android v0.3.0 uses version code 3, minimum SDK 23, target/compile SDK 36, and package ID `com.together.travel`. The APK certificate SHA-256 must match the checked-in Digital Asset Links statement.

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
$env:ANDROID_VERSION_CODE = "3"
$env:ANDROID_VERSION_NAME = "0.3.0"
$env:ANDROID_KEY_ALIAS = "together-release"
npm run android:prepare
```

Do not commit a keystore, passwords, generated Android project files, unsigned Android outputs, `.env` files, or local logs. Only verified, signed, versioned APK/AAB deliverables belong under `release/`.

## Deployment and storage

`.openai/hosting.json` declares the deployed Sites project and its legacy D1 binding. The current login-free product UI stores private records only in the current browser. Public share snapshots include an itinerary only and must not include profile data, participants, or expense records.

GitHub Actions CI validates the PWA contract, TypeScript, lint, production build, and tests on pull requests and `main`.

## Repository safety

The repository ignores local logs, TypeScript build caches, Cloudflare/vinext output, generated Android projects, signing material, and unversioned Android outputs. Versioned deliverables under `release/` are deliberately tracked. Before publishing, inspect `git status`, staged files, and the remote destination; never use a blanket commit if unrelated or sensitive files are present.
