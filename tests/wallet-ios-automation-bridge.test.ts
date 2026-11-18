import assert from "node:assert/strict";
import test from "node:test";
import { normalizeIosInbox, normalizeCardAutomationStatus, cardAutomationConnectionState } from "../src/lib/nativeCardAutomation";
import { applyHighConfidenceCardAutomation, parseNativeCandidateBatch, buildNativeAutomationConfiguration } from "../src/lib/cardAutomation";
import { iosSourcePackageName } from "../src/lib/iosTransactionInput";
import { isSmsSenderSource } from "../src/lib/smsAutomation";
import { createLedger, parseWalletStateStrict } from "../src/lib/wallet";
import { rememberMerchantCategory } from "../src/lib/categoryInference";
import { rememberMerchantDescription } from "../src/lib/merchantDescriptions";
import type { GeneralLedger, WalletState } from "../src/lib/types";

const receivedAt = new Date(2026, 10, 4, 12).getTime();
function input(id: string, fields: Record<string, unknown> = {}) {
  return { id, queueToken: `token-${id}`, kind: "notification", sourceName: "Synthetic Bank", receivedAt, body: "Paid EUR 12.50 at Luna Cafe", ...fields };
}
function wallet(trusted: string[] = []): WalletState {
  const ledger = createLedger("general", "Synthetic ledger", "EUR") as GeneralLedger;
  return { version: 2, locale: "en", activeLedgerId: ledger.id, ledgers: [{ ...ledger, automationAllApps: true, automationSmsNotifications: true, automationSources: trusted.map((packageName) => ({ packageName, displayName: "Synthetic source", trustedDirectApp: true })) }] };
}

test("iOS consent is not reported as an Android listener connection", () => {
  const status = normalizeCardAutomationStatus({ supported: true, captureMode: "ios-shortcuts", captureEnabled: true, accessGranted: true, listenerConnected: true, queuedInputs: 3, lastShortcutReceivedAt: receivedAt });
  assert.equal(status.listenerConnected, undefined);
  assert.equal(cardAutomationConnectionState(status), "shortcuts");
  assert.equal(status.queuedInputs, 3);
  assert.equal(cardAutomationConnectionState({ ...status, accessGranted: false }), "access-required");
  assert.equal(normalizeCardAutomationStatus({ queuedInputs: -1 }).queuedInputs, undefined);
});

test("iOS ads and requests are excluded with token acknowledgements, never review rows", () => {
  const batch = parseNativeCandidateBatch(normalizeIosInbox({ inputs: [input("ad", { body: "(광고) 대출 승인 1,000,000원" }), input("request", { title: "Verify a payment", body: "You’re making an online card payment of EUR 5 to Example. Tap to verify." })] }));
  assert.equal(batch.candidates.length, 0);
  assert.deepEqual(batch.rejectedAcknowledgements.map((entry) => entry.queueToken), ["token-ad", "token-request"]);
});

test("malformed native inbox fails closed rather than silently claiming no transactions", () => {
  assert.throws(() => normalizeIosInbox(null), /ios-inbox-invalid/);
  assert.throws(() => normalizeIosInbox({ events: [] }), /ios-inbox-invalid/);
  assert.throws(() => normalizeIosInbox({ inputs: new Array(5_001) }), /ios-inbox-limit/);
  const batch = parseNativeCandidateBatch(normalizeIosInbox({ inputs: [input("bad", { receivedAt: "yesterday" })] }));
  assert.equal(batch.candidates.length, 0);
  assert.deepEqual(batch.rejectedAcknowledgements, [{ id: "bad", queueToken: "token-bad" }]);
});

test("new iOS source requires review; trusting it enables existing deterministic pipeline", () => {
  const batch = parseNativeCandidateBatch(normalizeIosInbox({ inputs: [input("paid")] }));
  assert.equal(batch.candidates.length, 1);
  assert.equal(applyHighConfidenceCardAutomation(wallet(), batch.candidates).insertedIds.length, 0);
  const source = iosSourcePackageName("notification", "Synthetic Bank");
  const applied = applyHighConfidenceCardAutomation(wallet([source]), batch.candidates);
  assert.equal(applied.insertedIds.length, 1);
  const ledger = applied.state.ledgers[0] as GeneralLedger;
  assert.equal(ledger.expenses[0].minorUnits, 1250);
  assert.equal(ledger.expenses[0].description, "Luna Cafe");
  assert.equal(applyHighConfidenceCardAutomation(applied.state, batch.candidates).insertedIds.length, 0);
});

