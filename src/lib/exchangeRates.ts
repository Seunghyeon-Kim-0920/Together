import type { GeneralExpense } from "./types";

/** Shared display fields only. Merchant, account and participant data never
 * enter the exchange-rate request. */
export type FxExpense = Pick<GeneralExpense, "id" | "currency" | "occurredOn" | "minorUnits">;
export interface FxExpenseList { readonly expenses: readonly FxExpense[]; }

/** Reference exchange rates for the optional "settle in one currency" view.
 *
 * Nothing here is uploaded to the shared-trip server. Every device asks the
 * same public service for published daily rates. Provisional, fallback or
 * manually entered rates can differ between devices; these are reference values.
 * Requests contain only currency codes and dates. */
export type RateSource = "frankfurter" | "currency-api";

export interface RatePoint {
  /** The publication date that was used; the latest one on or before the expense date. */
  readonly rateDate: string;
  readonly rate: number;
  readonly source: RateSource;
  /** False while a later publication or the primary source could still replace it. */
  readonly final: boolean;
  readonly fetchedAt: number;
}
export interface MissingRate { readonly currency: string; readonly date: string }
export interface KeyValueStore { getItem(key: string): string | null; setItem(key: string, value: string): void }
export interface RateDependencies {
  /** Resolves parsed JSON for a successful response and rejects otherwise. */
  readonly fetchJson: (url: string) => Promise<unknown>;
  readonly storage: KeyValueStore | null;
  readonly now: () => number;
  readonly online: boolean;
}
export interface RateLoadResult {
  readonly rates: ReadonlyMap<string, RatePoint>;
  readonly missing: readonly MissingRate[];
  /** True when at least one requested rate could not be refreshed online. */
  readonly failed: boolean;
}

export const RATE_CACHE_KEY = "wallet-diary-fx-rates-v1";
const MAX_CACHED_POINTS = 4_000;
const MAX_FALLBACK_REQUESTS = 30;
const MAX_RATE_AGE_DAYS = 10;
const SETTLED_AFTER_DAYS = 2;
const DAY_MS = 86_400_000;
const PRIMARY_RETRY_MS = 6 * 3_600_000;
const FALLBACK_RETRY_MS = 24 * 3_600_000;
const CURRENCY_API_FIRST_DAY = Date.UTC(2024, 2, 2) / DAY_MS;
const CURRENCY = /^[A-Z]{3}$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function rateKey(currency: string, date: string): string { return `${currency}@${date}`; }

function dayNumber(date: unknown): number | null {
  if (typeof date !== "string") return null;
  const match = ISO_DATE.exec(date);
  if (!match) return null;
  const time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isFinite(time) && isoDay(time / DAY_MS) === date ? time / DAY_MS : null;
}
function isoDay(day: number): string { return new Date(day * DAY_MS).toISOString().slice(0, 10); }
function validRate(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value > 0 && value < 1e12; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }

/** Expense dates per foreign currency. Currencies with a manual rate are skipped. */
export function requiredRates(ledger: FxExpenseList, target: string, skip: ReadonlySet<string> = new Set()): ReadonlyMap<string, readonly string[]> {
  const dates = new Map<string, Set<string>>();
  for (const expense of ledger.expenses) {
    if (expense.currency === target || skip.has(expense.currency) || dayNumber(expense.occurredOn) === null) continue;
    let known = dates.get(expense.currency);
    if (!known) { known = new Set(); dates.set(expense.currency, known); }
    known.add(expense.occurredOn);
  }
  return new Map([...dates].sort(([a], [b]) => (a < b ? -1 : 1)).map(([currency, values]) => [currency, [...values].sort()]));
}

