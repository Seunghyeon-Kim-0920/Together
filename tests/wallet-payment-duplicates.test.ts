import assert from "node:assert/strict";
import test from "node:test";
import { findCrossSourcePayment, getAutomationPaymentHistory, hasPossibleCrossSourcePayment, joinPaymentReceipt, paymentReceipt, paymentReceiptIdentity, undoPaymentMerge, type PaymentDuplicateEvidence } from "../src/lib/paymentDuplicates";
import type { AutomationPaymentReceipt, GeneralLedger, WalletState } from "../src/lib/types";
import { createLedger, MAX_AUTOMATION_PAYMENT_RECEIPTS, MAX_EXPENSES_PER_LEDGER, mergeGeneralLedgerMutation, parseWalletStateStrict } from "../src/lib/wallet";
import { createLedgerSharePayload } from "../src/lib/share";

const bank = "com.example.card";
const wallet = "com.example.wallet";
const epoch = Date.parse("2026-09-10T10:00:00Z");

function evidence(id: string, packageName: string, seconds = 0, overrides: Partial<PaymentDuplicateEvidence> = {}): PaymentDuplicateEvidence {
  return Object.freeze({ expenseId: id, packageName, occurredAt: new Date(epoch + seconds * 1000).toISOString(), originFingerprint: `origin-${id}`, reversalFingerprint: `reversal-${id}`, merchant: packageName === bank ? "CORNER SHOP EUROPE SAS" : "동네 가게", currency: "EUR", minorUnits: 1234, ...overrides });
}

function ledgerWith(...receipts: readonly AutomationPaymentReceipt[]): GeneralLedger {
  return Object.freeze({ ...createLedger("general", "Synthetic spending", "EUR"), automationPaymentReceipts: Object.freeze(receipts) });
}

function ledgersWith(...receipts: readonly AutomationPaymentReceipt[]): WalletState["ledgers"] {
  return Object.freeze([ledgerWith(...receipts)]);
}

test("exact minor units pair different merchant names from arbitrary payment apps in either order", () => {
  const packages = ["com.google.android.apps.walletnfcrel", "com.samsung.android.spay", "hr.lunc.client", "com.unknown.bank"];
  for (const packageName of packages) {
    const left = evidence("issuer-alert", bank);
    const right = evidence("counterpart-alert", packageName, 40);
    for (const [first, second] of [[left, right], [right, left]]) {
      const ledger = ledgersWith(paymentReceipt(first));
      const match = findCrossSourcePayment(ledger, second);
      assert.ok(match, `${first.packageName} followed by ${second.packageName}`);
      assert.equal(match.receipt.expenseId, first.expenseId);
    }
  }
});

test("different merchant names only auto-pair within the inclusive two-minute span", () => {
  const ledgers = ledgersWith(paymentReceipt(evidence("first", bank)));
  for (const seconds of [-120, -119, 0, 119, 120]) assert.ok(findCrossSourcePayment(ledgers, evidence(`alert-${seconds}`, wallet, seconds)));
  for (const seconds of [-121, 121]) assert.equal(findCrossSourcePayment(ledgers, evidence(`late-${seconds}`, wallet, seconds)), null);
});

test("actual Android delivery time pairs concurrent cross-app alerts even if notification when differs", () => {
  const first = evidence("issuer", bank, 0, { deliveredAt: "2026-09-10T10:20:00Z" });
  const second = evidence("wallet", wallet, 900, { deliveredAt: "2026-09-10T10:20:08Z" });
  const match = findCrossSourcePayment(ledgersWith(paymentReceipt(first)), second);
  assert.ok(match);
  const joined = joinPaymentReceipt(ledgerWith(paymentReceipt(first)), { ...match, ledgerIndex: 0 }, second);
  assert.equal(joined.automationPaymentReceipts?.[0].sources.length, 2);
  assert.deepEqual(joined.automationPaymentReceipts?.[0].sources.map((source) => source.deliveredAt), [first.deliveredAt, second.deliveredAt]);
});

test("when delivery evidence is present on both sides, old transaction timestamps cannot create a false match", () => {
  const first = evidence("first", bank, 0, { deliveredAt: "2026-09-10T10:00:00Z" });
  const second = evidence("second", wallet, 0, { deliveredAt: "2026-09-10T11:00:00Z" });
  const ledgers = ledgersWith(paymentReceipt(first));
  assert.equal(findCrossSourcePayment(ledgers, second), null);
  assert.equal(hasPossibleCrossSourcePayment(ledgers, second), false);
});

