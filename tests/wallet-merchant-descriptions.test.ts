import assert from "node:assert/strict";
import test from "node:test";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { applyHighConfidenceCardAutomation, automationExpenseId, confirmCardCandidate, type NativeCardCandidate } from "../src/lib/cardAutomation";
import { rememberMerchantCategory } from "../src/lib/categoryInference";
import { attachLedgerToPdf } from "../src/lib/ledgerPdf";
import { descriptionMerchantKey, MAX_MERCHANT_DESCRIPTION_PREFERENCES, rememberMerchantDescription, resolveMerchantDescription } from "../src/lib/merchantDescriptions";
import { createLedgerSharePayload, parseLedgerSharePayload } from "../src/lib/share";
import type { GeneralExpense, GeneralLedger, WalletState } from "../src/lib/types";
import { createLedger, mergeGeneralLedgerMutation, parseLedger, parseWalletStateStrict } from "../src/lib/wallet";

// Synthetic receipts only; no bank, account or notification data from a user.
const bank = "com.example.synthetic.bank";
const pay = "com.example.synthetic.wallet";
const rawMerchant = "이마트여의도점";
const alias = "이마트 장보기";
function candidate(id = "first", overrides: Partial<NativeCardCandidate> = {}): NativeCardCandidate {
  return { id, queueToken: `token-${id}`, packageName: bank, sourceName: "Synthetic bank", merchant: rawMerchant,
    currency: "KRW", minorUnits: 14000, occurredOn: "2026-11-01", occurredAt: "2026-11-01T12:00:00+09:00",
    deliveredAt: "2026-11-01T12:00:00+09:00", eventType: "purchase", confidence: "high", manualOnly: false, ...overrides };
}
function ledger(): GeneralLedger {
  return { ...createLedger("general", "Synthetic spending", "KRW"), automationAllApps: true,
    automationSources: [bank, pay].map((packageName) => ({ packageName, displayName: "Synthetic source", trustedDirectApp: true })) };
}
function wallet(...ledgers: GeneralLedger[]): WalletState { return { version: 2, locale: "ko", activeLedgerId: ledgers[0].id, ledgers }; }
function general(state: WalletState, index = 0): GeneralLedger { const value = state.ledgers[index]; assert.equal(value.kind, "general"); return value as GeneralLedger; }
function received(): GeneralLedger { return general(applyHighConfidenceCardAutomation(wallet(ledger()), [candidate()]).state); }
function edit(source: GeneralLedger, description = alias, expenseId = source.expenses[0].id): GeneralLedger {
  const previous = source.expenses.find((item) => item.id === expenseId); assert.ok(previous);
  const changed = { ...previous, description };
  return rememberMerchantDescription({ ...source, expenses: source.expenses.map((item) => item.id === expenseId ? changed : item) }, changed, previous);
}
function next(id = "next", overrides: Partial<NativeCardCandidate> = {}): NativeCardCandidate {
  return candidate(id, { minorUnits: 15000, occurredOn: "2026-11-02", occurredAt: "2026-11-02T12:00:00+09:00", deliveredAt: "2026-11-02T12:00:00+09:00", ...overrides });
}

test("an edited merchant description is reused for the next notification without altering raw evidence", () => {
  const original = received(); const before = original.expenses[0]; const learned = edit(original);
  assert.equal(before.description, rawMerchant, "old immutable state remains untouched");
  assert.equal(learned.expenses[0].description, alias);
  assert.equal(learned.expenses[0].originalMerchant, rawMerchant);
  assert.equal(resolveMerchantDescription(learned, rawMerchant), alias);
  const result = applyHighConfidenceCardAutomation(wallet(learned), [next()]);
  assert.equal(result.insertedIds.length, 1);
  const saved = general(result.state).expenses[1];
  assert.equal(saved.description, alias); assert.equal(saved.originalMerchant, rawMerchant);
  assert.equal(saved.minorUnits, 15000); assert.equal(saved.occurredOn, "2026-11-02");
  const receipt = general(result.state).automationPaymentReceipts?.find((item) => item.expenseId === saved.id); assert.ok(receipt);
  assert.equal(receipt.merchant, rawMerchant); assert.equal(receipt.sources[0].merchant, rawMerchant);
  assert.notEqual(saved.automationFingerprint, undefined);
});

