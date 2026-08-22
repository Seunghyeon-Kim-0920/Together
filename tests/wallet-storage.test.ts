import assert from "node:assert/strict";
import test from "node:test";
import { createTravelSharePayload, parseTravelSharePayload, safeFilename } from "../src/lib/share";
import { EMPTY_WALLET_STATE } from "../src/lib/types";
import { createLedger, parseWalletState, parseWalletStateStrict } from "../src/lib/wallet";

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

test("state validation rejects duplicate ledger ids", () => {
  const ledger = createLedger("general", "Home", "KRW");
  const result = parseWalletState({ version: 2, locale: "ko", activeLedgerId: ledger.id, ledgers: [ledger, ledger] });
  assert.deepEqual(result, EMPTY_WALLET_STATE);
  assert.equal(parseWalletStateStrict({ version: 2, locale: "ko", activeLedgerId: ledger.id, ledgers: [ledger, ledger] }), null);
});

test("filenames are safe on Android, iOS, and Windows", () => {
  assert.equal(safeFilename('Paris: 2026 / A*B?'), "Paris- 2026 - A-B-");
});
