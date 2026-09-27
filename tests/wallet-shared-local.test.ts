import assert from "node:assert/strict";
import test from "node:test";
import { acknowledgeSharedMutation, connectSharedLedger, disconnectSharedLedger, parseSharedLocal, queueSharedWalletChanges, receiveSharedSnapshot, resolveSharedConflict } from "../src/lib/sharedTravelLocal";
import type { SharedExpenseMutation, SharedExpenseRecord, SharedTrip, SharedTripSnapshot } from "../src/lib/sharedTravel";
import type { GeneralLedger, TravelExpense, TravelLedger, WalletState } from "../src/lib/types";
import { createLedger, parseWalletStateStrict } from "../src/lib/wallet";
import { createLedgerSharePayload, parseLedgerSharePayload } from "../src/lib/share";

const trip: SharedTrip = Object.freeze({ id: "shared-trip", ownerUid: "owner-device", title: "Shared holiday", revision: 1, deleted: false,
  participants: Object.freeze([{ id: "person-a", name: "A" }, { id: "person-b", name: "B" }]), currencies: Object.freeze(["EUR", "GBP"]), defaultCurrency: "EUR" });
const uid = "my-device";
function expense(id = "expense-one", description = "Lunch", minorUnits = 1234): TravelExpense {
  return { id, description, category: "food", currency: "EUR", minorUnits, paidBy: "person-a",
    shares: [{ participantId: "person-a", minorUnits: Math.floor(minorUnits / 2) }, { participantId: "person-b", minorUnits: minorUnits - Math.floor(minorUnits / 2) }], occurredOn: "2026-09-20" };
}
function remote(value: TravelExpense | null, revision = 1, overrides: Partial<SharedExpenseRecord> = {}): SharedExpenseRecord {
  return { id: value?.id ?? "expense-one", authorUid: uid, updatedBy: uid, revision, mutationId: `remote-mutation-${revision}`, deleted: value === null, expense: value, ...overrides };
}
function snapshot(records: readonly SharedExpenseRecord[] = [], overrides: Partial<SharedTripSnapshot> = {}): SharedTripSnapshot {
  return { trip, expenses: records, members: [{ uid: trip.ownerUid, displayName: "Owner", role: "owner" }, { uid, displayName: "Me", role: "member" }], fromCache: false, ...overrides };
}
function localLedger(expenses: readonly TravelExpense[] = []): TravelLedger {
  return { ...createLedger("travel", trip.title, "EUR"), id: trip.id, participants: trip.participants, currencies: trip.currencies,
    defaultCurrency: trip.defaultCurrency, selfParticipantId: "person-a", expenses };
}
function connected(records: readonly SharedExpenseRecord[] = [], actor = uid): TravelLedger {
  return connectSharedLedger(localLedger(), trip, actor, snapshot(records));
}
function wallet(ledger: TravelLedger, general?: GeneralLedger): WalletState {
  return { version: 2, locale: "ko", activeLedgerId: ledger.id, ledgers: general ? [general, ledger] : [ledger] };
}
function changed(ledger: TravelLedger, expenses: readonly TravelExpense[]): TravelLedger {
  const after = queueSharedWalletChanges(wallet(ledger), wallet({ ...ledger, expenses }));
  return after.ledgers[0] as TravelLedger;
}
function acknowledgement(op: SharedExpenseMutation, revision: number): SharedExpenseRecord {
  return remote(op.expense, revision, { id: op.id, mutationId: op.mutationId });
}

test("connecting explicitly queues approved initial expenses with stable identity and durable local snapshots", () => {
  const original = localLedger([expense()]); const before = JSON.stringify(original);
  const linked = connectSharedLedger(original, trip, uid);
  assert.equal(JSON.stringify(original), before);
  assert.equal(linked.expenses, original.expenses);
  assert.equal(linked.sharedSync?.pending.length, 1);
  assert.equal(linked.sharedSync?.pending[0].id, original.expenses[0].id);
  assert.equal(linked.sharedSync?.pending[0].expectedRevision, 0);
  assert.equal(linked.sharedSync?.pending[0].conflict, false);
  const parsed = parseWalletStateStrict(JSON.parse(JSON.stringify(wallet(linked)))); assert.ok(parsed);
  assert.deepEqual((parsed.ledgers[0] as TravelLedger).sharedSync, linked.sharedSync);
  assert.throws(() => connectSharedLedger(linked, trip, uid));
});

