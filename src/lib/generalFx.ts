import type { GeneralCategory, GeneralExpense } from "./types";

export type GeneralFxRow = Pick<GeneralExpense, "id" | "minorUnits" | "currency" | "occurredOn">;

/** Only the currently displayed month (or year in Statistics) needs rates.
 * Never include the merchant, category, alert or card metadata in an FX row. */
export function visibleGeneralFxRows(expenses: readonly GeneralExpense[], selectedMonth: string, statistics: boolean, category: GeneralCategory | "all"): GeneralFxRow[] {
  const period = statistics ? selectedMonth.slice(0, 4) + "-" : selectedMonth + "-";
  return expenses.filter(expense => expense.occurredOn.startsWith(period) && (category === "all" || expense.category === category))
    .map(({ id, minorUnits, currency, occurredOn }) => ({ id, minorUnits, currency, occurredOn }));
}

/** Sum already-rounded line amounts. Missing quotes and overflow never
 * produce a partial monthly/yearly total that could be mistaken for complete. */
export function sumGeneralFxAmounts(rows: readonly Pick<GeneralFxRow, "id">[], amounts: ReadonlyMap<string, number | null>): number | null {
  let sum = 0;
  for (const { id } of rows) {
    const value = amounts.get(id);
    if (value == null || !Number.isSafeInteger(value) || value < 0 || !Number.isSafeInteger(sum + value)) return null;
    sum += value;
  }
  return sum;
}
