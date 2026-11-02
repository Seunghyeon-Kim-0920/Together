import assert from "node:assert/strict";
import test from "node:test";
import { activeTravelParticipants, addTravelParticipant, previewParticipantHistoryRemoval, removeTravelParticipant, removeTravelParticipantHistory, restoreTravelParticipant, travelExpenseParticipants, TravelParticipantError } from "../src/lib/travelParticipants";
import { createLedger, createTravelExpense, mergeTravelLedgerMutation, parseLedger, settleTravelExpenses } from "../src/lib/wallet";
import { createLedgerSharePayload, parseLedgerSharePayload } from "../src/lib/share";
import { previewTravelLedgerMerge } from "../src/lib/travelExchange";
import { connectSharedLedger } from "../src/lib/sharedTravelLocal";
import { parseSharedTrip, toSharedTripData } from "../src/lib/sharedTravel";
import type { TravelLedger } from "../src/lib/types";

const base: TravelLedger = { ...createLedger("travel", "Synthetic trip", "EUR"), participants: [{ id: "a", name: "Alice" }, { id: "b", name: "Bob" }], selfParticipantId: "a" };
const expense = createTravelExpense({ description: "Hotel", category: "accommodation", currency: "EUR", minorUnits: 10001, paidBy: "a", participantIds: ["a", "b"], occurredOn: "2026-10-28" });

test("local unused participant removes fully, used participant archives without changing settlement", () => {
  const removed = removeTravelParticipant(base, "a");
  assert.equal(removed.selfParticipantId, null);
  assert.deepEqual(removed.participants, [base.participants[1]]);
  const used = { ...base, expenses: [expense] };
  const archived = removeTravelParticipant(used, "a");
  assert.deepEqual(archived.participants, used.participants);
  assert.deepEqual(archived.expenses, used.expenses);
  assert.deepEqual(settleTravelExpenses(archived), settleTravelExpenses(used));
  assert.deepEqual(activeTravelParticipants(archived).map((person) => person.id), ["b"]);
  assert.deepEqual(travelExpenseParticipants(archived, expense), base.participants);
  assert.deepEqual(activeTravelParticipants(restoreTravelParticipant(archived, "a")), base.participants);
});

test("add validates names, duplicate archived identities and limit; shared member cannot manage", () => {
  assert.equal(addTravelParticipant(base, "Carol").participants.length, 3);
  for (const name of ["", "  ", "a".repeat(81), "alice"]) assert.throws(() => addTravelParticipant(base, name));
  const archived = removeTravelParticipant({ ...base, expenses: [expense] }, "a");
  assert.throws(() => addTravelParticipant(archived, "Alice"));
  const trip = parseSharedTrip(base.id, toSharedTripData(base, "owner"))!;
  const shared = connectSharedLedger(base, trip, "owner");
  assert.throws(() => addTravelParticipant(shared, "Injected|Name"));
  assert.deepEqual(removeTravelParticipant(shared, "b").participants, base.participants);
  const member = { ...shared, sharedSync: { ...shared.sharedSync!, uid: "member" } };
  assert.throws(() => addTravelParticipant(member, "Carol"));
  assert.throws(() => removeTravelParticipant(member, "b"));
  assert.throws(() => restoreTravelParticipant(member, "b"));
});

