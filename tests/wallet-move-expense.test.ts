import assert from "node:assert/strict";
import test from "node:test";
import { applyHighConfidenceCardAutomation, automationExpenseId, confirmCardCandidate, type NativeCardCandidate } from "../src/lib/cardAutomation";
import { moveGeneralExpenseToTravel, type MoveGeneralExpenseToTravelInput } from "../src/lib/moveExpense";
import { createLedgerSharePayload, parseLedgerSharePayload } from "../src/lib/share";
import { publicExpenseId } from "../src/lib/expenseIdentity";
import type { GeneralExpense, GeneralLedger, TravelLedger, WalletState } from "../src/lib/types";
import { createLedger, MAX_EXPENSES_PER_LEDGER, mergeGeneralLedgerMutation, mergeGeneralLedgers, parseLedger, parseWalletStateStrict, settleTravelExpenses } from "../src/lib/wallet";

const purchase: NativeCardCandidate = Object.freeze({ id: "native-payment", queueToken: null, packageName: "com.example.bank", sourceName: "Example Bank", merchant: "Trip dinner", minorUnits: 1001, currency: "EUR", occurredAt: "2026-09-04T18:00:00+02:00", occurredOn: "2026-09-04", confidence: "high", eventType: "purchase", manualOnly: false });
const expense: GeneralExpense = Object.freeze({ id: "source-expense", description: "Dinner by the river", category: "food", currency: "EUR", minorUnits: 1001, occurredOn: "2026-09-04" });

function fixtures() {
  const source: GeneralLedger = Object.freeze({ ...createLedger("general", "생활", "EUR"), expenses: Object.freeze([expense]), automationSources: Object.freeze([{ packageName: purchase.packageName, displayName: purchase.sourceName, trustedDirectApp: true as const }]) });
  const target: TravelLedger = Object.freeze({ ...createLedger("travel", "Paris", "USD"), participants: Object.freeze([{ id: "me", name: "Me" }, { id: "friend", name: "Friend" }]), selfParticipantId: "me" });
  const other = createLedger("general", "Untouched", "EUR");
  const state: WalletState = Object.freeze({ version: 2, locale: "ko", activeLedgerId: source.id, ledgers: Object.freeze([source, target, other]) });
  const input: MoveGeneralExpenseToTravelInput = Object.freeze({ sourceLedgerId: source.id, expenseId: expense.id, targetLedgerId: target.id, paidBy: "me", participantIds: Object.freeze(["me", "friend"]), category: "food" });
  return { state, source, target, other, input };
}

function general(state: WalletState, id: string): GeneralLedger {
  const ledger = state.ledgers.find((candidate) => candidate.id === id);
  assert.ok(ledger?.kind === "general"); return ledger;
}
function travel(state: WalletState, id: string): TravelLedger {
  const ledger = state.ledgers.find((candidate) => candidate.id === id);
  assert.ok(ledger?.kind === "travel"); return ledger;
}

test("moving preserves original money/date/description, removes the source, and splits exactly", () => {
  const { state, source, target, other, input } = fixtures();
  const next = moveGeneralExpenseToTravel(state, input);
  const nextSource = general(next, source.id); const nextTarget = travel(next, target.id);
  assert.equal(source.expenses.length, 1);
  assert.equal(target.expenses.length, 0);
  assert.equal(nextSource.expenses.length, 0);
  assert.deepEqual(nextSource.movedExpenseIds, [expense.id, publicExpenseId(source.id, expense.id)]);
  assert.deepEqual(nextTarget.currencies, ["USD", "EUR"]);
  const moved = nextTarget.expenses[0];
  assert.equal(moved.description, expense.description);
  assert.equal(moved.minorUnits, expense.minorUnits);
  assert.equal(moved.currency, expense.currency);
  assert.equal(moved.occurredOn, expense.occurredOn);
  assert.equal(moved.paidBy, "me");
  assert.deepEqual(moved.shares, [{ participantId: "friend", minorUnits: 501 }, { participantId: "me", minorUnits: 500 }]);
  assert.match(moved.id, /^travel-move-[0-9a-f]{16}$/);
  assert.equal(next.ledgers[2], other);
  assert.equal(next.activeLedgerId, state.activeLedgerId);
  assert.ok(parseWalletStateStrict(next));
  assert.deepEqual(settleTravelExpenses(nextTarget).find((item) => item.currency === "EUR")?.transfers, [{ from: "friend", to: "me", currency: "EUR", minorUnits: 501 }]);
});

