import assert from "node:assert/strict";
import test from "node:test";
import { categoryMerchantKey, createCategoryResolver, inferGeneralCategory, rememberMerchantCategory } from "../src/lib/categoryInference";
import { applyHighConfidenceCardAutomation, confirmCardCandidate, parseNativeCardCandidate, type NativeCardCandidate } from "../src/lib/cardAutomation";
import { createLedger, mergeGeneralLedgerMutation, parseLedger, parseWalletStateStrict } from "../src/lib/wallet";
import { createLedgerSharePayload, parseLedgerSharePayload } from "../src/lib/share";
import type { GeneralCategory, GeneralExpense, GeneralLedger, WalletState } from "../src/lib/types";

const candidate: NativeCardCandidate = { id: "learn-1", queueToken: "token-1", packageName: "com.example.bank", sourceName: "Example bank", merchant: "Lidl Paris", currency: "EUR", minorUnits: 1000, occurredAt: "2026-09-01T12:00:00+02:00", occurredOn: "2026-09-01", confidence: "high", manualOnly: false, eventType: "purchase" };
function ledger(currency = "EUR"): GeneralLedger { return { ...createLedger("general", "Test", currency), automationSources: [{ packageName: candidate.packageName, displayName: "Test", trustedDirectApp: true }] }; }
function wallet(...ledgers: GeneralLedger[]): WalletState { return { version: 2, locale: "ko", activeLedgerId: ledgers[0].id, ledgers }; }
function expense(description = "Lidl Paris", category: GeneralCategory = "shopping", id = "edited"): GeneralExpense { return { id, description, category, currency: "EUR", minorUnits: 1234, occurredOn: "2026-08-01" }; }
function general(state: WalletState, index = 0): GeneralLedger { const item = state.ledgers[index]; assert.equal(item.kind, "general"); return item as GeneralLedger; }

test("category suggestions understand multilingual merchants and specific brands", () => {
  const cases: [string, GeneralCategory][] = [["Uber Eats", "food"], ["Uber trip", "transport"], ["Amazon Prime", "subscriptions"], ["Amazon marketplace", "shopping"], ["PHARMACIE DU CENTRE", "health"], ["Café Étoile", "food"], ["월세 이체", "housing"], ["한국전력 전기요금", "utilities"], ["스타벅스 강남점", "food"], ["서울약국", "health"], ["SNCF CONNECT", "transport"], ["Université test", "education"], ["NETFLIX.COM", "subscriptions"], ["博物館 超市", "food"], ["Unidentified XYZ", "other"]];
  for (const [name, category] of cases) assert.equal(inferGeneralCategory(name), category, name);
  assert.equal(inferGeneralCategory("Unidentified XYZ", "food"), "food");
  assert.equal(inferGeneralCategory("Pharmacie", "food"), "health");
});

test("merchant matching normalizes accents and wallet wrappers without merging branches", () => {
  assert.equal(categoryMerchantKey("Google Pay * Café Étoile"), categoryMerchantKey("CAFE ETOILE"));
  assert.equal(categoryMerchantKey("Samsung Pay: LIDL Paris"), categoryMerchantKey("lidl paris"));
  assert.notEqual(categoryMerchantKey("Lidl Paris 1"), categoryMerchantKey("Lidl Paris 2"));
});

test("explicit correction wins over a newer automatic guess, across ledgers and restarts", () => {
  const old = expense(); const newer = { ...expense("Lidl Paris", "food", "auto"), occurredOn: "2026-09-01" };
  const learned = rememberMerchantCategory({ ...ledger(), expenses: [old, newer] }, old, old);
  const restored = parseWalletStateStrict(JSON.parse(JSON.stringify(wallet(learned, ledger())))); assert.ok(restored);
  assert.equal(createCategoryResolver(restored.ledgers)("LIDL PARIS", restored.ledgers[1].id, "food"), "shopping");
  const noExpenses = { ...general(restored), expenses: [] };
  assert.equal(createCategoryResolver([noExpenses])("Lidl Paris", noExpenses.id), "shopping");
});

test("existing pre-upgrade category is reused without a preference migration", () => {
  const existing = { ...ledger(), expenses: [expense()] };
  const result = applyHighConfidenceCardAutomation(wallet(existing), [candidate]);
  assert.equal(result.insertedIds.length, 1); assert.equal(general(result.state).expenses[1].category, "shopping");
  assert.equal(general(result.state).merchantCategoryPreferences, undefined);
});

test("legacy manual category beats a newer automatic guess before preferences existed", () => {
  const oldManual = expense("Lidl Paris", "shopping", "manual-before-upgrade");
  const newerAutomatic = { ...expense("Lidl Paris", "food", "card-auto-newer"), occurredOn: "2026-09-01" };
  const before = { ...ledger(), expenses: [oldManual, newerAutomatic] };
  const next = { ...candidate, id: "legacy-future", occurredOn: "2026-09-02", occurredAt: "2026-09-02T12:00:00+02:00" };
  const result = applyHighConfidenceCardAutomation(wallet(before), [next]);
  assert.equal(general(result.state).expenses[2].category, "shopping");
  assert.equal(createCategoryResolver([before, ledger()])("Lidl Paris", "another-ledger"), "shopping");
  const source = { ...ledger(), expenses: [oldManual] };
  const target = { ...ledger(), expenses: [newerAutomatic] };
  assert.equal(createCategoryResolver([source, target])("Lidl Paris", target.id), "shopping", "a target ledger's automatic guess cannot override another ledger's manual choice");
});