test("joining uses the remote snapshot and never silently uploads pre-existing local expenses", () => {
  const joined = connectSharedLedger(localLedger([expense("private-draft", "Not approved for upload")]), trip, uid, snapshot([remote(expense())]));
  assert.deepEqual(joined.expenses, [expense()]);
  assert.deepEqual(joined.sharedSync?.pending, []);
  assert.equal(joined.sharedSync?.records.length, 1);
});

test("joining uses the latest snapshot participants and mapped payer even when the accepted invite header was older", () => {
  const latest: SharedTrip = { ...trip, title: "Latest shared holiday", revision: 3,
    participants: [...trip.participants, { id: "person-c", name: "Me" }], participantMembers: { [uid]: "person-c" } };
  const newPayment: TravelExpense = { ...expense(), paidBy: "person-c", shares: [{ participantId: "person-c", minorUnits: 1234 }] };
  const joined = connectSharedLedger(localLedger(), trip, uid, snapshot([remote(newPayment)], { trip: latest }));
  assert.equal(joined.title, latest.title);
  assert.deepEqual(joined.participants, latest.participants);
  assert.equal(joined.selfParticipantId, "person-c");
  assert.deepEqual(joined.sharedSync!.trip, latest);
  assert.deepEqual(joined.expenses, [newPayment]);
  assert.deepEqual(joined.sharedSync!.pending, []);
  const reloaded = parseWalletStateStrict(JSON.parse(JSON.stringify(wallet(joined)))); assert.ok(reloaded);
  assert.deepEqual((reloaded.ledgers[0] as TravelLedger).sharedSync, joined.sharedSync);
});

test("legacy storage stays readable and optional participant mappings round-trip without accepting invalid identities", () => {
  const legacy = connected();
  const oldParsed = parseSharedLocal(JSON.parse(JSON.stringify(legacy.sharedSync))); assert.ok(oldParsed);
  assert.equal(Object.hasOwn(oldParsed.trip, "participantMembers"), false);
  const mapped = { ...legacy.sharedSync!, trip: { ...trip, participantMembers: { [uid]: "person-b", [trip.ownerUid]: "person-a" } } };
  assert.deepEqual(parseSharedLocal(JSON.parse(JSON.stringify(mapped))), mapped);
  for (const invalidMapping of [null, [], "person-a", { [uid]: "missing-person" }, { "invalid/uid": "person-a" },
    { [uid]: "person-a", [trip.ownerUid]: "person-a" }, { [uid]: 1 }]) {
    assert.equal(parseSharedLocal({ ...mapped, trip: { ...trip, participantMembers: invalidMapping } }), null);
  }
});

test("incoming joins append settlement people and keep existing expense shares and offline changes exactly intact", () => {
  const initial = connected([remote(expense())]);
  const offline = changed(initial, [expense(), expense("offline-expense", "Already split", 1001)]);
  const nextTrip: SharedTrip = { ...trip, revision: 2, title: "Joined holiday",
    participants: [...trip.participants, { id: "person-c", name: "Me" }], participantMembers: { [uid]: "person-c" } };
  const before = JSON.stringify(offline);
  const updated = receiveSharedSnapshot(offline, snapshot([remote(expense())], { trip: nextTrip }));
  assert.equal(JSON.stringify(offline), before);
  assert.deepEqual(updated.participants, nextTrip.participants);
  assert.equal(updated.title, "Joined holiday");
  assert.equal(updated.selfParticipantId, "person-c");
  assert.deepEqual(updated.expenses, offline.expenses);
  assert.deepEqual(updated.expenses.map((item) => item.shares), offline.expenses.map((item) => item.shares));
  assert.deepEqual(updated.sharedSync!.pending, offline.sharedSync!.pending);
  assert.deepEqual(updated.sharedSync!.records, offline.sharedSync!.records);
  assert.ok(parseWalletStateStrict(JSON.parse(JSON.stringify(wallet(updated)))));
});

