import assert from "node:assert/strict";
import test from "node:test";
import { createLedgerSharePayload, createTravelSharePayload, parseLedgerShareDocument, parseLedgerSharePayload, shareTravelLedgerFile } from "../src/lib/share";
import { previewTravelLedgerMerge, type ParticipantMapping } from "../src/lib/travelExchange";
import type { GeneralLedger, TravelExpense, TravelLedger } from "../src/lib/types";
import { createLedger, parseLedger, preserveTravelShares, settleTravelExpenses } from "../src/lib/wallet";

const people = Object.freeze([{ id: "alice", name: "Alice" }, { id: "bob", name: "Bob" }]);
const paidDinner: TravelExpense = Object.freeze({ id: "dinner-1", description: "Dinner", category: "food", currency: "EUR", minorUnits: 3001, occurredOn: "2026-08-31", paidBy: "alice", shares: Object.freeze([{ participantId: "alice", minorUnits: 1501 }, { participantId: "bob", minorUnits: 1500 }]) });
const newPeople: ParticipantMapping = { alice: { kind: "new" }, bob: { kind: "new" } };
function trip(id: string, expenses: readonly TravelExpense[] = []): TravelLedger {
  return Object.freeze({ ...createLedger("travel", "Summer", "EUR"), id, participants: people, selfParticipantId: "alice", expenses: Object.freeze(expenses) });
}

test("editing an imported unequal split preserves shares until split inputs change", () => {
  const imported: TravelExpense = Object.freeze({ ...paidDinner, shares: Object.freeze([{ participantId: "alice", minorUnits: 2200 }, { participantId: "bob", minorUnits: 801 }]) });
  assert.deepEqual(preserveTravelShares(imported, 3001, "EUR", ["bob", "alice"]), imported.shares);
  assert.equal(preserveTravelShares(imported, 3000, "EUR", ["alice", "bob"]), null);
  assert.equal(preserveTravelShares(imported, 3001, "USD", ["alice", "bob"]), null);
  assert.equal(preserveTravelShares(imported, 3001, "EUR", ["alice"]), null);
});

test("share documents preserve source, person and expense IDs while dropping private identity", () => {
  const source = trip("source", [paidDinner]);
  const document = parseLedgerShareDocument(createTravelSharePayload(source));
  assert.equal(document?.sourceLedgerId, "source");
  assert.equal(document?.ledger.id, "source");
  assert.equal(document?.ledger.kind === "travel" && document.ledger.selfParticipantId, null);
  assert.deepEqual(document?.ledger.expenses, source.expenses);
  assert.deepEqual(document?.ledger.kind === "travel" && document.ledger.participants, people);
  const newTab = parseLedgerSharePayload(createTravelSharePayload(source));
  assert.notEqual(newTab?.id, "source");
  assert.deepEqual(newTab?.expenses, source.expenses);
});

test("general documents strip forged private fields and retain opaque IDs through a roundtrip", () => {
  const source: GeneralLedger = { ...createLedger("general", "Home", "EUR"), monthlyLimitMinor: 999, automationAllApps: true, movedExpenseIds: ["secret-moved"], expenses: [{ id: "card-auto-1234567890abcdef", description: "Cafe", category: "food", currency: "EUR", minorUnits: 100, occurredOn: "2026-09-01", automationFingerprint: "card-origin-1234567890abcdef" }] };
  const payload = createLedgerSharePayload(source);
  assert.equal(payload.includes("secret-moved"), false);
  const first = parseLedgerShareDocument(payload)?.ledger;
  assert.equal(first?.kind, "general");
  if (first?.kind !== "general") throw new Error("expected general");
  assert.equal(first.automationAllApps, false);
  assert.equal(first.monthlyLimitMinor, null);
  assert.deepEqual(first.movedExpenseIds, []);
  assert.equal(first.expenses[0].automationFingerprint, undefined);
  const second = parseLedgerShareDocument(createLedgerSharePayload(first))?.ledger;
  assert.equal(second?.expenses[0].id, first.expenses[0].id);
});

test("merge previews exact totals and settlements after explicit person mapping", () => {
  const target = Object.freeze({ ...trip("mine"), participants: [{ id: "me", name: "Me" }, { id: "friend", name: "Friend" }], selfParticipantId: "me" });
  const result = previewTravelLedgerMerge(target, trip("friend-copy", [paidDinner]), { alice: { kind: "existing", participantId: "friend" }, bob: { kind: "existing", participantId: "me" } });
  assert.equal(result.ok, true);
  assert.equal(result.addedExpenseCount, 1);
  assert.deepEqual(result.addedTotals, [{ currency: "EUR", minorUnits: 3001 }]);
  assert.deepEqual(result.resultTotals, result.addedTotals);
  assert.equal(result.ledger?.selfParticipantId, "me");
  assert.equal(result.ledger?.expenses[0].paidBy, "friend");
  assert.deepEqual(settleTravelExpenses(result.ledger!)[0].transfers, [{ from: "me", to: "friend", currency: "EUR", minorUnits: 1500 }]);
  assert.equal(target.expenses.length, 0);
});

