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
export function annualAverageComparison(expenses: readonly GeneralExpense[], key: string, category: GeneralCategory | "all" = "all", asOf = new Date()) {
  const year = Number(key.slice(0, 4));
  const current = monthTotal(expenses, key, category);
  const coverageMonths = annualCoverageMonths(expenses, year, asOf);
  const annualTotal = monthlyTotals(expenses, year, category).reduce((sum, total) => sum + total, 0);
  const average = coverageMonths === 0 ? 0 : Math.round(annualTotal / coverageMonths);
  const difference = current - average;
  const percent = average === 0 ? (current === 0 ? 0 : null) : Math.round((difference / average) * 1000) / 10;
  return Object.freeze({ current, average, difference, percent, coverageMonths });
}
export function annualCoverageMonths(expenses: readonly GeneralExpense[], year: number, asOf = new Date()): number {
  const months = expenses.filter((expense) => Number(expense.occurredOn.slice(0, 4)) === year).map((expense) => Number(expense.occurredOn.slice(5, 7))).filter((month) => month >= 1 && month <= 12);
  if (months.length === 0) return 0;
  const first = Math.min(...months);
  const latestRecorded = Math.max(...months);
  const currentYear = asOf.getFullYear();
  if (year === currentYear) return Math.max(1, Math.max(latestRecorded, asOf.getMonth() + 1) - first + 1);
  if (year < currentYear && expenses.some((expense) => Number(expense.occurredOn.slice(0, 4)) > year)) return 12 - first + 1;
  return latestRecorded - first + 1;
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
