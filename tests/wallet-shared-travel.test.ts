import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSharedError, parseSharedExpense, parseSharedTrip, registerSharedParticipant, SharedTravelError, toSharedExpenseData, toSharedTripData, validateSharedExpense, type SharedTravelClient } from "../src/lib/sharedTravel";
import { createSharedTravelClientLoader } from "../src/lib/sharedTravelClient";
import { createLedger } from "../src/lib/wallet";
import type { TravelExpense, TravelLedger } from "../src/lib/types";

const ledger: TravelLedger = { ...createLedger("travel", "Paris", "EUR"), id: "trip-one", participants: [{ id: "alice", name: "Alice" }, { id: "bob", name: "Bob" }], selfParticipantId: "alice" };
const expense: TravelExpense = { id: "expense-one", description: "Cafe", category: "food", currency: "EUR", minorUnits: 1001, occurredOn: "2026-09-19", paidBy: "alice", shares: [{ participantId: "alice", minorUnits: 501 }, { participantId: "bob", minorUnits: 500 }] };
const trip = parseSharedTrip(ledger.id, toSharedTripData(ledger, "owner"))!;

test("shared travel is disabled without a configured free project; no implicit anonymous sign-in", async () => {
  let calls = 0;
  const load = createSharedTravelClientLoader(null, async () => { calls++; throw new Error("unexpected sign-in"); });
  await assert.rejects(load(), (error) => error instanceof SharedTravelError && error.code === "not-configured");
  assert.equal(calls, 0);
});
test("configured loading stays lazy, shares a concurrent initialization and retries failure", async () => {
  let calls = 0;
  const fake = { uid: "test-only" } as SharedTravelClient;
  const config = { projectId: "demo-wallet-diary", apiKey: "fake", appId: "fake", authDomain: "localhost" };
  const load = createSharedTravelClientLoader(config, async (provided) => {
    assert.equal(provided, config); calls++;
    if (calls === 1) throw new Error("offline");
    return fake;
  });
  assert.equal(calls, 0);
  const first = load(); assert.equal(load(), first);
  await assert.rejects(first, (error) => error instanceof SharedTravelError && error.code === "unavailable");
  assert.deepEqual(await Promise.all([load(), load()]), [fake, fake]);
  assert.equal(calls, 2);
});
test("cloud serialization allowlists only approved trip metadata and expenses", () => {
  const privateLedger = { ...ledger, statementImportHistory: [{ id: "secret", kind: "payment" as const, expenseId: "secret" }], selfParticipantId: "private" };
  const header = toSharedTripData(privateLedger, "owner");
  assert.equal(JSON.stringify(header).includes("secret"), false);
  assert.equal("selfParticipantId" in header, false);
  assert.equal("expenses" in header, false);
  const data = toSharedExpenseData({ ...expense, rawNotification: "secret balance" } as TravelExpense, trip, "owner", "owner", 1, "mutation-one");
  assert.equal(JSON.stringify(data).includes("secret"), false);
  assert.deepEqual(parseSharedExpense(expense.id, data, trip)?.expense, expense);
});
test("shared expense validation rejects invalid calendar dates, imbalanced splits and foreign participants", () => {
  for (const invalid of [
    { ...expense, occurredOn: "2025-02-29" }, { ...expense, occurredOn: "2026-04-31" }, { ...expense, occurredOn: "0000-01-01" },
    { ...expense, description: "x".repeat(201) },
    { ...expense, currency: "USD" }, { ...expense, minorUnits: Number.MAX_SAFE_INTEGER },
    { ...expense, shares: [{ participantId: "alice", minorUnits: 1000 }] },
    { ...expense, shares: [{ participantId: "other", minorUnits: 1001 }] },
    { ...expense, shares: [{ participantId: "alice", minorUnits: 501 }, { participantId: "alice", minorUnits: 500 }] },
  ]) assert.throws(() => validateSharedExpense(invalid, trip), SharedTravelError);
  assert.doesNotThrow(() => validateSharedExpense({ ...expense, occurredOn: "2024-02-29" }, trip));
});
test("cloud data parsing rejects private fields and unsafe revisions rather than silently importing", () => {
  const data = toSharedExpenseData(expense, trip, "owner", "owner", 1, "mutation-one");
  assert.equal(parseSharedExpense(expense.id, { ...data, rawNotification: "private" }, trip), null);
  assert.equal(parseSharedExpense(expense.id, { ...data, revision: 0 }, trip), null);
  assert.equal(parseSharedTrip(ledger.id, { ...toSharedTripData(ledger, "owner"), title: "x".repeat(81) }), null);
  assert.equal(parseSharedTrip(ledger.id, { ...toSharedTripData(ledger, "owner"), participantIds: [], participantNames: [] }), null);
  assert.equal(parseSharedTrip(ledger.id, { ...toSharedTripData(ledger, "owner"), participantNames: ["Alice|Injected", "Bob"] }), null);
  const tombstone = { schema: 1, authorUid: "owner", updatedBy: "owner", revision: 2, mutationId: "delete-one", deleted: true };
  assert.equal(parseSharedExpense(expense.id, tombstone, trip)?.expense, null);
  assert.equal(parseSharedExpense(expense.id, { ...tombstone, description: "leftover" }, trip), null);
});
test("quota and network failures are explicit without claiming a daily reset", () => {
  assert.equal(normalizeSharedError({ code: "firestore/resource-exhausted" }).code, "quota");
  assert.equal(normalizeSharedError({ code: "firestore/permission-denied" }).code, "permission-denied");
  assert.equal(normalizeSharedError(new Error("offline")).code, "unavailable");
});