test("first device mapping selects self, but later joins preserve the user's explicit payer selection", () => {
  const mappingTrip: SharedTrip = { ...trip, revision: 2, participantMembers: { [uid]: "person-b" } };
  const mapped = receiveSharedSnapshot(connected(), snapshot([], { trip: mappingTrip }));
  assert.equal(mapped.selfParticipantId, "person-b");
  const manuallySelected = { ...mapped, selfParticipantId: "person-a" };
  const nextTrip: SharedTrip = { ...mappingTrip, revision: 3,
    participants: [...trip.participants, { id: "person-c", name: "C" }], participantMembers: { ...mappingTrip.participantMembers, "third-device": "person-c" } };
  const updated = receiveSharedSnapshot(manuallySelected, snapshot([], { trip: nextTrip }));
  assert.equal(updated.selfParticipantId, "person-a");
  assert.deepEqual(updated.participants, nextTrip.participants);
});

test("a delayed older trip header cannot undo joined people or their device mappings", () => {
  const latest: SharedTrip = { ...trip, title: "Joined title", revision: 3,
    participants: [...trip.participants, { id: "person-c", name: "Me" }], participantMembers: { [uid]: "person-c" } };
  const joined = receiveSharedSnapshot(connected([remote(expense())]), snapshot([remote(expense())], { trip: latest }));
  const stale = receiveSharedSnapshot(joined, snapshot([remote(expense("expense-one", "New expense revision"), 2)]));
  assert.deepEqual(stale.participants, latest.participants);
  assert.equal(stale.title, latest.title);
  assert.equal(stale.selfParticipantId, "person-c");
  assert.deepEqual(stale.sharedSync!.trip, latest);
  assert.equal(stale.expenses[0].description, "New expense revision");
});

test("remote participant changes cannot rename, delete, reorder, or remap existing settlement identities", () => {
  const mappedTrip: SharedTrip = { ...trip, participantMembers: { [uid]: "person-b" } };
  const initial = connectSharedLedger(localLedger(), mappedTrip, uid, snapshot([remote(expense())], { trip: mappedTrip }));
  const before = JSON.stringify(initial);
  const invalidUpdates: Partial<SharedTrip>[] = [
    { participants: [{ ...trip.participants[0], name: "Renamed" }, trip.participants[1]] },
    { participants: [trip.participants[0]] },
    { participants: [trip.participants[1], trip.participants[0]] },
    { participantMembers: undefined },
    { participantMembers: {} },
    { participantMembers: { [uid]: "person-a" } },
    { participantMembers: { [uid]: "person-b", "another-device": "person-b" } },
    { currencies: ["EUR"] },
    { defaultCurrency: "GBP" },
    { ownerUid: "new-owner" },
  ];
  for (const update of invalidUpdates) {
    assert.throws(() => receiveSharedSnapshot(initial, snapshot([remote(expense())], { trip: { ...mappedTrip, revision: 2, ...update } })), /invalid-data/);
    assert.equal(JSON.stringify(initial), before);
  }
});

test("local outbox coalesces offline edits without changing its baseline and retains explicit deletion before first upload", () => {
  const initial = connected();
  const added = changed(initial, [expense()]); const creation = added.sharedSync!.pending[0];
  const edited = changed(added, [expense("expense-one", "Dinner", 2500)]); const edit = edited.sharedSync!.pending[0];
  assert.equal(edited.sharedSync!.pending.length, 1); assert.equal(edit.expectedRevision, 0);
  assert.notEqual(edit.mutationId, creation.mutationId);
  const removed = changed(edited, []); const deletion = removed.sharedSync!.pending[0];
  assert.equal(removed.expenses.length, 0); assert.equal(deletion.expense, null); assert.equal(deletion.expectedRevision, 0);
  assert.equal(removed.sharedSync!.pending.length, 1);
  // The original network create can complete after the user deletes locally.
  const acknowledged = acknowledgeSharedMutation(removed, creation, acknowledgement(creation, 1));
  assert.equal(acknowledged.expenses.length, 0);
  assert.equal(acknowledged.sharedSync!.pending[0].expense, null);
  assert.equal(acknowledged.sharedSync!.pending[0].expectedRevision, 1);
  assert.equal(acknowledged.sharedSync!.pending[0].mutationId, deletion.mutationId);
});

