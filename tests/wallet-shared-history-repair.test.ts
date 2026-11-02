import assert from "node:assert/strict";
import test from "node:test";
import { orphanedPendingHistoryExpenses, repairPendingHistoryShares } from "../src/lib/sharedHistoryRepair";
import { connectSharedLedger, queueSharedWalletChanges, receiveSharedSnapshot } from "../src/lib/sharedTravelLocal";
import { createLedger, createTravelExpense, parseWalletStateStrict } from "../src/lib/wallet";
import type { SharedTrip } from "../src/lib/sharedTravel";
import { EMPTY_WALLET_STATE, type TravelLedger } from "../src/lib/types";

const trip: SharedTrip = { id: "synthetic", ownerUid: "owner", title: "Synthetic trip", participants: [{ id: "a", name: "A" }, { id: "b", name: "B" }], currencies: ["EUR"], defaultCurrency: "EUR", revision: 1, deleted: false };
const local: TravelLedger = { ...createLedger("travel", trip.title, "EUR"), id: trip.id, participants: trip.participants };
const connected = connectSharedLedger(local, trip, "member", { trip, expenses: [], members: [], fromCache: false });
const expense = createTravelExpense({ description: "Unsent synthetic expense", category: "food", currency: "EUR", minorUnits: 101, occurredOn: "2026-10-29", paidBy: "a", participantIds: ["b"] });
const wallet = (ledger: TravelLedger) => ({ ...EMPTY_WALLET_STATE, ledgers: [ledger], activeLedgerId: ledger.id });
const pending = queueSharedWalletChanges(wallet(connected), wallet({ ...connected, expenses: [expense] })).ledgers[0] as TravelLedger;
const lockedTrip: SharedTrip = { ...trip, revision: 2, participantHistoryRemoval: { id: "operation", participantId: "b", phase: "applying", cursor: null } };
const finalTrip: SharedTrip = { ...trip, revision: 3, inactiveParticipantIds: ["b"], historyRemovedParticipantIds: ["b"] };
const finalSnapshot = { trip: finalTrip, expenses: [], members: [], fromCache: false };

test("unsent orphan is retained through failure and can be explicitly repaired even after local lock", () => {
  const held = receiveSharedSnapshot(pending, { trip: lockedTrip, expenses: [], members: [], fromCache: false });
  const before = JSON.stringify(held);
  assert.throws(() => receiveSharedSnapshot(held, finalSnapshot), /orphan-shares/);
  assert.equal(JSON.stringify(held), before);
  assert.deepEqual(orphanedPendingHistoryExpenses(held, finalTrip), [expense]);
  const repaired = repairPendingHistoryShares(held, finalTrip, expense, ["a"]);
  assert.ok(parseWalletStateStrict(wallet(repaired)));
  const finished = receiveSharedSnapshot(repaired, finalSnapshot);
  assert.equal(finished.expenses[0].description, expense.description);
  assert.equal(finished.expenses[0].minorUnits, 101);
  assert.deepEqual(finished.expenses[0].shares, [{ participantId: "a", minorUnits: 101 }]);
  assert.equal(finished.sharedSync?.pending.length, 1);
  assert.equal(finished.sharedSync?.trip.participantHistoryRemoval, undefined);
  assert.ok(parseWalletStateStrict(wallet(finished)));
});
test("repair rejects removed/empty sharers and a stale confirmation", () => {
  assert.throws(() => repairPendingHistoryShares(pending, finalTrip, expense, ["b"]));
  assert.throws(() => repairPendingHistoryShares(pending, finalTrip, expense, []));
  assert.throws(() => repairPendingHistoryShares(pending, finalTrip, { ...expense, minorUnits: 999 }, ["a"]), /conflict/);
  assert.throws(() => repairPendingHistoryShares(pending, lockedTrip, expense, ["a"]), /conflict/);
  const appended = { ...finalTrip, participants: [...finalTrip.participants, { id: "c", name: "New companion" }] };
  assert.throws(() => repairPendingHistoryShares(pending, appended, expense, ["c"]), /invalid-data/);
  assert.ok(parseWalletStateStrict(wallet(repairPendingHistoryShares(pending, appended, expense, ["a"]))));
});
