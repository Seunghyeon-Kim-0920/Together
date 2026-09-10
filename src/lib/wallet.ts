import { currencyDigits } from "./currency";
import { legacyPublicExpenseId, publicExpenseId } from "./expenseIdentity";
import { EMPTY_WALLET_STATE, GENERAL_CATEGORIES, SUPPORTED_LOCALES, TRAVEL_CATEGORIES, type AutomationSource, type ExpenseShare, type GeneralExpense, type GeneralLedger, type Ledger, type Locale, type Participant, type StatementImportReceipt, type TravelExpense, type TravelLedger, type WalletState } from "./types";

export const MAX_LEDGERS = 50;
export const MAX_EXPENSES_PER_LEDGER = 5_000;
export const MAX_PARTICIPANTS = 100;
export const MAX_MOVED_EXPENSE_MARKERS = MAX_EXPENSES_PER_LEDGER * 4;
export const MAX_STATEMENT_IMPORT_RECEIPTS = 20_000;
// This is a storage-safety bound, not a provider allow-list. Five hundred
// distinct Android packages is deliberately well beyond normal card usage.
export const MAX_AUTOMATION_SOURCES = 500;

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function text(value: unknown, maximum: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= maximum ? normalized : null;
}
function currency(value: unknown): string | null { const normalized = typeof value === "string" ? value.trim().toUpperCase() : ""; return /^[A-Z]{3}$/.test(normalized) ? normalized : null; }
function date(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}
function timestamp(value: unknown): string | null { return typeof value === "string" && value.length <= 80 && !Number.isNaN(Date.parse(value)) ? value : null; }
function positiveMinor(value: unknown): number | null { return Number.isSafeInteger(value) && (value as number) > 0 ? value as number : null; }
export function isValidPackageName(value: string): boolean { return value.length <= 200 && /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/.test(value); }

export function parseAutomationSource(value: unknown): AutomationSource | null {
  if (!isRecord(value)) return null;
  const packageName = text(value.packageName, 200); const displayName = text(value.displayName, 80);
  // Sources saved before v1.3 were already explicitly registered by the user.
  // Migrate those entries, but reject a value that explicitly denies the
  // direct-app attestation.
  const trustedDirectApp = value.trustedDirectApp === undefined ? true : value.trustedDirectApp;
  return packageName && displayName && isValidPackageName(packageName) && trustedDirectApp === true ? Object.freeze({ packageName, displayName, trustedDirectApp: true }) : null;
}

function parseAutomationSources(value: unknown): readonly AutomationSource[] | null {
  if (!Array.isArray(value) || value.length > MAX_AUTOMATION_SOURCES) return null;
  const sources: AutomationSource[] = []; const packages = new Set<string>();
  for (const candidate of value) { const source = parseAutomationSource(candidate); if (!source || packages.has(source.packageName)) return null; packages.add(source.packageName); sources.push(source); }
  return Object.freeze(sources);
}

function parseAutomationReversalIds(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || value.length > MAX_EXPENSES_PER_LEDGER) return null;
  const ids = value.map((candidate) => text(candidate, 100));
  if (ids.some((candidate) => !candidate || !/^card-(?:auto|origin|reversal)-[0-9a-f]{16}$/.test(candidate as string)) || new Set(ids).size !== ids.length) return null;
  return Object.freeze(ids as string[]);
}

function parseMovedExpenseIds(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || value.length > MAX_MOVED_EXPENSE_MARKERS) return null;
  const ids = value.map((candidate) => text(candidate, 100));
  if (ids.some((candidate) => !candidate) || new Set(ids).size !== ids.length) return null;
  return Object.freeze(ids as string[]);
}

