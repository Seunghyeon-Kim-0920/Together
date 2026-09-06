import type { Participant, TravelExpense, TravelLedger } from "./types";
import { MAX_EXPENSES_PER_LEDGER, MAX_PARTICIPANTS, parseLedger } from "./wallet";

export type ParticipantDestination =
  | { readonly kind: "existing"; readonly participantId: string }
  | { readonly kind: "new"; readonly name?: string };

/** Every source person must be explicitly matched or added; names are not IDs. */
export type ParticipantMapping = Readonly<Record<string, ParticipantDestination>>;

export interface TravelCurrencyTotal { readonly currency: string; readonly minorUnits: number; }
export interface TravelMergeConflict {
  readonly expenseId: string;
  readonly existing: TravelExpense;
  readonly incoming: TravelExpense;
}
export type TravelMergeErrorCode = "invalid-target" | "invalid-source" | "missing-participant-mapping" | "unknown-source-participant" | "unknown-target-participant" | "invalid-participant-mapping" | "participant-limit" | "expense-limit" | "currency-limit" | "amount-overflow";
export interface TravelMergeError { readonly code: TravelMergeErrorCode; readonly participantId?: string; }
export interface TravelMergePreview {
  readonly ok: boolean;
  /** Apply only after the user has checked the mapping and preview. */
  readonly ledger: TravelLedger | null;
  readonly errors: readonly TravelMergeError[];
  readonly addedExpenseCount: number;
  readonly duplicateExpenseCount: number;
  readonly conflicts: readonly TravelMergeConflict[];
  readonly addedParticipantCount: number;
  readonly addedTotals: readonly TravelCurrencyTotal[];
  readonly resultTotals: readonly TravelCurrencyTotal[];
}

function sameExpense(left: TravelExpense, right: TravelExpense): boolean {
  if (left.id !== right.id || left.description !== right.description || left.category !== right.category || left.currency !== right.currency || left.minorUnits !== right.minorUnits || left.paidBy !== right.paidBy || left.occurredOn !== right.occurredOn || left.shares.length !== right.shares.length) return false;
  const rightShares = new Map(right.shares.map((share) => [share.participantId, share.minorUnits]));
  return left.shares.every((share) => rightShares.get(share.participantId) === share.minorUnits);
}

function totals(expenses: readonly TravelExpense[]): readonly TravelCurrencyTotal[] | null {
  const values = new Map<string, number>();
  for (const expense of expenses) {
    const amount = (values.get(expense.currency) ?? 0) + expense.minorUnits;
    if (!Number.isSafeInteger(amount)) return null;
    values.set(expense.currency, amount);
  }
  return Object.freeze([...values].sort(([left], [right]) => left.localeCompare(right)).map(([currency, minorUnits]) => Object.freeze({ currency, minorUnits })));
}

function failed(errors: readonly TravelMergeError[]): TravelMergePreview {
  return Object.freeze({ ok: false, ledger: null, errors: Object.freeze(errors), addedExpenseCount: 0, duplicateExpenseCount: 0, conflicts: Object.freeze([]), addedParticipantCount: 0, addedTotals: Object.freeze([]), resultTotals: Object.freeze([]) });
}

/** Build a lossless merge preview. Stable IDs survive exports and new-tab
 * imports, so forwarding a file never creates a second copy of its expenses.
 * A changed ID-matched record is reported while the existing edit is kept. */