/** A stable string for effect dependencies and for comparing loaded results. */
export function serializeRateRequest(target: string, needs: ReadonlyMap<string, readonly string[]>): string {
  return JSON.stringify([target, [...needs]]);
}
export function parseRateRequest(serialized: string): { readonly target: string; readonly needs: ReadonlyMap<string, readonly string[]> } | null {
  try {
    const value: unknown = JSON.parse(serialized);
    if (!Array.isArray(value) || typeof value[0] !== "string" || !CURRENCY.test(value[0]) || !Array.isArray(value[1])) return null;
    const needs = new Map<string, readonly string[]>();
    for (const entry of value[1] as unknown[]) {
      if (!Array.isArray(entry) || typeof entry[0] !== "string" || !CURRENCY.test(entry[0]) || !Array.isArray(entry[1])) return null;
      const dates = (entry[1] as unknown[]).filter((date): date is string => dayNumber(date) !== null);
      if (dates.length) needs.set(entry[0], dates);
    }
    return { target: value[0], needs };
  } catch { return null; }
}

type StoredPoint = readonly [rateDate: string, rate: number, source: 0 | 1, fetchedAt: number, final: 0 | 1];
type Cache = Map<string, Map<string, RatePoint>>;

function readCache(storage: KeyValueStore | null, now: number): Cache {
  const cache: Cache = new Map();
  if (!storage) return cache;
  try {
    const parsed: unknown = JSON.parse(storage.getItem(RATE_CACHE_KEY) ?? "null");
    if (!record(parsed) || parsed.v !== 1 || !record(parsed.pairs)) return cache;
    for (const [pair, dates] of Object.entries(parsed.pairs)) {
      if (!/^[A-Z]{3}>[A-Z]{3}$/.test(pair) || !record(dates)) continue;
      const points = new Map<string, RatePoint>();
      for (const [date, stored] of Object.entries(dates)) {
        const expenseDay = dayNumber(date);
        if (expenseDay === null || !Array.isArray(stored) || stored.length !== 5) continue;
        const [rateDate, rate, source, fetchedAt, final] = stored as unknown[];
        const publishedDay = dayNumber(rateDate);
        if (publishedDay === null || !validRate(rate) || (source !== 0 && source !== 1) || typeof fetchedAt !== "number" || !Number.isFinite(fetchedAt) || fetchedAt < 0 || fetchedAt > now || (final !== 0 && final !== 1)) continue;
        const fetchedDay = Math.floor(fetchedAt / DAY_MS);
        const lookupDay = Math.min(expenseDay, fetchedDay);
        // A stored value must satisfy the same publication window as a live
        // response. Future dates/timestamps cannot make an entry permanent.
        if (publishedDay > lookupDay || lookupDay - publishedDay > MAX_RATE_AGE_DAYS) continue;
        const settled = final === 1 && source === 0 && fetchedDay - expenseDay >= SETTLED_AFTER_DAYS;
        points.set(date, { rateDate: rateDate as string, rate, source: source === 0 ? "frankfurter" : "currency-api", fetchedAt, final: settled });
      }
      if (points.size) cache.set(pair, points);
    }
  } catch { /* An unreadable cache is rebuilt from the network. */ }
  return cache;
}

function writeCache(storage: KeyValueStore | null, cache: Cache): void {
  if (!storage) return;
  const all: { pair: string; date: string; point: RatePoint }[] = [];
  for (const [pair, points] of cache) for (const [date, point] of points) all.push({ pair, date, point });
  all.sort((a, b) => b.point.fetchedAt - a.point.fetchedAt);
  const pairs: Record<string, Record<string, StoredPoint>> = {};
  for (const { pair, date, point } of all.slice(0, MAX_CACHED_POINTS)) {
    (pairs[pair] ??= {})[date] = [point.rateDate, point.rate, point.source === "frankfurter" ? 0 : 1, point.fetchedAt, point.final ? 1 : 0];
  }
  try { storage.setItem(RATE_CACHE_KEY, JSON.stringify({ v: 1, pairs })); } catch { /* A full or blocked store only costs a later re-download. */ }
}

