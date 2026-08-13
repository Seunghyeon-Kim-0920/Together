import {
  DomainValidationError,
  EXPENSE_CATEGORIES,
  type CurrencySettlement,
  type Expense,
  type ExpenseCategory,
  type ExpenseShare,
  type Money,
  type ParticipantBalance,
  type SettlementTransfer,
} from "./domain.js";

export interface EqualSplitExpenseInput {
  readonly id: string;
  readonly tripId: string;
  readonly paidBy: string;
  readonly category: ExpenseCategory;
  readonly description: string;
  readonly currency: string;
  readonly totalMinorUnits: number;
  readonly participantIds: readonly string[];
  readonly occurredAt: string;
}

export interface ExpenseLedger {
  readonly version: 1;
  readonly expenses: readonly Expense[];
}

const MAX_LEDGER_EXPENSES = 1_000;
const MAX_LEDGER_PARTICIPANTS = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireBoundedText(
  value: string,
  fieldName: string,
  maximum: number,
): string {
  const normalized = requireNonEmpty(value, fieldName);
  if (normalized.length > maximum) {
    throw new DomainValidationError(`${fieldName} is too long`);
  }
  return normalized;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function requireNonEmpty(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new DomainValidationError(`${fieldName} must not be empty`);
  }
  return normalized;
}

function normalizeCurrency(currency: string): string {
  const normalized = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw new DomainValidationError(
      "Currency must be a three-letter ISO 4217 code",
    );
  }
  return normalized;
}

function assertMinorUnits(value: number, allowNegative: boolean): void {
  if (!Number.isSafeInteger(value) || (!allowNegative && value < 0)) {
    throw new DomainValidationError(
      `Minor units must be a ${allowNegative ? "safe" : "non-negative safe"} integer`,
    );
  }
}

export function createMoney(currency: string, minorUnits: number): Money {
  assertMinorUnits(minorUnits, true);
  return Object.freeze({
    currency: normalizeCurrency(currency),
    minorUnits,
  });
}

function normalizeParticipantIds(
  participantIds: readonly string[],
): readonly string[] {
  if (participantIds.length === 0) {
    throw new DomainValidationError("At least one participant is required");
  }
  const normalized = participantIds.map((participantId) =>
    requireNonEmpty(participantId, "Participant id"),
  );
  if (new Set(normalized).size !== normalized.length) {
    throw new DomainValidationError("Participant ids must be unique");
  }
  return normalized.sort(compareText);
}

export function splitEvenly(
  totalMinorUnits: number,
  participantIds: readonly string[],
): readonly ExpenseShare[] {
  assertMinorUnits(totalMinorUnits, false);
  const sortedParticipantIds = normalizeParticipantIds(participantIds);
  const base = Math.floor(totalMinorUnits / sortedParticipantIds.length);
  const remainder = totalMinorUnits % sortedParticipantIds.length;
  return Object.freeze(
    sortedParticipantIds.map((participantId, index) =>
      Object.freeze({
        participantId,
        minorUnits: base + (index < remainder ? 1 : 0),
      }),
    ),
  );
}
export function assertExpenseInvariant(expense: Expense): void {
  requireBoundedText(expense.id, "Expense id", 100);
  requireBoundedText(expense.tripId, "Trip id", 100);
  requireBoundedText(expense.paidBy, "Payer id", 100);
  requireBoundedText(expense.description, "Expense description", 500);
  if (!(EXPENSE_CATEGORIES as readonly string[]).includes(expense.category)) {
    throw new DomainValidationError(`Unsupported category: ${expense.category}`);
  }
  if (typeof expense.occurredAt !== "string" || expense.occurredAt.length > 80 || Number.isNaN(Date.parse(expense.occurredAt))) {
    throw new DomainValidationError("Occurrence timestamp must be ISO-compatible");
  }
  if (!Number.isSafeInteger(expense.amount.minorUnits) || expense.amount.minorUnits <= 0) {
    throw new DomainValidationError("Expense amount must be a positive integer");
  }
  if (normalizeCurrency(expense.amount.currency) !== expense.amount.currency) {
    throw new DomainValidationError("Expense currency must be canonical");
  }
  if (expense.shares.length > MAX_LEDGER_PARTICIPANTS) {
    throw new DomainValidationError("Expense has too many participants");
  }
  normalizeParticipantIds(expense.shares.map((share) => share.participantId));
  for (const share of expense.shares) {
    assertMinorUnits(share.minorUnits, false);
  }
  const shareTotal = expense.shares.reduce(
    (total, share) => total + share.minorUnits,
    0,
  );
  if (shareTotal !== expense.amount.minorUnits) {
    throw new DomainValidationError(
      `Expense shares ${shareTotal} do not equal amount ${expense.amount.minorUnits}`,
    );
  }
}

