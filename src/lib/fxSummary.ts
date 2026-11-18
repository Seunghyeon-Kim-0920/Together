import { convertMinorUnits, type ConvertedSettlement, type RateResolver } from "./convertedSettlement";
import { formatMoney } from "./currency";
import { rateKey, type FxExpense, type FxExpenseList, type RatePoint } from "./exchangeRates";
import { fxText } from "./fxI18n";
import type { Locale, TravelLedger } from "./types";

/** Entry amounts use exactly the same per-expense rounding as settlement.
 * Unknown/invalid rates stay unknown, never a fabricated zero. */
export function convertExpenseAmounts(expenses: readonly FxExpense[], target: string, resolve: RateResolver): ReadonlyMap<string, number | null> {
  return new Map(expenses.map((expense) => {
    if (expense.currency === target) return [expense.id, expense.minorUnits] as const;
    try {
      const rate = resolve(expense.currency, expense.occurredOn);
      return [expense.id, rate === null ? null : convertMinorUnits(expense.minorUnits, expense.currency, target, rate)] as const;
    } catch { return [expense.id, null] as const; }
  }));
}

/** What was applied to one foreign currency, for the screen and the shared text. */
export interface RateSummary {
  readonly currency: string;
  readonly manual: boolean;
  readonly minRate: number;
  readonly maxRate: number;
  /** Actual publication dates used (e.g. Friday for a weekend expense). */
  readonly firstDate: string;
  readonly lastDate: string;
  readonly provisional: boolean;
  readonly fallback: boolean;
}

export function summarizeRates(ledger: FxExpenseList, target: string, manualRates: Readonly<Record<string, number>>, rates: ReadonlyMap<string, RatePoint>): readonly RateSummary[] {
  const summaries = new Map<string, { manual: boolean; min: number; max: number; first: string; last: string; provisional: boolean; fallback: boolean }>();
  for (const expense of ledger.expenses) {
    if (expense.currency === target) continue;
    const manual = Object.hasOwn(manualRates, expense.currency) ? manualRates[expense.currency] : undefined;
    const point = manual === undefined ? rates.get(rateKey(expense.currency, expense.occurredOn)) : undefined;
    const rate = manual ?? point?.rate;
    if (rate === undefined) continue;
    const date = point?.rateDate ?? expense.occurredOn;
    const known = summaries.get(expense.currency);
    if (!known) summaries.set(expense.currency, { manual: manual !== undefined, min: rate, max: rate, first: date, last: date, provisional: Boolean(point && !point.final), fallback: point?.source === "currency-api" });
    else {
      known.min = Math.min(known.min, rate); known.max = Math.max(known.max, rate);
      if (date < known.first) known.first = date;
      if (date > known.last) known.last = date;
      known.provisional ||= Boolean(point && !point.final); known.fallback ||= point?.source === "currency-api";
    }
  }
  return [...summaries].sort(([a], [b]) => (a < b ? -1 : 1)).map(([currency, value]) => ({ currency, manual: value.manual, minRate: value.min, maxRate: value.max, firstDate: value.first, lastDate: value.last, provisional: value.provisional, fallback: value.fallback }));
}

/** A rate is not an amount of whole minor units, so it keeps a few extra decimals. */
export function formatRate(rate: number, currency: string, locale: Locale): string {
  const maximumFractionDigits = rate >= 100 ? 2 : rate >= 1 ? 4 : 6;
  try { return new Intl.NumberFormat(locale === "ko" ? "ko-KR" : locale, { style: "currency", currency, minimumFractionDigits: 0, maximumFractionDigits }).format(rate); }
  catch { return `${rate.toFixed(maximumFractionDigits)} ${currency}`; }
}

export function rateSummaryLine(summary: RateSummary, target: string, locale: Locale): string {
  const value = summary.minRate === summary.maxRate ? formatRate(summary.minRate, target, locale) : `${formatRate(summary.minRate, target, locale)} ~ ${formatRate(summary.maxRate, target, locale)}`;
  const dates = summary.firstDate === summary.lastDate ? summary.firstDate : `${summary.firstDate} ~ ${summary.lastDate}`;
  return `1 ${summary.currency} = ${value} (${summary.manual ? fxText(locale, "manual") : `${fxText(locale, "daily")}, ${dates}`})`;
}

/** Plain text for a group chat: the transfers first, then how they were calculated. */
export function convertedShareText(locale: Locale, ledger: TravelLedger, settlement: ConvertedSettlement, summaries: readonly RateSummary[], emptyLabel: string): string {
  const names = new Map(ledger.participants.map((person) => [person.id, person.name]));
  const lines = [fxText(locale, "shareHeading").replace("{title}", ledger.title).replace("{currency}", settlement.target), ""];
  if (settlement.transfers.length) for (const transfer of settlement.transfers) lines.push(`${names.get(transfer.from) ?? "-"} → ${names.get(transfer.to) ?? "-"}  ${formatMoney(transfer.minorUnits, transfer.currency, locale)}`);
  else lines.push(emptyLabel);
  lines.push("", `${fxText(locale, "total")}: ${formatMoney(settlement.totalMinor, settlement.target, locale)}`);
  if (summaries.length) {
    lines.push("", fxText(locale, "rates"));
    for (const summary of summaries) lines.push(`· ${rateSummaryLine(summary, settlement.target, locale)}`);
    lines.push(fxText(locale, "note"));
  }
  return lines.join("\n");
}
