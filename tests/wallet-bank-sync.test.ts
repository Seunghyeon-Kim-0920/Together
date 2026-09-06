import assert from "node:assert/strict";
import test from "node:test";
import { MAX_BANK_SYNC_TRANSACTIONS, bankSyncExpenseId, bankTransactionStableKey, previewBankSync } from "../src/lib/bankSync";
import { createLedger, parseLedger } from "../src/lib/wallet";

function transaction(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    transactionId: "txn-1",
    status: "booked",
    direction: "debit",
    kind: "card_purchase",
    description: "Lidl Paris",
    minorUnits: 1_299,
    currency: "EUR",
    bookedOn: "2026-09-04",
    ...overrides,
  };
}

function envelope(transactions: readonly unknown[], overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { provider: "open-bank", connectionId: "connection-1", accountId: "account-1", transactions, ...overrides };
}

test("booked outgoing transactions normalize into all four supported kinds", () => {
  const kinds = ["card_purchase", "outgoing_transfer", "direct_debit", "standing_order"] as const;
  const raw = envelope(kinds.map((kind, index) => transaction({ transactionId: `txn-${index}`, status: index === 0 ? "BOOKED" : "completed", direction: index % 2 ? "OUTGOING" : "debit", kind, internalTransfer: kind === "outgoing_transfer" || kind === "standing_order" ? false : undefined })));
  const preview = previewBankSync(raw);

  assert.equal(preview.valid, true);
  assert.deepEqual(preview.candidates.map((candidate) => candidate.kind), kinds);
  assert.equal(preview.counts.automatic, 4);
  assert.equal(preview.counts.review, 0);
  assert.equal(preview.counts.excluded, 0);
  assert.deepEqual(preview.candidates[0].proposedExpense, {
    id: preview.candidates[0].expenseId,
    description: "Lidl Paris",
    category: "other",
    currency: "EUR",
    minorUnits: 1_299,
    occurredOn: "2026-09-04",
  });

  const ledger = createLedger("general", "생활", "EUR");
  const parsed = parseLedger({ ...ledger, expenses: preview.candidates.map((candidate) => candidate.proposedExpense) });
  assert.notEqual(parsed, null, "every proposed row must fit the existing GeneralExpense schema");
});

test("incoming, unbooked, failed, balance, and unsupported rows are excluded while reversals become removal previews", () => {
  const rows = [
    transaction({ transactionId: "accepted" }),
    transaction({ transactionId: "incoming", direction: "incoming", kind: "outgoing_transfer" }),
    transaction({ transactionId: "credit", direction: "credit" }),
    transaction({ transactionId: "pending", status: "pending" }),
    transaction({ transactionId: "scheduled", status: "scheduled", kind: "standing_order" }),
    transaction({ transactionId: "failed", status: "failed" }),
    transaction({ transactionId: "declined", status: "declined" }),
    transaction({ transactionId: "reversed", status: "reversed" }),
    transaction({ transactionId: "returned", status: "returned", kind: "direct_debit" }),
    { kind: "balance", minorUnits: 500_000, currency: "EUR" },
    transaction({ transactionId: "cash", kind: "cash_withdrawal" }),
    transaction({ transactionId: "unknown-status", status: "settled" }),
  ];
  const preview = previewBankSync(envelope(rows));

  assert.deepEqual(preview.candidates.map((candidate) => candidate.transactionId), ["accepted"]);
  assert.deepEqual(preview.removalCandidates.map((candidate) => [candidate.transactionId, candidate.reason]), [
    ["reversed", "reversed"],
    ["returned", "reversed"],
  ]);
  assert.deepEqual(preview.exclusions.map((item) => item.reason), [
    "incoming", "incoming", "not_booked", "not_booked", "failed", "failed", "balance", "unsupported_kind", "invalid_transaction",
  ]);
  assert.equal(preview.counts.removals, 2);
  assert.equal(preview.counts.invalid, 1);
});

