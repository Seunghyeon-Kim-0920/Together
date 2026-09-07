import assert from "node:assert/strict";
import test from "node:test";
import { createLedgerSharePayload, parseLedgerShareDocument } from "../src/lib/share";
import { applyStatementImport, detectStatementColumns, parseStatementAmount, parseStatementDate, previewExpenseDocument, validateStatementImportRow, type ReadExpenseDocument, type StatementImportRow } from "../src/lib/statementImport";
import { EMPTY_WALLET_STATE, type WalletState } from "../src/lib/types";
import { createLedger, parseWalletStateStrict, settleTravelExpenses } from "../src/lib/wallet";

function document(rows: readonly (readonly string[])[], overrides: Partial<ReadExpenseDocument> = {}): ReadExpenseDocument {
  return { name: "synthetic-statement.csv", text: rows.map((row) => row.join("\t")).join("\n"), tables: [{ name: "Statement", rows }], scanned: false, ledger: null, ...overrides };
}
function preview(rows: readonly (readonly string[])[]) {
  return previewExpenseDocument(document([["Date", "Description", "Amount", "Currency", "Type", "Status", "Transaction ID", "Related Transaction ID"], ...rows]));
}
function row(overrides: Partial<StatementImportRow> = {}): StatementImportRow {
  return { id: "statement-test-1", sourceRow: 2, description: "Café Test", occurredOn: "2026-09-06", currency: "EUR", minorUnits: 1_001, category: "food", raw: ["2026-09-06", "Café Test", "-10.01"], selected: true, reviewReasons: [], ...overrides };
}

test("statement amounts preserve locale separators, minor units, signs and precision", () => {
  const cases: [string, string, number][] = [
    ["-1 234,56 €", "EUR", -123456], ["(1\u00a0234,56)", "EUR", -123456],
    ["1\u202f234,56 EUR", "EUR", 123456], ["1,234.56", "USD", 123456],
    ["1.234,56", "EUR", 123456], ["1'234.56 CHF", "CHF", 123456],
    ["12,000원", "KRW", 12000], ["₩ 12,000", "KRW", 12000],
    ["2,400円", "JPY", 2400], ["1,23,456.78", "INR", 12345678],
    ["12.34 DR", "EUR", -1234], ["12.34 CR", "EUR", 1234],
    ["+0.01", "EUR", 1], ["0", "EUR", 0], ["12.34-", "EUR", -1234],
  ];
  for (const [raw, currency, expected] of cases) assert.equal(parseStatementAmount(raw, currency), expected, `${currency} ${raw}`);
  assert.equal(parseStatementAmount("1,234", "KWD"), null, "three-decimal ambiguity requires an explicit separator");
  assert.equal(parseStatementAmount("1,234", "KWD", ","), 1234);
  assert.equal(parseStatementAmount("1,234", "KWD", "."), 1234000);
  for (const raw of ["12.3456", "1 2", "1,23,4", "1..20", "EUR 1 USD", "1e5", "--1.20", "(-1.20)", "90071992547409.92", "12 dollars"]) assert.equal(parseStatementAmount(raw, "EUR"), null, raw);
  assert.equal(parseStatementAmount("12.50", "JPY"), null, "yen fractions cannot be silently rounded");
  assert.equal(parseStatementAmount("10 USD", "EUR"), null);
});

test("statement dates retain provider-local dates through DST and reject calendar rollover and ambiguity", () => {
  assert.equal(parseStatementDate("2026-09-06T23:50:00-04:00"), "2026-09-06");
  assert.equal(parseStatementDate("2026-03-29 01:30:00+01:00"), "2026-03-29");
  assert.equal(parseStatementDate("2026-10-25 02:30:00+02:00"), "2026-10-25");
  assert.equal(parseStatementDate("2026년 9월 6일"), "2026-09-06");
  assert.equal(parseStatementDate("31/08/2026"), "2026-08-31");
  assert.equal(parseStatementDate("08/31/2026"), "2026-08-31");
  assert.equal(parseStatementDate("06/09/2026"), null);
  assert.equal(parseStatementDate("06/09/2026", "dmy"), "2026-09-06");
  assert.equal(parseStatementDate("06/09/2026", "mdy"), "2026-06-09");
  assert.equal(parseStatementDate("2024-02-29"), "2024-02-29");
  for (const invalid of ["2025-02-29", "2026-02-30", "2026-04-31", "2026-13-01", "2026-00-01", "2026-01-00", "03/04/26", "9999-01-01", "2026-09-06 garbage", "2026-09-06T99:99:00Z"]) assert.equal(parseStatementDate(invalid), null, invalid);
});

