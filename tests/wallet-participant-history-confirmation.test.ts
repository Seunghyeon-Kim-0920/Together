import assert from "node:assert/strict";
import test from "node:test";
import { applyConfirmedLocalHistoryRemoval } from "../src/lib/participantHistoryRemoval";
import { createLedger, createTravelExpense, parseWalletStateStrict } from "../src/lib/wallet";
import { EMPTY_WALLET_STATE, type TravelLedger, type WalletState } from "../src/lib/types";

const ledger: TravelLedger = { ...createLedger("travel", "Synthetic confirmation", "EUR"), participants: [{ id: "a", name: "A" }, { id: "b", name: "B" }], expenses: [createTravelExpense({ description: "Synthetic hotel", category: "accommodation", currency: "EUR", minorUnits: 101, occurredOn: "2026-10-29", paidBy: "a", participantIds: ["a", "b"] })] };
const state: WalletState = { ...EMPTY_WALLET_STATE, ledgers: [ledger], activeLedgerId: ledger.id };
test("confirmed local history removal atomically changes expenses and permanent identity fence", () => {
  const next = applyConfirmedLocalHistoryRemoval(state, ledger, "b");
  const travel = next.ledgers[0] as TravelLedger;
  assert.deepEqual(travel.expenses[0].shares, [{ participantId: "a", minorUnits: 101 }]);
  assert.deepEqual(travel.historyRemovedParticipantIds, ["b"]);
  assert.ok(parseWalletStateStrict(next));
  assert.equal(state.ledgers[0].expenses.length, 1);
  assert.equal(ledger.expenses[0].shares.length, 2);
});
test("confirmation cannot overwrite a concurrent edit or resurrect a deleted ledger", () => {
  const edited = { ...ledger, expenses: [{ ...ledger.expenses[0], description: "Changed on another screen" }] };
  assert.throws(() => applyConfirmedLocalHistoryRemoval({ ...state, ledgers: [edited] }, ledger, "b"), /conflict/);
  assert.throws(() => applyConfirmedLocalHistoryRemoval({ ...state, ledgers: [] }, ledger, "b"), /conflict/);
  const added = { ...ledger, expenses: [...ledger.expenses, { ...ledger.expenses[0], id: "concurrent", paidBy: "b" }] };
  assert.throws(() => applyConfirmedLocalHistoryRemoval({ ...state, ledgers: [added] }, ledger, "b"), /conflict/);
});