test("outgoing transfers and standing orders require proof that they are external", () => {
  const preview = previewBankSync(envelope([
    transaction({ transactionId: "unknown", kind: "outgoing_transfer", counterpartyName: "Alice", description: undefined }),
    transaction({ transactionId: "external", kind: "outgoing_transfer", internalTransfer: false, counterpartyName: "Bob" }),
    transaction({ transactionId: "standing-unknown", kind: "standing_order", counterpartyName: "Landlord" }),
    transaction({ transactionId: "standing-external", kind: "standing_order", internalTransfer: false, counterpartyName: "Power company" }),
    transaction({ transactionId: "explicit-internal", kind: "outgoing_transfer", internalTransfer: true }),
    transaction({ transactionId: "owned-match", kind: "outgoing_transfer", internalTransfer: false, counterpartyAccountId: "my-savings" }),
  ], { ownedAccountIds: ["my-savings"] }));

  assert.equal(preview.candidates.find((candidate) => candidate.transactionId === "unknown")?.decision, "review");
  assert.deepEqual(preview.candidates.find((candidate) => candidate.transactionId === "unknown")?.reviewReasons, ["internal_transfer_unknown"]);
  assert.equal(preview.candidates.find((candidate) => candidate.transactionId === "unknown")?.description, "Alice");
  assert.equal(preview.candidates.find((candidate) => candidate.transactionId === "external")?.decision, "automatic");
  assert.equal(preview.candidates.find((candidate) => candidate.transactionId === "standing-unknown")?.decision, "review");
  assert.deepEqual(preview.candidates.find((candidate) => candidate.transactionId === "standing-unknown")?.reviewReasons, ["internal_transfer_unknown"]);
  assert.equal(preview.candidates.find((candidate) => candidate.transactionId === "standing-external")?.decision, "automatic");
  assert.deepEqual(preview.exclusions.filter((item) => item.reason === "internal_transfer").map((item) => item.transactionId), ["explicit-internal", "owned-match"]);
  assert.equal(preview.counts.automatic, 2);
  assert.equal(preview.counts.review, 2);
});

test("movement descriptions prefer a safe counterparty and never expose provider fallback text", () => {
  const preview = previewBankSync(envelope([
    transaction({
      transactionId: "counterparty-first",
      kind: "outgoing_transfer",
      internalTransfer: false,
      counterpartyName: "Alice Martin",
      description: "Transfer to FR76 3000 6000 0112 3456 7890 189 with card 4111 1111 1111 1111",
    }),
    transaction({
      transactionId: "redacted-fallback",
      kind: "direct_debit",
      counterpartyName: undefined,
      description: "OpenBank transaction REF-ALPHA for EDF account 110-123-456789 card **** **** **** 4242",
    }),
    transaction({
      transactionId: "safe-counterparty",
      kind: "standing_order",
      internalTransfer: false,
      counterpartyName: "Landlord account 1234567890",
      description: "Standing order to private account 9876543210",
    }),
  ]));

  assert.equal(preview.candidates[0].description, "Alice Martin");
  assert.equal(preview.candidates[0].proposedExpense.description, "Alice Martin");
  assert.equal(preview.candidates[1].description, "Direct debit");
  assert.doesNotMatch(preview.candidates[1].description, /OpenBank|REF-ALPHA|EDF|110-123-456789|4242/u);
  assert.equal(preview.candidates[2].description, "Landlord account ••••");
  assert.doesNotMatch(preview.candidates.map((candidate) => candidate.description).join(" "), /FR76|4111 1111|1234567890|9876543210/u);
});

test("refunds and reversals create idempotent confirmation-only tombstone previews", () => {
  const imported = previewBankSync(envelope([transaction({ transactionId: "original-payment" })]));
  const original = imported.candidates[0];
  const raw = envelope([
    transaction({ transactionId: "refund-event", status: "booked", direction: "credit", kind: "refund", relatedTransactionId: "original-payment" }),
    transaction({ transactionId: "refund-event", status: "booked", direction: "credit", kind: "refund", relatedTransactionId: "original-payment" }),
    transaction({ transactionId: "reversed-in-place", status: "reversed", direction: "incoming", kind: "unknown" }),
  ]);
  const before = structuredClone(raw);
  const preview = previewBankSync(raw, { existingStableKeys: [original.stableKey], existingExpenseIds: [original.expenseId] });

  assert.deepEqual(raw, before);
  assert.equal(preview.candidates.length, 0);
  assert.equal(preview.removalCandidates.length, 2);
  assert.equal(preview.counts.removals, 2);
  assert.equal(preview.removalCandidates[0].reason, "refunded");
  assert.equal(preview.removalCandidates[0].targetTransactionId, "original-payment");
  assert.equal(preview.removalCandidates[0].targetStableKey, original.stableKey);
  assert.equal(preview.removalCandidates[0].targetExpenseId, original.expenseId);
  assert.equal(preview.removalCandidates[0].requiresConfirmation, true);
  assert.equal("proposedExpense" in preview.removalCandidates[0], false);
  assert.equal(preview.removalCandidates[1].reason, "reversed");
  assert.equal(preview.removalCandidates[1].targetTransactionId, "reversed-in-place");
  assert.deepEqual(preview.exclusions.map((item) => item.reason), ["duplicate"]);
  assert.equal(Object.isFrozen(preview.removalCandidates), true);
  assert.equal(Object.isFrozen(preview.removalCandidates[0]), true);

  const replay = previewBankSync(envelope([
    transaction({ transactionId: "refund-event", status: "booked", direction: "credit", kind: "refund", relatedTransactionId: "original-payment" }),
  ]), { existingTombstoneKeys: [preview.removalCandidates[0].tombstoneKey] });
  assert.equal(replay.removalCandidates.length, 0);
  assert.deepEqual(replay.exclusions.map((item) => item.reason), ["already_removed"]);

  const conflicting = previewBankSync(envelope([
    transaction({ transactionId: "same-reversal", status: "booked", direction: "credit", kind: "refund", relatedTransactionId: "first-target" }),
    transaction({ transactionId: "same-reversal", status: "booked", direction: "credit", kind: "refund", relatedTransactionId: "second-target" }),
  ]));
  assert.equal(conflicting.removalCandidates.length, 0);
  assert.deepEqual(conflicting.exclusions.map((item) => item.reason), ["conflicting_duplicate", "conflicting_duplicate"]);

  const contradictory = previewBankSync(envelope([
    transaction({ transactionId: "changed-in-place" }),
    transaction({ transactionId: "changed-in-place", status: "reversed" }),
  ]));
  assert.equal(contradictory.candidates.length, 0);
  assert.equal(contradictory.removalCandidates.length, 0);
  assert.deepEqual(contradictory.exclusions.map((item) => item.reason), ["conflicting_duplicate", "conflicting_duplicate"]);

  const orphanRefund = previewBankSync(envelope([
    transaction({ transactionId: "orphan-refund", status: "booked", direction: "credit", kind: "refund", relatedTransactionId: undefined }),
  ]));
  assert.equal(orphanRefund.removalCandidates.length, 0);
  assert.deepEqual(orphanRefund.exclusions.map((item) => item.reason), ["invalid_transaction"]);
});