test("replayed moves preserve the target's subsequent user edits without duplicating", () => {
  const { state, input, target } = fixtures();
  const moved = moveGeneralExpenseToTravel(state, input);
  const currentTarget = travel(moved, target.id);
  const editedTarget = Object.freeze({ ...currentTarget, expenses: Object.freeze([{ ...currentTarget.expenses[0], description: "Edited after moving" }]) });
  const edited = Object.freeze({ ...moved, ledgers: Object.freeze(moved.ledgers.map((ledger) => ledger.id === target.id ? editedTarget : ledger)) });
  assert.equal(moveGeneralExpenseToTravel(edited, input), edited);
  assert.equal(editedTarget.expenses.length, 1);
});

test("validation failures never remove or alter the original expense", () => {
  const { state, input } = fixtures(); const snapshot = JSON.stringify(state);
  const invalid: readonly Partial<MoveGeneralExpenseToTravelInput>[] = [
    { sourceLedgerId: "missing" }, { targetLedgerId: "missing" }, { expenseId: "missing" },
    { paidBy: "deleted participant" }, { participantIds: [] }, { participantIds: ["me", "me"] },
    { participantIds: ["unknown"] }, { category: "invalid" as never },
  ];
  for (const patch of invalid) assert.throws(() => moveGeneralExpenseToTravel(state, { ...input, ...patch }));
  assert.equal(JSON.stringify(state), snapshot);
});

test("destination capacity and currency limits fail atomically", () => {
  const { state, target, input } = fixtures();
  const fullTarget = Object.freeze({ ...target, expenses: Object.freeze(Array.from({ length: MAX_EXPENSES_PER_LEDGER }, (_, index) => Object.freeze({ id: `travel-${index}`, description: "Existing", category: "food" as const, currency: "USD", minorUnits: 1, occurredOn: "2026-09-01", paidBy: "me", shares: Object.freeze([{ participantId: "me", minorUnits: 1 }]) }))) });
  const fullState = Object.freeze({ ...state, ledgers: Object.freeze(state.ledgers.map((ledger) => ledger.id === target.id ? fullTarget : ledger)) });
  assert.throws(() => moveGeneralExpenseToTravel(fullState, input), /expense limit/);
  assert.equal(general(fullState, input.sourceLedgerId).expenses.length, 1);
  const currencies = Object.freeze(["USD", "KRW", "JPY", "GBP", "CHF", "CAD", "AUD", "NZD", "CNY", "HKD", "SGD", "THB", "VND", "IDR", "MYR", "INR", "SEK", "NOK", "DKK", "PLN"]);
  const currencyTarget = Object.freeze({ ...target, currencies });
  const currencyState = Object.freeze({ ...state, ledgers: Object.freeze(state.ledgers.map((ledger) => ledger.id === target.id ? currencyTarget : ledger)) });
  assert.throws(() => moveGeneralExpenseToTravel(currencyState, input), /currency limit/);
  assert.equal(general(currencyState, input.sourceLedgerId).expenses.length, 1);
});

test("the latest source edits and unrelated changes survive an open move sheet", () => {
  const { state, source, input } = fixtures();
  const corrected = Object.freeze({ ...expense, description: "Corrected receipt", minorUnits: 2351, occurredOn: "2026-09-03" });
  const extra = Object.freeze({ ...expense, id: "later-payment", description: "Later payment" });
  const latestSource = Object.freeze({ ...source, title: "Renamed ledger", expenses: Object.freeze([corrected, extra]) });
  const latest = Object.freeze({ ...state, ledgers: Object.freeze(state.ledgers.map((ledger) => ledger.id === source.id ? latestSource : ledger)) });
  const moved = moveGeneralExpenseToTravel(latest, input);
  assert.deepEqual(general(moved, source.id).expenses, [extra]);
  assert.equal(general(moved, source.id).title, "Renamed ledger");
  assert.equal(travel(moved, input.targetLedgerId).expenses[0].description, corrected.description);
  assert.equal(travel(moved, input.targetLedgerId).expenses[0].minorUnits, corrected.minorUnits);
  assert.equal(travel(moved, input.targetLedgerId).expenses[0].occurredOn, corrected.occurredOn);
});

test("legacy ledgers acquire empty private move history and invalid histories are rejected", () => {
  const { source } = fixtures();
  const parsed = parseLedger({ ...source, movedExpenseIds: undefined });
  assert.ok(parsed?.kind === "general"); assert.deepEqual(parsed.movedExpenseIds, []);
  assert.equal(parseLedger({ ...source, movedExpenseIds: [expense.id, expense.id] }), null);
  assert.equal(parseLedger({ ...source, movedExpenseIds: [""] }), null);
});

