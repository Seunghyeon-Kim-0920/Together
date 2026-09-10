import assert from "node:assert/strict";
import test from "node:test";
import { cardAutomationConnectionState, normalizeCardAutomationStatus, withNativeReadDeadline } from "../src/lib/nativeCardAutomation";
import { applyHighConfidenceCardAutomation, automationExpenseId, buildNativeAutomationConfiguration, calculateMonthlyLimitStatus, candidateOwnerLedgerIds, completeCandidateMerchant, confirmCardCandidate, inferGeneralCategory, parseNativeCandidateBatch, parseNativeCardCandidate, reversalMatchIndexes, visibleCardCandidates, type NativeCardCandidate } from "../src/lib/cardAutomation";
import type { GeneralLedger, WalletState } from "../src/lib/types";
import { createLedger, mergeGeneralLedgerMutation, parseWalletStateStrict, replaceExpenseById } from "../src/lib/wallet";

const candidate: NativeCardCandidate = Object.freeze({ id: "native-1", queueToken: null, packageName: "com.revolut.revolut", sourceName: "Revolut", merchant: "Lidl Paris", minorUnits: 1299, currency: "EUR", occurredAt: "2026-08-30T10:15:00+02:00", occurredOn: "2026-08-30", confidence: "high", eventType: "purchase", manualOnly: false });

test("notification permission is distinct from a connected detection service", () => {
  const allowed = { supported: true, accessGranted: true, alertPermissionGranted: true };
  assert.equal(cardAutomationConnectionState({ ...allowed, listenerConnected: false }), "disconnected");
  assert.equal(cardAutomationConnectionState({ ...allowed, listenerConnected: true }), "connected");
  assert.equal(cardAutomationConnectionState(allowed), "unknown");
  assert.equal(cardAutomationConnectionState({ ...allowed, accessGranted: false, listenerConnected: true }), "access-required");
  assert.equal(cardAutomationConnectionState({ ...allowed, supported: false }), "unsupported");
});

test("connection diagnostics retain only bounded valid timestamps and known errors", () => {
  const clean = normalizeCardAutomationStatus({ supported: true, accessGranted: true, listenerConnected: false, lastListenerConnectedAt: 1789000000000, lastProcessingFailureAt: -1, lastRecoveryRequestedAt: Infinity, lastRecoveryError: "processing_failed", secretText: "not retained" });
  assert.equal(clean.lastListenerConnectedAt, 1789000000000);
  assert.equal(clean.lastProcessingFailureAt, undefined);
  assert.equal(clean.lastRecoveryRequestedAt, undefined);
  assert.equal(clean.lastRecoveryError, "processing_failed");
  assert.equal("secretText" in clean, false);
  assert.equal(normalizeCardAutomationStatus({ lastRecoveryError: "private exception text" }).lastRecoveryError, undefined);
});

test("hung native reads time out without swallowing native errors or successes", async () => {
  assert.equal(await withNativeReadDeadline(Promise.resolve(3), 100), 3);
  await assert.rejects(withNativeReadDeadline(Promise.reject(new Error("native failure")), 100), /native failure/);
  await assert.rejects(withNativeReadDeadline(new Promise(() => {}), 10), /native-read-timeout/);
});

function configuredLedger(): GeneralLedger {
  return Object.freeze({ ...createLedger("general", "생활", "EUR"), monthlyLimitMinor: 50_000, automationSources: Object.freeze([{ packageName: candidate.packageName, displayName: candidate.sourceName, trustedDirectApp: true as const }]) });
}

function wallet(ledger = configuredLedger()): WalletState { return Object.freeze({ version: 2, locale: "ko", activeLedgerId: ledger.id, ledgers: Object.freeze([ledger]) }); }

