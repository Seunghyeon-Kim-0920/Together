# v1.7.3 acceptance notes

## Scope

- Suggest notification categories from merchant and payment words locally.
- Prefer saved user merchant/category choices over automatic guesses, including after a restart, rename, move or deletion of the original expense.
- Repair labelled PDF geometry and fragmented dates/amounts; test the user-provided Swile statement and retain the Revolut regression.
- Offer inclusive start/end dates for a general-ledger PDF, filtering both the report and its embedded ledger attachment.
- Require review when a payment app is linked to a ledger in another currency, even if the app is also trusted for a matching-currency ledger. Do not convert amounts automatically.

## Verified before packaging

- JavaScript: the initial 170-test suite passed. Independent review identified a legacy manual-vs-automatic category priority bug; it was fixed and a regression test added for the final 171-test run.
- Notification parser/category helper: 43 JVM tests passed. Complete Android project packaging tests: 74 passed, zero failures/errors.
- ICU: 64 expressions compiled, 30 matching fixtures passed; the former unsupported-pattern negative control was rejected as intended.
- Swile: source transaction rows, dates, exact merchant text and debit amounts matched the provided PDF. Credit and per-row balances were excluded; no blank review rows. Financial values, the original statement and personal identifiers are not published here.
- Revolut: existing multi-page real-statement regression passed, including separate income and reverted sections; no missing date/merchant fields.
- KB-style synthetic fixtures: vertically wrapped Korean headings, split minus signs/punctuation, currency units, short-year dates with an explicit statement year, and missing-year review protection. **No actual KB source file was available for verification.**
- Rendered browser: an expense category was edited and saved, reloaded, and inherited by the next synthetic payment. Duplicate replay retains user edits.
- Integrated general-ledger PDF: selected dates produced only the included expense in the embedded attachment; private merchant preferences and trusted-app configuration were absent.
- Date-range sheet: all/custom dates, inclusive boundaries, leap date, reversed-date rejection, empty range, canceled/failed save retaining choices, save/close locks, KO/EN/FR, 360/390/1280px. Generated PDF was rendered and visually checked.
- Actual Swile file was uploaded into an isolated browser review screen and all debit fields verified. No real transactions were committed to a ledger during QA.
- Trusted foreign-currency review UI: blocked from an incompatible EUR ledger, retained for explicit review in a trusted USD ledger, saved only after confirmation with its original amount. KO/EN/FR explanations passed.
- Previous-release UI regressions also passed: partial/full-refund confirmation and idempotent reimport, budget save-failure retry, month/year/category statistics, localized offline privacy, corrupted-storage protection.
- Browser plugin was unavailable; installed Playwright with Chromium 149.0.7827.55 was used against a task-owned local Vite server. No application runtime errors in the successful flows.

## Constraints

- Category suggestions are heuristics, not guaranteed merchant-category-code data. Users may edit them; user choices remain on-device and are excluded from shared ledger/PDF attachments.
- A source linked to multiple ledger currencies is handled conservatively: differing assignments trigger manual review. Same-currency single assignments retain automatic insertion.
- For pre-upgrade data without explicit category preferences, manual entries and reviewed imports take priority over newer automatic card guesses. Old edits made directly to an automatically created row have no category-edit provenance, so they cannot always be distinguished. New saves record that preference explicitly.
- Unknown or unlabelled PDFs can still require column mapping, OCR, password entry or manual correction. This is not a promise to parse every bank's format.
- Browser/JVM/ICU tests do not prove Android notification delivery, Samsung background-service behavior, permission recovery or another app's share handling on every phone.
- No silent bank-account synchronization was added. Transactions that never generate notifications still need a supported file import or a separately authorized bank integration.
- The release remains a prerelease/internal-test candidate. It is not a claim that Play Console or all production-release requirements have been approved.
- Existing signing credentials are reused; no user data migration deletes records. Back up important ledgers before updating and do not uninstall the app merely to update it.

## Packaging verification

Run `scripts/build-android.ps1`, then `scripts/verify-android.ps1` against the returned build directory. Only the separately verified APK/AAB are copied into `release/`. The verifier checks the current source snapshot, package/version, existing certificate, packaged web/PDF assets, 16 KB native-library alignment, AAB signature and bundle structure. Final hashes belong in `release/SHA256SUMS.txt`.
