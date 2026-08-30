import { monthKey, monthTotal } from "./statistics";
import type { AutomationSource, GeneralCategory, GeneralExpense, GeneralLedger, Locale, WalletState } from "./types";
import { MAX_EXPENSES_PER_LEDGER } from "./wallet";

const MAX_NATIVE_EVENTS = 5_000;
const DATE_PREFIX = /^\d{4}-\d{2}-\d{2}/;
const PACKAGE_NAME = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/;

export type CardCandidateConfidence = "high" | "review";

export interface NativeCardCandidate {
  readonly id: string;
  readonly packageName: string;
  readonly sourceName: string;
  readonly merchant: string;
  readonly minorUnits: number;
  readonly currency: string;
  readonly occurredAt: string;
  readonly occurredOn: string;
  readonly confidence: CardCandidateConfidence;
}

export interface ParsedCandidateBatch {
  readonly candidates: readonly NativeCardCandidate[];
  readonly rejectedIds: readonly string[];
}

export interface AutomationBatchResult {
  readonly state: WalletState;
  readonly acknowledgedIds: readonly string[];
  readonly insertedIds: readonly string[];
  readonly pending: readonly NativeCardCandidate[];
}

export interface MonthlyLimitStatus {
  readonly state: "unset" | "under" | "near" | "reached" | "over";
  readonly spentMinor: number;
  readonly limitMinor: number | null;
  readonly remainingMinor: number | null;
  readonly percent: number | null;
}

export interface NativeAutomationConfiguration {
  readonly ledgers: readonly { readonly ledgerId: string; readonly title: string; readonly currency: string; readonly monthlyLimitMinor: number | null; readonly spentMinor: number; readonly locale: Locale }[];
  readonly sources: readonly { readonly packageName: string; readonly ledgerId: string }[];
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function boundedText(value: unknown, maximum: number): string | null { const normalized = typeof value === "string" ? value.trim() : ""; return normalized && normalized.length <= maximum ? normalized : null; }
function validTimestamp(value: unknown): string | null {
  const timestamp = boundedText(value, 80); const datePart = timestamp?.match(DATE_PREFIX)?.[0];
  if (!timestamp || !datePart || !/^\d{4}-\d{2}-\d{2}T/.test(timestamp) || Number.isNaN(Date.parse(timestamp))) return null;
  return new Date(`${datePart}T00:00:00Z`).toISOString().slice(0, 10) === datePart ? timestamp : null;
}
function validCalendarDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value ? value : null;
}
function localCalendarDate(timestamp: string): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function parseNativeCardCandidate(value: unknown): NativeCardCandidate | null {
  if (!isRecord(value)) return null;
  const id = boundedText(value.id, 200); const packageName = boundedText(value.packageName, 200); const sourceName = boundedText(value.sourceName, 80); const merchant = boundedText(value.merchant, 500); const occurredAt = validTimestamp(value.occurredAt); const currency = typeof value.currency === "string" ? value.currency.trim().toUpperCase() : "";
  if (!id || !packageName || !PACKAGE_NAME.test(packageName) || !sourceName || !merchant || !occurredAt || !Number.isSafeInteger(value.minorUnits) || (value.minorUnits as number) <= 0 || !/^[A-Z]{3}$/.test(currency) || (value.confidence !== "high" && value.confidence !== "review")) return null;
  const occurredOn = value.occurredOn === undefined ? localCalendarDate(occurredAt) : validCalendarDate(value.occurredOn);
  if (!occurredOn) return null;
  return Object.freeze({ id, packageName, sourceName, merchant, minorUnits: value.minorUnits as number, currency, occurredAt, occurredOn, confidence: value.confidence });
}

export function parseNativeCandidateBatch(value: unknown): ParsedCandidateBatch {
  const rawEvents = isRecord(value) && Array.isArray(value.events) ? value.events.slice(0, MAX_NATIVE_EVENTS) : [];
  const candidates: NativeCardCandidate[] = []; const rejectedIds = new Set<string>(); const stableKeys = new Set<string>();
  for (const raw of rawEvents) {
    const candidate = parseNativeCardCandidate(raw);
    if (!candidate) { if (isRecord(raw)) { const id = boundedText(raw.id, 200); if (id) rejectedIds.add(id); } continue; }
    const stableKey = `${candidate.packageName}\u0000${candidate.id}`;
    if (stableKeys.has(stableKey)) continue;
    stableKeys.add(stableKey); candidates.push(candidate);
  }
  return Object.freeze({ candidates: Object.freeze(candidates), rejectedIds: Object.freeze([...rejectedIds]) });
}