test("Korean, English and French mappings identify expenses without selecting balances or credits", () => {
  assert.deepEqual(detectStatementColumns(["거래일자", "가맹점명", "출금금액", "입금금액", "잔액", "통화", "거래상태"]), { date: 0, description: 1, debit: 2, credit: 3, currency: 5, status: 6 });
  assert.deepEqual(detectStatementColumns(["Date d'opération", "Libellé", "Débit", "Crédit", "Solde", "Devise"]), { date: 0, description: 1, debit: 2, credit: 3, currency: 5 });
  const result = previewExpenseDocument(document([
    ["Account statement", "Private account text"],
    ["거래일자", "가맹점명", "출금금액", "입금금액", "잔액", "통화", "거래상태"],
    ["2026-09-01", "식당", "12,000", "", "5,200,000", "KRW", "완료"],
    ["2026-09-02", "친구", "", "5,000", "5,205,000", "KRW", "완료"],
    ["2026-09-03", "철도", "8,000", "0", "5,197,000", "KRW", "완료"],
  ]));
  assert.equal(result.headerRow, 1);
  assert.deepEqual(result.rows.map((item) => [item.description, item.minorUnits, item.selected]), [["식당", 12000, true], ["철도", 8000, true]]);
  assert.deepEqual(result.excluded.map((item) => item.reason), ["income"]);
  assert.deepEqual(result.currencyTotals, [{ currency: "KRW", minorUnits: "20000", count: 2 }]);
  assert.deepEqual(result.dateRange, { from: "2026-09-01", to: "2026-09-03" });
});

test("Revolut completed dates and separate currencies remain intact; unavailable rows are excluded", () => {
  const result = previewExpenseDocument(document([
    ["Type", "Started Date", "Completed Date", "Description", "Amount", "Currency", "State", "Balance"],
    ["CARD_PAYMENT", "2026-09-01 23:50:00", "2026-09-02 01:50:00", "Lidl", "-10.12", "EUR", "COMPLETED", "1200.00"],
    ["CARD_PAYMENT", "2026-09-01", "2026-09-02", "Railway", "-1200", "JPY", "COMPLETED", "85000"],
    ["TOPUP", "2026-09-01", "2026-09-02", "Card top-up", "200", "EUR", "COMPLETED", "1400.00"],
    ["CARD_PAYMENT", "2026-09-01", "2026-09-02", "Shop", "-20", "EUR", "PENDING", "1400"],
    ["CARD_PAYMENT", "2026-09-01", "2026-09-02", "Shop", "-30", "EUR", "DECLINED", "1400"],
    ["CARD_PAYMENT", "2026-09-01", "2026-09-02", "Shop", "-40", "EUR", "REVERTED", "1400"],
  ]));
  assert.equal(result.mapping.date, 2);
  assert.deepEqual(result.rows.map((item) => [item.occurredOn, item.currency, item.minorUnits]), [["2026-09-02", "EUR", 1012], ["2026-09-02", "JPY", 1200]]);
  assert.deepEqual(result.excluded.map((item) => item.reason).sort(), ["cancelled", "failed", "income", "pending"]);
  assert.deepEqual(result.currencyTotals, [{ currency: "EUR", minorUnits: "1012", count: 1 }, { currency: "JPY", minorUnits: "1200", count: 1 }]);
});

test("missing dates, merchants, currency and amount direction stay editable and unselected", () => {
  const result = previewExpenseDocument(document([
    ["Date", "Description", "Amount", "Currency"],
    ["06/09/2026", "Lidl", "-10.00", "EUR"],
    ["2026-09-06", "", "-20", "EUR"],
    ["2026-09-06", "Shop", "not money", "EUR"],
    ["2026-09-06", "Shop", "-10", ""],
    ["2026-09-06", "Shop", "10", "EUR"],
  ]));
  assert.equal(result.rows.length, 5); assert.ok(result.rows.every((item) => !item.selected));
  assert.deepEqual(result.rows.map((item) => item.reviewReasons[0]), ["ambiguous_date", "missing_description", "invalid_amount", "missing_currency", "ambiguous_direction"]);
  const corrected = { ...result.rows[0], occurredOn: "2026-09-06", selected: true };
  assert.equal(validateStatementImportRow(corrected), true);
  assert.equal(corrected.id, result.rows[0].id, "editing retains source identity");
  const applied = applyStatementImport(EMPTY_WALLET_STATE, [corrected], { kind: "new-general", title: "생활" });
  assert.equal(applied.added, 1); assert.equal(applied.state.ledgers[0].expenses[0].occurredOn, "2026-09-06");
});