test("provider metadata is preserved on candidates without leaking into GeneralExpense", () => {
  const preview = previewBankSync(envelope([transaction({
    bookedAt: "2026-09-04T10:15:30+02:00",
    valueOn: "2026-09-05",
    counterpartyName: "Merchant Legal Name",
    counterpartyAccountId: "FR76MASKED",
    reference: "Invoice 42",
    providerCategory: "groceries",
    relatedTransactionId: "pending-42",
    originalMinorUnits: 1_500,
    originalCurrency: "USD",
    feeMinorUnits: 25,
    feeCurrency: "EUR",
  })]));
  const candidate = preview.candidates[0];

  assert.deepEqual(candidate.metadata, {
    bookedAt: "2026-09-04T10:15:30+02:00",
    valueOn: "2026-09-05",
    counterpartyName: "Merchant Legal Name",
    counterpartyAccountId: "FR76MASKED",
    reference: "Invoice 42",
    providerCategory: "groceries",
    relatedTransactionId: "pending-42",
    originalMinorUnits: 1_500,
    originalCurrency: "USD",
    feeMinorUnits: 25,
    feeCurrency: "EUR",
    internalTransfer: null,
  });
  assert.equal("reference" in candidate.proposedExpense, false);
  assert.equal("counterpartyAccountId" in candidate.proposedExpense, false);
});

test("stable source IDs are unambiguous and repeated imports are idempotent", () => {
  const base = { provider: "provider|one", connectionId: "connection:1", accountId: "account", transactionId: "transaction" };
  const stableKey = bankTransactionStableKey(base);
  assert.equal(stableKey, bankTransactionStableKey({ ...base }));
  assert.notEqual(stableKey, bankTransactionStableKey({ ...base, provider: "provider|two" }));
  assert.notEqual(stableKey, bankTransactionStableKey({ ...base, connectionId: "connection:2" }));
  assert.notEqual(stableKey, bankTransactionStableKey({ ...base, accountId: "other-account" }));
  assert.notEqual(stableKey, bankTransactionStableKey({ ...base, transactionId: "other-transaction" }));
  assert.equal(bankSyncExpenseId(stableKey), bankSyncExpenseId(stableKey));

  const first = previewBankSync(envelope([transaction()]));
  const replayByStableKey = previewBankSync(envelope([transaction()]), { existingStableKeys: [first.candidates[0].stableKey] });
  const replayByExpenseId = previewBankSync(envelope([transaction()]), { existingExpenseIds: [first.candidates[0].expenseId] });
  assert.equal(replayByStableKey.candidates.length, 0);
  assert.equal(replayByExpenseId.candidates.length, 0);
  assert.equal(replayByStableKey.exclusions[0].reason, "already_imported");
  assert.equal(replayByExpenseId.exclusions[0].reason, "already_imported");
});

test("identical duplicate IDs collapse while conflicting duplicate IDs are quarantined", () => {
  const identical = previewBankSync(envelope([transaction(), transaction()]));
  assert.equal(identical.candidates.length, 1);
  assert.equal(identical.exclusions[0].reason, "duplicate");

  const conflicting = previewBankSync(envelope([transaction(), transaction({ minorUnits: 2_999 })]));
  assert.equal(conflicting.candidates.length, 0);
  assert.deepEqual(conflicting.exclusions.map((item) => item.reason), ["conflicting_duplicate", "conflicting_duplicate"]);
  assert.equal(conflicting.counts.duplicate, 2);
});