test("repeated imports and independently cloned tabs do not duplicate people or expenses", () => {
  const source = trip("source", [paidDinner]);
  const target = Object.freeze({ ...trip("target"), participants: [], selfParticipantId: null });
  const first = previewTravelLedgerMerge(target, source, newPeople);
  assert.equal(first.addedParticipantCount, 2);
  const clone = parseLedgerSharePayload(createTravelSharePayload(source));
  assert.equal(clone?.kind, "travel");
  const repeated = previewTravelLedgerMerge(first.ledger!, clone as TravelLedger, newPeople);
  assert.equal(repeated.addedExpenseCount, 0);
  assert.equal(repeated.duplicateExpenseCount, 1);
  assert.equal(repeated.addedParticipantCount, 0);
  assert.deepEqual(repeated.ledger, first.ledger);
  const forwarded = parseLedgerShareDocument(createTravelSharePayload(first.ledger!))!.ledger as TravelLedger;
  const roundtrip = previewTravelLedgerMerge(source, forwarded, newPeople);
  assert.equal(roundtrip.duplicateExpenseCount, 1);
  assert.equal(roundtrip.ledger?.expenses.length, 1);
});

test("a same-ID conflict preserves local corrections and reports both records", () => {
  const edited = Object.freeze({ ...paidDinner, description: "Edited locally", minorUnits: 2000, shares: [{ participantId: "alice", minorUnits: 1000 }, { participantId: "bob", minorUnits: 1000 }] });
  const result = previewTravelLedgerMerge(trip("local", [edited]), trip("incoming", [paidDinner]), newPeople);
  assert.equal(result.ok, true);
  assert.equal(result.addedExpenseCount, 0);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].expenseId, paidDinner.id);
  assert.equal(result.conflicts[0].incoming.minorUnits, 3001);
  assert.equal(result.ledger?.expenses[0].description, "Edited locally");
  assert.deepEqual(result.resultTotals, [{ currency: "EUR", minorUnits: 2000 }]);
});

test("different currencies retain exact original amounts and settle independently", () => {
  const source = Object.freeze({ ...trip("source", [{ ...paidDinner, id: "dinner-usd", currency: "USD" }]), currencies: ["USD"], defaultCurrency: "USD" });
  const result = previewTravelLedgerMerge(trip("target", [paidDinner]), source, newPeople);
  assert.equal(result.ok, true);
  assert.deepEqual(result.addedTotals, [{ currency: "USD", minorUnits: 3001 }]);
  assert.deepEqual(result.resultTotals, [{ currency: "EUR", minorUnits: 3001 }, { currency: "USD", minorUnits: 3001 }]);
  assert.deepEqual(settleTravelExpenses(result.ledger!).map((settlement) => settlement.transfers), [[{ from: "bob", to: "alice", currency: "EUR", minorUnits: 1500 }], [{ from: "bob", to: "alice", currency: "USD", minorUnits: 1500 }]]);
});

test("share ordering is irrelevant and explicit many-to-one mappings sum a person's shares", () => {
  const reversed = Object.freeze({ ...paidDinner, shares: [...paidDinner.shares].reverse() });
  assert.equal(previewTravelLedgerMerge(trip("target", [paidDinner]), trip("source", [reversed]), newPeople).duplicateExpenseCount, 1);
  const target = Object.freeze({ ...trip("target"), participants: [{ id: "me", name: "Me" }], selfParticipantId: "me" });
  const merged = previewTravelLedgerMerge(target, trip("source", [paidDinner]), { alice: { kind: "existing", participantId: "me" }, bob: { kind: "existing", participantId: "me" } });
  assert.equal(merged.ok, true);
  assert.deepEqual(merged.ledger?.expenses[0].shares, [{ participantId: "me", minorUnits: 3001 }]);
  assert.deepEqual(settleTravelExpenses(merged.ledger!)[0].transfers, []);
});