test("new app merchant drafts remain visible and cannot save until user completes them", () => {
  const draft = parseNativeCardCandidate({ ...candidate, packageName: "hr.lunc.client", sourceName: "Swile", merchant: "", requiresMerchant: true, queueToken: "original-token" });
  assert.ok(draft);
  assert.equal(draft.confidence, "review");
  const current = wallet();
  const result = applyHighConfidenceCardAutomation(current, [draft]);
  assert.equal(result.state, current);
  assert.equal(result.pending.length, 1);
  assert.deepEqual(result.acknowledgedIds, []);
  assert.throws(() => confirmCardCandidate(current, current.ledgers[0].id, draft));
  assert.throws(() => completeCandidateMerchant(draft, "   "));
  const reviewed = completeCandidateMerchant(draft, "Lidl");
  assert.equal(reviewed.id, draft.id); assert.equal(reviewed.queueToken, draft.queueToken);
  const confirmed = confirmCardCandidate(current, current.ledgers[0].id, reviewed);
  assert.equal(confirmed.inserted, true);
  assert.equal(confirmed.state.ledgers[0].expenses[0].description, "Lidl");
  assert.equal(applyHighConfidenceCardAutomation(confirmed.state, [draft]).pending.length, 0);
});

test("trusted packages cannot auto-save missing merchants or bypass malformed draft validation", () => {
  const draft = Object.freeze({ ...candidate, merchant: "", requiresMerchant: true });
  const result = applyHighConfidenceCardAutomation(wallet(), [draft]);
  assert.equal(result.insertedIds.length, 0);
  assert.equal(result.pending[0].confidence, "review");
  assert.equal(parseNativeCardCandidate({ ...draft, requiresMerchant: "yes" }), null);
  assert.equal(parseNativeCardCandidate({ ...draft, requiresMerchant: false }), null);
  assert.equal(parseNativeCardCandidate({ ...candidate, occurredOn: "2026-99-99" }), null);
});

test("other currencies and ambiguous owners do not disappear from review", () => {
  const first = Object.freeze({ ...configuredLedger(), automationAllApps: true });
  const second = Object.freeze({ ...createLedger("general", "Other", "EUR"), automationAllApps: true });
  const foreign = Object.freeze({ ...candidate, id: "kr-payment", packageName: "kr.example.bank", currency: "KRW", confidence: "review" as const });
  const unknown = Object.freeze({ ...candidate, id: "new-payment", packageName: "com.example.newapp", confidence: "review" as const });
  assert.deepEqual(visibleCardCandidates([first, second], first.id, [foreign, unknown]), [foreign, unknown]);
  assert.deepEqual(visibleCardCandidates([first, second], second.id, [foreign, unknown]), [foreign, unknown]);
  assert.throws(() => confirmCardCandidate(wallet(first), first.id, foreign));
  assert.deepEqual(visibleCardCandidates([first, second], second.id, [candidate]), [], "explicit owner remains the review destination for matching currency");
});

test("native candidates are strictly validated and duplicate queue rows collapse", () => {
  assert.deepEqual(parseNativeCardCandidate(candidate), candidate);
  assert.equal(parseNativeCardCandidate({ ...candidate, minorUnits: -1 }), null);
  assert.equal(parseNativeCardCandidate({ ...candidate, packageName: "not-a-package" }), null);
  assert.equal(parseNativeCardCandidate({ ...candidate, occurredAt: "2026-02-30T10:00:00Z" }), null);
  assert.equal(parseNativeCardCandidate({ ...candidate, occurredOn: "2026-02-30" }), null);
  assert.equal(parseNativeCardCandidate({ ...candidate, eventType: "credit" }), null);
  assert.equal(parseNativeCardCandidate({ ...candidate, eventType: "outgoing_transfer" })?.eventType, "outgoing_transfer");
  assert.equal(parseNativeCardCandidate({ ...candidate, eventType: "direct_debit" })?.eventType, "direct_debit");
  assert.equal(parseNativeCardCandidate({ ...candidate, eventType: "standing_order" })?.eventType, "standing_order");
  assert.equal(parseNativeCardCandidate({ ...candidate, eventType: undefined })?.eventType, "purchase");
  assert.equal(parseNativeCardCandidate({ ...candidate, identityConflict: true })?.identityConflict, undefined, "native input cannot set an app-only conflict flag");
  const batch = parseNativeCandidateBatch({ events: [candidate, candidate, { ...candidate, id: "bad", queueToken: "bad-version", currency: "EURO" }] });
  assert.equal(batch.candidates.length, 1);
  assert.deepEqual(batch.rejectedIds, ["bad"]);
  assert.deepEqual(batch.rejectedAcknowledgements, [{ id: "bad", queueToken: "bad-version" }]);
});