test("an unusually large provider transaction-time disagreement waits for review despite simultaneous posts", () => {
  const first = evidence("first", bank, 0, { deliveredAt: "2026-09-10T12:00:00Z" });
  const second = evidence("second", wallet, 90 * 60, { deliveredAt: "2026-09-10T12:00:10Z" });
  const ledgers = ledgersWith(paymentReceipt(first));
  assert.equal(findCrossSourcePayment(ledgers, second), null);
  assert.equal(hasPossibleCrossSourcePayment(ledgers, second), true);
});

test("a mixed legacy receipt recognizes a later simultaneous alert but requires review", () => {
  const legacy = evidence("legacy", bank, 0);
  const modern = evidence("modern", wallet, 30, { deliveredAt: "2026-09-10T11:00:00Z" });
  const first = ledgerWith(paymentReceipt(legacy));
  const match = findCrossSourcePayment([first], modern); assert.ok(match);
  const joined = joinPaymentReceipt(first, match, modern);
  const third = evidence("third", "com.third.payment", 900, { deliveredAt: "2026-09-10T11:00:10Z", merchant: "Third label" });
  assert.equal(findCrossSourcePayment([joined], third), null);
  assert.equal(hasPossibleCrossSourcePayment([joined], third), true);
});

test("one cent, a different currency, or another day cannot collapse to an equal-value payment", () => {
  const ledgers = ledgersWith(paymentReceipt(evidence("first", bank)));
  for (const override of [{ minorUnits: 1233 }, { minorUnits: 1235 }, { currency: "USD" }, { currency: "KRW" }]) {
    assert.equal(findCrossSourcePayment(ledgers, evidence("different-money", wallet, 20, override)), null);
    assert.equal(hasPossibleCrossSourcePayment(ledgers, evidence("different-money", wallet, 20, override)), false);
  }
  assert.equal(findCrossSourcePayment(ledgers, evidence("another-day", wallet, 86_400)), null);
});

test("a same-app repost is not automatically consumed or allowed to bypass duplicate review", () => {
  const first = evidence("card-first", bank);
  const counterpart = evidence("wallet-first", wallet, 10);
  const base = ledgerWith(paymentReceipt(first));
  const location = findCrossSourcePayment([base], counterpart); assert.ok(location);
  const joined = joinPaymentReceipt(base, location, counterpart);
  assert.equal(findCrossSourcePayment([joined], evidence("card-second", bank, 30)), null);
  assert.equal(findCrossSourcePayment([joined], evidence("wallet-second", wallet, 35)), null);
  assert.equal(hasPossibleCrossSourcePayment([joined], evidence("card-second", bank, 30)), true);
  assert.equal(hasPossibleCrossSourcePayment([joined], evidence("card-second-renamed", bank, 30, { merchant: "Different shop label" })), true);
  assert.equal(joined.automationPaymentReceipts?.[0].sources.length, 2);
});

test("a wallet purchase and another debit type require review rather than silently losing a separate transfer", () => {
  for (const eventType of ["outgoing_transfer", "direct_debit", "standing_order"] as const) {
    const debit = evidence("debit", bank, 0, { eventType, merchant: "Same Shop" });
    const purchase = evidence("wallet", "com.google.android.apps.walletnfcrel", 15, { eventType: "purchase", merchant: "Same Shop" });
    for (const [first, second] of [[debit, purchase], [purchase, debit]]) {
      assert.equal(findCrossSourcePayment(ledgersWith(paymentReceipt(first)), second), null);
      assert.equal(hasPossibleCrossSourcePayment(ledgersWith(paymentReceipt(first)), second), true);
    }
    assert.equal(findCrossSourcePayment(ledgersWith(paymentReceipt(debit)), { ...purchase, occurredAt: new Date(epoch + 180_000).toISOString() }), null);
    assert.equal(findCrossSourcePayment(ledgersWith(paymentReceipt(debit)), { ...purchase, eventType: "reversal" }), null);
    assert.equal(findCrossSourcePayment(ledgersWith(paymentReceipt(debit)), { ...purchase, packageName: "com.other.bank" }), null);
  }
});