test("manual, automatic, revised-identity confirmations reuse user categories", () => {
  const existing = rememberMerchantCategory(ledger(), expense(), expense());
  const state = wallet(existing);
  const auto = applyHighConfidenceCardAutomation(state, [candidate]);
  assert.equal(general(auto.state).expenses[0].category, "shopping");
  const manual = confirmCardCandidate(state, existing.id, { ...candidate, confidence: "review" });
  assert.equal(general(manual.state).expenses[0].category, "shopping");
  const revision = { ...candidate, minorUnits: 2000, queueToken: "token-2", identityConflict: true };
  const revised = confirmCardCandidate(auto.state, existing.id, revision, { asNewTransaction: true });
  assert.equal(general(revised.state).expenses[1].category, "shopping");
  assert.equal(applyHighConfidenceCardAutomation(revised.state, [revision]).insertedIds.length, 0);
});

test("notification hints are bounded enums and never affect payment identity or edits", () => {
  const hinted = parseNativeCardCandidate({ ...candidate, merchant: "Unknown XYZ", categoryHint: "transport", rawText: "PRIVATE" }); assert.ok(hinted);
  assert.equal(hinted.categoryHint, "transport"); assert.equal("rawText" in hinted, false);
  assert.equal(parseNativeCardCandidate({ ...candidate, categoryHint: "PRIVATE" })?.categoryHint, undefined);
  const initial = applyHighConfidenceCardAutomation(wallet(ledger()), [hinted]);
  assert.equal(general(initial.state).expenses[0].category, "transport");
  const edited = { ...general(initial.state), expenses: [{ ...general(initial.state).expenses[0], category: "health" as const }] };
  const replay = applyHighConfidenceCardAutomation(wallet(edited), [{ ...hinted, categoryHint: "food" }]);
  assert.equal(replay.state.ledgers[0].expenses[0].category, "health"); assert.equal(replay.pending.length, 0);
});

test("outgoing transfers and direct debits infer categories too", () => {
  for (const eventType of ["outgoing_transfer", "direct_debit", "standing_order"] as const) {
    const result = applyHighConfidenceCardAutomation(wallet(ledger()), [{ ...candidate, eventType, merchant: "Loyer appartement" }]);
    assert.equal(general(result.state).expenses[0].category, "housing");
  }
});

test("concurrent ledger saves preserve both user preferences and incoming payments", () => {
  const base = ledger(); const first = expense(); const second = expense("Pharmacie", "health", "second");
  const latest = { ...rememberMerchantCategory(base, first), expenses: [first] };
  const desired = { ...rememberMerchantCategory(base, second), expenses: [second] };
  const merged = mergeGeneralLedgerMutation(base, desired, latest);
  assert.equal(merged.expenses.length, 2); assert.equal(merged.merchantCategoryPreferences?.length, 2);
  assert.equal(createCategoryResolver([merged])("Lidl Paris", merged.id), "shopping");
  assert.equal(createCategoryResolver([merged])("Pharmacie", merged.id), "health");
  assert.equal(mergeGeneralLedgerMutation(base, { ...base, monthlyLimitMinor: 2000 }, merged).merchantCategoryPreferences?.length, 2);
});

test("learning retains original merchant alias after user renames a recorded merchant", () => {
  const auto = general(applyHighConfidenceCardAutomation(wallet(ledger()), [candidate]).state);
  const before = auto.expenses[0]; const changed = { ...before, description: "Family weekly shop", category: "shopping" as const };
  const learned = rememberMerchantCategory(auto, changed, before);
  const resolve = createCategoryResolver([learned]);
  assert.equal(resolve("Lidl Paris", auto.id), "shopping"); assert.equal(resolve("Family weekly shop", auto.id), "shopping");
});

test("category preferences stay private in exports and untrusted imports", () => {
  const learned = rememberMerchantCategory(ledger(), expense());
  assert.ok(parseLedger(learned));
  assert.equal(createLedgerSharePayload(learned).includes("merchantCategoryPreferences"), false);
  const injected = JSON.stringify({ format: "wallet-diary", version: 1, ledger: learned });
  const imported = parseLedgerSharePayload(injected); assert.ok(imported); assert.equal("merchantCategoryPreferences" in imported, false);
  assert.equal(parseLedger({ ...learned, merchantCategoryPreferences: [{ merchantKey: "abc", category: "not-a-category", updatedAt: "2026-09-01T00:00:00Z" }] }), null);
});

test("foreign currency requires review even if trusted for both currencies", () => {
  const eur = ledger(); const usd = ledger("USD"); const foreign = { ...candidate, currency: "USD" };
  const state = wallet(eur, usd); const pending = applyHighConfidenceCardAutomation(state, [foreign]);
  assert.equal(pending.state, state); assert.equal(pending.insertedIds.length, 0); assert.equal(pending.pending[0].currencyReview, true);
  assert.throws(() => confirmCardCandidate(state, eur.id, pending.pending[0]), /incompatible/);
  const confirmed = confirmCardCandidate(state, usd.id, pending.pending[0]);
  assert.equal(general(confirmed.state, 1).expenses[0].currency, "USD"); assert.equal(general(confirmed.state, 1).expenses[0].minorUnits, 1000);
  assert.equal(applyHighConfidenceCardAutomation(confirmed.state, [foreign]).pending.length, 0);
  assert.equal(applyHighConfidenceCardAutomation(wallet(eur), [candidate]).insertedIds.length, 1);
});