function fresh(point: RatePoint, now: number): boolean {
  if (point.final) return true;
  const age = now - point.fetchedAt;
  return age >= 0 && age < (point.source === "frankfurter" ? PRIMARY_RETRY_MS : FALLBACK_RETRY_MS);
}

/** When the currently displayed rates next need checking. Never spin on a
 * failed refresh that returned expired cached values. Missing rates can also
 * be retried explicitly or when a device reconnects. */
export function nextRateRefreshAt(result: RateLoadResult, checkedAt: number): number | null {
  let due = result.failed || result.missing.length ? checkedAt + PRIMARY_RETRY_MS : Infinity;
  for (const point of result.rates.values()) {
    if (point.final) continue;
    const expiry = point.fetchedAt + (point.source === "frankfurter" ? PRIMARY_RETRY_MS : FALLBACK_RETRY_MS);
    due = Math.min(due, expiry > checkedAt ? expiry : checkedAt + PRIMARY_RETRY_MS);
  }
  return Number.isFinite(due) ? due : null;
}

/** Frankfurter v2 returns a flat array with one row per date and quote. */
export function parseFrankfurterRows(value: unknown, base: string, quote: string): readonly { readonly day: number; readonly rate: number }[] {
  if (!Array.isArray(value)) return [];
  const rows = new Map<number, number>();
  for (const row of value as unknown[]) {
    if (!record(row) || typeof row.base !== "string" || typeof row.quote !== "string") continue;
    if (row.base.toUpperCase() !== base || row.quote.toUpperCase() !== quote || !validRate(row.rate)) continue;
    const day = dayNumber(row.date);
    if (day !== null) rows.set(day, row.rate);
  }
  return [...rows].sort(([a], [b]) => a - b).map(([day, rate]) => ({ day, rate }));
}

/** The fallback serves one file per day: `{ "date": "…", "usd": { "krw": 1380.1 } }`. */
export function parseCurrencyApi(value: unknown, base: string, quote: string): { readonly date: string; readonly rate: number } | null {
  if (!record(value) || dayNumber(value.date) === null) return null;
  const table = value[base.toLowerCase()];
  if (!record(table)) return null;
  const rate = table[quote.toLowerCase()];
  return validRate(rate) ? { date: value.date as string, rate } : null;
}

type Published = { readonly rateDay: number; readonly rate: number };

/** `days` never lie in the future; the caller clamps future-dated expenses to today. */
async function loadFromFrankfurter(base: string, quote: string, days: readonly number[], deps: RateDependencies): Promise<Map<number, Published>> {
  const found = new Map<number, Published>();
  const byYear = new Map<string, number[]>();
  for (const day of days) { const year = isoDay(day).slice(0, 4); byYear.set(year, [...(byYear.get(year) ?? []), day]); }
  for (const group of byYear.values()) {
    const to = Math.max(...group);
    const from = Math.min(...group) - MAX_RATE_AGE_DAYS;
    const url = `https://api.frankfurter.dev/v2/rates?base=${base}&quotes=${quote}&from=${isoDay(from)}&to=${isoDay(to)}`;
    let rows: readonly { readonly day: number; readonly rate: number }[];
    try { rows = parseFrankfurterRows(await deps.fetchJson(url), base, quote); } catch { continue; }
    for (const day of group) {
      let chosen: { readonly day: number; readonly rate: number } | null = null;
      for (const row of rows) { if (row.day > day) break; chosen = row; }
      if (!chosen || day - chosen.day > MAX_RATE_AGE_DAYS) continue;
      found.set(day, { rateDay: chosen.day, rate: chosen.rate });
    }
  }
  return found;
}