test("a debit receipt preserves its type through joining and legacy purchase receipts remain compatible", () => {
  const debit = evidence("debit", bank, 0, { eventType: "direct_debit" });
  assert.equal(paymentReceipt(debit).sources[0].eventType, "direct_debit");
  assert.throws(() => paymentReceipt({ ...debit, eventType: "reversal" }), /payment-receipt-reversal/);
  assert.ok(findCrossSourcePayment(ledgersWith(paymentReceipt(evidence("old", bank))), evidence("new", wallet, 1, { eventType: "purchase" })));
});

test("multiple equal-price receipts stay ambiguous even if one notification is closer", () => {
  const first = paymentReceipt(evidence("real-first", bank));
  const second = paymentReceipt(evidence("real-second", bank, 50));
  const ledgers = ledgersWith(first, second);
  const incoming = evidence("wallet-ambiguous", wallet, 55);
  assert.equal(findCrossSourcePayment(ledgers, incoming), null);
  assert.equal(hasPossibleCrossSourcePayment(ledgers, incoming), true);
});

test("already paired events leave a separate equal-price purchase available for one-to-one pairing", () => {
  const first = evidence("real-first", bank);
  const counterpart = evidence("first-wallet", wallet, 5);
  const base = ledgerWith(paymentReceipt(first), paymentReceipt(evidence("real-second", bank, 35)));
  // Explicitly recorded first counterpart models a receipt paired before the second purchase.
  const joined = joinPaymentReceipt(base, { ledgerIndex: 0, receiptIndex: 0, receipt: base.automationPaymentReceipts![0] }, counterpart);
  const incoming = evidence("second-wallet", wallet, 40);
  const match = findCrossSourcePayment([joined], incoming); assert.ok(match);
  assert.equal(match.receipt.expenseId, "real-second");
});

test("three-source matching cannot extend the name-independent time window by chaining alerts", () => {
  const first = evidence("card-first", bank);
  const second = evidence("wallet-second", wallet, 90);
  const base = ledgerWith(paymentReceipt(first));
  const location = findCrossSourcePayment([base], second); assert.ok(location);
  const joined = joinPaymentReceipt(base, location, second);
  assert.ok(findCrossSourcePayment([joined], evidence("third-within", "com.third.payment", 120, { merchant: "THIRD NAME" })));
  assert.equal(findCrossSourcePayment([joined], evidence("third-too-late", "com.third.payment", 180, { merchant: "THIRD NAME" })), null);
  assert.equal(findCrossSourcePayment([joined], evidence("third-too-early", "com.third.payment", -90, { merchant: "THIRD NAME" })), null);
});

test("normalized matching names retain delayed ten-minute matching and longer-delay review", () => {
  const ledgers = ledgersWith(paymentReceipt(evidence("first", bank, 0, { merchant: "Café Bleu" })));
  assert.ok(findCrossSourcePayment(ledgers, evidence("delayed", wallet, 600, { merchant: "CAFE BLEU" })));
  const late = evidence("late", wallet, 601, { merchant: "Café Bleu" });
  assert.equal(findCrossSourcePayment(ledgers, late), null);
  assert.equal(hasPossibleCrossSourcePayment(ledgers, late), true);
});

test("cross-source matching scans every ledger without mutating original evidence", () => {
  const first = evidence("first", bank);
  const base = ledgerWith(paymentReceipt(first));
  const ledgers = Object.freeze([ledgerWith(), base]);
  const original = JSON.stringify(ledgers);
  const incoming = evidence("other", wallet, 15);
  const match = findCrossSourcePayment(ledgers, incoming); assert.ok(match);
  assert.equal(match.ledgerIndex, 1);
  const joined = joinPaymentReceipt(base, match, incoming);
  assert.equal(JSON.stringify(ledgers), original);
  assert.equal(joined.automationPaymentReceipts?.[0].merchant, first.merchant);
  assert.equal(joined.automationPaymentReceipts?.[0].minorUnits, first.minorUnits);
  assert.equal(paymentReceiptIdentity([joined], incoming), "same");
  assert.equal(paymentReceiptIdentity([joined], { ...incoming, originFingerprint: "changed-origin" }), "conflict");
});