test("the preview reports the 5,000-row boundary and provider-side missing rows", () => {
  const overflowRows = Array.from({ length: MAX_BANK_SYNC_TRANSACTIONS + 2 }, (_, index) => transaction({ transactionId: `txn-${index}` }));
  const overflow = previewBankSync(envelope(overflowRows));
  assert.equal(overflow.candidates.length, MAX_BANK_SYNC_TRANSACTIONS);
  assert.equal(overflow.counts.received, MAX_BANK_SYNC_TRANSACTIONS + 2);
  assert.equal(overflow.counts.inspected, MAX_BANK_SYNC_TRANSACTIONS);
  assert.equal(overflow.counts.overflow, 2);
  assert.equal(overflow.counts.providerMissing, 0);
  assert.equal(overflow.counts.missing, 2);
  assert.equal(overflow.counts.hasMissing, true);

  const providerMissing = previewBankSync(envelope([transaction({ transactionId: "a" }), transaction({ transactionId: "b" })], { reportedTotal: 6, hasMore: true }));
  assert.equal(providerMissing.counts.providerMissing, 4);
  assert.equal(providerMissing.counts.missing, 4);
  assert.equal(providerMissing.counts.hasMissing, true);

  const unknownMissing = previewBankSync(envelope([transaction()], { hasMore: true }));
  assert.equal(unknownMissing.counts.providerMissing, null);
  assert.equal(unknownMissing.counts.missing, null);
  assert.equal(unknownMissing.counts.hasMissing, true);
});

test("malformed envelopes and transactions fail closed", () => {
  assert.deepEqual(previewBankSync(null).validationErrors, ["invalid_envelope"]);
  assert.deepEqual(previewBankSync(envelope([], { provider: "" })).validationErrors, ["invalid_provider"]);
  assert.deepEqual(previewBankSync(envelope([], { connectionId: "" })).validationErrors, ["invalid_connection"]);
  assert.deepEqual(previewBankSync(envelope([], { accountId: "" })).validationErrors, ["invalid_account"]);
  assert.deepEqual(previewBankSync(envelope([], { ownedAccountIds: ["same", "same"] })).validationErrors, ["invalid_owned_accounts"]);
  assert.deepEqual(previewBankSync({ provider: "p", connectionId: "c", accountId: "a", transactions: "not-an-array" }).validationErrors, ["invalid_transactions"]);
  assert.deepEqual(previewBankSync(envelope([], { hasMore: "yes" })).validationErrors, ["invalid_pagination"]);

  const invalidRows = previewBankSync(envelope([
    transaction({ transactionId: "negative", minorUnits: -1 }),
    transaction({ transactionId: "bad-date", bookedOn: "2026-02-30" }),
    transaction({ transactionId: "bad-currency", currency: "EURO" }),
    transaction({ transactionId: "no-description", description: undefined }),
    transaction({ transactionId: "bad-internal", internalTransfer: "false" }),
    transaction({ transactionId: "half-original", originalMinorUnits: 500 }),
    transaction({ transactionId: "bad-fee", feeMinorUnits: -1, feeCurrency: "EUR" }),
    transaction({ transactionId: "local-time", bookedAt: "2026-09-04T10:15:00" }),
  ]));
  assert.equal(invalidRows.candidates.length, 0);
  assert.equal(invalidRows.counts.invalid, 8);
  assert.ok(invalidRows.exclusions.every((item) => item.reason === "invalid_transaction"));
});

test("preview creation is deterministic, immutable, and does not mutate input", () => {
  const raw = envelope([
    transaction({ transactionId: "auto", minorUnits: Number.MAX_SAFE_INTEGER }),
    transaction({ transactionId: "review", kind: "outgoing_transfer", minorUnits: Number.MAX_SAFE_INTEGER }),
  ]);
  const before = structuredClone(raw);
  const first = previewBankSync(raw);
  const second = previewBankSync(raw);

  assert.deepEqual(raw, before);
  assert.deepEqual(first, second);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.candidates), true);
  assert.equal(Object.isFrozen(first.candidates[0]), true);
  assert.equal(Object.isFrozen(first.candidates[0].metadata), true);
  assert.equal(Object.isFrozen(first.candidates[0].proposedExpense), true);
  assert.deepEqual(first.currencyTotals, [{ currency: "EUR", automaticMinorUnits: "9007199254740991", reviewMinorUnits: "9007199254740991", automaticCount: 1, reviewCount: 1 }]);
});
