import { currencyDigits } from "./currency";
import { EMPTY_WALLET_STATE, GENERAL_CATEGORIES, SUPPORTED_LOCALES, TRAVEL_CATEGORIES, type ExpenseShare, type GeneralExpense, type GeneralLedger, type Ledger, type Locale, type Participant, type TravelExpense, type TravelLedger, type WalletState } from "./types";

export const MAX_LEDGERS = 50;
export const MAX_EXPENSES_PER_LEDGER = 5_000;
export const MAX_PARTICIPANTS = 100;

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function text(value: unknown, maximum: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= maximum ? normalized : null;
}
function currency(value: unknown): string | null { const normalized = typeof value === "string" ? value.trim().toUpperCase() : ""; return /^[A-Z]{3}$/.test(normalized) ? normalized : null; }
function date(value: unknown): string | null { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ? value : null; }
function timestamp(value: unknown): string | null { return typeof value === "string" && value.length <= 80 && !Number.isNaN(Date.parse(value)) ? value : null; }
function positiveMinor(value: unknown): number | null { return Number.isSafeInteger(value) && (value as number) > 0 ? value as number : null; }

function parseParticipants(value: unknown): readonly Participant[] | null {
  if (!Array.isArray(value) || value.length > MAX_PARTICIPANTS) return null;
  const result: Participant[] = [];
  const ids = new Set<string>();
  for (const candidate of value) {
    if (!isRecord(candidate)) return null;
    const id = text(candidate.id, 100); const name = text(candidate.name, 80);
    if (!id || !name || ids.has(id)) return null;
    ids.add(id); result.push(Object.freeze({ id, name }));
  }
  return Object.freeze(result);
}

function parseTravelExpense(value: unknown, participantIds: ReadonlySet<string>, allowedCurrencies: ReadonlySet<string>): TravelExpense | null {
  if (!isRecord(value) || !Array.isArray(value.shares)) return null;
  const id = text(value.id, 100); const description = text(value.description, 500); const expenseDate = date(value.occurredOn); const expenseCurrency = currency(value.currency); const minorUnits = positiveMinor(value.minorUnits); const paidBy = text(value.paidBy, 100);
  if (!id || !description || !expenseDate || !expenseCurrency || !minorUnits || !paidBy || !participantIds.has(paidBy) || !allowedCurrencies.has(expenseCurrency) || !TRAVEL_CATEGORIES.includes(value.category as never) || value.shares.length < 1 || value.shares.length > MAX_PARTICIPANTS) return null;
  const shares: ExpenseShare[] = []; const shareIds = new Set<string>(); let sum = 0;
  for (const candidate of value.shares) {
    if (!isRecord(candidate)) return null;
    const participantId = text(candidate.participantId, 100); const shareMinor = Number.isSafeInteger(candidate.minorUnits) && (candidate.minorUnits as number) >= 0 ? candidate.minorUnits as number : null;
    if (!participantId || shareMinor === null || !participantIds.has(participantId) || shareIds.has(participantId)) return null;
    shareIds.add(participantId); sum += shareMinor;
    if (!Number.isSafeInteger(sum)) return null;
    shares.push(Object.freeze({ participantId, minorUnits: shareMinor }));
  }
  if (sum !== minorUnits) return null;
  return Object.freeze({ id, description, category: value.category as TravelExpense["category"], currency: expenseCurrency, minorUnits, paidBy, shares: Object.freeze(shares), occurredOn: expenseDate });
}

function parseGeneralExpense(value: unknown, ledgerCurrency: string): GeneralExpense | null {
  if (!isRecord(value)) return null;
  const id = text(value.id, 100); const description = text(value.description, 500); const expenseDate = date(value.occurredOn); const expenseCurrency = currency(value.currency); const minorUnits = positiveMinor(value.minorUnits);
  if (!id || !description || !expenseDate || expenseCurrency !== ledgerCurrency || !minorUnits || !GENERAL_CATEGORIES.includes(value.category as never)) return null;
  return Object.freeze({ id, description, category: value.category as GeneralExpense["category"], currency: ledgerCurrency, minorUnits, occurredOn: expenseDate });
}