test("completed outgoing transfers and executed recurring debits use the normal editable expense pipeline", () => {
  const outbound = Object.freeze({ ...candidate, id: "transfer-1", merchant: "Marie Dupont", eventType: "outgoing_transfer" as const });
  const directDebit = Object.freeze({ ...candidate, id: "debit-1", merchant: "Electric EDF", eventType: "direct_debit" as const });
  const standingOrder = Object.freeze({ ...candidate, id: "standing-1", merchant: "Landlord", eventType: "standing_order" as const });
  const result = applyHighConfidenceCardAutomation(wallet(), [outbound, directDebit, standingOrder]);
  assert.deepEqual(result.insertedIds, [outbound.id, directDebit.id, standingOrder.id]);
  assert.equal(result.state.ledgers[0].kind === "general" ? result.state.ledgers[0].expenses.length : 0, 3);
  if (result.state.ledgers[0].kind !== "general") throw new Error("expected general ledger");
  assert.equal(result.state.ledgers[0].expenses[0].category, "other");
  assert.equal(result.state.ledgers[0].expenses[1].category, "utilities");
  const edited = Object.freeze({ ...result.state.ledgers[0].expenses[0], description: "친구에게 보냄", category: "leisure" as const });
  const editedLedger = Object.freeze({ ...result.state.ledgers[0], expenses: replaceExpenseById(result.state.ledgers[0].expenses, edited) });
  const replay = applyHighConfidenceCardAutomation(wallet(editedLedger), [outbound]);
  assert.deepEqual(replay.state.ledgers[0].kind === "general" ? replay.state.ledgers[0].expenses[0] : null, edited);
  assert.deepEqual(replay.acknowledgedIds, [outbound.id]);
  assert.deepEqual(replay.pending, []);
});

test("stable ids and category inference are deterministic", () => {
  assert.equal(automationExpenseId(candidate), automationExpenseId({ ...candidate }));
  assert.notEqual(automationExpenseId(candidate), automationExpenseId({ ...candidate, id: "native-2" }));
  assert.equal(inferGeneralCategory("Lidl Paris"), "food");
  assert.equal(inferGeneralCategory("SNCF Connect"), "transport");
  assert.equal(inferGeneralCategory("Unknown merchant"), "other");
});

test("only high-confidence uniquely configured candidates auto-merge and replays are acknowledged", () => {
  const review = Object.freeze({ ...candidate, id: "review-1", confidence: "review" as const });
  const unconfigured = Object.freeze({ ...candidate, id: "other-1", packageName: "com.example.card" });
  const first = applyHighConfidenceCardAutomation(wallet(), [candidate, review, unconfigured]);
  assert.deepEqual(first.insertedIds, [candidate.id]);
  assert.deepEqual(first.acknowledgedIds, [candidate.id]);
  assert.deepEqual(first.pending.map((item) => item.id), [review.id, unconfigured.id]);
  const ledger = first.state.ledgers[0];
  assert.equal(ledger.kind, "general");
  if (ledger.kind !== "general") throw new Error("expected general ledger");
  assert.equal(ledger.expenses.length, 1);
  assert.equal(ledger.expenses[0].id, automationExpenseId(candidate));
  assert.equal(ledger.expenses[0].description, candidate.merchant);
  const replay = applyHighConfidenceCardAutomation(first.state, [candidate]);
  assert.equal(replay.state, first.state);
  assert.deepEqual(replay.acknowledgedIds, [candidate.id]);
  assert.equal(replay.insertedIds.length, 0);
});

test("messaging, email, and browser aggregator candidates always require manual confirmation", () => {
  const relayed = Object.freeze({ ...candidate, id: "sms-1", packageName: "com.google.android.apps.messaging", sourceName: "Messages", manualOnly: true });
  const ledger = Object.freeze({ ...createLedger("general", "SMS card", "EUR"), automationSources: Object.freeze([{ packageName: relayed.packageName, displayName: relayed.sourceName, trustedDirectApp: true as const }]) });
  const state = wallet(ledger);
  const result = applyHighConfidenceCardAutomation(state, [relayed]);
  assert.equal(result.state, state);
  assert.deepEqual(result.insertedIds, []);
  assert.deepEqual(result.acknowledgedIds, []);
  assert.deepEqual(result.pending, [{ ...relayed, confidence: "review" }]);
  const confirmed = confirmCardCandidate(state, ledger.id, result.pending[0]);
  assert.equal(confirmed.inserted, true);
});