function parseStatementImportHistory(value: unknown): readonly StatementImportReceipt[] | null {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > MAX_STATEMENT_IMPORT_RECEIPTS) return null;
  const receipts: StatementImportReceipt[] = []; const ids = new Set<string>();
  for (const entry of value) {
    if (!isRecord(entry) || entry.kind !== "payment" && entry.kind !== "adjustment") return null;
    const id = text(entry.id, 100); const expenseId = text(entry.expenseId, 100);
    const transactionKey = entry.transactionKey === undefined ? undefined : text(entry.transactionKey, 50);
    if (!id || !expenseId || ids.has(`${entry.kind}:${id}`) || entry.kind === "adjustment" && !/^statement-adjustment-[0-9a-f]{16}$/.test(id) || entry.transactionKey !== undefined && (!transactionKey || !/^statement-transaction-[0-9a-f]{16}$/.test(transactionKey))) return null;
    ids.add(`${entry.kind}:${id}`); receipts.push(Object.freeze({ kind: entry.kind, id, expenseId, ...(transactionKey ? { transactionKey } : {}) }));
  }
  return Object.freeze(receipts);
}

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
  const automationFingerprint = value.automationFingerprint === undefined ? null : text(value.automationFingerprint, 40);
  const automationReversalFingerprint = value.automationReversalFingerprint === undefined ? null : text(value.automationReversalFingerprint, 42);
  if (!id || !description || !expenseDate || expenseCurrency !== ledgerCurrency || !minorUnits || !GENERAL_CATEGORIES.includes(value.category as never) || (value.automationFingerprint !== undefined && (!automationFingerprint || !/^card-origin-[0-9a-f]{16}$/.test(automationFingerprint))) || (value.automationReversalFingerprint !== undefined && (!automationReversalFingerprint || !/^card-reversal-[0-9a-f]{16}$/.test(automationReversalFingerprint)))) return null;
  return Object.freeze({ id, description, category: value.category as GeneralExpense["category"], currency: ledgerCurrency, minorUnits, occurredOn: expenseDate, ...(automationFingerprint ? { automationFingerprint } : {}), ...(automationReversalFingerprint ? { automationReversalFingerprint } : {}) });
}

export function parseLedger(value: unknown): Ledger | null {
  if (!isRecord(value)) return null;
  const id = text(value.id, 100); const title = text(value.title, 80); const createdAt = timestamp(value.createdAt); const updatedAt = timestamp(value.updatedAt);
  const statementImportHistory = parseStatementImportHistory(value.statementImportHistory);
  if (!id || !title || !createdAt || !updatedAt || !statementImportHistory || !Array.isArray(value.expenses) || value.expenses.length > MAX_EXPENSES_PER_LEDGER) return null;
  const privateHistory = statementImportHistory.length ? { statementImportHistory } : {};
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
    return Object.freeze({ id, title, kind: "travel", createdAt, updatedAt, currencies: Object.freeze(currencies as string[]), defaultCurrency, participants, selfParticipantId, expenses: Object.freeze(expenses), ...privateHistory } satisfies TravelLedger);
  }
  if (value.kind === "general") {
    const ledgerCurrency = currency(value.currency);
    const monthlyLimitMinor = value.monthlyLimitMinor === undefined || value.monthlyLimitMinor === null ? null : positiveMinor(value.monthlyLimitMinor);
    const automationAllApps = value.automationAllApps === undefined ? false : value.automationAllApps;
    const automationSources = value.automationSources === undefined ? Object.freeze([]) : parseAutomationSources(value.automationSources);
    const automationReversalIds = value.automationReversalIds === undefined ? Object.freeze([]) : parseAutomationReversalIds(value.automationReversalIds);
    const movedExpenseIds = value.movedExpenseIds === undefined ? Object.freeze([]) : parseMovedExpenseIds(value.movedExpenseIds);
    if (!ledgerCurrency || typeof automationAllApps !== "boolean" || (value.monthlyLimitMinor !== undefined && value.monthlyLimitMinor !== null && monthlyLimitMinor === null) || !automationSources || !automationReversalIds || !movedExpenseIds) return null;
    const expenses: GeneralExpense[] = [];
    for (const candidate of value.expenses) {
      const expense = parseGeneralExpense(candidate, ledgerCurrency);
      if (!expense || expenseIds.has(expense.id)) return null;
      expenseIds.add(expense.id); expenses.push(expense);
    }
    return Object.freeze({ id, title, kind: "general", createdAt, updatedAt, currency: ledgerCurrency, monthlyLimitMinor, automationAllApps, automationSources, automationReversalIds, movedExpenseIds, expenses: Object.freeze(expenses), ...privateHistory } satisfies GeneralLedger);
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
    : Object.freeze({ ...base, kind, currency: selectedCurrency, monthlyLimitMinor: null, automationAllApps: false, automationSources: Object.freeze([]), automationReversalIds: Object.freeze([]), movedExpenseIds: Object.freeze([]), expenses: Object.freeze([]) });
}

