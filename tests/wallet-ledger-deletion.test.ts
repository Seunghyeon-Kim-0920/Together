import assert from "node:assert/strict";
import test from "node:test";
import { deleteConfirmedLedger, removeConfirmedLedger } from "../src/lib/ledgerDeletion";
import { createLedger } from "../src/lib/wallet";
import { connectSharedLedger } from "../src/lib/sharedTravelLocal";
import { parseSharedTrip, toSharedTripData, type SharedTravelClient } from "../src/lib/sharedTravel";
import { EMPTY_WALLET_STATE } from "../src/lib/types";

const base = { ...createLedger("travel", "Synthetic trip", "EUR"), participants: [{ id: "alice", name: "Alice" }], selfParticipantId: "alice" };
const trip = parseSharedTrip(base.id, toSharedTripData(base, "owner"))!;
const owner = connectSharedLedger(base, trip, "owner");
const member = { ...owner, sharedSync: { ...owner.sharedSync!, uid: "member" } };

test("explicit owner delete/member leave completes remotely before removing local tab", async () => {
  for (const [ledger, scope] of [[owner, "everyone"], [member, "leave"]] as const) {
    const calls: string[] = [];
    const client = { uid: ledger.sharedSync!.uid, deleteTrip: async () => { calls.push("everyone"); }, leaveTrip: async () => { calls.push("leave"); } } as unknown as SharedTravelClient;
    await deleteConfirmedLedger(ledger, scope, async () => client, async () => { calls.push("local"); });
    assert.deepEqual(calls, [scope, "local"]);
  }
});

test("remote failure, identity mismatch and wrong role preserve local ledger", async () => {
  let removed = 0;
  const remove = async () => { removed++; };
  const offline = async () => { throw new Error("offline"); };
  await assert.rejects(deleteConfirmedLedger(owner, "everyone", offline, remove));
  await assert.rejects(deleteConfirmedLedger(owner, "everyone", async () => ({ uid: "different" }) as SharedTravelClient, remove));
  await assert.rejects(deleteConfirmedLedger(member, "everyone", offline, remove));
  await assert.rejects(deleteConfirmedLedger(owner, "leave", offline, remove));
  assert.equal(removed, 0);
  await deleteConfirmedLedger(owner, "device", offline, remove);
  assert.equal(removed, 1);
});

test("local persistence failure propagates instead of claiming deletion; removal preserves other ledgers", async () => {
  await assert.rejects(deleteConfirmedLedger(owner, "device", async () => { throw new Error("must not load"); }, async () => { throw new Error("disk full"); }), /disk full/);
  const other = createLedger("general", "Everyday", "EUR");
  const state = { ...EMPTY_WALLET_STATE, activeLedgerId: owner.id, ledgers: [owner, other] };
  const next = removeConfirmedLedger(state, owner);
  assert.deepEqual(next.ledgers, [other]); assert.equal(next.activeLedgerId, other.id);
  assert.equal(removeConfirmedLedger(next, owner), next);
  const reconnected = { ...owner, sharedSync: { ...owner.sharedSync!, tripId: "another-trip" } };
  assert.throws(() => removeConfirmedLedger({ ...state, ledgers: [reconnected, other] }, owner));
});