async function loadFromCurrencyApi(base: string, quote: string, day: number, today: number, deps: RateDependencies): Promise<Published | null> {
  if (day < CURRENCY_API_FIRST_DAY) return null;
  const versions = [isoDay(day)];
  if (today - day < SETTLED_AFTER_DAYS) versions.push("latest");
  const file = `v1/currencies/${base.toLowerCase()}.min.json`;
  for (const version of versions) {
    for (const url of [`https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${version}/${file}`, `https://${version}.currency-api.pages.dev/${file}`]) {
      try {
        const parsed = parseCurrencyApi(await deps.fetchJson(url), base, quote);
        if (!parsed) continue;
        const published = dayNumber(parsed.date);
        // Never relabel a latest/future or undated response as historical data.
        if (published === null || published > day || day - published > MAX_RATE_AGE_DAYS) continue;
        return { rateDay: published, rate: parsed.rate };
      } catch { /* Try the mirror, then the next version. */ }
    }
  }
  return null;
}

/** Never rejects: missing rates are reported so the screen can offer a manual
 * rate or a retry. Settled days are cached permanently; recent days are retried. */
export async function loadRates(target: string, needs: ReadonlyMap<string, readonly string[]>, deps: RateDependencies): Promise<RateLoadResult> {
  const rates = new Map<string, RatePoint>(); const missing: MissingRate[] = [];
  if (!CURRENCY.test(target)) return { rates, missing, failed: false };
  const now = deps.now(); const today = Math.floor(now / DAY_MS);
  const cache = readCache(deps.storage, now);
  let failed = false; let changed = false; let fallbackBudget = MAX_FALLBACK_REQUESTS;
  await Promise.all([...needs].map(async ([currency, dates]) => {
    if (!CURRENCY.test(currency) || currency === target) return;
    const pair = `${currency}>${target}`;
    let known = cache.get(pair);
    // A future-dated expense uses the latest published rate until its own day is settled.
    const wanted = [...new Set(dates)].flatMap((date) => { const day = dayNumber(date); return day === null ? [] : [{ date, day, lookup: Math.min(day, today) }]; });
    const stale = wanted.filter(({ date }) => { const point = known?.get(date); return !point || !fresh(point, now); });
    if (stale.length && deps.online) {
      const primary = await loadFromFrankfurter(currency, target, [...new Set(stale.map(({ lookup }) => lookup))], deps);
      for (const { date, day, lookup } of stale) {
        let published = primary.get(lookup) ?? null; let source: RateSource = "frankfurter";
        if (!published && fallbackBudget > 0) { fallbackBudget -= 1; source = "currency-api"; published = await loadFromCurrencyApi(currency, target, lookup, today, deps); }
        if (!published) { failed = true; continue; }
        if (!known) { known = new Map(); cache.set(pair, known); }
        // Only the primary source becomes permanent. Fallbacks stay provisional.
        known.set(date, { rateDate: isoDay(published.rateDay), rate: published.rate, source, final: source === "frankfurter" && today - day >= SETTLED_AFTER_DAYS, fetchedAt: deps.now() });
        changed = true;
      }
    }
    for (const { date } of wanted) {
      // An expired provisional value is still better than nothing while offline.
      const point = known?.get(date);
      if (point) rates.set(rateKey(currency, date), point); else missing.push({ currency, date });
    }
  }));
  if (changed) writeCache(deps.storage, cache);
  missing.sort((a, b) => (a.currency === b.currency ? (a.date < b.date ? -1 : 1) : a.currency < b.currency ? -1 : 1));
  return { rates, missing, failed };
}

async function fetchJsonWithTimeout(url: string, timeoutMs = 8_000): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, credentials: "omit", referrerPolicy: "no-referrer", headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`rate request failed: ${response.status}`);
    return await response.json() as unknown;
  } finally { clearTimeout(timer); }
}

export function browserStorage(): KeyValueStore | null {
  try { return typeof window !== "undefined" && window.localStorage ? window.localStorage : null; } catch { return null; }
}

export function browserRateDependencies(): RateDependencies {
  return { fetchJson: fetchJsonWithTimeout, storage: browserStorage(), now: () => Date.now(), online: typeof navigator === "undefined" || navigator.onLine !== false };
}
