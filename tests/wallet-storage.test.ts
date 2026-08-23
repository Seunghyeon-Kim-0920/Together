import assert from "node:assert/strict";
import test from "node:test";
import { createLedgerSharePayload, createTravelSharePayload, parseLedgerSharePayload, parseTravelSharePayload, safeFilename } from "../src/lib/share";
import { EMPTY_WALLET_STATE } from "../src/lib/types";
import { createLedger, mergeGeneralLedgers, parseWalletState, parseWalletStateStrict } from "../src/lib/wallet";

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

test("general ledger share files import as a new ledger with expenses intact", () => {
  const base = createLedger("general", "Card expenses", "EUR");
  const ledger = Object.freeze({ ...base, expenses: Object.freeze([{ id: "expense-1", description: "Lunch", category: "food" as const, currency: "EUR", minorUnits: 1250, occurredOn: "2025-08-04" }]) });
  const imported = parseLedgerSharePayload(createLedgerSharePayload(ledger));
  assert.equal(imported?.kind, "general");
  assert.equal(imported?.title, ledger.title);
  assert.deepEqual(imported?.expenses, ledger.expenses);
  assert.notEqual(imported?.id, ledger.id);
  assert.equal(typeof imported?.createdAt, "string");
  assert.equal(Number.isNaN(Date.parse(imported?.createdAt ?? "")), false);
});

test("provider imports merge into the existing ledger idempotently", () => {
  const existing = Object.freeze({ ...createLedger("general", "생활", "EUR"), expenses: Object.freeze([{ id: "stable-1", description: "Old", category: "food" as const, currency: "EUR", minorUnits: 100, occurredOn: "2025-08-01" }]) });
  const imported = Object.freeze({ ...createLedger("general", "생활", "EUR"), expenses: Object.freeze([{ id: "stable-1", description: "Corrected", category: "food" as const, currency: "EUR", minorUnits: 125, occurredOn: "2025-08-01" }, { id: "stable-2", description: "New", category: "transport" as const, currency: "EUR", minorUnits: 200, occurredOn: "2025-08-02" }]) });
  const merged = mergeGeneralLedgers(existing, imported);
  assert.equal(merged.id, existing.id);
  assert.equal(merged.expenses.length, 2);
  assert.equal(merged.expenses.find((expense) => expense.id === "stable-1")?.minorUnits, 125);
  assert.equal(mergeGeneralLedgers(merged, imported).expenses.length, 2);
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
