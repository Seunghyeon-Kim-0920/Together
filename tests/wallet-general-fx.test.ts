import assert from "node:assert/strict";
import test from "node:test";
import { visibleGeneralFxRows, sumGeneralFxAmounts } from "../src/lib/generalFx";
import { convertExpenseAmounts } from "../src/lib/fxSummary";
import { requiredRates } from "../src/lib/exchangeRates";
import type { GeneralExpense } from "../src/lib/types";

const expense = (id: string, category: GeneralExpense["category"], occurredOn: string, minorUnits: number): GeneralExpense =>
  Object.freeze({ id, category, occurredOn, minorUnits, currency: "EUR", description: "Synthetic entry", automationFingerprint: "synthetic-local-only" });
const expenses = Object.freeze([
  expense("old", "food", "2025-11-05", 300), expense("oct", "food", "2026-10-28", 500),
  expense("n1", "food", "2026-11-01", 100), expense("n2", "transport", "2026-11-09", 200),
]);

test("general FX limits rate demand to the selected month or statistics year and category", () => {
  const rows = visibleGeneralFxRows(expenses, "2026-11", false, "all");
  assert.deepEqual(rows.map(row => row.id), ["n1", "n2"]);
  assert.deepEqual(Object.keys(rows[0]).sort(), ["currency", "id", "minorUnits", "occurredOn"]);
  assert.deepEqual([...requiredRates({ expenses: rows }, "KRW")], [["EUR", ["2026-11-01", "2026-11-09"]]]);
  assert.deepEqual([...requiredRates({ expenses: rows }, "EUR")], []);
  assert.deepEqual(visibleGeneralFxRows(expenses, "2026-11", true, "food").map(row => row.id), ["oct", "n1"]);
  assert.deepEqual(visibleGeneralFxRows(expenses, "2026-11", false, "housing"), []);
});

test("general totals add the displayed transaction-date conversions without changing original cents", () => {
  const monthly = visibleGeneralFxRows(expenses, "2026-11", false, "all");
  const yearly = visibleGeneralFxRows(expenses, "2026-11", true, "all");
  const quotes = new Map([["2026-10-28", 1300.2], ["2026-11-01", 1400.5], ["2026-11-09", 1420.25]]);
  const converted = convertExpenseAmounts(yearly, "KRW", (_currency, date) => quotes.get(date) ?? null);
  assert.deepEqual([...converted.values()], [6501, 1401, 2841]);
  assert.equal(sumGeneralFxAmounts(monthly, converted), 4242);
  assert.equal(sumGeneralFxAmounts(yearly, converted), 10743);
  assert.deepEqual(expenses.map(row => row.minorUnits), [300, 500, 100, 200]);
});

test("unavailable or overflowing historical totals never appear as complete totals", () => {
  const month = visibleGeneralFxRows(expenses, "2026-11", false, "all");
  const year = visibleGeneralFxRows(expenses, "2026-11", true, "all");
  const availableMonth = convertExpenseAmounts(year, "USD", (_currency, date) => date.startsWith("2026-11") ? 1.2 : null);
  assert.equal(sumGeneralFxAmounts(month, availableMonth), 360);
  assert.equal(sumGeneralFxAmounts(year, availableMonth), null);
  assert.equal(sumGeneralFxAmounts(month, new Map([["n1", 123]])), null);
  assert.equal(sumGeneralFxAmounts(month, new Map([["n1", 1], ["n2", Number.MAX_SAFE_INTEGER]])), null);
  assert.equal(sumGeneralFxAmounts([], new Map()), 0);
});