export function parseLedger(value: unknown): Ledger | null {
  if (!isRecord(value)) return null;
  const id = text(value.id, 100); const title = text(value.title, 80); const createdAt = timestamp(value.createdAt); const updatedAt = timestamp(value.updatedAt);
  if (!id || !title || !createdAt || !updatedAt || !Array.isArray(value.expenses) || value.expenses.length > MAX_EXPENSES_PER_LEDGER) return null;
  const expenseIds = new Set<string>();
  if (value.kind === "travel") {
    const participants = parseParticipants(value.participants);
    if (!participants || !Array.isArray(value.currencies) || value.currencies.length < 1 || value.currencies.length > 20) return null;
    const currencies = value.currencies.map(currency);
    if (currencies.some((item) => !item) || new Set(currencies).size !== currencies.length) return null;
    const defaultCurrency = currency(value.defaultCurrency);
    if (!defaultCurrency || !currencies.includes(defaultCurrency)) return null;
    const participantIds = new Set(participants.map((participant) => participant.id));
    const selfParticipantId = value.selfParticipantId === null ? null : text(value.selfParticipantId, 100);
    if (selfParticipantId !== null && !participantIds.has(selfParticipantId)) return null;
    const expenses: TravelExpense[] = [];
    for (const candidate of value.expenses) {
      const expense = parseTravelExpense(candidate, participantIds, new Set(currencies as string[]));
      if (!expense || expenseIds.has(expense.id)) return null;
      expenseIds.add(expense.id); expenses.push(expense);
    }
    return Object.freeze({ id, title, kind: "travel", createdAt, updatedAt, currencies: Object.freeze(currencies as string[]), defaultCurrency, participants, selfParticipantId, expenses: Object.freeze(expenses) } satisfies TravelLedger);
  }
  if (value.kind === "general") {
    const ledgerCurrency = currency(value.currency);
    if (!ledgerCurrency) return null;
    const expenses: GeneralExpense[] = [];
    for (const candidate of value.expenses) {
      const expense = parseGeneralExpense(candidate, ledgerCurrency);
      if (!expense || expenseIds.has(expense.id)) return null;
      expenseIds.add(expense.id); expenses.push(expense);
    }
    return Object.freeze({ id, title, kind: "general", createdAt, updatedAt, currency: ledgerCurrency, expenses: Object.freeze(expenses) } satisfies GeneralLedger);
  }
  return null;
}

export function parseWalletStateStrict(value: unknown): WalletState | null {
  if (!isRecord(value) || value.version !== 2 || !SUPPORTED_LOCALES.includes(value.locale as Locale) || !Array.isArray(value.ledgers) || value.ledgers.length > MAX_LEDGERS) return null;
  const ledgers: Ledger[] = []; const ids = new Set<string>();
  for (const candidate of value.ledgers) { const ledger = parseLedger(candidate); if (!ledger || ids.has(ledger.id)) return null; ids.add(ledger.id); ledgers.push(ledger); }
  const activeLedgerId = value.activeLedgerId === null ? null : text(value.activeLedgerId, 100);
  if (activeLedgerId !== null && !ids.has(activeLedgerId)) return null;
  return Object.freeze({ version: 2, locale: value.locale as Locale, activeLedgerId, ledgers: Object.freeze(ledgers) });
}

export function parseWalletState(value: unknown): WalletState { return parseWalletStateStrict(value) ?? EMPTY_WALLET_STATE; }