export function parseExpenseLedger(value: unknown): ExpenseLedger | null {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.expenses) || value.expenses.length > MAX_LEDGER_EXPENSES) {
    return null;
  }
  const expenses: Expense[] = [];
  try {
    for (const candidate of value.expenses) {
      if (!isRecord(candidate) || !isRecord(candidate.amount) || !Array.isArray(candidate.shares)) return null;
      if (typeof candidate.id !== "string" || typeof candidate.tripId !== "string" || typeof candidate.paidBy !== "string" || typeof candidate.description !== "string" || typeof candidate.occurredAt !== "string") return null;
      if (typeof candidate.category !== "string" || !(EXPENSE_CATEGORIES as readonly string[]).includes(candidate.category)) return null;
      if (typeof candidate.amount.currency !== "string" || !Number.isSafeInteger(candidate.amount.minorUnits)) return null;
      if (candidate.shares.length < 1 || candidate.shares.length > MAX_LEDGER_PARTICIPANTS) return null;
      const shares: ExpenseShare[] = [];
      for (const share of candidate.shares) {
        if (!isRecord(share) || typeof share.participantId !== "string" || !Number.isSafeInteger(share.minorUnits)) return null;
        shares.push(Object.freeze({
          participantId: requireBoundedText(share.participantId, "Participant id", 100),
          minorUnits: share.minorUnits as number,
        }));
      }
      const expense: Expense = Object.freeze({
        id: requireBoundedText(candidate.id, "Expense id", 100),
        tripId: requireBoundedText(candidate.tripId, "Trip id", 100),
        paidBy: requireBoundedText(candidate.paidBy, "Payer id", 100),
        category: candidate.category as ExpenseCategory,
        description: requireBoundedText(candidate.description, "Expense description", 500),
        amount: createMoney(candidate.amount.currency, candidate.amount.minorUnits as number),
        shares: Object.freeze(shares),
        occurredAt: candidate.occurredAt,
      });
      assertExpenseInvariant(expense);
      expenses.push(expense);
    }
    if (new Set(expenses.map((expense) => expense.id)).size !== expenses.length) return null;
    return Object.freeze({ version: 1, expenses: Object.freeze(expenses) });
  } catch {
    return null;
  }
}

export function createEqualSplitExpense(
  input: EqualSplitExpenseInput,
): Expense {
  if (!(EXPENSE_CATEGORIES as readonly string[]).includes(input.category)) {
    throw new DomainValidationError(`Unsupported category: ${input.category}`);
  }
  assertMinorUnits(input.totalMinorUnits, false);
  if (input.totalMinorUnits === 0) {
    throw new DomainValidationError("Expense amount must be positive");
  }
  const occurredAt = requireNonEmpty(input.occurredAt, "Occurrence timestamp");
  if (Number.isNaN(Date.parse(occurredAt))) {
    throw new DomainValidationError("Occurrence timestamp must be ISO-compatible");
  }

  const expense: Expense = Object.freeze({
    id: requireNonEmpty(input.id, "Expense id"),
    tripId: requireNonEmpty(input.tripId, "Trip id"),
    paidBy: requireNonEmpty(input.paidBy, "Payer id"),
    category: input.category,
    description: requireNonEmpty(input.description, "Expense description"),
    amount: createMoney(input.currency, input.totalMinorUnits),
    shares: splitEvenly(input.totalMinorUnits, input.participantIds),
    occurredAt,
  });
  assertExpenseInvariant(expense);
  return expense;
}

export function calculateBalances(
  expenses: readonly Expense[],
  currency?: string,
): readonly ParticipantBalance[] {
  if (expenses.length === 0) return [];
  const expectedCurrency = normalizeCurrency(
    currency ?? expenses[0].amount.currency,
  );
  const balances = new Map<string, number>();
  const safeAdd = (left: number, right: number): number => {
    const result = left + right;
    if (!Number.isSafeInteger(result)) {
      throw new DomainValidationError("Expense balance is outside the safe integer range");
    }
    return result;
  };

  for (const expense of expenses) {
    assertExpenseInvariant(expense);
    if (expense.amount.currency !== expectedCurrency) {
      throw new DomainValidationError(
        "Balances must be calculated separately for each currency",
      );
    }
    balances.set(
      expense.paidBy,
      safeAdd(
        balances.get(expense.paidBy) ?? 0,
        expense.amount.minorUnits,
      ),
    );
    for (const share of expense.shares) {
      balances.set(
        share.participantId,
        safeAdd(
          balances.get(share.participantId) ?? 0,
          -share.minorUnits,
        ),
      );
    }
  }

  const total = Array.from(balances.values()).reduce(safeAdd, 0);
  if (total !== 0) {
    throw new DomainValidationError("Participant balances must sum to zero");
  }

  return Object.freeze(
    Array.from(balances.entries())
      .sort(([left], [right]) => compareText(left, right))
      .map(([participantId, minorUnits]) =>
        Object.freeze({
          participantId,
          amount: createMoney(expectedCurrency, minorUnits),
        }),
      ),
  );
}