test("name choices survive strict storage roundtrip, source deletion and later app runs", () => {
  const learned = edit(received());
  const restored = parseWalletStateStrict(JSON.parse(JSON.stringify(wallet(learned)))); assert.ok(restored);
  assert.equal(general(restored).expenses[0].originalMerchant, rawMerchant);
  const noOldExpense = { ...general(restored), expenses: [] };
  assert.equal(resolveMerchantDescription(noOldExpense, rawMerchant), alias);
  const result = applyHighConfidenceCardAutomation(wallet(noOldExpense), [next()]);
  assert.equal(general(result.state).expenses[0].description, alias);
});

test("a second edit changes the original name mapping and never creates recursive aliases", () => {
  const first = edit(received()); const second = edit(first, "주말 장보기");
  assert.equal(resolveMerchantDescription(second, rawMerchant), "주말 장보기");
  assert.equal(resolveMerchantDescription(second, alias), alias, "a custom label is not a new bank identity");
  assert.equal(second.expenses[0].originalMerchant, rawMerchant);
  const result = applyHighConfidenceCardAutomation(wallet(second), [next()]);
  assert.equal(general(result.state).expenses[1].description, "주말 장보기");
  const revert = edit(second, rawMerchant);
  assert.equal(resolveMerchantDescription(revert, rawMerchant), rawMerchant);
});

test("exact normalization preserves branches, accents and punctuation, and rules remain ledger-local", () => {
  assert.equal(descriptionMerchantKey("  EXAMPLE   Store  "), descriptionMerchantKey("example store"));
  assert.notEqual(descriptionMerchantKey("A-B"), descriptionMerchantKey("AB"));
  assert.notEqual(descriptionMerchantKey("Café"), descriptionMerchantKey("Cafe"));
  assert.notEqual(descriptionMerchantKey("Store 1"), descriptionMerchantKey("Store 2"));
  const learned = edit(received());
  assert.equal(resolveMerchantDescription(learned, "이마트강남점"), "이마트강남점");
  assert.equal(resolveMerchantDescription(ledger(), rawMerchant), rawMerchant);
  assert.equal(descriptionMerchantKey("x".repeat(501)), "");
  assert.equal(descriptionMerchantKey("bad\0name"), "");
});

test("replayed and cross-wallet issuer notifications remain one renamed expense", () => {
  const learned = edit(received()); const state = wallet(learned);
  const replay = applyHighConfidenceCardAutomation(state, [candidate()]);
  assert.equal(replay.state, state); assert.equal(replay.pending.length, 0);
  const duplicate = candidate("wallet-copy", { packageName: pay, merchant: "E MART SEOUL BRANCH", occurredAt: "2026-11-01T12:00:20+09:00", deliveredAt: "2026-11-01T12:00:20+09:00" });
  const joined = applyHighConfidenceCardAutomation(state, [duplicate]);
  assert.equal(general(joined.state).expenses.length, 1); assert.equal(joined.pending.length, 0);
  assert.equal(general(joined.state).expenses[0].description, alias);
  assert.equal(general(joined.state).automationPaymentReceipts?.[0].sources[1].merchant, duplicate.merchant);
  const changedAgain = edit(general(joined.state), "생필품 장보기");
  assert.equal(resolveMerchantDescription(changedAgain, rawMerchant), "생필품 장보기");
  assert.equal(resolveMerchantDescription(changedAgain, duplicate.merchant), "생필품 장보기");
});

test("cancellation and cashback retain original merchant matching after rename", () => {
  const learned = edit(received());
  const reward = candidate("cashback", { eventType: "cashback", minorUnits: 1400, deliveredAt: "2026-11-01T12:00:30+09:00" });
  const reduced = applyHighConfidenceCardAutomation(wallet(learned), [reward]);
  assert.equal(general(reduced.state).expenses[0].description, alias);
  assert.equal(general(reduced.state).expenses[0].minorUnits, 12600);
  assert.equal(general(reduced.state).automationPaymentReceipts?.[0].minorUnits, 14000);
  const cancellation = candidate("cancel", { eventType: "reversal", occurredAt: "2026-11-01T12:02:00+09:00", deliveredAt: "2026-11-01T12:02:00+09:00" });
  const removed = applyHighConfidenceCardAutomation(reduced.state, [cancellation]);
  assert.equal(general(removed.state).expenses.length, 0);
  assert.deepEqual(removed.reversedIds, [cancellation.id]);
  assert.equal(resolveMerchantDescription(general(removed.state), rawMerchant), alias);
  assert.equal(applyHighConfidenceCardAutomation(removed.state, [candidate(), reward]).state, removed.state);
});

