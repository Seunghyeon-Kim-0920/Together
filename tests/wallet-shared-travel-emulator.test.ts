import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, serverTimestamp, setDoc, Timestamp, updateDoc, writeBatch, type Firestore } from "firebase/firestore";
import { createFirebaseSharedTravelClient } from "../src/lib/sharedTravelClient";
import { parseSharedTrip, SharedTravelError, toSharedExpenseData, toSharedTripData } from "../src/lib/sharedTravel";
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
      assert.equal((await alice.joinTrip(invite, "Alice phone")).trip.id, base.id);
      assert.equal((await alice.joinTrip(invite, "Alice phone again")).joined, false);
      assert.equal((await bob.joinTrip(invite, "Bob phone")).joined, true);
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
      await assertFails(updateDoc(doc(ownerDb, "sharedTrips", base.id), { participantNames: ["Changed", "Bob"], revision: 2, updatedAt: serverTimestamp() }));
      const renamed = await owner.updateTrip(base.id, { ...base, title: "Renamed trip" }, 1);
      assert.equal(renamed.title, "Renamed trip");
      await assert.rejects(alice.updateTrip(base.id, { ...base, title: "Other title" }, 2), isCode("permission-denied"));
    });
    await t.test("twenty-person unequal split fits security rule limits without accepting invalid totals", async () => {
      const large: TravelLedger = { ...base, id: "large-trip", participants: Array.from({ length: 20 }, (_, index) => ({ id: `person-${index}`, name: `Person ${index}` })) };
      const trip = (await owner.createTrip(large, "Host")).trip;
      const paid: TravelExpense = { ...expense, id: "twenty-split", paidBy: "person-0", minorUnits: 2001, shares: large.participants.map((person, index) => ({ participantId: person.id, minorUnits: index === 0 ? 101 : 100 })) };
      assert.equal((await owner.publishExpense(trip.id, { id: paid.id, expense: paid, expectedRevision: 0, mutationId: "large-create" })).expense?.minorUnits, 2001);
      await owner.deleteTrip(trip.id);
    });
    await t.test("list round-trip validation rejects number coercion and separator injection", async () => {
      const safe = toSharedTripData(base, "owner");
      for (const fields of [{ participantNames: [123, "Bob"] }, { participantNames: ["Alice|Injected", "Bob"] }, { participantIds: [], participantNames: [] }, { participantIds: [123, "bob"] }, { currencies: [123], defaultCurrency: 123 }]) {
        await assertFails(setDoc(doc(ownerDb, "sharedTrips", "bad-list"), { ...safe, ...fields, updatedAt: serverTimestamp() }));
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
      await owner.revokeMember(base.id, "bob-device");
      await assert.rejects(bob.getSnapshot(base.id), isCode("permission-denied"));
      await assert.rejects(bob.publishExpense(base.id, { id: "expense-three", expense: { ...expense, id: "expense-three" }, expectedRevision: 0, mutationId: "bob-late" }), isCode("permission-denied"));
      await assert.rejects(bob.joinTrip(invite, "Bob again"));
      assert.equal((await owner.getSnapshot(base.id)).members.length, 2);
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
