import assert from "node:assert/strict";
import test from "node:test";
import { applyHighConfidenceCardAutomation, automationExpenseId, buildNativeAutomationConfiguration, calculateMonthlyLimitStatus, confirmCardCandidate, inferGeneralCategory, parseNativeCandidateBatch, parseNativeCardCandidate, type NativeCardCandidate } from "../src/lib/cardAutomation";
import type { GeneralLedger, WalletState } from "../src/lib/types";
import { createLedger, mergeGeneralLedgerMutation, replaceExpenseById } from "../src/lib/wallet";

const candidate: NativeCardCandidate = Object.freeze({ id: "native-1", packageName: "com.revolut.revolut", sourceName: "Revolut", merchant: "Lidl Paris", minorUnits: 1299, currency: "EUR", occurredAt: "2026-08-30T10:15:00+02:00", occurredOn: "2026-08-30", confidence: "high" });

function configuredLedger(): GeneralLedger {
  return Object.freeze({ ...createLedger("general", "생활", "EUR"), monthlyLimitMinor: 50_000, automationSources: Object.freeze([{ packageName: candidate.packageName, displayName: candidate.sourceName }]) });
}

function wallet(ledger = configuredLedger()): WalletState { return Object.freeze({ version: 2, locale: "ko", activeLedgerId: ledger.id, ledgers: Object.freeze([ledger]) }); }

test("native candidates are strictly validated and duplicate queue rows collapse", () => {
  assert.deepEqual(parseNativeCardCandidate(candidate), candidate);
  assert.equal(parseNativeCardCandidate({ ...candidate, minorUnits: -1 }), null);
  assert.equal(parseNativeCardCandidate({ ...candidate, packageName: "not-a-package" }), null);
  assert.equal(parseNativeCardCandidate({ ...candidate, occurredAt: "2026-02-30T10:00:00Z" }), null);
  assert.equal(parseNativeCardCandidate({ ...candidate, occurredOn: "2026-02-30" }), null);
  const batch = parseNativeCandidateBatch({ events: [candidate, candidate, { ...candidate, id: "bad", currency: "EURO" }] });
  assert.equal(batch.candidates.length, 1);
  assert.deepEqual(batch.rejectedIds, ["bad"]);
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

test("an automatically recorded expense stays editable and a replay preserves the user's changes", () => {
  const recorded = applyHighConfidenceCardAutomation(wallet(), [candidate]);
  const ledger = recorded.state.ledgers[0];
  if (ledger.kind !== "general") throw new Error("expected general ledger");
  const original = ledger.expenses[0];
  const edited = Object.freeze({ ...original, description: "동네 마트", category: "shopping" as const, minorUnits: 1199, occurredOn: "2026-08-29" });
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
  assert.deepEqual(config.ledgers[0], { ledgerId: ledger.id, title: ledger.title, currency: "EUR", monthlyLimitMinor: 50_000, spentMinor: 40_000, locale: "fr" });
  assert.deepEqual(config.sources, [{ packageName: candidate.packageName, ledgerId: ledger.id }]);
});

test("ambiguous source assignments are withheld from native configuration", () => {
  const first = configuredLedger();
  const second = Object.freeze({ ...configuredLedger(), id: "second-ledger" });
  const state: WalletState = Object.freeze({ version: 2, locale: "ko", activeLedgerId: first.id, ledgers: Object.freeze([first, second]) });
  assert.deepEqual(buildNativeAutomationConfiguration(state, "ko").sources, []);
  assert.deepEqual(applyHighConfidenceCardAutomation(state, [candidate]).pending, [candidate]);
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