export function automationExpenseId(candidate: Pick<NativeCardCandidate, "id" | "packageName">): string {
  return `card-auto-${shortFingerprint(`${candidate.packageName}\u0000${candidate.id}`)}`;
}

function shortFingerprint(value: string): string {
  let left = 0x811c9dc5; let right = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) { const code = value.charCodeAt(index); left = Math.imul(left ^ code, 0x01000193); right = Math.imul(right ^ code, 0x85ebca6b); right ^= right >>> 13; }
  return `${(left >>> 0).toString(16).padStart(8, "0")}${(right >>> 0).toString(16).padStart(8, "0")}`;
}

const CATEGORY_RULES: readonly [GeneralCategory, RegExp][] = [
  ["transport", /\b(?:uber|bolt|taxi|sncf|ratp|train|metro|bus|tram|parking|fuel|essence|shell|totalenergies)\b/iu],
  ["food", /\b(?:lidl|carrefour|auchan|monoprix|restaurant|cafe|café|coffee|starbucks|kfc|burger|mcdonald|market|supermarch|grocery|boulanger)\b/iu],
  ["housing", /\b(?:rent|loyer|residence|résidence|landlord)\b/iu],
  ["utilities", /\b(?:electric|électric|energy|energie|énergie|water|eau|internet|mobile|telecom|télécom)\b/iu],
  ["health", /\b(?:pharmacy|pharmacie|doctor|médecin|hospital|hôpital|dentist|dentiste)\b/iu],
  ["subscriptions", /\b(?:spotify|netflix|youtube|subscription|abonnement|icloud)\b/iu],
  ["travel", /\b(?:hotel|hôtel|airbnb|airline|booking|hostel|aéroport|airport)\b/iu],
  ["education", /\b(?:school|école|university|université|course|formation)\b/iu],
  ["leisure", /\b(?:cinema|cinéma|theatre|théâtre|museum|musée|concert|game)\b/iu],
  ["shopping", /\b(?:amazon|ikea|zara|uniqlo|decathlon|action|store|shop)\b/iu],
];

export function inferGeneralCategory(merchant: string): GeneralCategory {
  for (const [category, pattern] of CATEGORY_RULES) if (pattern.test(merchant)) return category;
  return "other";
}

function merchantFingerprint(value: string): string { return value.normalize("NFKD").toLocaleLowerCase("en").replace(/[\p{Diacritic}\p{Punctuation}\p{Separator}]+/gu, ""); }
function candidateDate(candidate: NativeCardCandidate): string { return candidate.occurredOn; }
export function automationOriginFingerprint(candidate: NativeCardCandidate): string {
  // Deliberately excludes the app package: the same physical card payment can
  // be announced by both a wallet and a card-provider app.
  return `card-origin-${shortFingerprint([candidate.currency, candidate.minorUnits, candidate.occurredOn, merchantFingerprint(candidate.merchant)].join("\u0000"))}`;
}
function likelyExistingExpense(expenses: readonly GeneralExpense[], candidate: NativeCardCandidate): boolean {
  const merchant = merchantFingerprint(candidate.merchant); const occurredOn = candidateDate(candidate);
  const origin = automationOriginFingerprint(candidate);
  return expenses.some((expense) => expense.automationFingerprint === origin || (expense.currency === candidate.currency && expense.minorUnits === candidate.minorUnits && expense.occurredOn === occurredOn && merchantFingerprint(expense.description) === merchant));
}

function candidateExpense(candidate: NativeCardCandidate): GeneralExpense {
  return Object.freeze({ id: automationExpenseId(candidate), description: candidate.merchant, category: inferGeneralCategory(candidate.merchant), currency: candidate.currency, minorUnits: candidate.minorUnits, occurredOn: candidateDate(candidate), automationFingerprint: automationOriginFingerprint(candidate) });
}