test("the receipt source bound cannot be bypassed by a ninth payment app", () => {
  const first = evidence("source-0", "com.source.app0", 0, { merchant: "Same Shop" });
  const receipt = paymentReceipt(first);
  const full: AutomationPaymentReceipt = Object.freeze({ ...receipt, sources: Object.freeze(Array.from({ length: 8 }, (_, index) => paymentReceipt(evidence(`source-${index}`, `com.source.app${index}`, index, { merchant: "Same Shop" })).sources[0])) });
  assert.equal(findCrossSourcePayment(ledgersWith(full), evidence("source-8", "com.source.app8", 15, { merchant: "Same Shop" })), null);
});

test("malformed comparison timestamps do not create a payment match", () => {
  const ledgers = ledgersWith(paymentReceipt(evidence("first", bank)));
  const invalid = evidence("invalid", wallet, 0, { occurredAt: "not-a-date" });
  assert.equal(findCrossSourcePayment(ledgers, invalid), null);
  assert.equal(hasPossibleCrossSourcePayment(ledgers, invalid), false);
});

function savedEvidence(index: number, seconds = 0): PaymentDuplicateEvidence {
  const suffix = String(index).padStart(16, "0");
  return evidence(`card-auto-${suffix}`, `com.source.app${index}`, seconds, {
    merchant: `Original merchant ${index}`, category: index === 1 ? "food" : "transport",
    originFingerprint: `card-origin-${suffix}`, reversalFingerprint: `card-reversal-${suffix}`,
    // A local calendar day can differ from the UTC notification timestamp.
    occurredOn: "2026-09-09",
  });
}

function undoFixture(count = 2): { state: WalletState; ledger: GeneralLedger; alerts: PaymentDuplicateEvidence[] } {
  const alerts = Array.from({ length: count }, (_, index) => savedEvidence(index + 1, index * 20));
  const primary = alerts[0];
  let ledger: GeneralLedger = Object.freeze({ ...ledgerWith(paymentReceipt(primary)), expenses: Object.freeze([
    Object.freeze({ id: primary.expenseId, description: "Edited display", category: "shopping" as const,
      currency: "EUR", minorUnits: 9999, occurredOn: "2026-09-15", automationFingerprint: primary.originFingerprint,
      automationReversalFingerprint: primary.reversalFingerprint }),
  ]) });
  for (const alert of alerts.slice(1)) {
    const match = findCrossSourcePayment([ledger], alert); assert.ok(match);
    ledger = joinPaymentReceipt(ledger, match, alert);
  }
  const state: WalletState = Object.freeze({ version: 2, locale: "ko", activeLedgerId: ledger.id, ledgers: Object.freeze([ledger]) });
  assert.ok(parseWalletStateStrict(state));
  return { state, ledger, alerts };
}

test("undo restores immutable original money, category, merchant and local date without changing the edited primary", () => {
  const { state, ledger, alerts } = undoFixture(); const original = JSON.stringify(state);
  const result = undoPaymentMerge(state, ledger.id, alerts[0].expenseId, alerts[1].expenseId);
  assert.equal(JSON.stringify(state), original);
  assert.equal(result.restoredExpenseId, alerts[1].expenseId); assert.equal(result.usedLegacySnapshot, false);
  const restoredLedger = result.state.ledgers[0] as GeneralLedger;
  assert.equal(restoredLedger.expenses[0], ledger.expenses[0]);
  assert.deepEqual(restoredLedger.expenses[1], {
    id: alerts[1].expenseId, description: alerts[1].merchant, category: alerts[1].category,
    currency: "EUR", minorUnits: 1234, occurredOn: "2026-09-09",
    automationFingerprint: alerts[1].originFingerprint, automationReversalFingerprint: alerts[1].reversalFingerprint,
  });
  assert.deepEqual(restoredLedger.automationPaymentReceipts?.[0].separatedSourceIds, [alerts[1].expenseId]);
  assert.deepEqual(restoredLedger.automationPaymentReceipts?.[1].separatedSourceIds, [alerts[0].expenseId]);
  assert.ok(parseWalletStateStrict(JSON.parse(JSON.stringify(result.state))));
});

