import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, serverTimestamp, setDoc, Timestamp, updateDoc, writeBatch, type Firestore } from "firebase/firestore";
import { createFirebaseSharedTravelClient } from "../src/lib/sharedTravelClient";
import { parseSharedTrip, SharedTravelError, toSharedExpenseData, toSharedTripData, type SharedTripSnapshot } from "../src/lib/sharedTravel";
import { createLedger } from "../src/lib/wallet";
import type { TravelExpense, TravelLedger } from "../src/lib/types";

const emulator = process.env.FIRESTORE_EMULATOR_HOST;
const base: TravelLedger = { ...createLedger("travel", "Paris", "EUR"), id: "shared-trip", participants: [{ id: "alice", name: "Alice" }, { id: "bob", name: "Bob" }], selfParticipantId: "alice" };
const expense: TravelExpense = { id: "expense-one", description: "Cafe", category: "food", currency: "EUR", minorUnits: 1001, occurredOn: "2026-09-19", paidBy: "alice", shares: [{ participantId: "alice", minorUnits: 501 }, { participantId: "bob", minorUnits: 500 }] };
function isCode(code: string) { return (error: unknown) => error instanceof SharedTravelError && error.code === code; }

test("shared travel emulator: isolation, membership, validation, retries and conflicts", { skip: !emulator, timeout: 180_000 }, async (t) => {
  const [host, port] = emulator!.split(":");
  const environment = await initializeTestEnvironment({ projectId: "demo-wallet-diary", firestore: { host, port: Number(port), rules: readFileSync(new URL("../firebase.rules", import.meta.url), "utf8") } });
  const ownerDb = environment.authenticatedContext("owner").firestore() as unknown as Firestore;
  const aliceDb = environment.authenticatedContext("alice-device").firestore() as unknown as Firestore;
  const bobDb = environment.authenticatedContext("bob-device").firestore() as unknown as Firestore;
  const strangerDb = environment.authenticatedContext("stranger").firestore() as unknown as Firestore;
  const anonymousDb = environment.unauthenticatedContext().firestore() as unknown as Firestore;
  const owner = createFirebaseSharedTravelClient(ownerDb, "owner");
  const alice = createFirebaseSharedTravelClient(aliceDb, "alice-device");
  const bob = createFirebaseSharedTravelClient(bobDb, "bob-device");
  let invite = "";
  try {
    await environment.clearFirestore();
    await t.test("creation uploads metadata only; strangers cannot read or enumerate trips", async () => {
      const connection = await owner.createTrip({ ...base, expenses: [expense] }, "Host");
      assert.equal(connection.created, true);
      const trip = connection.trip;
      assert.equal(trip.ownerUid, "owner");
      assert.equal(trip.revision, 1);
      assert.deepEqual(trip.participantMembers, { owner: "alice" });
      assert.deepEqual(await owner.createTrip(base, "Host again"), { trip, created: false });
      assert.equal((await owner.getSnapshot(base.id)).expenses.length, 0);
      await assertFails(getDoc(doc(strangerDb, "sharedTrips", base.id)));
      await assertFails(getDocs(collection(ownerDb, "sharedTrips")));
      await assertFails(getDoc(doc(anonymousDb, "sharedTrips", base.id)));
      await assertFails(setDoc(doc(ownerDb, "privateWallets", "wallet"), { balance: 123 }));
    });
    await t.test("only owner creates invites; token grants precisely one trip", async () => {
      invite = await owner.createInvite(base.id);
      assert.match(invite, /^shared-trip\.[a-f0-9]{64}$/);
      const aliceJoin = await alice.joinTrip(invite, "Alice phone");
      assert.equal(aliceJoin.trip.id, base.id);
      assert.equal(aliceJoin.trip.participantMembers?.["alice-device"], "member_alice-device");
      assert.deepEqual(aliceJoin.trip.participants.at(-1), { id: "member_alice-device", name: "Alice phone" });
      assert.equal((await alice.joinTrip(invite, "Alice phone again")).joined, false);
      const bobJoin = await bob.joinTrip(invite, "Bob");
      assert.equal(bobJoin.joined, true);
      assert.equal(bobJoin.trip.participantMembers?.["bob-device"], "bob");
      assert.equal(bobJoin.trip.participants.length, 3);
      assert.equal(bobJoin.trip.revision, 3);
      assert.deepEqual(await bob.ensureParticipant(base.id), bobJoin.trip);
      assert.equal((await owner.getSnapshot(base.id)).members.length, 3);
      await assert.rejects(alice.createInvite(base.id), isCode("permission-denied"));
      await assertFails(getDocs(collection(aliceDb, "sharedTrips", base.id, "invites")));
      await assert.rejects(alice.joinTrip(`other-trip.${invite.split(".")[1]}`, "Alice"));
    });
    await t.test("same amount from different users remains two expenses; repeated mutation is idempotent", async () => {
      const first = await alice.publishExpense(base.id, { id: expense.id, expense, expectedRevision: 0, mutationId: "alice-create" });
      const replay = await alice.publishExpense(base.id, { id: expense.id, expense, expectedRevision: 0, mutationId: "alice-create" });
      assert.deepEqual(first, replay);
      await bob.publishExpense(base.id, { id: "expense-two", expense: { ...expense, id: "expense-two" }, expectedRevision: 0, mutationId: "bob-create" });
      assert.equal((await owner.getSnapshot(base.id)).expenses.length, 2);
      await assert.rejects(bob.publishExpense(base.id, { id: expense.id, expense: { ...expense, description: "Hijacked" }, expectedRevision: 1, mutationId: "bob-hijack" }), isCode("permission-denied"));
    });
    await t.test("stale financial edits conflict; owner can edit with preserved author attribution", async () => {
      const updated = await owner.publishExpense(base.id, { id: expense.id, expense: { ...expense, description: "Edited cafe" }, expectedRevision: 1, mutationId: "owner-edit" });
      assert.equal(updated.authorUid, "alice-device"); assert.equal(updated.updatedBy, "owner");
      await assert.rejects(alice.publishExpense(base.id, { id: expense.id, expense, expectedRevision: 1, mutationId: "alice-stale" }), isCode("conflict"));
      assert.equal((await alice.getSnapshot(base.id)).expenses.find((record) => record.id === expense.id)?.expense?.description, "Edited cafe");
    });
    await t.test("rules reject malformed amounts, dates, shares, metadata and private notification fields", async () => {
      const trip = (await owner.createTrip(base, "Host")).trip;
      const safe = toSharedExpenseData({ ...expense, id: "malformed" }, trip, "alice-device", "alice-device", 1, "malformed-create");
      for (const change of [{ minorUnits: -1001 }, { minorUnits: 1001.5 }, { shareMinorUnits: [500, 500] }, { participantIds: ["alice", "alice"] }, { occurredOn: "2025-02-29" }, { occurredOn: "2026-04-31" }, { rawNotification: "sensitive" }, { category: "unknown" }]) {
        await assertFails(setDoc(doc(aliceDb, "sharedTrips", base.id, "expenses", "malformed"), { ...safe, ...change, updatedAt: serverTimestamp() }));
      }
      await assertFails(updateDoc(doc(ownerDb, "sharedTrips", base.id), { participantNames: trip.participants.map((person, index) => index === 0 ? "Changed" : person.name), revision: trip.revision + 1, updatedAt: serverTimestamp() }));
      const currentLedger = { ...base, participants: [...trip.participants] };
      const renamed = await owner.updateTrip(base.id, { ...currentLedger, title: "Renamed trip" }, trip.revision);
      assert.equal(renamed.title, "Renamed trip");
      assert.deepEqual(renamed.participantMembers, trip.participantMembers);
      await assert.rejects(alice.updateTrip(base.id, { ...currentLedger, title: "Other title" }, renamed.revision), isCode("permission-denied"));
    });
    await t.test("twenty-person unequal split fits security rule limits without accepting invalid totals", async () => {
      const large: TravelLedger = { ...base, id: "large-trip", selfParticipantId: "person-0", participants: Array.from({ length: 20 }, (_, index) => ({ id: `person-${index}`, name: `Person ${index}` })) };
      const trip = (await owner.createTrip(large, "Host")).trip;
      const paid: TravelExpense = { ...expense, id: "twenty-split", paidBy: "person-0", minorUnits: 2001, shares: large.participants.map((person, index) => ({ participantId: person.id, minorUnits: index === 0 ? 101 : 100 })) };
      assert.equal((await owner.publishExpense(trip.id, { id: paid.id, expense: paid, expectedRevision: 0, mutationId: "large-create" })).expense?.minorUnits, 2001);
      await owner.deleteTrip(trip.id);
    });
    await t.test("concurrent invite joins append each participant once and preserve existing financial shares", async () => {
      const concurrent: TravelLedger = { ...base, id: "concurrent-trip" };
      await owner.createTrip(concurrent, "Host");
      await owner.publishExpense(concurrent.id, { id: expense.id, expense, expectedRevision: 0, mutationId: "before-joining" });
      const code = await owner.createInvite(concurrent.id);
      const charlieDb = environment.authenticatedContext("charlie-device").firestore() as unknown as Firestore;
      const danaDb = environment.authenticatedContext("dana-device").firestore() as unknown as Firestore;
      const charlie = createFirebaseSharedTravelClient(charlieDb, "charlie-device");
      const dana = createFirebaseSharedTravelClient(danaDb, "dana-device");
      await Promise.all([charlie.joinTrip(code, "Charlie"), dana.joinTrip(code, "Dana")]);
      const snapshot = await owner.getSnapshot(concurrent.id);
      assert.equal(snapshot.trip.participants.length, 4);
      assert.equal(snapshot.trip.participantMembers?.["charlie-device"], "member_charlie-device");
      assert.equal(snapshot.trip.participantMembers?.["dana-device"], "member_dana-device");
      assert.equal(snapshot.trip.revision, 3);
      assert.deepEqual(snapshot.expenses[0].expense?.shares, expense.shares);
      await Promise.all([charlie.ensureParticipant(concurrent.id), dana.ensureParticipant(concurrent.id)]);
      assert.deepEqual((await owner.getSnapshot(concurrent.id)).trip, snapshot.trip);
      const ownExpense: TravelExpense = { ...expense, id: "new-member-expense", paidBy: "member_charlie-device", minorUnits: 400, shares: snapshot.trip.participants.map((person) => ({ participantId: person.id, minorUnits: 100 })) };
      await charlie.publishExpense(concurrent.id, { id: ownExpense.id, expense: ownExpense, expectedRevision: 0, mutationId: "charlie-pays" });
      assert.deepEqual((await dana.getSnapshot(concurrent.id)).expenses.find((record) => record.id === ownExpense.id)?.expense, ownExpense);
      await charlie.leaveTrip(concurrent.id);
      assert.deepEqual((await owner.getSnapshot(concurrent.id)).trip, snapshot.trip);
      const rejoined = await charlie.joinTrip(code, "Charlie renamed");
      assert.equal(rejoined.joined, true);
      assert.deepEqual(rejoined.trip, snapshot.trip);
      await owner.deleteTrip(concurrent.id);
    });
    await t.test("old schema-one trips register owner self and an exact-name member without duplicating people", async () => {
      const legacy = { ...base, id: "legacy-trip" };
      const writes = writeBatch(ownerDb);
      writes.set(doc(ownerDb, "sharedTrips", legacy.id), { ...toSharedTripData(legacy, "owner"), updatedAt: serverTimestamp() });
      writes.set(doc(ownerDb, "sharedTrips", legacy.id, "members", "owner"), { schema: 1, role: "owner", displayName: "Host", joinedAt: serverTimestamp() });
      await assertSucceeds(writes.commit());
      const registered = await owner.ensureParticipant(legacy.id, "alice");
      assert.deepEqual(registered.participants, legacy.participants);
      assert.deepEqual(registered.participantMembers, { owner: "alice" });
      const joined = await bob.joinTrip(await owner.createInvite(legacy.id), "Bob");
      assert.deepEqual(joined.trip.participants, legacy.participants);
      assert.deepEqual(joined.trip.participantMembers, { owner: "alice", "bob-device": "bob" });
      await owner.deleteTrip(legacy.id);
    });
    await t.test("live owner listener receives a newly joined payer and their expense without an invalid-data interruption", { timeout: 45_000 }, async () => {
      const live = { ...base, id: "live-join-trip" };
      await owner.createTrip(live, "Host");
      const code = await owner.createInvite(live.id);
      const joinerDb = environment.authenticatedContext("live-joiner").firestore() as unknown as Firestore;
      const joiner = createFirebaseSharedTravelClient(joinerDb, "live-joiner");
      let latest: SharedTripSnapshot | null = null;
      const errors: SharedTravelError[] = [];
      let waiting: { accepts: (snapshot: SharedTripSnapshot) => boolean; resolve: (snapshot: SharedTripSnapshot) => void; reject: (error: unknown) => void; timer: ReturnType<typeof setTimeout> } | null = null;
      function waitFor(accepts: (snapshot: SharedTripSnapshot) => boolean): Promise<SharedTripSnapshot> {
        if (errors.length) return Promise.reject(errors[0]);
        if (latest && accepts(latest)) return Promise.resolve(latest);
        assert.equal(waiting, null);
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => { waiting = null; reject(new Error("Timed out waiting for live shared-trip snapshot")); }, 15_000);
          waiting = { accepts, resolve, reject, timer };
        });
      }
      function clearWaitingTimer(): void { if (waiting) { clearTimeout(waiting.timer); waiting = null; } }
      const stop = owner.listenTrip(live.id, (snapshot) => {
        latest = snapshot;
        if (waiting?.accepts(snapshot)) {
          const current = waiting; waiting = null; clearTimeout(current.timer); current.resolve(snapshot);
        }
      }, (error) => {
        errors.push(error);
        if (waiting) {
          const current = waiting; waiting = null; clearTimeout(current.timer); current.reject(error);
        }
      });
      try {
        const initial = await waitFor((snapshot) => !snapshot.fromCache && snapshot.trip.revision === 1);
        assert.equal(initial.trip.participants.length, 2);
        assert.equal(initial.expenses.length, 0);
        const joined = await joiner.joinTrip(code, "New traveler");
        const participantId = joined.trip.participantMembers?.["live-joiner"];
        assert.equal(participantId, "member_live-joiner");
        const ownExpense: TravelExpense = { ...expense, id: "live-new-payer", paidBy: participantId!, minorUnits: 200, shares: [{ participantId: participantId!, minorUnits: 200 }] };
        await joiner.publishExpense(live.id, { id: ownExpense.id, expense: ownExpense, expectedRevision: 0, mutationId: "live-new-payer-create" });
        const updated = await waitFor((snapshot) => !snapshot.fromCache && snapshot.expenses.some((record) => record.id === ownExpense.id) && snapshot.members.some((member) => member.uid === "live-joiner"));
        assert.deepEqual(updated.trip.participants.find((person) => person.id === participantId), { id: participantId, name: "New traveler" });
        assert.equal(updated.trip.participants.length, 3);
        assert.deepEqual(updated.expenses.find((record) => record.id === ownExpense.id)?.expense, ownExpense);
        assert.equal(updated.members.some((member) => member.uid === "live-joiner"), true);
        assert.deepEqual(errors, []);
      } finally {
        stop();
        clearWaitingTimer();
      }
      await owner.deleteTrip(live.id);
    });
    await t.test("registration rules reject other identities, claimed people, forged names and unrelated metadata changes", async () => {
      const guardedTrip = { ...base, id: "registration-guard-trip" };
      const trip = (await owner.createTrip(guardedTrip, "Host")).trip;
      const code = await owner.createInvite(guardedTrip.id);
      const token = code.split(".")[1];
      const newcomerDb = environment.authenticatedContext("newcomer").firestore() as unknown as Firestore;
      await assertSucceeds(setDoc(doc(newcomerDb, "sharedTrips", guardedTrip.id, "members", "newcomer"), { schema: 1, role: "member", displayName: "Eve", inviteToken: token, joinedAt: serverTimestamp() }));
      const correct = { participantIds: [...trip.participants.map((person) => person.id), "member_newcomer"], participantNames: [...trip.participants.map((person) => person.name), "Eve"], participantMembers: { ...trip.participantMembers, newcomer: "member_newcomer" }, revision: trip.revision + 1, updatedAt: serverTimestamp() };
      for (const change of [
        { participantMembers: { ...trip.participantMembers, someoneElse: "member_newcomer" } },
        { participantMembers: { ...trip.participantMembers, newcomer: "alice" } },
        { participantMembers: { owner: "bob", newcomer: "member_newcomer" } },
        { participantMembers: { newcomer: "member_newcomer" } },
        { participantIds: ["alice", "bob"], participantNames: ["Alice", "Bob"], participantMembers: { ...trip.participantMembers, newcomer: "bob" } },
        { participantNames: ["Alice", "Bob", "Forged name"] },
        { participantNames: ["Changed", "Bob", "Eve"] },
        { participantIds: ["alice", "bob", "arbitrary-id"], participantMembers: { ...trip.participantMembers, newcomer: "arbitrary-id" } },
        { title: "Hijacked title" }, { currencies: ["USD"], defaultCurrency: "USD" }, { deleted: true },
      ]) await assertFails(updateDoc(doc(newcomerDb, "sharedTrips", guardedTrip.id), { ...correct, ...change }));
      await assertSucceeds(updateDoc(doc(newcomerDb, "sharedTrips", guardedTrip.id), correct));
      const snapshot = await owner.getSnapshot(guardedTrip.id);
      assert.equal(snapshot.trip.participantMembers?.newcomer, "member_newcomer");
      await assertFails(setDoc(doc(newcomerDb, "privateWallets", "wallet"), { amount: 50 }));
      await owner.deleteTrip(guardedTrip.id);
    });
    await t.test("ambiguous equal names cannot claim another existing settlement identity", async () => {
      const named = { ...base, id: "duplicate-name-trip", participants: [base.participants[0], { id: "sam-one", name: "Sam" }, { id: "sam-two", name: "Sam" }] };
      const trip = (await owner.createTrip(named, "Host")).trip;
      const code = await owner.createInvite(named.id);
      const samDb = environment.authenticatedContext("sam-device").firestore() as unknown as Firestore;
      await setDoc(doc(samDb, "sharedTrips", named.id, "members", "sam-device"), { schema: 1, role: "member", displayName: "Sam", inviteToken: code.split(".")[1], joinedAt: serverTimestamp() });
      await assertFails(updateDoc(doc(samDb, "sharedTrips", named.id), { participantMembers: { ...trip.participantMembers, "sam-device": "sam-one" }, revision: trip.revision + 1, updatedAt: serverTimestamp() }));
      const registered = await createFirebaseSharedTravelClient(samDb, "sam-device").ensureParticipant(named.id);
      assert.equal(registered.participants.length, 4);
      assert.equal(registered.participantMembers?.["sam-device"], "member_sam-device");
      await owner.deleteTrip(named.id);
    });
    await t.test("full participant list rejects a new person, rolls back membership and still permits an existing exact-name person", async () => {
      const full = { ...base, id: "full-trip", selfParticipantId: "person-0", participants: Array.from({ length: 20 }, (_, index) => ({ id: `person-${index}`, name: `Person ${index}` })) };
      const trip = (await owner.createTrip(full, "Host")).trip;
      const code = await owner.createInvite(full.id);
      await assert.rejects(alice.joinTrip(code, "New person"), isCode("limit"));
      assert.equal((await getDoc(doc(aliceDb, "sharedTrips", full.id, "members", "alice-device"))).exists(), false);
      assert.deepEqual((await owner.getSnapshot(full.id)).trip, trip);
      const joined = await bob.joinTrip(code, "Person 19");
      assert.equal(joined.trip.participantMembers?.["bob-device"], "person-19");
      assert.equal(joined.trip.participants.length, 20);
      await owner.deleteTrip(full.id);
    });
    await t.test("list round-trip validation rejects number coercion and separator injection", async () => {
      const safe = toSharedTripData(base, "owner");
      for (const fields of [{ participantNames: [123, "Bob"] }, { participantNames: ["Alice|Injected", "Bob"] }, { participantIds: [], participantNames: [] }, { participantIds: [123, "bob"] }, { currencies: [123], defaultCurrency: 123 }]) {
        await assertFails(setDoc(doc(ownerDb, "sharedTrips", "bad-list"), { ...safe, ...fields, updatedAt: serverTimestamp() }));
      }
    });
    await t.test("new trip mapping can bind only the creator to a valid settlement participant", async () => {
      const safe = toSharedTripData(base, "owner");
      for (const participantMembers of [{ intruder: "bob" }, { owner: "missing" }, { owner: "alice", intruder: "alice" }, { owner: 123 }, ["alice"]]) {
        const writes = writeBatch(ownerDb);
        writes.set(doc(ownerDb, "sharedTrips", "bad-member-map"), { ...safe, participantMembers, updatedAt: serverTimestamp() });
        writes.set(doc(ownerDb, "sharedTrips", "bad-member-map", "members", "owner"), { schema: 1, role: "owner", displayName: "Host", joinedAt: serverTimestamp() });
        await assertFails(writes.commit());
      }
    });
    await t.test("deleting a never-uploaded expense creates an idempotent tombstone", async () => {
      const op = { id: "offline-deleted", expense: null, expectedRevision: 0, mutationId: "offline-delete" };
      const first = await alice.publishExpense(base.id, op);
      assert.equal(first.deleted, true);
      assert.deepEqual(await alice.publishExpense(base.id, op), first);
    });
    await t.test("revoked and expired invite tokens cannot admit another device", async () => {
      const revoked = await owner.createInvite(base.id); await owner.revokeInvite(revoked);
      const stranger = createFirebaseSharedTravelClient(strangerDb, "stranger");
      await assert.rejects(stranger.joinTrip(revoked, "Stranger"));
      const token = "e".repeat(64);
      await environment.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore() as unknown as Firestore, "sharedTrips", base.id, "invites", token), { schema: 1, ownerUid: "owner", expiresAt: Timestamp.fromMillis(Date.now() - 60_000), createdAt: Timestamp.now() });
      });
      await assert.rejects(stranger.joinTrip(`${base.id}.${token}`, "Stranger"));
    });
    await t.test("owner app limits outstanding invitations before they exhaust member storage", async () => {
      const capped = { ...base, id: "invite-limit-trip" };
      await owner.createTrip(capped, "Host");
      await environment.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore() as unknown as Firestore;
        const writes = writeBatch(db);
        for (let index = 0; index < 20; index += 1) writes.set(doc(db, "sharedTrips", capped.id, "invites", String(index).padStart(64, "a")), {
          schema: 1, ownerUid: "owner", expiresAt: Timestamp.fromMillis(Date.now() + 60_000), createdAt: Timestamp.now(),
        });
        await writes.commit();
      });
      await assert.rejects(owner.createInvite(capped.id), isCode("limit"));
      await owner.deleteTrip(capped.id);
    });
    await t.test("member revocation blocks reads/writes and old-invite rejoining", async () => {
      const before = (await owner.getSnapshot(base.id)).trip;
      await owner.revokeMember(base.id, "bob-device");
      await assert.rejects(bob.getSnapshot(base.id), isCode("permission-denied"));
      await assert.rejects(bob.ensureParticipant(base.id), isCode("permission-denied"));
      await assert.rejects(bob.publishExpense(base.id, { id: "expense-three", expense: { ...expense, id: "expense-three" }, expectedRevision: 0, mutationId: "bob-late" }), isCode("permission-denied"));
      await assert.rejects(bob.joinTrip(invite, "Bob again"));
      assert.equal((await owner.getSnapshot(base.id)).members.length, 2);
      assert.deepEqual((await owner.getSnapshot(base.id)).trip, before);
    });
    await t.test("explicit leave removes access; only owner can delete the shared trip", async () => {
      await assert.rejects(alice.deleteTrip(base.id), isCode("permission-denied"));
      await alice.leaveTrip(base.id);
      await assert.rejects(alice.getSnapshot(base.id), isCode("permission-denied"));
      await assert.rejects(owner.leaveTrip(base.id), isCode("invalid-data"));
      await owner.deleteTrip(base.id);
      await assertSucceeds(getDoc(doc(ownerDb, "sharedTrips", base.id)));
      await environment.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore() as unknown as Firestore;
        for (const name of ["expenses", "members", "invites", "blocked"]) assert.equal((await getDocs(collection(db, "sharedTrips", base.id, name))).empty, true);
      });
    });
  } finally { await environment.cleanup(); }
});

test("raw cloud serializer still accepts all supported travel categories", () => {
  const trip = parseSharedTrip(base.id, toSharedTripData(base, "owner"))!;
  for (const category of ["accommodation", "transport", "food", "activities", "shopping", "insurance", "other"] as const) assert.equal(toSharedExpenseData({ ...expense, category }, trip, "owner", "owner", 1, "mutation").category, category);
});