test("server updates cannot overwrite a pending edit and divergent revisions become explicit conflicts", () => {
  const initial = connected([remote(expense())]);
  const pending = changed(initial, [expense("expense-one", "My offline correction")]);
  const before = JSON.stringify(pending);
  const updated = receiveSharedSnapshot(pending, snapshot([remote(expense("expense-one", "Owner correction"), 2, { updatedBy: trip.ownerUid })]));
  assert.equal(JSON.stringify(pending), before);
  assert.equal(updated.expenses[0].description, "My offline correction");
  assert.equal(updated.sharedSync!.records[0].expense?.description, "Owner correction");
  assert.equal(updated.sharedSync!.pending[0].conflict, true);
  assert.equal(updated.sharedSync!.pending[0].expectedRevision, 1);
});

test("acknowledging an older in-flight mutation preserves later local edits and advances their expected revision", () => {
  const initial = connected([remote(expense())]);
  const first = changed(initial, [expense("expense-one", "First edit")]); const sent = first.sharedSync!.pending[0];
  const second = changed(first, [expense("expense-one", "Later edit")]); const waiting = second.sharedSync!.pending[0];
  const acknowledged = acknowledgeSharedMutation(second, sent, acknowledgement(sent, 2));
  assert.equal(acknowledged.expenses[0].description, "Later edit");
  assert.equal(acknowledged.sharedSync!.pending.length, 1);
  assert.equal(acknowledged.sharedSync!.pending[0].mutationId, waiting.mutationId);
  assert.equal(acknowledged.sharedSync!.pending[0].expectedRevision, 2);
  assert.equal(acknowledged.sharedSync!.pending[0].conflict, false);
  assert.equal(acknowledged.sharedSync!.records[0].revision, 2);
  const finished = acknowledgeSharedMutation(acknowledged, acknowledged.sharedSync!.pending[0], acknowledgement(acknowledged.sharedSync!.pending[0], 3));
  assert.equal(finished.sharedSync!.pending.length, 0);
  assert.equal(finished.expenses[0].description, "Later edit");
});

test("a delayed older ACK cannot erase a newer remote revision or clear its real conflict", () => {
  const initial = connected([remote(expense())]);
  const first = changed(initial, [expense("expense-one", "First edit")]); const sent = first.sharedSync!.pending[0];
  const second = changed(first, [expense("expense-one", "Later edit")]);
  const newer = receiveSharedSnapshot(second, snapshot([remote(expense("expense-one", "New owner change"), 3, { updatedBy: trip.ownerUid })]));
  assert.equal(newer.sharedSync!.pending[0].conflict, true);
  const late = acknowledgeSharedMutation(newer, sent, acknowledgement(sent, 2));
  assert.equal(late.expenses[0].description, "Later edit");
  assert.equal(late.sharedSync!.records[0].revision, 3);
  assert.equal(late.sharedSync!.records[0].expense?.description, "New owner change");
  assert.equal(late.sharedSync!.pending[0].conflict, true);
});

test("a matching server mutation acts as acknowledgement and remote tombstones remove only synchronized records", () => {
  const initial = connected(); const added = changed(initial, [expense()]); const sent = added.sharedSync!.pending[0];
  const acknowledged = receiveSharedSnapshot(added, snapshot([acknowledgement(sent, 1)]));
  assert.deepEqual(acknowledged.sharedSync!.pending, []); assert.equal(acknowledged.expenses.length, 1);
  const second = changed(acknowledged, [expense(), expense("expense-two", "Pending second expense")]);
  const removed = receiveSharedSnapshot(second, snapshot([remote(null, 2)]));
  assert.deepEqual(removed.expenses.map((item) => item.id), ["expense-two"]);
  assert.equal(removed.sharedSync!.pending.length, 1);
  assert.equal(removed.sharedSync!.pending[0].id, "expense-two");
});

test("cache snapshots and mismatched groups cannot alter a connected ledger", () => {
  const initial = connected([remote(expense())]);
  assert.equal(receiveSharedSnapshot(initial, snapshot([remote(null, 2)], { fromCache: true })), initial);
  assert.equal(receiveSharedSnapshot(initial, snapshot([remote(null, 2)], { trip: { ...trip, id: "another-trip" } })), initial);
});