function canonicalizeTransfers(
  transfers: readonly SettlementTransfer[],
): readonly SettlementTransfer[] {
  return [...transfers].sort((left, right) => {
    return (
      compareText(left.fromParticipantId, right.fromParticipantId) ||
      compareText(left.toParticipantId, right.toParticipantId) ||
      left.amount.minorUnits - right.amount.minorUnits
    );
  });
}

/**
 * Produces a deterministic greedy settlement in O(n log n) time.
 *
 * The historical export name is retained for compatibility. The result is
 * bounded to at most debtors + creditors - 1 transfers, but is not guaranteed
 * to use the mathematically minimum possible number of transfers.
 */
export function minimumSettlementTransfers(
  balancesInput: readonly ParticipantBalance[],
): readonly SettlementTransfer[] {
  if (balancesInput.length === 0) return [];
  const currency = normalizeCurrency(balancesInput[0].amount.currency);
  const participantIds = balancesInput.map((balance) =>
    requireNonEmpty(balance.participantId, "Participant id"),
  );
  if (new Set(participantIds).size !== participantIds.length) {
    throw new DomainValidationError("Balances must have unique participant ids");
  }
  for (const balance of balancesInput) {
    if (normalizeCurrency(balance.amount.currency) !== currency) {
      throw new DomainValidationError(
        "Settlement balances must use one currency",
      );
    }
    assertMinorUnits(balance.amount.minorUnits, true);
  }
  const total = balancesInput.reduce((sum, balance) => {
    const next = sum + balance.amount.minorUnits;
    if (!Number.isSafeInteger(next)) {
      throw new DomainValidationError("Settlement total is outside the safe integer range");
    }
    return next;
  }, 0);
  if (total !== 0) {
    throw new DomainValidationError("Settlement balances must sum to zero");
  }

  const debtors = balancesInput
    .filter((balance) => balance.amount.minorUnits < 0)
    .map((balance) => ({
      participantId: requireNonEmpty(balance.participantId, "Participant id"),
      remainingMinorUnits: -balance.amount.minorUnits,
    }))
    .sort((left, right) => compareText(left.participantId, right.participantId));
  const creditors = balancesInput
    .filter((balance) => balance.amount.minorUnits > 0)
    .map((balance) => ({
      participantId: requireNonEmpty(balance.participantId, "Participant id"),
      remainingMinorUnits: balance.amount.minorUnits,
    }))
    .sort((left, right) => compareText(left.participantId, right.participantId));

  const transfers: SettlementTransfer[] = [];
  let debtorIndex = 0;
  let creditorIndex = 0;
  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];
    const amount = Math.min(
      debtor.remainingMinorUnits,
      creditor.remainingMinorUnits,
    );
    transfers.push(
      Object.freeze({
        fromParticipantId: debtor.participantId,
        toParticipantId: creditor.participantId,
        amount: createMoney(currency, amount),
      }),
    );
    debtor.remainingMinorUnits -= amount;
    creditor.remainingMinorUnits -= amount;
    if (debtor.remainingMinorUnits === 0) debtorIndex += 1;
    if (creditor.remainingMinorUnits === 0) creditorIndex += 1;
  }

  if (debtorIndex !== debtors.length || creditorIndex !== creditors.length) {
    throw new DomainValidationError("Balances cannot be settled");
  }
  return Object.freeze(canonicalizeTransfers(transfers));
}

export function settleExpensesByCurrency(
  expenses: readonly Expense[],
): readonly CurrencySettlement[] {
  const groups = new Map<string, Expense[]>();
  for (const expense of expenses) {
    assertExpenseInvariant(expense);
    const currency = normalizeCurrency(expense.amount.currency);
    const group = groups.get(currency) ?? [];
    group.push(expense);
    groups.set(currency, group);
  }

  return Object.freeze(
    Array.from(groups.entries())
      .sort(([left], [right]) => compareText(left, right))
      .map(([currency, currencyExpenses]) => {
        const balances = calculateBalances(currencyExpenses, currency);
        return Object.freeze({
          currency,
          balances,
          transfers: minimumSettlementTransfers(balances),
        });
      }),
  );
}