test("provider reimport and stale general edits cannot resurrect a moved expense", () => {
  const { state, source, input } = fixtures();
  const moved = general(moveGeneralExpenseToTravel(state, input), source.id);
  assert.equal(mergeGeneralLedgers(moved, source).expenses.length, 0);
  const staleEdit = Object.freeze({ ...source, title: "Edited title", expenses: Object.freeze([{ ...expense, description: "Old sheet edit" }]) });
  const merged = mergeGeneralLedgerMutation(source, staleEdit, moved);
  assert.equal(merged.expenses.length, 0);
  assert.deepEqual(merged.movedExpenseIds, [expense.id, publicExpenseId(source.id, expense.id)]);
  assert.equal(merged.title, "Edited title");
});

test("moved notification payments stay deduplicated and later reversals cannot delete another purchase", () => {
  const { state, source, input } = fixtures();
  const recorded = applyHighConfidenceCardAutomation(state, [purchase]).state;
  const sourceExpenseId = automationExpenseId(purchase);
  const moved = moveGeneralExpenseToTravel(recorded, { ...input, expenseId: sourceExpenseId });
  const replay = applyHighConfidenceCardAutomation(moved, [purchase]);
  assert.equal(replay.state, moved); assert.deepEqual(replay.acknowledgedIds, [purchase.id]);
  assert.equal(confirmCardCandidate(moved, source.id, purchase).state, moved);
  const repost = Object.freeze({ ...purchase, id: "new-post-id" });
  assert.deepEqual(applyHighConfidenceCardAutomation(moved, [repost]).pending.map((item) => item.id), [repost.id]);
  const another = confirmCardCandidate(moved, source.id, repost).state;
  const reversal = Object.freeze({ ...purchase, id: "later-cancellation", eventType: "reversal" as const });
  const result = applyHighConfidenceCardAutomation(another, [reversal]);
  assert.equal(result.state, another); assert.deepEqual(result.pending.map((item) => item.id), [reversal.id]);
  assert.throws(() => confirmCardCandidate(another, source.id, reversal), /travel ledger review/);
  assert.equal(general(another, source.id).expenses.length, 2);
});

test("travel sharing never exposes source ids or private automation fingerprints", () => {
  const { state, source, input } = fixtures();
  const recorded = applyHighConfidenceCardAutomation(state, [purchase]).state;
  const recordedSource = general(recorded, source.id);
  const original = recordedSource.expenses.find((item) => item.id === automationExpenseId(purchase))!;
  const moved = moveGeneralExpenseToTravel(recorded, { ...input, expenseId: original.id });
  const payload = createLedgerSharePayload(travel(moved, input.targetLedgerId));
  assert.equal(payload.includes(original.id), false);
  assert.equal(payload.includes(original.automationFingerprint!), false);
  assert.equal(payload.includes(original.automationReversalFingerprint!), false);
  assert.equal(payload.includes("movedExpenseIds"), false);
  assert.equal(createLedgerSharePayload(general(moved, source.id)).includes("movedExpenseIds"), false);
});

test("an old exported general file cannot recreate a moved expense", () => {
  const { state, source, input } = fixtures();
  const oldFile = createLedgerSharePayload(source);
  const imported = parseLedgerSharePayload(oldFile);
  assert.ok(imported?.kind === "general");
  const moved = moveGeneralExpenseToTravel(state, input);
  assert.equal(mergeGeneralLedgers(general(moved, source.id), imported).expenses.length, 0);
  assert.equal(travel(moved, input.targetLedgerId).expenses.length, 1);
});

test("moving imported provider descriptions retains only the displayed merchant", () => {
  const importedExpense = { ...expense, id: "revolut-transaction", description: "Revolut · Lidl" };
  const { state, source, input } = fixtures();
  const incoming = { ...state, ledgers: state.ledgers.map((ledger) => ledger.id === source.id ? { ...source, expenses: [importedExpense] } : ledger) };
  const moved = moveGeneralExpenseToTravel(incoming, { ...input, expenseId: importedExpense.id });
  const ledger = travel(moved, input.targetLedgerId);
  assert.equal(ledger.expenses[0].description, "Lidl");
  assert.equal(createLedgerSharePayload(ledger).includes("Revolut"), false);
});

test("moving an expense cannot overflow a travel currency total", () => {
  const { state, source, target, input } = fixtures();
  const huge = { id: "huge", description: "Huge", category: "other" as const, currency: "EUR", minorUnits: Number.MAX_SAFE_INTEGER, paidBy: "me", shares: [{ participantId: "me", minorUnits: Number.MAX_SAFE_INTEGER }], occurredOn: "2026-09-04" };
  const unsafe = { ...state, ledgers: state.ledgers.map((ledger) => ledger.id === target.id ? { ...target, currencies: ["USD", "EUR"], expenses: [huge] } : ledger) };
  assert.throws(() => moveGeneralExpenseToTravel(unsafe, input), /overflow/);
  assert.equal(general(unsafe, source.id).expenses.length, 1);
});