test("inactive identities round-trip storage/share, reject invalid lists and survive stale expense edits", () => {
  const archived = removeTravelParticipant({ ...base, expenses: [expense] }, "b");
  assert.deepEqual(parseLedger(JSON.parse(JSON.stringify(archived)))?.kind, "travel");
  assert.deepEqual((parseLedger(archived) as TravelLedger).inactiveParticipantIds, ["b"]);
  assert.deepEqual(JSON.parse(createLedgerSharePayload(archived)).ledger.inactiveParticipantIds, ["b"]);
  for (const inactiveParticipantIds of [["unknown"], ["b", "b"], [123], "b"]) assert.equal(parseLedger({ ...base, inactiveParticipantIds }), null);
  const merged = mergeTravelLedgerMutation(base, { ...base, expenses: [expense] }, archived);
  assert.deepEqual(merged.inactiveParticipantIds, ["b"]);
  assert.deepEqual(merged.expenses, [expense]);
  const restored = mergeTravelLedgerMutation(archived, restoreTravelParticipant(archived, "b"), { ...archived, expenses: [expense, { ...expense, id: "new-offline" }] });
  assert.deepEqual(restored.inactiveParticipantIds, []);
  assert.equal(restored.expenses.length, 2);
});

test("history removal deletes target-paid expenses and exactly re-splits only affected subgroups", () => {
  const people = Object.freeze([...base.participants, { id: "c", name: "Carol" }, { id: "d", name: "Dan" }]);
  const sharedHotel = createTravelExpense({ ...expense, paidBy: "a", participantIds: ["c", "b", "a"], minorUnits: 10001 });
  const otherPayer = createTravelExpense({ ...expense, paidBy: "c", participantIds: ["b", "c"], currency: "KRW", minorUnits: 14000 });
  const removedPayment = createTravelExpense({ ...expense, paidBy: "b", participantIds: ["a", "d"], minorUnits: 999 });
  const unchanged = Object.freeze({ ...createTravelExpense({ ...expense, paidBy: "d", participantIds: ["a", "d"], minorUnits: 1000 }), shares: Object.freeze([{ participantId: "a", minorUnits: 100 }, { participantId: "d", minorUnits: 900 }]) });
  const ledger: TravelLedger = Object.freeze({ ...base, participants: people, currencies: Object.freeze(["EUR", "KRW"]), expenses: Object.freeze([sharedHotel, otherPayer, removedPayment, unchanged]) });
  const before = JSON.stringify(ledger);
  assert.deepEqual(previewParticipantHistoryRemoval(ledger, "b"), { deletedExpenseCount: 1, recalculatedExpenseCount: 2, orphanExpenseCount: 0, deletedTotals: [{ currency: "EUR", minorUnits: 999 }] });
  const removed = removeTravelParticipantHistory(ledger, "b");
  assert.equal(JSON.stringify(ledger), before, "the source ledger is never mutated");
  assert.equal(removed.participants, people, "canonical identities remain stable");
  assert.deepEqual(activeTravelParticipants(removed).map((person) => person.id), ["a", "c", "d"]);
  assert.deepEqual(removed.expenses.map((entry) => entry.id), [sharedHotel.id, otherPayer.id, unchanged.id]);
  assert.deepEqual(removed.expenses[0].shares, [{ participantId: "a", minorUnits: 5001 }, { participantId: "c", minorUnits: 5000 }]);
  assert.deepEqual(removed.expenses[1].shares, [{ participantId: "c", minorUnits: 14000 }]);
  assert.equal(removed.expenses[2], unchanged, "unrelated unequal splits are preserved exactly");
  assert.equal(removed.expenses[0].minorUnits, 10001);
  assert.equal(removed.expenses[0].occurredOn, sharedHotel.occurredOn);
  assert.equal(removed.expenses[0].description, sharedHotel.description);
  assert.ok(parseLedger(removed));
  for (const settlement of settleTravelExpenses(removed)) {
    assert.equal(settlement.balances.get("b"), 0);
    assert.equal([...settlement.balances.values()].reduce((sum, amount) => sum + amount, 0), 0);
    assert.ok(settlement.transfers.every((transfer) => transfer.from !== "b" && transfer.to !== "b"));
  }
  assert.deepEqual(settleTravelExpenses(removed)[0].transfers, [{ from: "c", to: "a", currency: "EUR", minorUnits: 4900 }, { from: "c", to: "d", currency: "EUR", minorUnits: 100 }]);
  assert.equal(removeTravelParticipantHistory(removed, "b"), removed, "repeated removal is idempotent");
});

