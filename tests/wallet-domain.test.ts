import assert from "node:assert/strict";
import test from "node:test";
import { parseMinorUnits } from "../src/lib/currency";
import { categoryTotals, monthlyTotals, previousMonthComparison, yearlyTotals } from "../src/lib/statistics";
import type { GeneralExpense, TravelLedger } from "../src/lib/types";
import { createLedger, createTravelExpense, newestExpensesFirst, parseLedger, replaceExpenseById, settleTravelExpenses, splitEvenly } from "../src/lib/wallet";

test("amounts are stored as exact currency minor units", () => {
  assert.equal(parseMinorUnits("12.34", "EUR"), 1234);
  assert.equal(parseMinorUnits("12,34", "EUR"), 1234);
  assert.equal(parseMinorUnits("1200", "KRW"), 1200);
  assert.equal(parseMinorUnits("1.1", "KWD"), 1100);
  assert.equal(parseMinorUnits("0", "EUR"), null);
  assert.equal(parseMinorUnits("1.001", "EUR"), null);
});

test("equal split preserves the exact total and is deterministic", () => {
  assert.deepEqual(splitEvenly(100, ["c", "a", "b"]), [
    { participantId: "a", minorUnits: 34 },
    { participantId: "b", minorUnits: 33 },
    { participantId: "c", minorUnits: 33 },
  ]);
  assert.throws(() => splitEvenly(100, ["a", "a"]));
});

test("travel settlement is calculated independently for each currency", () => {
  const base = createLedger("travel", "Lisbon", "EUR");
  const participants = Object.freeze([{ id: "a", name: "A" }, { id: "b", name: "B" }]);
  const eur = createTravelExpense({ description: "Dinner", category: "food", currency: "EUR", minorUnits: 3000, paidBy: "a", participantIds: ["a", "b"], occurredOn: "2026-08-01" });
  const usd = createTravelExpense({ description: "Taxi", category: "transport", currency: "USD", minorUnits: 1000, paidBy: "b", participantIds: ["a", "b"], occurredOn: "2026-08-02" });
  const ledger: TravelLedger = Object.freeze({ ...base, participants, selfParticipantId: "a", currencies: Object.freeze(["EUR", "USD"]), expenses: Object.freeze([eur, usd]) });
  const [euro, dollar] = settleTravelExpenses(ledger);
  assert.deepEqual(euro.transfers, [{ from: "b", to: "a", currency: "EUR", minorUnits: 1500 }]);
  assert.deepEqual(dollar.transfers, [{ from: "a", to: "b", currency: "USD", minorUnits: 500 }]);
});

test("general ledger statistics compare months, years, and categories", () => {
  const expenses: GeneralExpense[] = [
    { id: "1", description: "Food", category: "food", currency: "EUR", minorUnits: 1000, occurredOn: "2025-12-01" },
    { id: "2", description: "Train", category: "transport", currency: "EUR", minorUnits: 1500, occurredOn: "2026-01-02" },
    { id: "3", description: "Lunch", category: "food", currency: "EUR", minorUnits: 500, occurredOn: "2026-01-03" },
  ];
  assert.deepEqual(previousMonthComparison(expenses, "2026-01"), { current: 2000, previous: 1000, difference: 1000, percent: 100 });
  assert.equal(monthlyTotals(expenses, 2026)[0], 2000);
  assert.deepEqual(yearlyTotals(expenses), [{ year: 2025, total: 1000 }, { year: 2026, total: 2000 }]);
  assert.deepEqual([...categoryTotals(expenses, "2026-01")], [["transport", 1500], ["food", 500]]);
});

test("invalid ledgers and forged split totals are rejected", () => {
  const ledger = createLedger("travel", "Trip", "EUR");
  const forged = { ...ledger, participants: [{ id: "a", name: "A" }], expenses: [{ id: "e", description: "Meal", category: "food", currency: "EUR", minorUnits: 100, paidBy: "a", occurredOn: "2026-08-01", shares: [{ participantId: "a", minorUnits: 99 }] }] };
  assert.equal(parseLedger(forged), null);
});

test("editing replaces one expense in place and keeps its stable id", () => {
  const original: GeneralExpense = { id: "expense-1", description: "Lunch", category: "food", currency: "EUR", minorUnits: 1000, occurredOn: "2026-08-01" };
  const untouched: GeneralExpense = { id: "expense-2", description: "Train", category: "transport", currency: "EUR", minorUnits: 2000, occurredOn: "2026-08-02" };
  const edited: GeneralExpense = { ...original, description: "Dinner", minorUnits: 1250 };
  const result = replaceExpenseById([original, untouched], edited);
  assert.deepEqual(result, [edited, untouched]);
  assert.equal(result[0].id, original.id);
  assert.equal(replaceExpenseById(result, { ...edited, id: "missing" }), result);
  assert.deepEqual(newestExpensesFirst([original, edited, untouched]).map((expense) => expense.description), ["Train", "Dinner", "Lunch"]);
});