test("manual table, no-header mapping, decimal and sign choices are respected", () => {
  const source = document([], { tables: [{ name: "Notes", rows: [["Not transactions"]] }, { name: "Purchases", rows: [["Store", "06/09/2026", "1,234", "KWD"], ["Salary", "07/09/2026", "-10,000", "KWD"]] }] });
  const result = previewExpenseDocument(source, { tableIndex: 1, headerRow: -1, mapping: { description: 0, date: 1, amount: 2, currency: 3 }, dateOrder: "dmy", decimalSeparator: ",", amountSign: "positive" });
  assert.equal(result.tableIndex, 1); assert.equal(result.headerRow, -1);
  assert.deepEqual(result.rows.map((item) => [item.description, item.occurredOn, item.minorUnits, item.selected]), [["Store", "2026-09-06", 1234, true]]);
  assert.deepEqual(result.excluded.map((item) => item.reason), ["income"]);
});

test("refunds reconcile only one unambiguous same-file payment; unmatched refunds never become spending", () => {
  const result = preview([
    ["2026-09-01", "Lidl", "-20.00", "EUR", "payment", "completed", "pay-1", ""],
    ["2026-09-02", "Lidl", "5.25", "EUR", "refund", "completed", "refund-1", "pay-1"],
    ["2026-09-02", "Lidl", "5.25", "EUR", "refund", "completed", "refund-1", "pay-1"],
    ["2026-09-03", "Cafe", "-10.00", "EUR", "payment", "completed", "pay-2", ""],
    ["2026-09-04", "Cafe", "10.00", "EUR", "refund", "completed", "refund-2", "pay-2"],
    ["2026-09-05", "Unknown", "8.00", "EUR", "refund", "completed", "refund-3", ""],
  ]);
  assert.deepEqual(result.rows.map((item) => [item.description, item.minorUnits]), [["Lidl", 1475]]);
  assert.ok(result.rows[0].reviewReasons.includes("refund_adjusted"));
  assert.equal(result.excluded.filter((item) => item.reason === "duplicate").length, 1);
  assert.equal(result.excluded.filter((item) => item.reason === "refund_unmatched").length, 1);
  const original = preview([["2026-09-01", "Lidl", "-20.00", "EUR", "payment", "completed", "pay-1", ""]]);
  assert.equal(result.rows[0].id, original.rows[0].id, "netted refunds retain the original payment identity");
  const ambiguous = preview([
    ["2026-09-01", "Shop", "-20", "EUR", "payment", "completed", "a", ""],
    ["2026-09-02", "Shop", "-30", "EUR", "payment", "completed", "b", ""],
    ["2026-09-03", "Shop", "5", "EUR", "refund", "completed", "c", ""],
  ]);
  assert.deepEqual(ambiguous.rows.map((item) => item.minorUnits), [2000, 3000]);
  assert.equal(ambiguous.excluded[0].reason, "refund_unmatched");
  assert.ok(ambiguous.rows.every((item) => !item.selected && item.reviewReasons.includes("refund_unmatched")), "ambiguous refunds need review before original payments are added");
});

test("cancelled source identities remove their same-file original and conflicting identities are quarantined", () => {
  const cancelled = preview([
    ["2026-09-01", "Shop", "-20", "EUR", "payment", "completed", "same", ""],
    ["2026-09-01", "Shop", "-20", "EUR", "payment", "reverted", "same", ""],
  ]);
  assert.equal(cancelled.rows.length, 0);
  const conflicting = preview([
    ["2026-09-01", "Shop", "-20", "EUR", "payment", "completed", "same", ""],
    ["2026-09-01", "Shop", "-21", "EUR", "payment", "completed", "same", ""],
  ]);
  assert.equal(conflicting.rows.length, 0);
  assert.deepEqual(conflicting.excluded.map((item) => item.reason), ["conflicting_duplicate", "conflicting_duplicate"]);
});