test("an automatically recorded expense stays editable and a replay preserves the user's changes", () => {
  const recorded = applyHighConfidenceCardAutomation(wallet(), [candidate]);
  const ledger = recorded.state.ledgers[0];
  if (ledger.kind !== "general") throw new Error("expected general ledger");
  const original = ledger.expenses[0];
  const edited = Object.freeze({ ...original, description: "동네 마트", category: "shopping" as const, minorUnits: 1199, occurredOn: "2026-08-29" });
  assert.equal(edited.automationReversalFingerprint, original.automationReversalFingerprint);
  const editedLedger = Object.freeze({ ...ledger, expenses: replaceExpenseById(ledger.expenses, edited) });
  const editedState = Object.freeze({ ...recorded.state, ledgers: Object.freeze([editedLedger]) });

  const replay = applyHighConfidenceCardAutomation(editedState, [candidate]);
  assert.equal(replay.state, editedState);
  assert.deepEqual(replay.acknowledgedIds, [candidate.id]);
  assert.deepEqual(replay.state.ledgers[0].kind === "general" ? replay.state.ledgers[0].expenses[0] : null, edited);

  const reposted = Object.freeze({ ...candidate, id: "native-reposted", occurredAt: "2026-08-30T10:17:00+02:00" });
  const repost = applyHighConfidenceCardAutomation(editedState, [reposted]);
  assert.equal(repost.state, editedState);
  assert.deepEqual(repost.acknowledgedIds, []);
  assert.deepEqual(repost.pending, [{ ...reposted, confidence: "review" }]);
});

test("a changed revision of the same native id requires explicit add-as-new confirmation", () => {
  const recorded = applyHighConfidenceCardAutomation(wallet(), [candidate]);
  const ledger = recorded.state.ledgers[0];
  if (ledger.kind !== "general") throw new Error("expected general ledger");
  const original = ledger.expenses[0];
  const edited = Object.freeze({ ...original, description: "사용자가 고친 상점", category: "shopping" as const, minorUnits: 1199 });
  const editedLedger = Object.freeze({ ...ledger, expenses: replaceExpenseById(ledger.expenses, edited) });
  const editedState = wallet(editedLedger);
  const changed = Object.freeze({ ...candidate, queueToken: "changed-content-token", minorUnits: 1499 });

  const review = applyHighConfidenceCardAutomation(editedState, [changed]);
  assert.equal(review.state, editedState);
  assert.deepEqual(review.acknowledgedIds, []);
  assert.deepEqual(review.pending, [{ ...changed, confidence: "review", identityConflict: true }]);
  assert.throws(() => confirmCardCandidate(editedState, editedLedger.id, review.pending[0]), /candidate-conflict/);

  const added = confirmCardCandidate(editedState, editedLedger.id, review.pending[0], { asNewTransaction: true });
  assert.equal(added.inserted, true);
  if (added.state.ledgers[0].kind !== "general") throw new Error("expected general ledger");
  assert.deepEqual(added.state.ledgers[0].expenses[0], edited, "the prior user-edited row is untouched");
  assert.notEqual(added.state.ledgers[0].expenses[1].id, original.id);
  assert.equal(added.state.ledgers[0].expenses[1].minorUnits, changed.minorUnits);
  const replay = confirmCardCandidate(added.state, editedLedger.id, review.pending[0], { asNewTransaction: true });
  assert.equal(replay.state, added.state);
  assert.equal(replay.inserted, false);
});

test("moved native identities acknowledge exact replays but review changed revisions", () => {
  const base = configuredLedger();
  const recordedLedger = applyHighConfidenceCardAutomation(wallet(base), [candidate]).state.ledgers[0];
  if (recordedLedger.kind !== "general") throw new Error("expected general ledger");
  const originalOrigin = recordedLedger.expenses[0].automationFingerprint!;
  const movedWithOrigin = Object.freeze({ ...base, movedExpenseIds: Object.freeze([automationExpenseId(candidate), originalOrigin]) });
  const movedState = wallet(movedWithOrigin);
  assert.deepEqual(applyHighConfidenceCardAutomation(movedState, [candidate]).acknowledgedIds, [candidate.id]);

  const changed = Object.freeze({ ...candidate, queueToken: "moved-revision", merchant: "Another merchant" });
  const review = applyHighConfidenceCardAutomation(movedState, [changed]);
  assert.deepEqual(review.acknowledgedIds, []);
  assert.equal(review.pending[0].identityConflict, true);
  assert.throws(() => confirmCardCandidate(movedState, movedWithOrigin.id, review.pending[0]), /candidate-conflict/);
  const added = confirmCardCandidate(movedState, movedWithOrigin.id, review.pending[0], { asNewTransaction: true });
  assert.equal(added.inserted, true);
  assert.equal(added.state.ledgers[0].expenses.length, 1);
});