test("history removal blocks orphaned other-payer expenses without partially deleting anything", () => {
  const orphan = createTravelExpense({ ...expense, paidBy: "a", participantIds: ["b"] });
  const targetPaid = createTravelExpense({ ...expense, paidBy: "b", participantIds: ["a", "b"] });
  const ledger: TravelLedger = Object.freeze({ ...base, expenses: Object.freeze([targetPaid, orphan]) });
  const before = JSON.stringify(ledger);
  assert.deepEqual(previewParticipantHistoryRemoval(ledger, "b"), { deletedExpenseCount: 1, recalculatedExpenseCount: 0, orphanExpenseCount: 1, deletedTotals: [{ currency: "EUR", minorUnits: 10001 }] });
  assert.throws(() => removeTravelParticipantHistory(ledger, "b"), (error: unknown) => error instanceof TravelParticipantError && error.code === "no-remaining-sharers");
  assert.equal(JSON.stringify(ledger), before);
});

test("removing final person's history empties their expenses but preserves archived identity", () => {
  const ledger: TravelLedger = { ...base, participants: [base.participants[0]], expenses: [createTravelExpense({ ...expense, participantIds: ["a"] })] };
  const removed = removeTravelParticipantHistory(ledger, "a");
  assert.deepEqual(removed.expenses, []);
  assert.deepEqual(activeTravelParticipants(removed), []);
  assert.deepEqual(removed.participants, ledger.participants);
  assert.ok(parseLedger(removed));
  assert.equal(removeTravelParticipantHistory(removed, "a"), removed);
});

test("previously archived person can erase history later; original archive choice keeps past settlement", () => {
  const ledger: TravelLedger = { ...base, expenses: [expense] };
  const archived = removeTravelParticipant(ledger, "b");
  assert.equal(archived.expenses, ledger.expenses);
  assert.deepEqual(settleTravelExpenses(archived), settleTravelExpenses(ledger));
  const erased = removeTravelParticipantHistory(archived, "b");
  assert.deepEqual(erased.inactiveParticipantIds, ["b"]);
  assert.deepEqual(erased.expenses[0].shares, [{ participantId: "a", minorUnits: 10001 }]);
  assert.deepEqual(settleTravelExpenses(erased)[0].transfers, []);
  assert.equal(travelExpenseParticipants(erased, erased.expenses[0]).some((person) => person.id === "b"), false);
});

test("history removal requires valid identity and shared-owner management", () => {
  assert.throws(() => removeTravelParticipantHistory(base, "missing"), (error: unknown) => error instanceof TravelParticipantError && error.code === "not-found");
  const trip = parseSharedTrip(base.id, toSharedTripData(base, "owner"))!;
  const shared = connectSharedLedger({ ...base, expenses: [expense] }, trip, "owner");
  const member = { ...shared, sharedSync: { ...shared.sharedSync!, uid: "member" } };
  assert.throws(() => removeTravelParticipantHistory(member, "b"), (error: unknown) => error instanceof TravelParticipantError && error.code === "permission");
  const removed = removeTravelParticipantHistory(shared, "b");
  assert.equal(removed.sharedSync, shared.sharedSync, "the pure helper does not rewrite sync state");
  assert.deepEqual(removed.expenses[0].shares, [{ participantId: "a", minorUnits: 10001 }]);
  const deletedTrip = { ...shared, sharedSync: { ...shared.sharedSync!, trip: { ...trip, deleted: true } } };
  assert.throws(() => removeTravelParticipantHistory(deletedTrip, "b"), (error: unknown) => error instanceof TravelParticipantError && error.code === "permission");
});