test("repeat imports, edited rows, existing notification equivalents and moved markers do not create duplicates", () => {
  const source = document([["Date", "Description", "Amount", "Currency"], ["2026-09-06", "Lidl", "-10", "EUR"], ["2026-09-06", "Lidl", "-10", "EUR"]]);
  const initial = previewExpenseDocument(source);
  assert.notEqual(initial.rows[0].id, initial.rows[1].id, "two legitimate equal purchases retain multiplicity");
  const first = applyStatementImport(EMPTY_WALLET_STATE, initial.rows, { kind: "new-general", title: "생활" });
  assert.equal(first.added, 2);
  const ledger = first.state.ledgers[0];
  const editedState = { ...first.state, ledgers: [{ ...ledger, expenses: ledger.expenses.map((expense, index) => index ? expense : { ...expense, description: "Edited merchant", minorUnits: 2500 }) }] } as WalletState;
  const second = applyStatementImport(editedState, initial.rows, { kind: "existing", ledgerId: ledger.id });
  assert.equal(second.added, 0); assert.equal(second.duplicates, 2);
  assert.equal(second.state.ledgers[0].expenses[0].description, "Edited merchant");
  assert.ok(previewExpenseDocument(source, {}, editedState).rows.every((item) => !item.selected && item.reviewReasons.includes("duplicate")));

  const existing = createLedger("general", "생활", "EUR");
  const existingState: WalletState = { ...EMPTY_WALLET_STATE, activeLedgerId: existing.id, ledgers: [{ ...existing, expenses: [{ id: "card-auto-existing", description: "Lidl", occurredOn: "2026-09-06", currency: "EUR", category: "food", minorUnits: 1000 }] }] };
  const equivalent = previewExpenseDocument(source, {}, existingState);
  assert.deepEqual(equivalent.rows.map((item) => item.selected), [false, true]);
  const merged = applyStatementImport(existingState, initial.rows, { kind: "existing", ledgerId: existing.id });
  assert.equal(merged.added, 1); assert.equal(merged.duplicates, 1); assert.equal(merged.state.ledgers[0].expenses.length, 2);
  const selectedOnly = applyStatementImport(existingState, equivalent.rows.filter((item) => item.selected), { kind: "existing", ledgerId: existing.id });
  assert.equal(selectedOnly.added, 1, "filtering the first duplicate out must not hide the distinct second payment");
  const movedState: WalletState = { ...EMPTY_WALLET_STATE, ledgers: [{ ...existing, movedExpenseIds: [initial.rows[0].id] }], activeLedgerId: existing.id };
  const moved = applyStatementImport(movedState, [initial.rows[0]], { kind: "existing", ledgerId: existing.id });
  assert.equal(moved.added, 0); assert.equal(moved.duplicates, 1);
});

test("own general ledger PDF attachment rows preserve exported identity and category", () => {
  const ledger = { ...createLedger("general", "생활", "EUR"), expenses: [{ id: "personal-1", description: "Museum", occurredOn: "2026-09-06", currency: "EUR", minorUnits: 1600, category: "leisure" as const }] };
  const shared = parseLedgerShareDocument(createLedgerSharePayload(ledger)); assert.ok(shared);
  const result = previewExpenseDocument(document([], { ledger: shared }));
  assert.equal(result.rows[0].id, shared.ledger.expenses[0].id);
  assert.equal(result.rows[0].category, "leisure");
  const repeated = previewExpenseDocument(document([], { ledger: shared }), {}, { ...EMPTY_WALLET_STATE, ledgers: [ledger], activeLedgerId: ledger.id });
  assert.equal(repeated.rows[0].selected, false);
});

