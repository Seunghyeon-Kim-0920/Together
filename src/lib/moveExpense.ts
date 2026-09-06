import { TRAVEL_CATEGORIES, type TravelCategory, type TravelExpense, type WalletState } from "./types";
import { publicExpenseId } from "./expenseIdentity";
import { merchantDisplayName } from "./merchant";
import { MAX_EXPENSES_PER_LEDGER, MAX_MOVED_EXPENSE_MARKERS, MAX_PARTICIPANTS, parseLedger, parseWalletStateStrict, splitEvenly } from "./wallet";

export interface MoveGeneralExpenseToTravelInput {
  readonly sourceLedgerId: string;
  readonly expenseId: string;
  readonly targetLedgerId: string;
  readonly paidBy: string;
  readonly participantIds: readonly string[];
  readonly category: TravelCategory;
}

function movedTravelExpenseId(sourceLedgerId: string, expenseId: string): string {
  // The random local ledger id salts the deterministic id. No bank/source
  // identifier or merchant fingerprint is copied into a shared travel row.
  const value = JSON.stringify(["travel-move-v1", sourceLedgerId, expenseId]);
  let left = 0x811c9dc5; let right = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193);
    right = Math.imul(right ^ code, 0x85ebca6b); right ^= right >>> 13;
  }
  return `travel-move-${(left >>> 0).toString(16).padStart(8, "0")}${(right >>> 0).toString(16).padStart(8, "0")}`;
}

/** Validate against the caller's latest state and commit both ledger changes
 * together. Failed validation throws before any state is changed. */
export function moveGeneralExpenseToTravel(state: WalletState, input: MoveGeneralExpenseToTravelInput): WalletState {
  if (!parseWalletStateStrict(state)) throw new Error("invalid wallet state");
  const source = state.ledgers.find((ledger) => ledger.id === input.sourceLedgerId);
  const target = state.ledgers.find((ledger) => ledger.id === input.targetLedgerId);
  if (!source || source.kind !== "general" || !target || target.kind !== "travel" || !parseLedger(source) || !parseLedger(target)) throw new Error("invalid move ledgers");
  const availableParticipants = new Set(target.participants.map((participant) => participant.id));
  if (!availableParticipants.has(input.paidBy) || !Array.isArray(input.participantIds) || input.participantIds.length < 1 || input.participantIds.length > MAX_PARTICIPANTS || new Set(input.participantIds).size !== input.participantIds.length || input.participantIds.some((id) => !availableParticipants.has(id)) || !TRAVEL_CATEGORIES.includes(input.category)) throw new Error("invalid move participants or category");
  const movedMarkers = source.movedExpenseIds ?? [];
  if (movedMarkers.includes(input.expenseId)) return state;
  const expense = source.expenses.find((candidate) => candidate.id === input.expenseId);
  if (!expense) throw new Error("source expense no longer exists");
  const id = movedTravelExpenseId(source.id, expense.id);
  // A pre-existing destination id without its source tombstone is inconsistent.
  // Never remove the original expense in that situation.
  if (state.ledgers.some((ledger) => ledger.expenses.some((candidate) => candidate.id === id))) throw new Error("move destination conflict");
  if (target.expenses.length >= MAX_EXPENSES_PER_LEDGER) throw new Error("travel ledger expense limit");
  const currencies = target.currencies.includes(expense.currency) ? target.currencies : Object.freeze([...target.currencies, expense.currency]);
  if (currencies.length > 20) throw new Error("travel ledger currency limit");
  const currencyTotals = new Map<string, number>();
  for (const current of [...target.expenses, expense]) {
    const total = (currencyTotals.get(current.currency) ?? 0) + current.minorUnits;
    if (!Number.isSafeInteger(total)) throw new Error("travel ledger total overflow");
    currencyTotals.set(current.currency, total);
  }
  const movedExpenseIds = Object.freeze([...new Set([
    ...movedMarkers,
    expense.id,
    publicExpenseId(source.id, expense.id),
    ...(expense.automationFingerprint ? [expense.automationFingerprint] : []),
    ...(expense.automationReversalFingerprint ? [expense.automationReversalFingerprint] : []),
  ])]);
  if (movedExpenseIds.length > MAX_MOVED_EXPENSE_MARKERS) throw new Error("move history limit");
  const movedExpense: TravelExpense = Object.freeze({
    id,
    description: merchantDisplayName(expense.description, expense.id),
    category: input.category,
    currency: expense.currency,
    minorUnits: expense.minorUnits,
    occurredOn: expense.occurredOn,
    paidBy: input.paidBy,
    shares: splitEvenly(expense.minorUnits, input.participantIds),
  });
  const updatedAt = new Date().toISOString();
  const nextSource = Object.freeze({ ...source, movedExpenseIds, expenses: Object.freeze(source.expenses.filter((candidate) => candidate.id !== expense.id)), updatedAt });
  const nextTarget = Object.freeze({ ...target, currencies, expenses: Object.freeze([...target.expenses, movedExpense]), updatedAt });
  if (!parseLedger(nextSource) || !parseLedger(nextTarget)) throw new Error("invalid moved ledger");
  return Object.freeze({ ...state, ledgers: Object.freeze(state.ledgers.map((ledger) => ledger.id === source.id ? nextSource : ledger.id === target.id ? nextTarget : ledger)) });
}