test("unchanged descriptions, category-only edits and new manual expenses do not learn names", () => {
  const initial = received(); const before = initial.expenses[0];
  for (const changed of [{ ...before }, { ...before, minorUnits: 15000 }, { ...before, occurredOn: "2026-11-03" }, { ...before, category: "shopping" as const }]) {
    const current = { ...initial, expenses: [changed] };
    assert.equal(rememberMerchantDescription(current, changed, before), current);
    assert.equal(rememberMerchantDescription(current, changed, before).merchantDescriptionPreferences, undefined);
  }
  const manual: GeneralExpense = { id: "manual", description: "New manual description", category: "food", minorUnits: 1000, currency: "KRW", occurredOn: "2026-11-01" };
  const fresh = { ...ledger(), expenses: [manual] };
  assert.equal(rememberMerchantDescription(fresh, manual), fresh);
});

test("concurrent edit and native insertion retain both the preference and unrelated incoming expense", () => {
  const base = received(); const desired = edit(base);
  const other = next("unrelated", { merchant: "Synthetic pharmacy", minorUnits: 17000 });
  const latest = general(applyHighConfidenceCardAutomation(wallet(base), [other]).state);
  const merged = mergeGeneralLedgerMutation(base, desired, latest);
  assert.equal(merged.expenses.length, 2);
  assert.equal(merged.expenses.find((item) => item.id === base.expenses[0].id)?.description, alias);
  assert.equal(merged.expenses.find((item) => item.id === automationExpenseId(other))?.description, other.merchant);
  assert.equal(resolveMerchantDescription(merged, rawMerchant), alias);
  const staleBudgetEdit = mergeGeneralLedgerMutation(base, { ...base, monthlyLimitMinor: 50000 }, merged);
  assert.equal(resolveMerchantDescription(staleBudgetEdit, rawMerchant), alias);
  assert.equal(staleBudgetEdit.expenses.length, 2);
});

test("manual review and revised-identity confirmation apply the same name rules", () => {
  const learned = edit(received()); const draft = next("review", { confidence: "review" });
  const accepted = confirmCardCandidate(wallet(learned), learned.id, draft);
  assert.equal(general(accepted.state).expenses[1].description, alias);
  assert.equal(general(accepted.state).expenses[1].originalMerchant, rawMerchant);
  const revised = { ...draft, minorUnits: 19000, queueToken: "revised-token", identityConflict: true };
  const separate = confirmCardCandidate(accepted.state, learned.id, revised, { asNewTransaction: true });
  assert.equal(general(separate.state).expenses[2].description, alias);
  assert.equal(general(separate.state).expenses[2].originalMerchant, rawMerchant);
  assert.equal(applyHighConfidenceCardAutomation(separate.state, [revised]).insertedIds.length, 0);
  const duplicateButSeparate = next("separate-real-payment", { minorUnits: 15000, occurredAt: "2026-11-02T12:00:20+09:00", deliveredAt: "2026-11-02T12:00:20+09:00" });
  const confirmed = confirmCardCandidate(accepted.state, learned.id, duplicateButSeparate, { asNewTransaction: true });
  assert.equal(general(confirmed.state).expenses.length, 3);
  assert.equal(general(confirmed.state).expenses[2].description, alias);
});

test("category choices still learn from raw merchants while a display alias is applied", () => {
  const base = received(); const before = base.expenses[0]; const changed = { ...before, description: "No category keyword label", category: "health" as const };
  const named = rememberMerchantDescription({ ...base, expenses: [changed] }, changed, before);
  const learned = rememberMerchantCategory(named, changed, before);
  const result = applyHighConfidenceCardAutomation(wallet(learned), [next()]);
  assert.equal(general(result.state).expenses[1].description, changed.description);
  assert.equal(general(result.state).expenses[1].category, "health");
});