export function previewTravelLedgerMerge(target: TravelLedger, incoming: TravelLedger, mapping: ParticipantMapping): TravelMergePreview {
  const parsedTarget = parseLedger(target);
  const parsedSource = parseLedger(incoming);
  if (parsedTarget?.kind !== "travel") return failed([{ code: "invalid-target" }]);
  if (parsedSource?.kind !== "travel") return failed([{ code: "invalid-source" }]);
  if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) return failed([{ code: "invalid-participant-mapping" }]);
  const errors: TravelMergeError[] = [];
  const sourceIds = new Set(parsedSource.participants.map((person) => person.id));
  const existingPeople = new Map(parsedTarget.participants.map((person) => [person.id, person]));
  const newPeople = new Map<string, Participant>();
  const resolved = new Map<string, string>();
  for (const sourceId of Object.keys(mapping)) if (!sourceIds.has(sourceId)) errors.push({ code: "unknown-source-participant", participantId: sourceId });
  for (const person of parsedSource.participants) {
    if (!Object.hasOwn(mapping, person.id)) { errors.push({ code: "missing-participant-mapping", participantId: person.id }); continue; }
    const destination = mapping[person.id];
    if (!destination || typeof destination !== "object") { errors.push({ code: "invalid-participant-mapping", participantId: person.id }); continue; }
    if (destination.kind === "existing") {
      if (!existingPeople.has(destination.participantId)) { errors.push({ code: "unknown-target-participant", participantId: person.id }); continue; }
      resolved.set(person.id, destination.participantId);
    } else if (destination.kind === "new") {
      const name = destination.name === undefined ? person.name : typeof destination.name === "string" ? destination.name.trim() : "";
      if (!name || name.length > 80) { errors.push({ code: "invalid-participant-mapping", participantId: person.id }); continue; }
      // Reusing an already imported stable ID is intentional: preserve local
      // name edits when the same file is imported again. Equal names with
      // different IDs remain different people until the user maps them.
      if (!existingPeople.has(person.id)) newPeople.set(person.id, Object.freeze({ id: person.id, name }));
      resolved.set(person.id, person.id);
    } else errors.push({ code: "invalid-participant-mapping", participantId: person.id });
  }
  if (errors.length) return failed(errors);
  const participants = Object.freeze([...parsedTarget.participants, ...newPeople.values()]);
  if (participants.length > MAX_PARTICIPANTS) errors.push({ code: "participant-limit" });
  const currencies = Object.freeze([...new Set([...parsedTarget.currencies, ...parsedSource.currencies])]);
  if (currencies.length > 20) errors.push({ code: "currency-limit" });
  const existingExpenses = new Map(parsedTarget.expenses.map((expense) => [expense.id, expense]));
  const additions: TravelExpense[] = [];
  const conflicts: TravelMergeConflict[] = [];
  let duplicateExpenseCount = 0;
  for (const expense of parsedSource.expenses) {
    const mappedShares = new Map<string, number>();
    for (const share of expense.shares) {
      const participantId = resolved.get(share.participantId)!;
      mappedShares.set(participantId, (mappedShares.get(participantId) ?? 0) + share.minorUnits);
    }
    const mapped = Object.freeze({ ...expense, paidBy: resolved.get(expense.paidBy)!, shares: Object.freeze([...mappedShares].sort(([left], [right]) => left.localeCompare(right)).map(([participantId, minorUnits]) => Object.freeze({ participantId, minorUnits }))) });
    const existing = existingExpenses.get(mapped.id);
    if (!existing) additions.push(mapped);
    else if (sameExpense(existing, mapped)) duplicateExpenseCount += 1;
    else conflicts.push(Object.freeze({ expenseId: mapped.id, existing, incoming: mapped }));
  }
  const expenses = Object.freeze([...parsedTarget.expenses, ...additions]);
  if (expenses.length > MAX_EXPENSES_PER_LEDGER) errors.push({ code: "expense-limit" });
  const addedTotals = totals(additions); const resultTotals = totals(expenses);
  if (!addedTotals || !resultTotals) errors.push({ code: "amount-overflow" });
  const changed = additions.length > 0 || newPeople.size > 0 || currencies.length !== parsedTarget.currencies.length;
  const proposed = errors.length ? null : Object.freeze({ ...parsedTarget, participants, currencies, expenses, updatedAt: changed ? new Date().toISOString() : parsedTarget.updatedAt });
  const ledger = proposed && parseLedger(proposed);
  return Object.freeze({ ok: errors.length === 0 && ledger?.kind === "travel", ledger: ledger?.kind === "travel" ? ledger : null, errors: Object.freeze(errors), addedExpenseCount: additions.length, duplicateExpenseCount, conflicts: Object.freeze(conflicts), addedParticipantCount: newPeople.size, addedTotals: addedTotals ?? Object.freeze([]), resultTotals: resultTotals ?? Object.freeze([]) });
}
