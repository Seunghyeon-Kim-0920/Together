# Official bank synchronization

## Current status in v1.5.1

This release contains a tested, read-only transaction validation and preview foundation only. It has no live provider account, backend, OAuth consent UI, background synchronization, or database apply path, so transactions without notifications are not synchronized in v1.5.1. The automation screen now explicitly shows this disconnected state and links to existing statement-file import. Notification recovery and file import do not establish a bank connection. The flow below is the required target architecture, not an active user feature.

Wallet Diary must not read or automate another bank app's private screen or local database. Android isolates each app, and accessibility-based scraping is neither a reliable transaction source nor an acceptable production design for sensitive financial data.

Transactions that do not generate notifications require a consent-based Open Banking connection:

1. The user chooses a supported bank in Wallet Diary.
2. A backend creates a connection with a licensed account-information provider.
3. The provider hosts bank authentication and consent. Wallet Diary never receives a bank password or OTP.
4. The backend periodically requests account transactions within the bank's rate limit.
5. Only booked outgoing debits are normalized and offered to the app.
6. The app previews the date range, counts, exclusions, failures, and currency totals before the first import.
7. Repeated synchronization upserts by provider, connection, account, and transaction ID, preserving user edits.

## Transaction rules

- Include booked card purchases, outgoing transfers, executed direct debits, and executed standing orders.
- Exclude incoming transfers, balances, pending or scheduled instructions, failed or declined transactions, and returned or reversed transactions.
- Exclude verified transfers between the user's own connected accounts. If ownership is ambiguous, require review rather than recording an expense automatically.
- Never remove an expense from a guessed merchant-and-amount match. A reversal needs the provider's stable transaction ID or an explicit linked transaction ID.
- Keep the booked account amount and currency. Do not invent an exchange rate for another ledger.
- Do not include provider names, account numbers, access tokens, or raw transaction IDs in descriptions, PDFs, or shared ledger files.

## Deployment requirements

- A production account with an Open Banking provider. Enable Banking's restricted production linked-account flow is the initial personal EEA/France candidate. The user's own linked accounts can qualify for personal-use access; public multi-user access requires a separate agreement. Additional regional providers are required for broader coverage.
- A backend with encrypted provider credentials and per-user authorization. Provider secrets must never be bundled in the APK.
- OAuth callback URLs, a privacy policy, connection revocation and data deletion, Google Play Data safety disclosures, and the Financial features declaration.
- Background synchronization that handles consent expiry, rate limits, partial failures, pagination, and the 5,000-expense ledger limit without silent loss.

No provider supports every bank worldwide. The app should show the live supported-institution list and keep statement-file import as a fallback for unsupported banks.

## Enable Banking adapter requirements

- Check the current institution list with the France country filter before promising a particular Revolut account is supported.
- Require the owner to create a production application and complete the provider's account-linking bank authentication. The owner reported on 2026-09-05 that they do not yet have a provider account. No credentials or backend are configured in this repository.
- Normalize `entry_reference` and the account's `identification_hash` into durable application identities. Provider `transaction_id`, session ID and account UID can change across refresh or renewed consent and must not become the persistent deduplication key.
- Keep the provider signing key on a secured backend. The APK must never receive an application credential that grants access to other connections.
- The current removal preview is not an accounting apply implementation. Full cancellation and partial refund must be distinguished using the linked settled amount: a 20 EUR refund on a 100 EUR expense must never remove the whole 100 EUR expense.
- Raw provider descriptions and references are not suitable display labels. Supply sanitized merchant/counterparty names and localize generic fallback names in the app before activation.

Official references: [linked accounts](https://enablebanking.com/docs/api/linked-accounts), [terms](https://enablebanking.com/terms/), [transaction identity FAQ](https://enablebanking.com/docs/faq/), [Revolut integration countries](https://enablebanking.com/blog/2025/11/05/enable-banking-changelog-october-2025).
