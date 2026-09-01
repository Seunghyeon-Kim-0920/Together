import assert from "node:assert/strict";
import test from "node:test";
import { createLedgerSharePayload, createTravelSharePayload, createTravelShareText, parseLedgerSharePayload, parseTravelSharePayload, safeFilename } from "../src/lib/share";
import { EMPTY_WALLET_STATE, type TravelLedger } from "../src/lib/types";
import { createLedger, createTravelExpense, MAX_AUTOMATION_SOURCES, mergeGeneralLedgers, parseWalletState, parseWalletStateStrict } from "../src/lib/wallet";

test("a new installation starts with no ledgers, people, or expenses", () => {
  assert.equal(EMPTY_WALLET_STATE.activeLedgerId, null);
  assert.deepEqual(EMPTY_WALLET_STATE.ledgers, []);
  assert.deepEqual(parseWalletState(undefined), EMPTY_WALLET_STATE);
});

test("travel share files exclude private self identity and import as a new ledger", () => {
  const base = createLedger("travel", "Paris / Nice", "EUR");
  const ledger = Object.freeze({ ...base, participants: Object.freeze([{ id: "me", name: "Me" }]), selfParticipantId: "me" });
  const payload = createTravelSharePayload(ledger);
  assert.equal(payload.includes('"selfParticipantId":"me"'), false);
  const imported = parseTravelSharePayload(payload);
  assert.equal(imported?.kind, "travel");
  assert.equal(imported?.title, ledger.title);
  assert.equal(imported?.selfParticipantId, null);
  assert.notEqual(imported?.id, ledger.id);
});

test("share file parser rejects other formats and non-travel ledgers", () => {
  assert.equal(parseTravelSharePayload("{}"), null);
  const general = createLedger("general", "Home", "KRW");
  assert.equal(parseTravelSharePayload(JSON.stringify({ format: "wallet-diary", version: 1, ledger: general })), null);
});

test("chat sharing creates non-empty localized travel details", () => {
  const base = createLedger("travel", "Paris", "EUR");
  const participants = Object.freeze([{ id: "a", name: "Alice" }, { id: "b", name: "Bob" }]);
  const expense = createTravelExpense({ description: "Dinner", category: "food", currency: "EUR", minorUnits: 3000, paidBy: "a", participantIds: ["a", "b"], occurredOn: "2026-08-01" });
  const ledger: TravelLedger = Object.freeze({ ...base, participants, selfParticipantId: "a", expenses: Object.freeze([expense]) });
  const korean = createTravelShareText(ledger, "ko");
  const english = createTravelShareText(ledger, "en");
  const french = createTravelShareText(ledger, "fr");
  assert.match(korean, /총 지출/);
  assert.match(english, /Total spent/);
  assert.match(french, /Total dépensé/);
  for (const message of [korean, english, french]) {
    assert.match(message, /Paris/);
    assert.match(message, /Dinner/);
    assert.match(message, /Bob → Alice/);
  }
});

test("general ledger share files import as a new ledger with expenses intact", () => {
  const base = createLedger("general", "Card expenses", "EUR");
  const ledger = Object.freeze({ ...base, expenses: Object.freeze([{ id: "expense-1", description: "Lunch", category: "food" as const, currency: "EUR", minorUnits: 1250, occurredOn: "2025-08-04" }]) });
  const imported = parseLedgerSharePayload(createLedgerSharePayload(ledger));
  assert.equal(imported?.kind, "general");
  assert.equal(imported?.title, ledger.title);
  assert.equal(imported?.expenses.length, 1);
  assert.equal(imported?.expenses[0].description, ledger.expenses[0].description);
  assert.notEqual(imported?.expenses[0].id, ledger.expenses[0].id);
  assert.match(imported?.expenses[0].id ?? "", /^shared-/);
  assert.notEqual(imported?.id, ledger.id);
  assert.equal(typeof imported?.createdAt, "string");
  assert.equal(Number.isNaN(Date.parse(imported?.createdAt ?? "")), false);
});