test("joining registers one stable settlement identity and replay never adds another person", () => {
  const registered = registerSharedParticipant(trip, "carol-device", " Carol ");
  assert.deepEqual(registered.participants, [...trip.participants, { id: "member_carol-device", name: "Carol" }]);
  assert.equal(registered.participantMembers?.["carol-device"], "member_carol-device");
  assert.equal(registered.revision, trip.revision + 1);
  assert.equal(registerSharedParticipant(registered, "carol-device", "Carol phone"), registered);
  assert.deepEqual(parseSharedExpense(expense.id, toSharedExpenseData(expense, trip, "owner", "owner", 1, "prior"), registered)?.expense, expense);
});

test("one exact unclaimed name reuses the original participant and a connected namesake stays separate", () => {
  const first = registerSharedParticipant(trip, "bob-one", "Bob");
  assert.deepEqual(first.participants, trip.participants);
  assert.equal(first.participantMembers?.["bob-one"], "bob");
  const second = registerSharedParticipant(first, "bob-two", "Bob");
  assert.equal(second.participantMembers?.["bob-two"], "member_bob-two");
  assert.equal(second.participants.length, 3);
  assert.equal(second.participantMembers?.["bob-one"], "bob");
  const ambiguous = registerSharedParticipant({ ...trip, participants: [...trip.participants, { id: "other-bob", name: "Bob" }] }, "third-bob", "Bob");
  assert.equal(ambiguous.participantMembers?.["third-bob"], "member_third-bob");
});

test("owner's selected identity is retained without giving invitees control of another person's claim", () => {
  const owner = registerSharedParticipant(trip, "owner", "Host phone", "alice");
  assert.equal(owner.participantMembers?.owner, "alice");
  assert.deepEqual(owner.participants, trip.participants);
  const member = registerSharedParticipant(owner, "mallory", "Mallory", "bob");
  assert.equal(member.participantMembers?.mallory, "member_mallory");
});

test("settlement limit permits claiming an existing person but rejects a new twenty-first person", () => {
  const full = { ...trip, participants: Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, name: `Person ${i}` })) };
  assert.equal(registerSharedParticipant(full, "last-person", "Person 19").participants.length, 20);
  assert.throws(() => registerSharedParticipant(full, "extra", "Extra"), (e) => e instanceof SharedTravelError && e.code === "limit");
  assert.throws(() => registerSharedParticipant(trip, "bad-name", "Two|People"), SharedTravelError);
});

test("cloud mapping preserves legacy headers and rejects forged or duplicate settlement identities", () => {
  const data = toSharedTripData(ledger, "owner");
  assert.ok(parseSharedTrip(ledger.id, data));
  assert.deepEqual(parseSharedTrip(ledger.id, { ...data, participantMembers: { owner: "alice", guest: "bob" } })?.participantMembers, { owner: "alice", guest: "bob" });
  for (const invalid of [[], null, { owner: "missing" }, { owner: "alice", guest: "alice" }, { "bad/uid": "bob" }, { owner: 42 }]) {
    assert.equal(parseSharedTrip(ledger.id, { ...data, participantMembers: invalid }), null);
  }
});