test("same names never merge implicitly, while existing stable-ID name edits survive", () => {
  const target = Object.freeze({ ...trip("target"), participants: [{ id: "another-alice", name: "Alice" }], selfParticipantId: null });
  const result = previewTravelLedgerMerge(target, trip("source"), newPeople);
  assert.equal(result.ledger?.participants.length, 3);
  const renamed = Object.freeze({ ...trip("target"), participants: [{ id: "alice", name: "Renamed" }, people[1]] });
  assert.equal(previewTravelLedgerMerge(renamed, trip("source"), newPeople).ledger?.participants[0].name, "Renamed");
});

test("missing/unknown people and forged payer/splits fail before any result can apply", () => {
  const target = trip("target"); const source = trip("source", [paidDinner]);
  assert.equal(previewTravelLedgerMerge(target, source, {}).errors[0].code, "missing-participant-mapping");
  assert.equal(previewTravelLedgerMerge(target, source, { ...newPeople, ghost: { kind: "new" } }).errors[0].code, "unknown-source-participant");
  assert.equal(previewTravelLedgerMerge(target, source, { ...newPeople, alice: { kind: "existing", participantId: "unknown" } }).errors[0].code, "unknown-target-participant");
  for (const expense of [{ ...paidDinner, paidBy: "ghost" }, { ...paidDinner, shares: [{ participantId: "ghost", minorUnits: 3001 }] }, { ...paidDinner, shares: [{ participantId: "alice", minorUnits: 3000 }] }]) {
    const result = previewTravelLedgerMerge(target, trip("source", [expense]), newPeople);
    assert.equal(result.ok, false); assert.equal(result.ledger, null); assert.equal(result.errors[0].code, "invalid-source");
  }
});

test("all-or-nothing limits protect expenses, people, currencies and integer totals", () => {
  const target = trip("target", Array.from({ length: 5000 }, (_, index) => ({ ...paidDinner, id: `existing-${index}` })));
  assert.equal(previewTravelLedgerMerge(target, trip("source", [paidDinner]), newPeople).errors[0].code, "expense-limit");
  const fullPeople = Object.freeze({ ...trip("full-people"), participants: Array.from({ length: 100 }, (_, index) => ({ id: `person-${index}`, name: `Person ${index}` })), selfParticipantId: null });
  assert.equal(previewTravelLedgerMerge(fullPeople, trip("source"), newPeople).errors[0].code, "participant-limit");
  const codes = Array.from({ length: 20 }, (_, index) => `AA${String.fromCharCode(65 + index)}`);
  const fullCurrencies = Object.freeze({ ...trip("currencies"), currencies: codes, defaultCurrency: codes[0] });
  assert.equal(previewTravelLedgerMerge(fullCurrencies, trip("source"), newPeople).errors[0].code, "currency-limit");
  const huge = Object.freeze({ ...paidDinner, minorUnits: Number.MAX_SAFE_INTEGER, shares: [{ participantId: "alice", minorUnits: Number.MAX_SAFE_INTEGER }] });
  const overflow = previewTravelLedgerMerge(trip("large", [huge]), trip("source", [{ ...paidDinner, id: "another" }]), newPeople);
  assert.equal(overflow.errors[0].code, "amount-overflow"); assert.equal(overflow.ledger, null);
  assert.equal(parseLedger(trip("too-many", Array.from({ length: 5001 }, (_, index) => ({ ...paidDinner, id: `${index}` })))), null);
});

test("web file sharing sends an importable UTF-8 walletdiary attachment with every record", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  let receivedFile: File | undefined;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { canShare: ({ files }: { files: File[] }) => files.length === 1, share: async ({ files }: { files: File[] }) => { receivedFile = files[0]; } } });
  try {
    await shareTravelLedgerFile({ ...trip("source", [paidDinner]), title: "파리 여행" });
    assert.equal(receivedFile?.name, "파리 여행.walletdiary");
    const document = parseLedgerShareDocument(await receivedFile!.text());
    assert.equal(document?.ledger.title, "파리 여행");
    assert.deepEqual(document?.ledger.expenses, [paidDinner]);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "navigator", descriptor);
    else Reflect.deleteProperty(globalThis, "navigator");
  }
});

test("malformed and oversized share documents fail closed", () => {
  const valid = createTravelSharePayload(trip("source", [paidDinner]));
  assert.equal(parseLedgerShareDocument(valid.replace('"version":1', '"version":99')), null);
  assert.equal(parseLedgerShareDocument(valid.replace('"paidBy":"alice"', '"paidBy":"unknown"')), null);
  assert.equal(parseLedgerShareDocument(" ".repeat(2_000_001)), null);
  assert.equal(parseLedgerShareDocument("{"), null);
});