test("mixed currencies create separate ledgers and cannot be silently converted into a single-currency ledger", () => {
  const rows = [row(), row({ id: "statement-yen", currency: "JPY", minorUnits: 500 })];
  const result = applyStatementImport(EMPTY_WALLET_STATE, rows, { kind: "new-general", title: "Card history" });
  assert.equal(result.added, 2); assert.equal(result.state.ledgers.length, 2);
  assert.deepEqual(result.state.ledgers.map((ledger) => [ledger.title, ledger.expenses[0].currency, ledger.expenses[0].minorUnits]), [["Card history · EUR", "EUR", 1001], ["Card history · JPY", "JPY", 500]]);
  const existing = createLedger("general", "생활", "EUR"); const state: WalletState = { ...EMPTY_WALLET_STATE, ledgers: [existing], activeLedgerId: existing.id };
  assert.throws(() => applyStatementImport(state, rows, { kind: "existing", ledgerId: existing.id }), /currency_mismatch/u);
  assert.equal(state.ledgers[0].expenses.length, 0, "a failed import changes no original data");
});

test("travel imports require explicit payer and participants, split cents exactly and preserve existing expenses", () => {
  const travel = { ...createLedger("travel", "Paris", "EUR"), participants: [{ id: "alice", name: "Alice" }, { id: "bob", name: "Bob" }, { id: "chris", name: "Chris" }] };
  const state: WalletState = { ...EMPTY_WALLET_STATE, ledgers: [travel], activeLedgerId: travel.id };
  assert.throws(() => applyStatementImport(state, [row()], { kind: "existing", ledgerId: travel.id }), /participants_required/u);
  const result = applyStatementImport(state, [row()], { kind: "existing", ledgerId: travel.id, paidBy: "alice", participantIds: ["chris", "bob", "alice"] });
  const updated = result.state.ledgers[0]; assert.equal(updated.kind, "travel"); if (updated.kind !== "travel") return;
  assert.deepEqual(updated.expenses[0].shares.map((share) => share.minorUnits), [334, 334, 333]);
  assert.equal(updated.expenses[0].paidBy, "alice"); assert.equal(updated.expenses[0].id, row().id);
  assert.deepEqual(settleTravelExpenses(updated)[0].transfers.map((transfer) => [transfer.from, transfer.to, transfer.minorUnits]), [["bob", "alice", 334], ["chris", "alice", 333]]);
  assert.ok(parseWalletStateStrict(result.state));
});

test("commit validation rejects invalid edits, overflow and ledger capacity atomically", () => {
  for (const invalid of [row({ occurredOn: "2026-02-30" }), row({ minorUnits: 0 }), row({ minorUnits: 1.5 }), row({ currency: "euro" }), row({ description: " " })]) assert.throws(() => applyStatementImport(EMPTY_WALLET_STATE, [invalid], { kind: "new-general", title: "생활" }), /invalid_rows/u);
  assert.throws(() => applyStatementImport(EMPTY_WALLET_STATE, [row({ minorUnits: Number.MAX_SAFE_INTEGER }), row({ id: "overflow", minorUnits: 1 })], { kind: "new-general", title: "생활" }), /total_overflow/u);
  const ledgers = Array.from({ length: 50 }, (_, index) => createLedger("general", String(index), "EUR"));
  const state: WalletState = { ...EMPTY_WALLET_STATE, ledgers, activeLedgerId: ledgers[0].id };
  assert.throws(() => applyStatementImport(state, [row()], { kind: "new-general", title: "생활" }), /ledger_limit/u);
  const full = { ...ledgers[0], expenses: Array.from({ length: 5000 }, (_, index) => ({ id: `existing-${index}`, description: "Old", occurredOn: "2025-08-01", currency: "EUR", minorUnits: 1, category: "other" as const })) };
  assert.throws(() => applyStatementImport({ ...EMPTY_WALLET_STATE, ledgers: [full], activeLedgerId: full.id }, [row()], { kind: "existing", ledgerId: full.id }), /expense_limit/u);
});

test("plain-text PDF/OCR line extraction leaves ambiguous balance columns for manual review", () => {
  const source = document([], { tables: [], text: "Account statement\n2026-09-01 Lidl -12.34 EUR\n2026-09-02 Cafe -6.50 EUR\n2026-09-03 Shop -15.00 EUR 895.00 EUR\n2026-09-04 Closing balance 895.00 EUR\n2026-09-05 Test Cafe -10 -1000 EUR\n2026-09-06 Shop -12000 -88000 KRW" });
  const result = previewExpenseDocument(source);
  assert.deepEqual(result.rows.filter((item) => item.selected).map((item) => [item.description, item.minorUnits]), [["Lidl", 1234], ["Cafe", 650]]);
  assert.equal(result.rows.find((item) => item.occurredOn === "2026-09-03")?.selected, false);
  assert.equal(result.rows.find((item) => item.occurredOn === "2026-09-05")?.selected, false);
  assert.equal(result.rows.find((item) => item.occurredOn === "2026-09-06")?.selected, false);
  assert.ok(result.excluded.some((item) => item.reason === "balance"));
  assert.equal(Object.isFrozen(result), true); assert.equal(Object.isFrozen(result.rows), true);
});