test("names shared with another user exclude preferences and immutable private source names", () => {
  const learned = edit(received()); const shared = createLedgerSharePayload(learned);
  assert.ok(shared.includes(alias));
  for (const privateKey of ["merchantDescriptionPreferences", "originalMerchant", "automationPaymentReceipts", bank, rawMerchant]) assert.equal(shared.includes(privateKey), false, privateKey);
  const imported = parseLedgerSharePayload(JSON.stringify({ format: "wallet-diary", version: 1, ledger: learned })); assert.ok(imported);
  assert.equal("merchantDescriptionPreferences" in imported, false);
  assert.equal("originalMerchant" in imported.expenses[0], false);
  assert.equal(imported.expenses[0].description, alias);
});

test("embedded PDF data exports display descriptions but not the local alias rules or source evidence", async () => {
  const learned = edit(received()); const empty = await PDFDocument.create(); empty.addPage();
  const bytes = await attachLedgerToPdf(await empty.save(), learned);
  const pdf = await PDFDocument.load(bytes);
  const names = pdf.catalog.lookup(PDFName.of("Names"), PDFDict).lookup(PDFName.of("EmbeddedFiles"), PDFDict).lookup(PDFName.of("Names"), PDFArray);
  const specification = names.lookup(1, PDFDict);
  const stream = specification.lookup(PDFName.of("EF"), PDFDict).lookup(PDFName.of("F")); assert.ok(stream instanceof PDFRawStream);
  const text = new TextDecoder().decode(decodePDFRawStream(stream).decode());
  assert.ok(text.includes(alias));
  for (const privateKey of ["merchantDescriptionPreferences", "originalMerchant", "automationPaymentReceipts", rawMerchant, bank]) assert.equal(text.includes(privateKey), false, privateKey);
});

test("old ledgers remain loadable while malformed name rules fail strict parsing", () => {
  assert.ok(parseLedger(ledger()));
  const learned = edit(received()); assert.ok(parseLedger(learned));
  const good = learned.merchantDescriptionPreferences![0];
  for (const preferences of [
    [{ ...good, merchantKey: "" }], [{ ...good, description: "" }], [{ ...good, description: "x".repeat(501) }],
    [{ ...good, updatedAt: "not-a-date" }], [good, good], new Array(MAX_MERCHANT_DESCRIPTION_PREFERENCES + 1).fill(good),
  ]) assert.equal(parseLedger({ ...learned, merchantDescriptionPreferences: preferences }), null);
  assert.equal(learned.expenses[0].description, alias, "parsing bad input never mutates the existing ledger");
});

test("manual imported-name corrections preserve their original input through repeated edits", () => {
  const before: GeneralExpense = { id: "revolut-example", description: "Revolut · Example Shop", category: "shopping", currency: "KRW", minorUnits: 12000, occurredOn: "2026-11-01" };
  const source = { ...ledger(), expenses: [before] };
  const first = edit(source, "Household shopping");
  assert.equal(resolveMerchantDescription(first, "Example Shop"), "Household shopping");
  assert.equal(first.expenses[0].originalMerchant, "Example Shop");
  const second = edit(first, "Weekend supplies");
  assert.equal(resolveMerchantDescription(second, "Example Shop"), "Weekend supplies");
  assert.equal(resolveMerchantDescription(second, "Household shopping"), "Household shopping");
});

test("renaming an existing manual/imported expense does not defeat same-day duplicate review", () => {
  const before: GeneralExpense = { id: "manual-receipt", description: rawMerchant, category: "food", currency: "KRW", minorUnits: 14000, occurredOn: "2026-11-01" };
  const renamed = edit({ ...ledger(), expenses: [before] });
  const result = applyHighConfidenceCardAutomation(wallet(renamed), [candidate()]);
  assert.equal(result.insertedIds.length, 0, "a potential existing charge must not become automatic merely because its display label changed");
  assert.equal(result.pending.length, 1);
  assert.equal(general(result.state).expenses.length, 1);
});