test("legacy general ledgers migrate private automation settings to safe defaults", () => {
  const ledger = createLedger("general", "Legacy", "EUR");
  const legacy = { id: ledger.id, title: ledger.title, kind: ledger.kind, createdAt: ledger.createdAt, updatedAt: ledger.updatedAt, currency: ledger.currency, expenses: [] };
  const parsed = parseLedgerSharePayload(JSON.stringify({ format: "wallet-diary", version: 1, ledger: legacy }));
  assert.equal(parsed?.kind, "general");
  if (parsed?.kind !== "general") throw new Error("expected general ledger");
  assert.equal(parsed.monthlyLimitMinor, null);
  assert.equal(parsed.automationAllApps, false);
  assert.deepEqual(parsed.automationSources, []);
  assert.deepEqual(parsed.automationReversalIds, []);
});

test("invalid monthly limits and notification-source settings are rejected", () => {
  const ledger = createLedger("general", "Settings", "EUR");
  const state = { version: 2, locale: "ko", activeLedgerId: ledger.id, ledgers: [ledger] };
  assert.equal(parseWalletStateStrict({ ...state, ledgers: [{ ...ledger, monthlyLimitMinor: 0 }] }), null);
  assert.equal(parseWalletStateStrict({ ...state, ledgers: [{ ...ledger, automationSources: [{ packageName: "not a package", displayName: "Bad" }] }] }), null);
  assert.equal(parseWalletStateStrict({ ...state, ledgers: [{ ...ledger, automationSources: [{ packageName: "com.example.card", displayName: "Bad", trustedDirectApp: false }] }] }), null);
  assert.equal(parseWalletStateStrict({ ...state, ledgers: [{ ...ledger, automationSources: [{ packageName: "com.example.card", displayName: "One" }, { packageName: "com.example.card", displayName: "Two" }] }] }), null);
  assert.equal(parseWalletStateStrict({ ...state, ledgers: [{ ...ledger, automationAllApps: "yes" }] }), null);
  assert.equal(parseWalletStateStrict({ ...state, ledgers: [{ ...ledger, automationReversalIds: ["bad-id"] }] }), null);
  assert.equal(parseWalletStateStrict({ ...state, ledgers: [{ ...ledger, expenses: [{ id: "invalid-date", description: "Impossible", category: "other", currency: "EUR", minorUnits: 100, occurredOn: "2026-02-30" }] }] }), null);
});

test("worldwide card discovery is not restricted to a short provider list", () => {
  const ledger = createLedger("general", "Worldwide", "EUR");
  const sources = Array.from({ length: MAX_AUTOMATION_SOURCES }, (_, index) => ({ packageName: `com.example.bank${index}`, displayName: `Bank ${index}` }));
  const state = { version: 2, locale: "ko", activeLedgerId: ledger.id, ledgers: [{ ...ledger, automationSources: sources }] };
  assert.equal(parseWalletStateStrict(state)?.ledgers[0].kind, "general");
  assert.equal(parseWalletStateStrict({ ...state, ledgers: [{ ...ledger, automationSources: [...sources, { packageName: "com.example.overflow", displayName: "Overflow" }] }] }), null);
});

test("general ledger shares omit limits and all private automation state", () => {
  const expense = Object.freeze({ id: "card-auto-private", description: "Lidl", category: "food" as const, currency: "EUR", minorUnits: 500, occurredOn: "2026-08-30", automationFingerprint: "card-origin-0123456789abcdef", automationReversalFingerprint: "card-reversal-fedcba9876543210" });
  const ledger = Object.freeze({ ...createLedger("general", "Private", "EUR"), monthlyLimitMinor: 50_000, automationAllApps: true, automationSources: Object.freeze([{ packageName: "com.example.card", displayName: "Example Card", trustedDirectApp: true as const }]), automationReversalIds: Object.freeze(["card-auto-0123456789abcdef"]), expenses: Object.freeze([expense]) });
  const payload = createLedgerSharePayload(ledger);
  assert.equal(payload.includes("monthlyLimitMinor"), false);
  assert.equal(payload.includes("automationSources"), false);
  assert.equal(payload.includes("automationAllApps"), false);
  assert.equal(payload.includes("automationReversalIds"), false);
  assert.equal(payload.includes("com.example.card"), false);
  assert.equal(payload.includes("automationFingerprint"), false);
  assert.equal(payload.includes("automationReversalFingerprint"), false);
  assert.equal(payload.includes("card-origin-"), false);
  assert.equal(payload.includes("card-auto-"), false);
  const imported = parseLedgerSharePayload(payload);
  assert.equal(imported?.kind === "general" ? imported.monthlyLimitMinor : undefined, null);
});