test("fuzzy manual matches remain pending and user-reviewed candidates can be confirmed", () => {
  const base = configuredLedger();
  const manual = Object.freeze({ id: "manual", description: "LIDL PARIS", category: "food" as const, currency: "EUR", minorUnits: candidate.minorUnits, occurredOn: "2026-08-30" });
  const withManual = Object.freeze({ ...base, expenses: Object.freeze([manual]) });
  const duplicate = applyHighConfidenceCardAutomation(wallet(withManual), [candidate]);
  assert.equal(duplicate.insertedIds.length, 0);
  assert.deepEqual(duplicate.acknowledgedIds, []);
  assert.deepEqual(duplicate.pending, [{ ...candidate, confidence: "review" }]);
  const review = Object.freeze({ ...candidate, id: "review-2", merchant: "Starbucks", minorUnits: 500, confidence: "review" as const });
  const confirmed = confirmCardCandidate(duplicate.state, base.id, review);
  assert.equal(confirmed.inserted, true);
  assert.equal(confirmed.reversed, false);
  assert.equal(confirmed.state.ledgers[0].kind === "general" ? confirmed.state.ledgers[0].expenses.length : 0, 2);
});

test("same merchant, date, and amount with another stable id is never silently discarded", () => {
  const second = Object.freeze({ ...candidate, id: "native-2" });
  const result = applyHighConfidenceCardAutomation(wallet(), [candidate, second]);
  assert.deepEqual(result.insertedIds, [candidate.id]);
  assert.deepEqual(result.acknowledgedIds, [candidate.id]);
  assert.deepEqual(result.pending, [{ ...second, confidence: "review" }]);
  const confirmed = confirmCardCandidate(result.state, result.state.ledgers[0].id, result.pending[0]);
  assert.equal(confirmed.inserted, true);
  assert.equal(confirmed.state.ledgers[0].expenses.length, 2);
});

test("travel ledgers never receive automated expenses", () => {
  const travel = createLedger("travel", "Paris", "EUR"); const state: WalletState = Object.freeze({ version: 2, locale: "ko", activeLedgerId: travel.id, ledgers: Object.freeze([travel]) });
  const result = applyHighConfidenceCardAutomation(state, [candidate]);
  assert.equal(result.state, state);
  assert.deepEqual(result.pending, [candidate]);
});

test("monthly limit status and native configuration use the current calendar month", () => {
  const expense = Object.freeze({ id: "e", description: "Lunch", category: "food" as const, currency: "EUR", minorUnits: 40_000, occurredOn: "2026-08-15" });
  const ledger = Object.freeze({ ...configuredLedger(), expenses: Object.freeze([expense]) });
  assert.deepEqual(calculateMonthlyLimitStatus(ledger, "2026-08"), { state: "near", spentMinor: 40_000, limitMinor: 50_000, remainingMinor: 10_000, percent: 80 });
  assert.equal(calculateMonthlyLimitStatus(Object.freeze({ ...ledger, monthlyLimitMinor: 30_000 }), "2026-08").state, "over");
  assert.equal(calculateMonthlyLimitStatus(Object.freeze({ ...ledger, monthlyLimitMinor: 40_000 }), "2026-08").state, "reached");
  assert.equal(calculateMonthlyLimitStatus(Object.freeze({ ...ledger, monthlyLimitMinor: null }), "2026-08").state, "unset");
  const config = buildNativeAutomationConfiguration(wallet(ledger), "fr", new Date(2026, 7, 30));
  assert.deepEqual(config.ledgers[0], { ledgerId: ledger.id, title: ledger.title, currency: "EUR", monthlyLimitMinor: 50_000, spentMinor: 40_000, month: "2026-08", locale: "fr", automationAllApps: false });
  assert.deepEqual(config.sources, [{ packageName: candidate.packageName, ledgerId: ledger.id, currency: "EUR" }]);
  assert.equal(config.detectAllApps, false);
});