export function applyHighConfidenceCardAutomation(state: WalletState, candidates: readonly NativeCardCandidate[]): AutomationBatchResult {
  const ledgers = [...state.ledgers]; const acknowledgedIds = new Set<string>(); const insertedIds: string[] = []; const pending: NativeCardCandidate[] = [];
  const globallyRecorded = new Set(state.ledgers.flatMap((ledger) => ledger.expenses.map((expense) => expense.id)));
  for (const candidate of candidates) {
    const expenseId = automationExpenseId(candidate);
    if (globallyRecorded.has(expenseId)) { acknowledgedIds.add(candidate.id); continue; }
    const ownerIndexes = ledgers.flatMap((ledger, index) => ledger.kind === "general" && ledger.currency === candidate.currency && ledger.automationSources.some((source) => source.packageName === candidate.packageName) ? [index] : []);
    if (candidate.confidence !== "high" || ownerIndexes.length !== 1) { pending.push(candidate); continue; }
    const index = ownerIndexes[0]; const ledger = ledgers[index];
    if (ledger.kind !== "general" || ledger.expenses.length >= MAX_EXPENSES_PER_LEDGER) { pending.push(candidate); continue; }
    // A same-day purchase for the same amount at the same merchant can be a
    // legitimate second purchase. Keep fuzzy matches for explicit review and
    // only acknowledge deterministic native IDs automatically.
    if (likelyExistingExpense(ledger.expenses, candidate)) { pending.push(Object.freeze({ ...candidate, confidence: "review" })); continue; }
    const expense = candidateExpense(candidate); globallyRecorded.add(expense.id); insertedIds.push(candidate.id); acknowledgedIds.add(candidate.id);
    ledgers[index] = Object.freeze({ ...ledger, expenses: Object.freeze([...ledger.expenses, expense]), updatedAt: new Date().toISOString() });
  }
  const nextState = insertedIds.length ? Object.freeze({ ...state, ledgers: Object.freeze(ledgers) }) : state;
  return Object.freeze({ state: nextState, acknowledgedIds: Object.freeze([...acknowledgedIds]), insertedIds: Object.freeze(insertedIds), pending: Object.freeze(pending) });
}

export function confirmCardCandidate(state: WalletState, ledgerId: string, candidate: NativeCardCandidate): { readonly state: WalletState; readonly inserted: boolean } {
  const index = state.ledgers.findIndex((ledger) => ledger.id === ledgerId); const ledger = state.ledgers[index];
  if (!ledger || ledger.kind !== "general" || ledger.currency !== candidate.currency || ledger.expenses.length >= MAX_EXPENSES_PER_LEDGER) throw new Error("incompatible candidate");
  const expenseId = automationExpenseId(candidate);
  if (state.ledgers.some((item) => item.expenses.some((expense) => expense.id === expenseId))) return Object.freeze({ state, inserted: false });
  const updated = Object.freeze({ ...ledger, expenses: Object.freeze([...ledger.expenses, candidateExpense(candidate)]), updatedAt: new Date().toISOString() }); const ledgers = [...state.ledgers]; ledgers[index] = updated;
  return Object.freeze({ state: Object.freeze({ ...state, ledgers: Object.freeze(ledgers) }), inserted: true });
}

export function calculateMonthlyLimitStatus(ledger: GeneralLedger, selectedMonth: string): MonthlyLimitStatus {
  const spentMinor = monthTotal(ledger.expenses, selectedMonth); const limitMinor = ledger.monthlyLimitMinor;
  if (limitMinor === null) return Object.freeze({ state: "unset", spentMinor, limitMinor, remainingMinor: null, percent: null });
  const remainingMinor = limitMinor - spentMinor; const percentTenths = Number((BigInt(spentMinor) * 1000n + BigInt(limitMinor) / 2n) / BigInt(limitMinor)); const percent = percentTenths / 10;
  const status = spentMinor > limitMinor ? "over" : spentMinor === limitMinor ? "reached" : percent >= 80 ? "near" : "under";
  return Object.freeze({ state: status, spentMinor, limitMinor, remainingMinor, percent });
}

export function buildNativeAutomationConfiguration(state: WalletState, locale: Locale, now = new Date()): NativeAutomationConfiguration {
  const currentMonth = monthKey(now); const generalLedgers = state.ledgers.filter((ledger): ledger is GeneralLedger => ledger.kind === "general");
  const ownerCount = new Map<string, number>();
  for (const ledger of generalLedgers) for (const source of ledger.automationSources) ownerCount.set(source.packageName, (ownerCount.get(source.packageName) ?? 0) + 1);
  return Object.freeze({
    ledgers: Object.freeze(generalLedgers.map((ledger) => Object.freeze({ ledgerId: ledger.id, title: ledger.title, currency: ledger.currency, monthlyLimitMinor: ledger.monthlyLimitMinor, spentMinor: monthTotal(ledger.expenses, currentMonth), locale }))),
    // Ambiguous package assignments are never sent to native code: assigning
    // a purchase to the first ledger would silently corrupt another ledger.
    sources: Object.freeze(generalLedgers.flatMap((ledger) => ledger.automationSources.filter((source) => ownerCount.get(source.packageName) === 1).map((source: AutomationSource) => Object.freeze({ packageName: source.packageName, ledgerId: ledger.id })))),
  });
}
