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
  if (!Number.isSafeInteger(expense.amount.minorUnits) || expense.amount.minorUnits <= 0) {
    throw new DomainValidationError("Expense amount must be a positive integer");
  }
  normalizeCurrency(expense.amount.currency);
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

  for (const expense of expenses) {
    assertExpenseInvariant(expense);
    if (expense.amount.currency !== expectedCurrency) {
      throw new DomainValidationError(
        "Balances must be calculated separately for each currency",
      );
    }
    balances.set(
      expense.paidBy,
      (balances.get(expense.paidBy) ?? 0) + expense.amount.minorUnits,
    );
    for (const share of expense.shares) {
      balances.set(
        share.participantId,
        (balances.get(share.participantId) ?? 0) - share.minorUnits,
      );
    }
  }

  const total = Array.from(balances.values()).reduce(
    (sum, balance) => sum + balance,
    0,
  );
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

function planKey(transfers: readonly SettlementTransfer[]): string {
  return canonicalizeTransfers(transfers)
    .map(
      (transfer) =>
        `${transfer.fromParticipantId}>${transfer.toParticipantId}:${transfer.amount.minorUnits}`,
    )
    .join("|");
}

function chooseBetterPlan(
  candidate: readonly SettlementTransfer[],
  current: readonly SettlementTransfer[] | undefined,
): readonly SettlementTransfer[] {
  if (!current || candidate.length < current.length) return candidate;
  if (candidate.length > current.length) return current;
  return planKey(candidate) < planKey(current) ? candidate : current;
}

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
  const total = balancesInput.reduce(
    (sum, balance) => sum + balance.amount.minorUnits,
    0,
  );
  if (total !== 0) {
    throw new DomainValidationError("Settlement balances must sum to zero");
  }

  const entries = balancesInput
    .filter((balance) => balance.amount.minorUnits !== 0)
    .map((balance) => ({
      participantId: balance.participantId,
      minorUnits: balance.amount.minorUnits,
    }))
    .sort((left, right) => compareText(left.participantId, right.participantId));
  const memo = new Map<string, readonly SettlementTransfer[]>();

  const solve = (values: readonly number[]): readonly SettlementTransfer[] => {
    const first = values.findIndex((value) => value !== 0);
    if (first < 0) return [];
    const key = values.join(",");
    const cached = memo.get(key);
    if (cached) return cached;

    let best: readonly SettlementTransfer[] | undefined;
    const seenCounterpartBalances = new Set<number>();
    for (let counterpart = first + 1; counterpart < values.length; counterpart += 1) {
      if (values[first] * values[counterpart] >= 0) continue;
      if (seenCounterpartBalances.has(values[counterpart])) continue;
      seenCounterpartBalances.add(values[counterpart]);

      const amount = Math.min(
        Math.abs(values[first]),
        Math.abs(values[counterpart]),
      );
      const next = [...values];
      let transfer: SettlementTransfer;
      if (values[first] < 0) {
        next[first] += amount;
        next[counterpart] -= amount;
        transfer = Object.freeze({
          fromParticipantId: entries[first].participantId,
          toParticipantId: entries[counterpart].participantId,
          amount: createMoney(currency, amount),
        });
      } else {
        next[first] -= amount;
        next[counterpart] += amount;
        transfer = Object.freeze({
          fromParticipantId: entries[counterpart].participantId,
          toParticipantId: entries[first].participantId,
          amount: createMoney(currency, amount),
        });
      }
      const candidate = [transfer, ...solve(next)];
      best = chooseBetterPlan(candidate, best);
    }

    if (!best) {
      throw new DomainValidationError("Balances cannot be settled");
    }
    const canonical = Object.freeze(canonicalizeTransfers(best));
    memo.set(key, canonical);
    return canonical;
  };

  return Object.freeze([...solve(entries.map((entry) => entry.minorUnits))]);
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