test("all-app discovery is opt-in and never auto-inserts an unregistered package", () => {
  const ledger = Object.freeze({ ...createLedger("general", "Global", "EUR"), automationAllApps: true });
  const discovered = Object.freeze({ ...candidate, id: "new-bank", packageName: "com.example.worldbank", sourceName: "World Bank" });
  const result = applyHighConfidenceCardAutomation(wallet(ledger), [discovered]);
  assert.equal(result.insertedIds.length, 0);
  assert.deepEqual(result.pending, [{ ...discovered, confidence: "review" }]);
  assert.equal(buildNativeAutomationConfiguration(wallet(ledger), "ko").detectAllApps, true);
});

test("a reversal without the same stable event id never deletes automatically", () => {
  const purchase = applyHighConfidenceCardAutomation(wallet(), [candidate]);
  const reversal = Object.freeze({ ...candidate, id: "refund-1", occurredAt: "2026-09-01T10:00:00+02:00", occurredOn: "2026-09-01", eventType: "reversal" as const });
  const reversed = applyHighConfidenceCardAutomation(purchase.state, [reversal]);
  assert.equal(reversed.state, purchase.state);
  assert.deepEqual(reversed.insertedIds, []);
  assert.deepEqual(reversed.reversedIds, []);
  assert.deepEqual(reversed.acknowledgedIds, []);
  assert.equal(reversed.state.ledgers[0].expenses.length, 1);
  assert.deepEqual(reversed.pending, [{ ...reversal, confidence: "review" }]);
});

test("an updated notification can reverse a purchase with the same stable event id", () => {
  const purchase = applyHighConfidenceCardAutomation(wallet(), [candidate]);
  const reversal = Object.freeze({ ...candidate, eventType: "reversal" as const });
  const result = applyHighConfidenceCardAutomation(purchase.state, [reversal]);
  assert.deepEqual(result.reversedIds, [reversal.id]);
  assert.equal(result.state.ledgers[0].expenses.length, 0);
  assert.notEqual(parseWalletStateStrict(result.state), null);
  assert.equal(result.state.ledgers[0].kind === "general" ? result.state.ledgers[0].automationReversalIds.length : 0, 3);
  const replay = applyHighConfidenceCardAutomation(result.state, [candidate]);
  assert.equal(replay.state, result.state);
  assert.deepEqual(replay.acknowledgedIds, [candidate.id]);
  const changed = Object.freeze({ ...candidate, queueToken: "after-reversal-change", minorUnits: candidate.minorUnits + 1 });
  const changedResult = applyHighConfidenceCardAutomation(result.state, [changed]);
  assert.deepEqual(changedResult.acknowledgedIds, []);
  assert.equal(changedResult.pending[0].identityConflict, true);
  assert.throws(() => confirmCardCandidate(result.state, result.state.ledgers[0].id, changedResult.pending[0]), /candidate-conflict/);
  assert.equal(confirmCardCandidate(result.state, result.state.ledgers[0].id, changedResult.pending[0], { asNewTransaction: true }).inserted, true);
  assert.throws(() => confirmCardCandidate(result.state, result.state.ledgers[0].id, reversal, { asNewTransaction: true }), /candidate-conflict/);
});

test("a cancellation can be confirmed even when the ledger is at its expense limit", () => {
  const recorded = applyHighConfidenceCardAutomation(wallet(), [candidate]);
  const ledger = recorded.state.ledgers[0];
  if (ledger.kind !== "general") throw new Error("expected general ledger");
  const fillers = Array.from({ length: 4_999 }, (_, index) => Object.freeze({ id: `manual-${index}`, description: `Expense ${index}`, category: "other" as const, currency: "EUR", minorUnits: 1, occurredOn: "2026-08-30" }));
  const fullLedger = Object.freeze({ ...ledger, expenses: Object.freeze([...ledger.expenses, ...fillers]) });
  const fullState = wallet(fullLedger);
  const reversal = Object.freeze({ ...candidate, id: "refund-full", eventType: "reversal" as const });
  const confirmed = confirmCardCandidate(fullState, fullLedger.id, reversal);
  assert.equal(confirmed.reversed, true);
  assert.equal(confirmed.state.ledgers[0].expenses.length, 4_999);
});

