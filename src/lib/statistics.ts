import type { GeneralCategory, GeneralExpense } from "./types";

export function monthKey(date: Date): string { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`; }
export function addMonths(key: string, amount: number): string { const [year, month] = key.split("-").map(Number); return monthKey(new Date(year, month - 1 + amount, 1)); }
export function monthTotal(expenses: readonly GeneralExpense[], key: string, category: GeneralCategory | "all" = "all"): number {
  return expenses.filter((expense) => expense.occurredOn.startsWith(key) && (category === "all" || expense.category === category)).reduce((sum, expense) => sum + expense.minorUnits, 0);
}
export function previousMonthComparison(expenses: readonly GeneralExpense[], key: string, category: GeneralCategory | "all" = "all") {
  const current = monthTotal(expenses, key, category); const previous = monthTotal(expenses, addMonths(key, -1), category); const difference = current - previous;
  const percent = previous === 0 ? (current === 0 ? 0 : null) : Math.round((difference / previous) * 1000) / 10;
  return Object.freeze({ current, previous, difference, percent });
}
export function monthlyTotals(expenses: readonly GeneralExpense[], year: number, category: GeneralCategory | "all" = "all"): readonly number[] {
  return Object.freeze(Array.from({ length: 12 }, (_, index) => monthTotal(expenses, `${year}-${String(index + 1).padStart(2, "0")}`, category)));
}
export function yearlyTotals(expenses: readonly GeneralExpense[], category: GeneralCategory | "all" = "all"): readonly { year: number; total: number }[] {
  const totals = new Map<number, number>(); for (const expense of expenses) { if (category !== "all" && expense.category !== category) continue; const year = Number(expense.occurredOn.slice(0, 4)); totals.set(year, (totals.get(year) ?? 0) + expense.minorUnits); }
  return Object.freeze([...totals].sort(([left], [right]) => left - right).map(([year, total]) => Object.freeze({ year, total })));
}
export function categoryTotals(expenses: readonly GeneralExpense[], key: string): ReadonlyMap<GeneralCategory, number> {
  const totals = new Map<GeneralCategory, number>(); for (const expense of expenses) { if (expense.occurredOn.startsWith(key)) totals.set(expense.category, (totals.get(expense.category) ?? 0) + expense.minorUnits); } return totals;
}