test("out-of-order server snapshots cannot regress expense or deleted-trip revisions", () => {
  const initial = connected([remote(expense())]);
  const updated = receiveSharedSnapshot(initial, snapshot([remote(expense("expense-one", "Revision three"), 3)], { trip: { ...trip, revision: 2, deleted: true } }));
  const stale = receiveSharedSnapshot(updated, snapshot([remote(expense())]));
  assert.equal(stale.expenses[0].description, "Revision three");
  assert.equal(stale.sharedSync!.records[0].revision, 3);
  assert.equal(stale.sharedSync!.trip.revision, 2);
  assert.equal(stale.sharedSync!.trip.deleted, true);
});

test("conflict resolution either keeps the local edit against the latest revision or accepts the server deletion", () => {
  const initial = connected([remote(expense())]);
  const edited = changed(initial, [expense("expense-one", "Keep my correction")]);
  const conflicted = receiveSharedSnapshot(edited, snapshot([remote(null, 2)]));
  const keep = resolveSharedConflict(conflicted, "expense-one", true);
  assert.equal(keep.expenses[0].description, "Keep my correction");
  assert.equal(keep.sharedSync!.pending[0].expectedRevision, 2);
  assert.equal(keep.sharedSync!.pending[0].conflict, false);
  assert.notEqual(keep.sharedSync!.pending[0].mutationId, conflicted.sharedSync!.pending[0].mutationId);
  const discard = resolveSharedConflict(conflicted, "expense-one", false);
  assert.equal(discard.expenses.length, 0); assert.equal(discard.sharedSync!.pending.length, 0);
  assert.throws(() => resolveSharedConflict(edited, "expense-one", true));
});

test("members may edit only their own records while the owner may correct every shared expense", () => {
  const others = remote(expense(), 1, { authorUid: "another-member", updatedBy: "another-member" });
  const member = connected([others]);
  assert.throws(() => changed(member, [expense("expense-one", "Not mine")]), /permission-denied/);
  assert.throws(() => changed(member, []), /permission-denied/);
  const owner = connected([others], trip.ownerUid);
  const permitted = changed(owner, [expense("expense-one", "Owner correction")]);
  assert.equal(permitted.sharedSync!.pending.length, 1);
  // A concurrent owner replacement cannot grant a member permission through conflict resolution.
  const own = changed(connected([remote(expense())]), [expense("expense-one", "My draft")]);
  const forgedOwnership = receiveSharedSnapshot(own, snapshot([{ ...others, revision: 2 }]));
  assert.throws(() => resolveSharedConflict(forgedOwnership, "expense-one", true), /permission-denied/);
});

test("a deleted trip rejects new edits and keep-local conflict resolution", () => {
  const own = changed(connected([remote(expense())]), [expense("expense-one", "My draft")]);
  const closed = receiveSharedSnapshot(own, snapshot([remote(null, 2)], { trip: { ...trip, revision: 2, deleted: true } }));
  assert.throws(() => changed(closed, [expense("expense-one", "New edit")]), /permission-denied/);
  assert.throws(() => resolveSharedConflict(closed, "expense-one", true), /permission-denied/);
  const discard = resolveSharedConflict(closed, "expense-one", false);
  assert.equal(discard.sharedSync!.pending.length, 0);
});

test("metadata and tab deletion are blocked until explicitly disconnected, preserving local data", () => {
  const initial = connected([remote(expense())]);
  for (const mutation of [
    { title: "Rename" }, { participants: [] }, { currencies: ["EUR"] }, { defaultCurrency: "GBP" },
  ]) assert.throws(() => queueSharedWalletChanges(wallet(initial), wallet({ ...initial, ...mutation })), /permission-denied/);
  assert.throws(() => queueSharedWalletChanges(wallet(initial), { ...wallet(initial), ledgers: [], activeLedgerId: null }), /permission-denied/);
  const pending = changed(initial, [expense("expense-one", "Unsent edit")]);
  const detached = disconnectSharedLedger(pending);
  assert.equal(detached.sharedSync, undefined); assert.equal(detached.expenses[0].description, "Unsent edit");
  const deleted = queueSharedWalletChanges(wallet(detached), { ...wallet(detached), ledgers: [], activeLedgerId: null });
  assert.equal(deleted.ledgers.length, 0);
});