test("a reposted old cancellation never removes a later identical purchase automatically", () => {
  const firstPurchase = applyHighConfidenceCardAutomation(wallet(), [candidate]);
  const firstReversal = Object.freeze({ ...candidate, occurredAt: "2026-08-31T09:00:00+02:00", occurredOn: "2026-08-31", eventType: "reversal" as const });
  const cancelled = applyHighConfidenceCardAutomation(firstPurchase.state, [firstReversal]);
  const laterPurchase = Object.freeze({ ...candidate, id: "later-purchase", occurredAt: "2026-09-10T10:15:00+02:00", occurredOn: "2026-09-10" });
  const withLaterPurchase = applyHighConfidenceCardAutomation(cancelled.state, [laterPurchase]);
  assert.equal(withLaterPurchase.state.ledgers[0].expenses.length, 1);

  const repostedOldReversal = Object.freeze({ ...candidate, id: "refund-reposted", occurredAt: "2026-09-11T09:00:00+02:00", occurredOn: "2026-09-11", eventType: "reversal" as const });
  const protectedResult = applyHighConfidenceCardAutomation(withLaterPurchase.state, [repostedOldReversal]);
  assert.equal(protectedResult.state, withLaterPurchase.state);
  assert.deepEqual(protectedResult.reversedIds, []);
  assert.deepEqual(protectedResult.pending, [{ ...repostedOldReversal, confidence: "review" }]);
});

test("reversal order is safe across the same batch and later batches", () => {
  const reversal = Object.freeze({ ...candidate, eventType: "reversal" as const });
  const sameBatch = applyHighConfidenceCardAutomation(wallet(), [reversal, candidate]);
  assert.equal(sameBatch.state.ledgers[0].expenses.length, 0);
  assert.deepEqual(sameBatch.acknowledgedIds, [candidate.id]);

  const firstPass = applyHighConfidenceCardAutomation(wallet(), [reversal]);
  assert.deepEqual(firstPass.pending, [{ ...reversal, confidence: "review" }]);
  const laterPass = applyHighConfidenceCardAutomation(firstPass.state, [...firstPass.pending, candidate]);
  assert.equal(laterPass.state.ledgers[0].expenses.length, 1);
  assert.deepEqual(laterPass.reversedIds, []);
  assert.deepEqual(laterPass.pending, firstPass.pending);
});

test("a repeated semantic cancellation cannot be manually applied to a later purchase", () => {
  const firstPurchase = applyHighConfidenceCardAutomation(wallet(), [candidate]);
  const firstReversal = Object.freeze({ ...candidate, eventType: "reversal" as const });
  const cancelled = applyHighConfidenceCardAutomation(firstPurchase.state, [firstReversal]);
  const laterPurchase = Object.freeze({ ...candidate, id: "later-identical", occurredAt: "2026-09-10T10:15:00+02:00", occurredOn: "2026-09-10" });
  const withLater = applyHighConfidenceCardAutomation(cancelled.state, [laterPurchase]);
  const repeated = Object.freeze({ ...firstReversal, id: "reposted-cancellation", occurredAt: "2026-09-11T10:15:00+02:00", occurredOn: "2026-09-11" });
  const confirmed = confirmCardCandidate(withLater.state, withLater.state.ledgers[0].id, repeated);
  assert.equal(confirmed.state, withLater.state);
  assert.equal(confirmed.reversed, false);
  assert.equal(confirmed.state.ledgers[0].expenses.length, 1);
});

test("reversals never delete manual, cross-app, or ambiguous automatic expenses", () => {
  const base = configuredLedger();
  const manual = Object.freeze({ id: "manual", description: candidate.merchant, category: "food" as const, currency: "EUR", minorUnits: candidate.minorUnits, occurredOn: candidate.occurredOn });
  const manualLedger = Object.freeze({ ...base, expenses: Object.freeze([manual]) });
  const reversal = Object.freeze({ ...candidate, id: "refund-safe", eventType: "reversal" as const });
  const manualResult = applyHighConfidenceCardAutomation(wallet(manualLedger), [reversal]);
  assert.deepEqual(manualResult.state.ledgers[0].expenses, [manual]);
  assert.equal(reversalMatchIndexes(manualLedger.expenses, reversal).length, 0);

  const first = applyHighConfidenceCardAutomation(wallet(), [candidate]);
  const firstLedger = first.state.ledgers[0];
  if (firstLedger.kind !== "general") throw new Error("expected general ledger");
  const automatic = firstLedger.expenses[0];
  const duplicateAutomatic = Object.freeze({ ...automatic, id: "card-auto-duplicate" });
  const ambiguousLedger = Object.freeze({ ...firstLedger, expenses: Object.freeze([automatic, duplicateAutomatic]) });
  const ambiguousState = wallet(ambiguousLedger);
  const ambiguous = applyHighConfidenceCardAutomation(ambiguousState, [reversal]);
  assert.equal(ambiguous.state, ambiguousState);
  assert.equal(ambiguous.state.ledgers[0].expenses.length, 2);
  assert.deepEqual(ambiguous.pending, [{ ...reversal, confidence: "review" }]);

  const otherApp = Object.freeze({ ...reversal, id: "other-refund", packageName: "com.example.other" });
  assert.equal(reversalMatchIndexes(firstLedger.expenses, otherApp).length, 0);
});

