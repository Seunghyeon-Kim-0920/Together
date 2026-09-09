# Wallet Diary · Pocket journal

## Design source
The image-generated `daily-overview-concept.png` is the primary layout reference. `secondary-screens-concept.png` extends the same system to statistics and travel settlement. `brand-symbol.png` combines a wallet, paper pages and a coral bookmark. Sample people and amounts in these images are fictional design fixtures, never application defaults.

## Visual system
- Paper background #F7F8FC; white cards; ink #17233B; muted ink #66738C; border #E5EAF4.
- Cobalt #3555D5 primary, #2945AE pressed, #EDF1FF tint. Coral #FF8066 is a limited accent, not body text.
- 20px major card corners, 12px controls, 16px screen gutters; 44px minimum touch targets. Display money 38–42px, headings 24px, body 14–16px, secondary 12–13px. Tabular numbers.
- Compact branded header, horizontal notebooks about 170px wide with visible next notebook. Selected notebook is cobalt. Keep add/menu operations.
- Lucide outline icons for actions/categories. Raster brand symbol is an actual asset, not a full-screen screenshot. No decorative emoji.

## Information architecture
- Daily: heading and PDF save → Summary / Entries / Statistics segments → direct month input and previous/next → active content. Summary: blue monthly spend + both comparisons, compact budget/automation cards, recent 3 entries, View all. Entries: category filtering + full editable list with delete/move. Statistics: monthly/yearly charts and both monthly/yearly category amounts. Preserve all existing financial calculations.
- Travel: heading + PDF save, blue multi-currency total, Entries / Settle up / People segments, compact PDF share / Merge entries toolbar. Entries retain category filter, edit/delete. Settle up retains currency-specific debts. People retains local-currency management and me-selection. Zero participants has a clear add-people action. Never fabricate participants.
- Large bottom expense CTA with safe-area spacing. Long sheets retain all existing functionality. Modal focus is trapped; Escape closes; focus restores.
- New notebook: daily first/default; equally clear travel option and concise purpose explanations.
- KO/EN/FR UI strings complete. User-entered names/merchants stay unchanged. No claims of universal bank support or cloud sync.

## Fidelity checks
Compare generated concepts and rendered app: (1) cobalt/paper palette, (2) compact notebook/header hierarchy, (3) big spend + secondary comparison hierarchy, (4) restrained rounded white surfaces and readable rows, (5) persistent accessible add action. The generated layout is adapted only for real data, localization, accessibility and existing functions (e.g. cannot conflate currencies). Verify 360px and 390px layouts and all three languages.

## Implementation notes
- The real UI uses flat cobalt (rather than the image's subtle texture), with the generated dimensional symbol as the actual brand asset. This keeps figures crisp.
- 44px interactive targets and full French copy take more room than the illustration; the screen scrolls, while sections keep each task close. Native picker chrome follows the OS, but the visible month label follows the chosen app language.
- PDF save and PDF share remain distinct actions. Currencies are shown separately, never summed without a rate. Existing financial formulas and private storage remain intact.
- Service permission is not described as a healthy connection: the automation summary and settings now expose disconnected state and recovery separately.