test("a forged share file cannot enable notification access or inject trusted automation metadata", () => {
  const expense = Object.freeze({ id: "forged-expense", description: "Lidl", category: "food" as const, currency: "EUR", minorUnits: 500, occurredOn: "2026-08-30", automationFingerprint: "card-origin-0123456789abcdef", automationReversalFingerprint: "card-reversal-fedcba9876543210" });
  const forged = Object.freeze({ ...createLedger("general", "Forged", "EUR"), monthlyLimitMinor: 50_000, automationAllApps: true, automationSources: Object.freeze([{ packageName: "com.fake.bank", displayName: "Trusted Bank", trustedDirectApp: true as const }]), automationReversalIds: Object.freeze(["card-auto-0123456789abcdef", "card-reversal-fedcba9876543210"]), expenses: Object.freeze([expense]) });
  const imported = parseLedgerSharePayload(JSON.stringify({ format: "wallet-diary", version: 1, ledger: forged }));
  assert.equal(imported?.kind, "general");
  if (imported?.kind !== "general") throw new Error("expected general ledger");
  assert.equal(imported.monthlyLimitMinor, null);
  assert.equal(imported.automationAllApps, false);
  assert.deepEqual(imported.automationSources, []);
  assert.deepEqual(imported.automationReversalIds, []);
  assert.equal(imported.expenses[0].automationFingerprint, undefined);
  assert.equal(imported.expenses[0].automationReversalFingerprint, undefined);
});

test("provider imports merge into the existing ledger idempotently", () => {
  const existing = Object.freeze({ ...createLedger("general", "생활", "EUR"), expenses: Object.freeze([{ id: "stable-1", description: "Old", category: "food" as const, currency: "EUR", minorUnits: 100, occurredOn: "2025-08-01" }]) });
  const imported = Object.freeze({ ...createLedger("general", "생활", "EUR"), expenses: Object.freeze([{ id: "stable-1", description: "Corrected", category: "food" as const, currency: "EUR", minorUnits: 125, occurredOn: "2025-08-01" }, { id: "stable-2", description: "New", category: "transport" as const, currency: "EUR", minorUnits: 200, occurredOn: "2025-08-02" }]) });
  const merged = mergeGeneralLedgers(existing, imported);
  assert.equal(merged.id, existing.id);
  assert.equal(merged.expenses.length, 2);
  assert.equal(merged.expenses.find((expense) => expense.id === "stable-1")?.minorUnits, 100);
  assert.equal(mergeGeneralLedgers(merged, imported).expenses.length, 2);
});

test("provider re-import keeps a user's local expense correction", () => {
  const base = createLedger("general", "Card expenses", "EUR");
  const importedExpense = { id: "provider-1", description: "Original merchant", category: "other" as const, currency: "EUR", minorUnits: 500, occurredOn: "2026-08-01" };
  const localCorrection = Object.freeze({ ...importedExpense, description: "Corrected merchant", category: "food" as const, minorUnits: 450 });
  const existing = Object.freeze({ ...base, expenses: Object.freeze([localCorrection]) });
  const imported = Object.freeze({ ...base, id: "import", expenses: Object.freeze([importedExpense]) });
  assert.deepEqual(mergeGeneralLedgers(existing, imported).expenses, [localCorrection]);
});

test("state validation rejects duplicate ledger ids", () => {
  const ledger = createLedger("general", "Home", "KRW");
  const result = parseWalletState({ version: 2, locale: "ko", activeLedgerId: ledger.id, ledgers: [ledger, ledger] });
  assert.deepEqual(result, EMPTY_WALLET_STATE);
  assert.equal(parseWalletStateStrict({ version: 2, locale: "ko", activeLedgerId: ledger.id, ledgers: [ledger, ledger] }), null);
});

test("filenames are safe on Android, iOS, and Windows", () => {
  assert.equal(safeFilename('Paris: 2026 / A*B?'), "Paris- 2026 - A-B-");
});