test("iOS Wallet and issuer notifications share one expense even with different names", () => {
  const source = iosSourcePackageName("notification", "Synthetic Bank");
  const initial = wallet([source, "walletdiary.ios.wallet"]);
  const bank = parseNativeCandidateBatch(normalizeIosInbox({ inputs: [input("bank")] }));
  const first = applyHighConfidenceCardAutomation(initial, bank.candidates);
  const apple = parseNativeCandidateBatch(normalizeIosInbox({ inputs: [input("wallet", { kind: "wallet", sourceName: "Wallet", body: "", amount: "12.50", currency: "EUR", merchant: "Other branch label", receivedAt: receivedAt + 10_000 })] }));
  assert.equal(apple.candidates.length, 1);
  const second = applyHighConfidenceCardAutomation(first.state, apple.candidates);
  assert.equal((second.state.ledgers[0] as GeneralLedger).expenses.length, 1);
  assert.equal(second.pending.length, 0);
});

test("iOS message source cannot bypass separate message consent", () => {
  const source = iosSourcePackageName("message", "Synthetic Sender");
  assert.equal(isSmsSenderSource(source), true);
  const enabled = wallet([source]);
  const ledger = enabled.ledgers[0] as GeneralLedger;
  const disabled = { ...enabled, ledgers: [{ ...ledger, automationSmsNotifications: false }] };
  const batch = parseNativeCandidateBatch(normalizeIosInbox({ inputs: [input("sms", { kind: "message", sourceName: "Synthetic Sender" })] }));
  assert.equal(applyHighConfidenceCardAutomation(disabled, batch.candidates).insertedIds.length, 0);
  assert.equal(buildNativeAutomationConfiguration(disabled, "en").sources.length, 0);
  assert.equal(applyHighConfidenceCardAutomation(enabled, batch.candidates).insertedIds.length, 1);
});

test("foreign currency remains review and never uses an invented exchange rate", () => {
  const source = iosSourcePackageName("notification", "Synthetic Bank");
  const batch = parseNativeCandidateBatch(normalizeIosInbox({ inputs: [input("usd", { body: "Paid USD 12.50 at Luna Cafe" })] }));
  const result = applyHighConfidenceCardAutomation(wallet([source]), batch.candidates);
  assert.equal(result.insertedIds.length, 0);
  assert.equal(result.pending.length, 1);
  assert.equal(result.pending[0].currency, "USD");
});

test("iOS forwarded purchases use the same household, utilities and telecom categories", () => {
  const source = iosSourcePackageName("notification", "Synthetic Bank");
  const batch = parseNativeCandidateBatch(normalizeIosInbox({ inputs: [
    input("household", { body: "Paid EUR 5 at Laverie Exemple" }),
    input("utilities", { body: "Paid EUR 8 at EDF" }),
    input("telecom", { body: "Paid EUR 12 at Vodafone" }),
  ] }));
  assert.equal(batch.candidates.length, 3);
  const result = applyHighConfidenceCardAutomation(wallet([source]), batch.candidates);
  assert.equal(result.insertedIds.length, 3);
  const expenses = (result.state.ledgers[0] as GeneralLedger).expenses;
  assert.deepEqual(expenses.map(expense => expense.category), ["living", "utilities", "telecommunications"]);
});

test("iOS edits survive storage and apply to later input without breaking cancellation matching", () => {
  const source = iosSourcePackageName("notification", "Synthetic Bank");
  const parse = (id: string, fields: Record<string, unknown> = {}) => parseNativeCandidateBatch(normalizeIosInbox({ inputs: [input(id, fields)] })).candidates;
  const first = applyHighConfidenceCardAutomation(wallet([source]), parse("first"));
  const ledger = first.state.ledgers[0] as GeneralLedger;
  const previous = ledger.expenses[0]; assert.ok(previous);
  const edited = { ...previous, description: "My weekly cafe visit", category: "leisure" as const };
  const categorized = rememberMerchantCategory({ ...ledger, expenses: [edited] }, edited, previous);
  const learned = rememberMerchantDescription(categorized, edited, previous);
  const restored = parseWalletStateStrict(JSON.parse(JSON.stringify({ ...first.state, ledgers: [learned] })));
  assert.ok(restored);
  const nextAt = receivedAt + 86_400_000;
  const next = applyHighConfidenceCardAutomation(restored, parse("next", { body: "Paid EUR 15 at Luna Cafe", receivedAt: nextAt }));
  assert.equal(next.insertedIds.length, 1);
  const saved = (next.state.ledgers[0] as GeneralLedger).expenses[1];
  assert.equal(saved.description, "My weekly cafe visit");
  assert.equal(saved.originalMerchant, "Luna Cafe");
  assert.equal(saved.category, "leisure");
  const cancelled = applyHighConfidenceCardAutomation(next.state, parse("cancelled", { body: "Payment refunded EUR 15 at Luna Cafe", receivedAt: nextAt + 60_000 }));
  assert.equal(cancelled.pending.length, 0);
  assert.equal(cancelled.reversedIds.length, 1);
  assert.equal((cancelled.state.ledgers[0] as GeneralLedger).expenses.length, 1);
  assert.equal((cancelled.state.ledgers[0] as GeneralLedger).expenses[0].minorUnits, 1250);
});