test("undo is idempotent after durable reload and explicit separated sources cannot be merged again", () => {
  const { state, ledger, alerts } = undoFixture();
  const first = undoPaymentMerge(state, ledger.id, alerts[0].expenseId, alerts[1].expenseId);
  const reloaded = parseWalletStateStrict(JSON.parse(JSON.stringify(first.state))); assert.ok(reloaded);
  const again = undoPaymentMerge(reloaded, ledger.id, alerts[0].expenseId, alerts[1].expenseId);
  assert.equal(again.state, reloaded); assert.equal(again.state.ledgers[0].expenses.length, 2);
  for (const alert of alerts) {
    assert.equal(paymentReceiptIdentity(reloaded.ledgers, alert), "same");
    assert.equal(findCrossSourcePayment(reloaded.ledgers, alert), null);
    assert.equal(hasPossibleCrossSourcePayment(reloaded.ledgers, alert), false);
  }
  const next = reloaded.ledgers[0] as GeneralLedger;
  assert.throws(() => joinPaymentReceipt(next, { ledgerIndex: 0, receiptIndex: 0, receipt: next.automationPaymentReceipts![0] }, alerts[1]), /payment-merge-conflict/);
});

test("undoing a three-app group one source at a time preserves all reciprocal separation evidence", () => {
  const { state, ledger, alerts } = undoFixture(3);
  const one = undoPaymentMerge(state, ledger.id, alerts[0].expenseId, alerts[1].expenseId);
  const two = undoPaymentMerge(one.state, ledger.id, alerts[0].expenseId, alerts[2].expenseId);
  const parsed = parseWalletStateStrict(two.state); assert.ok(parsed);
  const next = parsed.ledgers[0] as GeneralLedger;
  assert.equal(next.expenses.length, 3);
  assert.equal(new Set(next.expenses.map((expense) => expense.id)).size, 3);
  for (const receipt of next.automationPaymentReceipts ?? []) {
    assert.equal(receipt.sources.length, 1);
    assert.deepEqual(new Set(receipt.separatedSourceIds), new Set(alerts.filter((alert) => alert.expenseId !== receipt.expenseId).map((alert) => alert.expenseId)));
  }
  assert.equal(findCrossSourcePayment(parsed.ledgers, savedEvidence(4, 70)), null);
  assert.equal(hasPossibleCrossSourcePayment(parsed.ledgers, savedEvidence(4, 70)), true);
});

test("legacy receipts restore an explicitly marked best available snapshot and remain valid", () => {
  const fixture = undoFixture();
  const receipts = fixture.ledger.automationPaymentReceipts!.map((receipt) => ({ ...receipt, sources: receipt.sources.map((source) => ({
    expenseId: source.expenseId, packageName: source.packageName, occurredAt: source.occurredAt,
    originFingerprint: source.originFingerprint, reversalFingerprint: source.reversalFingerprint,
  })) }));
  const ledger = { ...fixture.ledger, automationPaymentReceipts: receipts };
  const state = { ...fixture.state, ledgers: [ledger] };
  assert.ok(parseWalletStateStrict(state));
  assert.equal(getAutomationPaymentHistory(ledger)[0].sources[1].legacySnapshot, true);
  const result = undoPaymentMerge(state, ledger.id, fixture.alerts[0].expenseId, fixture.alerts[1].expenseId);
  assert.equal(result.usedLegacySnapshot, true);
  assert.equal(result.state.ledgers[0].expenses[1].minorUnits, 1234);
  assert.equal(result.state.ledgers[0].expenses[1].description, fixture.alerts[0].merchant);
  assert.equal(result.state.ledgers[0].expenses[1].occurredOn, fixture.alerts[1].occurredAt.slice(0, 10));
  assert.ok(parseWalletStateStrict(result.state));
});

test("removed, moved and cancelled payments cannot be resurrected by a stale undo request", () => {
  const { state, ledger, alerts } = undoFixture();
  for (const changes of [
    { expenses: [] },
    { movedExpenseIds: [alerts[1].expenseId] },
    { automationReversalIds: [alerts[1].expenseId] },
    { expenses: [...ledger.expenses, { ...ledger.expenses[0], id: alerts[1].expenseId }] },
  ]) {
    const changed = { ...state, ledgers: [{ ...ledger, ...changes }] };
    assert.throws(() => undoPaymentMerge(changed, ledger.id, alerts[0].expenseId, alerts[1].expenseId), /payment-undo-(?:unavailable|conflict)/);
  }
  assert.throws(() => undoPaymentMerge(state, "missing-ledger", alerts[0].expenseId, alerts[1].expenseId), /payment-undo-unavailable/);
  assert.throws(() => undoPaymentMerge(state, ledger.id, alerts[0].expenseId, alerts[0].expenseId), /payment-undo-unavailable/);
});