export function splitEvenly(minorUnits: number, participantIds: readonly string[]): readonly ExpenseShare[] {
  if (!Number.isSafeInteger(minorUnits) || minorUnits <= 0 || participantIds.length < 1 || new Set(participantIds).size !== participantIds.length) throw new Error("invalid split");
  const sorted = [...participantIds].sort(); const base = Math.floor(minorUnits / sorted.length); const remainder = minorUnits % sorted.length;
  return Object.freeze(sorted.map((participantId, index) => Object.freeze({ participantId, minorUnits: base + (index < remainder ? 1 : 0) })));
}

/** Preserve an imported unequal split when an edit leaves its split inputs unchanged. */
export function preserveTravelShares(existing: TravelExpense, minorUnits: number, currency: string, participantIds: readonly string[]): readonly ExpenseShare[] | null {
  if (existing.minorUnits !== minorUnits || existing.currency !== currency) return null;
  const previous = new Set(existing.shares.map((share) => share.participantId));
  const next = new Set(participantIds);
  if (previous.size !== next.size || [...previous].some((id) => !next.has(id))) return null;
  return existing.shares;
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

function sameGeneralExpense(left: GeneralExpense, right: GeneralExpense): boolean {
  return left.id === right.id && left.description === right.description && left.category === right.category && left.currency === right.currency && left.minorUnits === right.minorUnits && left.occurredOn === right.occurredOn && left.automationFingerprint === right.automationFingerprint && left.automationReversalFingerprint === right.automationReversalFingerprint;
}

function sameAutomationSources(left: readonly AutomationSource[], right: readonly AutomationSource[]): boolean {
  return left.length === right.length && left.every((source, index) => source.packageName === right[index]?.packageName && source.displayName === right[index]?.displayName);
}

function sameStringList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** Apply a user edit made from `base` onto the latest ledger without dropping
 * card expenses that were durably inserted while the edit sheet was open. */
export function mergeGeneralLedgerMutation(base: GeneralLedger, desired: GeneralLedger, latest: GeneralLedger): GeneralLedger {
  if (base.id !== desired.id || desired.id !== latest.id) return desired;
  const baseById = new Map(base.expenses.map((expense) => [expense.id, expense]));
  const desiredById = new Map(desired.expenses.map((expense) => [expense.id, expense]));
  const latestIds = new Set(latest.expenses.map((expense) => expense.id));
  const expenses: GeneralExpense[] = [];
  for (const current of latest.expenses) {
    const before = baseById.get(current.id); const requested = desiredById.get(current.id);
    if (before && !requested) continue;
    expenses.push(before && requested && !sameGeneralExpense(before, requested) ? requested : current);
  }
  for (const requested of desired.expenses) if (!baseById.has(requested.id) && !latestIds.has(requested.id) && !latest.movedExpenseIds.includes(requested.id)) expenses.push(requested);
  return Object.freeze({
    ...latest,
    title: desired.title !== base.title ? desired.title : latest.title,
    monthlyLimitMinor: desired.monthlyLimitMinor !== base.monthlyLimitMinor ? desired.monthlyLimitMinor : latest.monthlyLimitMinor,
    automationAllApps: desired.automationAllApps !== base.automationAllApps ? desired.automationAllApps : latest.automationAllApps,
    automationSources: sameAutomationSources(desired.automationSources, base.automationSources) ? latest.automationSources : desired.automationSources,
    automationReversalIds: sameStringList(desired.automationReversalIds, base.automationReversalIds) ? latest.automationReversalIds : desired.automationReversalIds,
    // Moving and editing can happen while another sheet is open. Tombstones
    // are monotonic and must never be erased by an older view of the ledger.
    movedExpenseIds: Object.freeze([...new Set([...latest.movedExpenseIds, ...desired.movedExpenseIds])]),
    expenses: Object.freeze(expenses),
    updatedAt: new Date().toISOString(),
  });
}

/** Merge provider-imported expenses into an existing general ledger by stable expense id. */
export function mergeGeneralLedgers(existing: GeneralLedger, imported: GeneralLedger, sourceLedgerId?: string): GeneralLedger {
  if (existing.kind !== "general" || imported.kind !== "general" || existing.currency !== imported.currency || existing.title !== imported.title) throw new Error("incompatible ledgers");
  const byId = new Map(existing.expenses.map((expense) => [expense.id, expense]));
  const knownIds = new Set<string>();
  const remember = (id: string) => {
    knownIds.add(id);
    // A local expense and its exported opaque id still identify one row.
    knownIds.add(publicExpenseId(existing.id, id));
    if (sourceLedgerId && /^shared-[0-9a-f]{16}$/.test(id)) knownIds.add(legacyPublicExpenseId(sourceLedgerId, id));
  };
  for (const expense of existing.expenses) remember(expense.id);
  for (const id of existing.movedExpenseIds) remember(id);
  // Existing rows may contain user edits. A repeated provider import should
  // only add unseen transactions, never overwrite those local corrections.
  for (const expense of imported.expenses) {
    const legacyId = sourceLedgerId ? legacyPublicExpenseId(sourceLedgerId, expense.id) : null;
    if (!knownIds.has(expense.id) && !(legacyId && knownIds.has(legacyId)) && !(expense.automationFingerprint && knownIds.has(expense.automationFingerprint))) {
      byId.set(expense.id, expense);
    }
    // Also remember a matched incoming alias so one file cannot insert both
    // legacy and stable forms of the same transaction in either order.
    remember(expense.id);
  }
  const merged = Object.freeze({ ...existing, expenses: Object.freeze([...byId.values()]), updatedAt: new Date().toISOString() });
  const parsed = parseLedger(merged);
  if (!parsed || parsed.kind !== "general") throw new Error("invalid merged ledger");
  return parsed;
}

export function createTravelExpense(input: Omit<TravelExpense, "id" | "shares"> & { participantIds: readonly string[] }): TravelExpense {
  return Object.freeze({ ...input, id: crypto.randomUUID(), shares: splitEvenly(input.minorUnits, input.participantIds) });
}

/** Replace one expense without changing list order or the stable expense id. */
export function replaceExpenseById<T extends { readonly id: string }>(expenses: readonly T[], replacement: T): readonly T[] {
  if (!expenses.some((expense) => expense.id === replacement.id)) return expenses;
  return Object.freeze(expenses.map((expense) => expense.id === replacement.id ? replacement : expense));
}

/** Show later dates first and, for the same date, the most recently added row first. */
export function newestExpensesFirst<T extends { readonly occurredOn: string }>(expenses: readonly T[]): readonly T[] {
  return Object.freeze(expenses.map((expense, index) => ({ expense, index })).sort((a, b) => b.expense.occurredOn.localeCompare(a.expense.occurredOn) || b.index - a.index).map(({ expense }) => expense));
}

export function defaultDate(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}
export function validateCurrencyAmount(minorUnits: number, valueCurrency: string): boolean { return Number.isSafeInteger(minorUnits) && minorUnits > 0 && currencyDigits(valueCurrency) >= 0; }