test("history removal fence survives storage and public exports, forbids references and restoration", () => {
  const ledger = { ...base, expenses: [expense] };
  const removed = removeTravelParticipantHistory(ledger, "b");
  assert.deepEqual(removed.historyRemovedParticipantIds, ["b"]);
  assert.deepEqual((parseLedger(removed) as TravelLedger).historyRemovedParticipantIds, ["b"]);
  const imported = parseLedgerSharePayload(createLedgerSharePayload(removed));
  assert.equal(imported?.kind, "travel");
  assert.deepEqual((imported as TravelLedger).historyRemovedParticipantIds, ["b"]);
  assert.equal(removeTravelParticipant(removed, "b"), removed, "tombstones cannot be physically removed by the preserve-history action");
  assert.throws(() => restoreTravelParticipant(removed, "b"), (error: unknown) => error instanceof TravelParticipantError && error.code === "history-removed");
  assert.equal(parseLedger({ ...removed, expenses: [expense] }), null, "old shares cannot return");
  assert.equal(parseLedger({ ...removed, expenses: [{ ...removed.expenses[0], paidBy: "b" }] }), null, "old payer cannot return");
  for (const historyRemovedParticipantIds of [["unknown"], ["a"], ["b", "b"], [1], "b"]) assert.equal(parseLedger({ ...removed, historyRemovedParticipantIds }), null);
  assert.equal(parseLedger({ ...removed, inactiveParticipantIds: [] }), null);
});

test("stale edits cannot remove permanent identity fences or reintroduce expenses", () => {
  const ledger = { ...base, expenses: [expense] };
  const removed = removeTravelParticipantHistory(ledger, "b");
  const unrelatedEdit = mergeTravelLedgerMutation(ledger, { ...ledger, title: "Changed title" }, removed);
  assert.deepEqual(unrelatedEdit.historyRemovedParticipantIds, ["b"]);
  assert.deepEqual(unrelatedEdit.inactiveParticipantIds, ["b"]);
  assert.equal(unrelatedEdit.expenses[0], removed.expenses[0]);
  assert.ok(parseLedger(unrelatedEdit));
  const staleRestore = mergeTravelLedgerMutation(removed, { ...removed, inactiveParticipantIds: [], historyRemovedParticipantIds: [] }, removed);
  assert.deepEqual(staleRestore.historyRemovedParticipantIds, ["b"]);
  assert.deepEqual(staleRestore.inactiveParticipantIds, ["b"]);
  const staleDelete = mergeTravelLedgerMutation(base, { ...base, participants: [base.participants[0]] }, removed);
  assert.deepEqual(staleDelete.participants, base.participants);
  assert.deepEqual(staleDelete.historyRemovedParticipantIds, ["b"]);
  const resurrected = mergeTravelLedgerMutation(ledger, { ...ledger, expenses: [{ ...expense, description: "Stale edit" }] }, removed);
  assert.equal(parseLedger(resurrected), null, "persistence rejects a stale financial edit rather than reviving erased shares");
});

test("import preserves new identity fences without erasing existing people, and rejects old references", () => {
  const source = removeTravelParticipantHistory({ ...base, expenses: [expense] }, "b");
  const empty = { ...base, participants: [], selfParticipantId: null };
  const mapping = { a: { kind: "new" as const }, b: { kind: "new" as const } };
  const imported = previewTravelLedgerMerge(empty, source, mapping);
  assert.ok(imported.ok);
  assert.deepEqual(imported.ledger?.historyRemovedParticipantIds, ["b"]);
  const oldFile = previewTravelLedgerMerge(imported.ledger!, { ...base, expenses: [expense] }, mapping);
  assert.equal(oldFile.ok, false);
  assert.equal(oldFile.ledger, null);
  assert.equal(oldFile.errors[0].code, "invalid-participant-mapping");
  const existing = previewTravelLedgerMerge(base, source, mapping);
  assert.ok(existing.ok);
  assert.equal(existing.ledger?.historyRemovedParticipantIds, undefined, "incoming archives cannot erase an existing local person's history");
});