export function createLedger(kind: "travel", title: string, selectedCurrency: string): TravelLedger;
export function createLedger(kind: "general", title: string, selectedCurrency: string): GeneralLedger;
export function createLedger(kind: Ledger["kind"], titleInput: string, selectedCurrencyInput: string): Ledger {
  const title = text(titleInput, 80); const selectedCurrency = currency(selectedCurrencyInput); if (!title || !selectedCurrency) throw new Error("invalid ledger");
  const now = new Date().toISOString(); const base = { id: crypto.randomUUID(), title, createdAt: now, updatedAt: now };
  return kind === "travel"
    ? Object.freeze({ ...base, kind, currencies: Object.freeze([selectedCurrency]), defaultCurrency: selectedCurrency, participants: Object.freeze([]), selfParticipantId: null, expenses: Object.freeze([]) })
    : Object.freeze({ ...base, kind, currency: selectedCurrency, expenses: Object.freeze([]) });
}

export function splitEvenly(minorUnits: number, participantIds: readonly string[]): readonly ExpenseShare[] {
  if (!Number.isSafeInteger(minorUnits) || minorUnits <= 0 || participantIds.length < 1 || new Set(participantIds).size !== participantIds.length) throw new Error("invalid split");
  const sorted = [...participantIds].sort(); const base = Math.floor(minorUnits / sorted.length); const remainder = minorUnits % sorted.length;
  return Object.freeze(sorted.map((participantId, index) => Object.freeze({ participantId, minorUnits: base + (index < remainder ? 1 : 0) })));
}

export interface SettlementTransfer { readonly from: string; readonly to: string; readonly currency: string; readonly minorUnits: number; }
export interface CurrencySettlement { readonly currency: string; readonly balances: ReadonlyMap<string, number>; readonly transfers: readonly SettlementTransfer[]; }

export function settleTravelExpenses(ledger: TravelLedger): readonly CurrencySettlement[] {
  return Object.freeze(ledger.currencies.map((expenseCurrency) => {
    const balances = new Map(ledger.participants.map((participant) => [participant.id, 0]));
    for (const expense of ledger.expenses) {
      if (expense.currency !== expenseCurrency) continue;
      balances.set(expense.paidBy, (balances.get(expense.paidBy) ?? 0) + expense.minorUnits);
      for (const share of expense.shares) balances.set(share.participantId, (balances.get(share.participantId) ?? 0) - share.minorUnits);
    }
    if ([...balances.values()].some((amount) => !Number.isSafeInteger(amount)) || [...balances.values()].reduce((sum, amount) => sum + amount, 0) !== 0) throw new Error("invalid balances");
    const debtors = [...balances].filter(([, amount]) => amount < 0).map(([id, amount]) => ({ id, amount: -amount })).sort((a, b) => a.id.localeCompare(b.id));
    const creditors = [...balances].filter(([, amount]) => amount > 0).map(([id, amount]) => ({ id, amount })).sort((a, b) => a.id.localeCompare(b.id));
    const transfers: SettlementTransfer[] = []; let di = 0; let ci = 0;
    while (di < debtors.length && ci < creditors.length) { const amount = Math.min(debtors[di].amount, creditors[ci].amount); transfers.push(Object.freeze({ from: debtors[di].id, to: creditors[ci].id, currency: expenseCurrency, minorUnits: amount })); debtors[di].amount -= amount; creditors[ci].amount -= amount; if (!debtors[di].amount) di += 1; if (!creditors[ci].amount) ci += 1; }
    return Object.freeze({ currency: expenseCurrency, balances, transfers: Object.freeze(transfers) });
  }));
}

export function replaceLedger(state: WalletState, ledger: Ledger): WalletState {
  const parsed = parseLedger(ledger); if (!parsed) throw new Error("invalid ledger");
  return Object.freeze({ ...state, ledgers: Object.freeze(state.ledgers.map((candidate) => candidate.id === parsed.id ? parsed : candidate)) });
}

export function createTravelExpense(input: Omit<TravelExpense, "id" | "shares"> & { participantIds: readonly string[] }): TravelExpense {
  return Object.freeze({ ...input, id: crypto.randomUUID(), shares: splitEvenly(input.minorUnits, input.participantIds) });
}

export function defaultDate(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}
export function validateCurrencyAmount(minorUnits: number, valueCurrency: string): boolean { return Number.isSafeInteger(minorUnits) && minorUnits > 0 && currencyDigits(valueCurrency) >= 0; }