test("undo enforces record, receipt and safe-integer limits without partially mutating state", () => {
  const { state, ledger, alerts } = undoFixture();
  for (const changes of [
    { expenses: Array.from({ length: MAX_EXPENSES_PER_LEDGER }, (_, index) => ({ ...ledger.expenses[0], id: index ? `expense-${index}` : ledger.expenses[0].id })) },
    { automationPaymentReceipts: Array.from({ length: MAX_AUTOMATION_PAYMENT_RECEIPTS }, () => ledger.automationPaymentReceipts![0]) },
    { expenses: [{ ...ledger.expenses[0], minorUnits: Number.MAX_SAFE_INTEGER }] },
  ]) {
    const changed = { ...state, ledgers: [{ ...ledger, ...changes }] }; const before = JSON.stringify(changed);
    assert.throws(() => undoPaymentMerge(changed, ledger.id, alerts[0].expenseId, alerts[1].expenseId), /payment-undo-limit/);
    assert.equal(JSON.stringify(changed), before);
  }
});

test("history distinguishes merged, restored, recorded and removed receipts while keeping snapshots private", () => {
  const { state, ledger, alerts } = undoFixture();
  const [history] = getAutomationPaymentHistory(ledger);
  assert.equal(history.status, "merged"); assert.equal(history.merchant, "Edited display");
  assert.deepEqual(history.sources.map((source) => source.canRestore), [false, true]);
  const next = undoPaymentMerge(state, ledger.id, alerts[0].expenseId, alerts[1].expenseId).state.ledgers[0] as GeneralLedger;
  assert.deepEqual(new Set(getAutomationPaymentHistory(next).map((entry) => entry.status)), new Set(["recorded", "restored"]));
  const removed = { ...next, expenses: [] };
  assert.ok(getAutomationPaymentHistory(removed).every((entry) => entry.status === "removed" && entry.sources.every((source) => !source.canRestore)));
  const payload = createLedgerSharePayload(next);
  for (const hidden of ["automationPaymentReceipts", "separatedSourceIds", "restoredFromExpenseId", "com.source.app", "card-origin-"])
    assert.equal(payload.includes(hidden), false, hidden);
});

test("concurrent stale expense edits preserve latest undo state and immutable receipt provenance", () => {
  const { state, ledger, alerts } = undoFixture();
  const latest = undoPaymentMerge(state, ledger.id, alerts[0].expenseId, alerts[1].expenseId).state.ledgers[0] as GeneralLedger;
  const merged = mergeGeneralLedgerMutation(ledger, { ...ledger, title: "Renamed", expenses: [{ ...ledger.expenses[0], description: "Newest edit" }] }, latest);
  assert.equal(merged.expenses.length, 2); assert.equal(merged.expenses[0].description, "Newest edit");
  assert.equal(merged.expenses[1], latest.expenses[1]);
  assert.deepEqual(merged.automationPaymentReceipts, latest.automationPaymentReceipts);
  assert.ok(parseWalletStateStrict({ ...state, ledgers: [merged] }));
});

test("partial or corrupted immutable receipt snapshots and conflicting exclusions fail closed", () => {
  const { state, ledger } = undoFixture(); const receipt = ledger.automationPaymentReceipts![0]; const source = receipt.sources[1];
  for (const corrupted of [
    { ...receipt, sources: [receipt.sources[0], { ...source, merchant: "" }] },
    { ...receipt, sources: [receipt.sources[0], { ...source, category: "invalid" }] },
    { ...receipt, sources: [receipt.sources[0], { ...source, occurredOn: "2026-02-30" }] },
    { ...receipt, sources: [receipt.sources[0], { ...source, deliveredAt: "2026-02-30T10:00:00Z" }] },
    { ...receipt, sources: [receipt.sources[0], { ...source, category: undefined }] },
    { ...receipt, separatedSourceIds: [source.expenseId] },
    { ...receipt, separatedSourceIds: ["bad-id"] },
    { ...receipt, restoredFromExpenseId: receipt.expenseId },
  ]) assert.equal(parseWalletStateStrict({ ...state, ledgers: [{ ...ledger, automationPaymentReceipts: [corrupted] }] }), null);
});