test("ambiguous source assignments are withheld from native configuration", () => {
  const first = configuredLedger();
  const second = Object.freeze({ ...configuredLedger(), id: "second-ledger" });
  const state: WalletState = Object.freeze({ version: 2, locale: "ko", activeLedgerId: first.id, ledgers: Object.freeze([first, second]) });
  assert.deepEqual(buildNativeAutomationConfiguration(state, "ko").sources, []);
  assert.deepEqual(applyHighConfidenceCardAutomation(state, [candidate]).pending, [candidate]);
});

test("an explicit source assignment takes precedence over broad same-currency discovery", () => {
  const discovery = Object.freeze({ ...createLedger("general", "Discovery", "EUR"), automationAllApps: true });
  const assigned = Object.freeze({ ...configuredLedger(), id: "assigned-ledger" });
  const state: WalletState = Object.freeze({ version: 2, locale: "ko", activeLedgerId: assigned.id, ledgers: Object.freeze([discovery, assigned]) });
  assert.deepEqual(candidateOwnerLedgerIds(state.ledgers, candidate), [assigned.id]);
  const result = applyHighConfidenceCardAutomation(state, [candidate]);
  assert.deepEqual(result.insertedIds, [candidate.id]);
  assert.equal(result.state.ledgers[0].expenses.length, 0);
  assert.equal(result.state.ledgers[1].expenses.length, 1);
});

test("one worldwide card app can route explicit currencies to different ledgers", () => {
  const eur = Object.freeze({ ...configuredLedger(), id: "eur-ledger" });
  const usd = Object.freeze({ ...createLedger("general", "USD card", "USD"), automationSources: Object.freeze([{ packageName: candidate.packageName, displayName: candidate.sourceName, trustedDirectApp: true as const }]) });
  const state: WalletState = Object.freeze({ version: 2, locale: "en", activeLedgerId: eur.id, ledgers: Object.freeze([eur, usd]) });
  const configuration = buildNativeAutomationConfiguration(state, "en");
  assert.deepEqual(configuration.sources, [
    { packageName: candidate.packageName, ledgerId: eur.id, currency: "EUR" },
    { packageName: candidate.packageName, ledgerId: usd.id, currency: "USD" },
  ]);
  const usdCandidate = Object.freeze({ ...candidate, id: "usd-purchase", currency: "USD", merchant: "New York Store" });
  const routed = applyHighConfidenceCardAutomation(state, [usdCandidate]);
  assert.equal(routed.state.ledgers[0].expenses.length, 0);
  assert.equal(routed.state.ledgers[1].expenses.length, 1);
});

test("a queued user edit merges onto the latest automatic insertion", () => {
  const base = configuredLedger();
  const automatic = applyHighConfidenceCardAutomation(wallet(base), [candidate]);
  const latest = automatic.state.ledgers[0];
  if (latest.kind !== "general") throw new Error("expected general ledger");
  const manual = Object.freeze({ id: "manual-lunch", description: "Lunch", category: "food" as const, currency: "EUR", minorUnits: 1500, occurredOn: "2026-08-30" });
  const desired = Object.freeze({ ...base, monthlyLimitMinor: 60_000, expenses: Object.freeze([manual]) });
  const merged = mergeGeneralLedgerMutation(base, desired, latest);
  assert.equal(merged.monthlyLimitMinor, 60_000);
  assert.deepEqual(merged.expenses.map((expense) => expense.id), [automationExpenseId(candidate), manual.id]);
});