test("headerless PDF and OCR reader tables retain the first payment and offer virtual editable columns", () => {
  const result = previewExpenseDocument(document([["2026-09-01 Lidl -10 EUR"], ["2026-09-02 Cafe -5 EUR"]]));
  assert.deepEqual(result.rows.map((item) => [item.description, item.minorUnits, item.selected]), [["Lidl", 1000, true], ["Cafe", 500, true]]);
  assert.deepEqual(result.headers, ["Date", "Description", "Amount", "Currency", "Type"]);
  const separated = previewExpenseDocument(document([["2026-09-01", "Lidl", "-10", "EUR", "completed"], ["2026-09-02", "Cafe", "-5", "EUR", "completed"]]), { headerRow: -1, mapping: { date: 0, description: 1, amount: 2, currency: 3, status: 4 } });
  assert.equal(separated.rows.length, 2); assert.equal(separated.rows[0].minorUnits, 1000);
  const unknown = previewExpenseDocument(document([["Merchant first", "2026-09-01", "-10"], ["Merchant second", "2026-09-02", "-5"]]));
  assert.equal(unknown.headerRow, -1, "a low-scoring first data row is not silently treated as a header");
  assert.equal(unknown.rows.length, 2);
});

test("explicit different transaction IDs preserve equal real purchases", () => {
  const first = preview([["2026-09-01", "Cafe", "-5", "EUR", "payment", "completed", "first", ""]]);
  const initial = applyStatementImport(EMPTY_WALLET_STATE, first.rows, { kind: "new-general", title: "생활" });
  const nextDoc = document([["Date", "Description", "Amount", "Currency", "Transaction ID"], ["2026-09-01", "Cafe", "-5", "EUR", "second"]]);
  const second = previewExpenseDocument(nextDoc, {}, initial.state);
  assert.equal(second.rows[0].selected, true);
  const appended = applyStatementImport(initial.state, second.rows, { kind: "existing", ledgerId: initial.state.ledgers[0].id });
  assert.equal(appended.added, 1); assert.equal(appended.state.ledgers[0].expenses.length, 2);
});

test("unidentified cancellations reconcile a unique exact payment and quarantine ambiguous originals", () => {
  const single = preview([
    ["2026-09-01", "Cafe", "-10", "EUR", "payment", "completed", "", ""],
    ["2026-09-02", "Cafe", "10", "EUR", "payment", "reversed", "", ""],
  ]);
  assert.equal(single.rows.length, 0);
  const multiple = preview([
    ["2026-09-01", "Cafe", "-10", "EUR", "payment", "completed", "", ""],
    ["2026-09-01", "Cafe", "-10", "EUR", "payment", "completed", "", ""],
    ["2026-09-02", "Cafe", "10", "EUR", "payment", "reversed", "", ""],
  ]);
  assert.equal(multiple.rows.length, 2); assert.ok(multiple.rows.every((item) => !item.selected && item.reviewReasons.includes("cancelled")));
});

test("OFX CREDIT is income while Total and New Balance are legitimate merchant names", () => {
  const result = preview([
    ["2026-09-01", "Alice", "100", "EUR", "CREDIT", "completed", "credit", ""],
    ["2026-09-01", "Total", "-30", "EUR", "DEBIT", "completed", "petrol", ""],
    ["2026-09-01", "New Balance", "-80", "EUR", "DEBIT", "completed", "shoes", ""],
    ["2026-09-01", "Closing balance", "1200", "EUR", "", "", "", ""],
  ]);
  assert.deepEqual(result.rows.map((item) => [item.description, item.minorUnits, item.selected]), [["Total", 3000, true], ["New Balance", 8000, true]]);
  assert.deepEqual(result.excluded.map((item) => item.reason), ["income", "balance"]);
});