test("general-ledger notifications and private settings never enter shared travel outbox or exports", () => {
  const travel = connected();
  const general: GeneralLedger = { ...createLedger("general", "Private living", "EUR"), monthlyLimitMinor: 90000, automationAllApps: true,
    automationSources: [{ packageName: "com.private.bank", displayName: "Private bank", trustedDirectApp: true }],
    expenses: [{ id: "private-payment", description: "Private merchant", category: "food", currency: "EUR", minorUnits: 1000, occurredOn: "2026-09-20" }] };
  const before = wallet(travel, general);
  const nextGeneral = { ...general, expenses: [...general.expenses, { ...general.expenses[0], id: "another-private-payment" }] };
  const next = queueSharedWalletChanges(before, wallet(travel, nextGeneral));
  const shared = next.ledgers[1] as TravelLedger;
  assert.equal(next.ledgers[0], nextGeneral); assert.deepEqual(shared.sharedSync!.pending, []);
  const outbox = JSON.stringify(shared.sharedSync);
  for (const privateText of ["Private merchant", "com.private.bank", "monthlyLimitMinor", "automationSources", "private-payment"]) assert.equal(outbox.includes(privateText), false);
  const pending = changed(travel, [expense()]);
  const payload = createLedgerSharePayload(pending);
  for (const privateText of ["sharedSync", "my-device", "owner-device", "mutationId", "expectedRevision", "authorUid"]) assert.equal(payload.includes(privateText), false);
  const imported = parseLedgerSharePayload(payload); assert.ok(imported && imported.kind === "travel");
  assert.equal(imported.sharedSync, undefined); assert.equal(imported.expenses.length, 1);
  const forged = JSON.stringify({ format: "wallet-diary", version: 1, ledger: pending });
  const sanitized = parseLedgerSharePayload(forged); assert.ok(sanitized && sanitized.kind === "travel");
  assert.equal(sanitized.sharedSync, undefined);
});

test("strict storage parsing rejects invalid outbox operations and preserves exact valid conflict state", () => {
  const pending = changed(connected([remote(expense())]), [expense("expense-one", "Offline")]);
  const conflicted = receiveSharedSnapshot(pending, snapshot([remote(expense("expense-one", "Online"), 2)]));
  const reloaded = parseWalletStateStrict(JSON.parse(JSON.stringify(wallet(conflicted)))); assert.ok(reloaded);
  assert.deepEqual((reloaded.ledgers[0] as TravelLedger).sharedSync, conflicted.sharedSync);
  const sync = conflicted.sharedSync!; const op = sync.pending[0];
  for (const corrupt of [
    { ...sync, pending: [{ ...op, expectedRevision: -1 }] },
    { ...sync, pending: [{ ...op, mutationId: "invalid/token" }] },
    { ...sync, pending: [{ ...op, expense: { ...op.expense!, occurredOn: "2026-02-30" } }] },
    { ...sync, pending: [op, op] },
    { ...sync, records: [{ ...sync.records[0], deleted: true }] },
    { ...sync, records: [{ ...sync.records[0], expense: { ...expense(), id: "wrong-id" } }] },
  ]) {
    assert.equal(parseSharedLocal(corrupt), null);
    assert.equal(parseWalletStateStrict(wallet({ ...conflicted, sharedSync: corrupt })), null);
  }
});

test("connecting a snapshot from a different shared group fails before replacing local records", () => {
  assert.throws(() => connectSharedLedger(localLedger(), trip, uid, snapshot([remote(expense())], { trip: { ...trip, id: "wrong-group" } })), /invalid-data/);
});

test("a late acknowledgement of the same sent mutation cannot clear a newer remote conflict", () => {
  const pending = changed(connected([remote(expense())]), [expense("expense-one", "My edit")]);
  const sent = pending.sharedSync!.pending[0];
  const updated = receiveSharedSnapshot(pending, snapshot([remote(expense("expense-one", "Newer server edit"), 3, { updatedBy: trip.ownerUid })]));
  const ack = acknowledgeSharedMutation(updated, sent, acknowledgement(sent, 2));
  assert.equal(ack.sharedSync!.records[0].revision, 3);
  assert.equal(ack.sharedSync!.pending[0].conflict, true);
  assert.equal(ack.expenses[0].description, "My edit");
});
