import { MAX_SHARED_PARTICIPANTS } from "./sharedTravel";
import type { Locale, Participant, TravelExpense, TravelLedger } from "./types";
import { MAX_PARTICIPANTS, splitEvenly } from "./wallet";

export type TravelParticipantErrorCode = "required" | "duplicate" | "limit" | "not-found" | "permission" | "invalid" | "no-remaining-sharers" | "history-removed";
export class TravelParticipantError extends Error {
  constructor(readonly code: TravelParticipantErrorCode) { super(code); this.name = "TravelParticipantError"; }
}

/** Canonical identities remain available to historical expenses and settlement. */
export function activeTravelParticipants(ledger: Pick<TravelLedger, "participants" | "inactiveParticipantIds">): readonly Participant[] {
  const inactive = new Set(ledger.inactiveParticipantIds ?? []);
  return Object.freeze(ledger.participants.filter((person) => !inactive.has(person.id)));
}

/** Edits retain their original people, without reintroducing every archived person. */
export function travelExpenseParticipants(ledger: Pick<TravelLedger, "participants" | "inactiveParticipantIds">, expense?: TravelExpense | null): readonly Participant[] {
  const allowed = new Set(activeTravelParticipants(ledger).map((person) => person.id));
  if (expense) { allowed.add(expense.paidBy); for (const share of expense.shares) allowed.add(share.participantId); }
  return Object.freeze(ledger.participants.filter((person) => allowed.has(person.id)));
}

export function participantIsReferenced(ledger: Pick<TravelLedger, "expenses">, participantId: string): boolean {
  return ledger.expenses.some((expense) => expense.paidBy === participantId || expense.shares.some((share) => share.participantId === participantId));
}

function requireManagement(ledger: TravelLedger): void {
  if (ledger.sharedSync && (ledger.sharedSync.trip.ownerUid !== ledger.sharedSync.uid || ledger.sharedSync.trip.deleted)) throw new TravelParticipantError("permission");
  const ids = ledger.inactiveParticipantIds;
  if (ids !== undefined && (!Array.isArray(ids) || new Set(ids).size !== ids.length || ids.some((id) => !ledger.participants.some((person) => person.id === id)))) throw new TravelParticipantError("invalid");
  const removed = ledger.historyRemovedParticipantIds;
  if (removed !== undefined && (!Array.isArray(removed) || new Set(removed).size !== removed.length || removed.some((id) => !ids?.includes(id)))) throw new TravelParticipantError("invalid");
}

function withInactive(ledger: TravelLedger, inactiveParticipantIds: readonly string[]): TravelLedger {
  const { inactiveParticipantIds: _previous, ...remaining } = ledger;
  void _previous;
  return Object.freeze({ ...remaining, ...(inactiveParticipantIds.length ? { inactiveParticipantIds: Object.freeze([...inactiveParticipantIds]) } : {}), updatedAt: new Date().toISOString() });
}

export function addTravelParticipant(ledger: TravelLedger, name: string, locale: Locale = "en"): TravelLedger {
  requireManagement(ledger);
  if (typeof name !== "string" || !name.trim()) throw new TravelParticipantError("required");
  const normalized = name.trim();
  if (normalized.length > 80 || ledger.sharedSync && normalized.includes("|")) throw new TravelParticipantError("invalid");
  // An archived identity is restored explicitly, never duplicated or silently reused.
  if (ledger.participants.some((person) => person.name.localeCompare(normalized, locale, { sensitivity: "accent" }) === 0)) throw new TravelParticipantError("duplicate");
  if (ledger.participants.length >= (ledger.sharedSync ? MAX_SHARED_PARTICIPANTS : MAX_PARTICIPANTS)) throw new TravelParticipantError("limit");
  const participant = Object.freeze({ id: crypto.randomUUID(), name: normalized });
  return Object.freeze({ ...ledger, participants: Object.freeze([...ledger.participants, participant]), selfParticipantId: ledger.selfParticipantId ?? participant.id, updatedAt: new Date().toISOString() });
}

/** Removing never rewrites an existing payer, split, or financial amount.
 * Shared identities are always archived: a companion may hold an offline expense. */
export function removeTravelParticipant(ledger: TravelLedger, participantId: string): TravelLedger {
  requireManagement(ledger);
  if (!ledger.participants.some((person) => person.id === participantId)) throw new TravelParticipantError("not-found");
  if (ledger.historyRemovedParticipantIds?.includes(participantId)) return ledger;
  if (ledger.sharedSync || participantIsReferenced(ledger, participantId)) {
    if (ledger.inactiveParticipantIds?.includes(participantId)) return ledger;
    return withInactive(ledger, [...(ledger.inactiveParticipantIds ?? []), participantId]);
  }
  return withInactive({ ...ledger, participants: Object.freeze(ledger.participants.filter((person) => person.id !== participantId)), selfParticipantId: ledger.selfParticipantId === participantId ? null : ledger.selfParticipantId }, (ledger.inactiveParticipantIds ?? []).filter((id) => id !== participantId));
}

export interface ParticipantHistoryRemovalPreview {
  readonly deletedExpenseCount: number;
  readonly recalculatedExpenseCount: number;
  readonly orphanExpenseCount: number;
  readonly deletedTotals: readonly { readonly currency: string; readonly minorUnits: number }[];
}

/** Preview counts are disjoint: an orphan cannot be recalculated without a user decision. */
export function previewParticipantHistoryRemoval(ledger: TravelLedger, participantId: string): ParticipantHistoryRemovalPreview {
  requireManagement(ledger);
  if (!ledger.participants.some((person) => person.id === participantId)) throw new TravelParticipantError("not-found");
  let deletedExpenseCount = 0; let recalculatedExpenseCount = 0; let orphanExpenseCount = 0;
  const totals = new Map<string, number>();
  for (const expense of ledger.expenses) {
    if (expense.paidBy === participantId) {
      deletedExpenseCount += 1;
      const amount = (totals.get(expense.currency) ?? 0) + expense.minorUnits;
      if (!Number.isSafeInteger(amount)) throw new TravelParticipantError("invalid");
      totals.set(expense.currency, amount); continue;
    }
    if (!expense.shares.some((share) => share.participantId === participantId)) continue;
    if (expense.shares.some((share) => share.participantId !== participantId)) recalculatedExpenseCount += 1;
    else orphanExpenseCount += 1;
  }
  return Object.freeze({ deletedExpenseCount, recalculatedExpenseCount, orphanExpenseCount, deletedTotals: Object.freeze([...totals].sort(([left], [right]) => left.localeCompare(right)).map(([currency, minorUnits]) => Object.freeze({ currency, minorUnits }))) });
}

/** Explicitly erase this person's past settlement, without assigning unrelated people a debt.
 * Only affected expenses are re-split among their remaining original sharers; unrelated
 * expenses retain their exact split. Canonical identity stays archived for sync continuity. */
export function removeTravelParticipantHistory(ledger: TravelLedger, participantId: string): TravelLedger {
  const preview = previewParticipantHistoryRemoval(ledger, participantId);
  if (preview.orphanExpenseCount) throw new TravelParticipantError("no-remaining-sharers");
  const alreadyInactive = ledger.inactiveParticipantIds?.includes(participantId) ?? false;
  if (!preview.deletedExpenseCount && !preview.recalculatedExpenseCount && alreadyInactive && ledger.historyRemovedParticipantIds?.includes(participantId)) return ledger;
  const expenses = ledger.expenses.filter((expense) => expense.paidBy !== participantId).map((expense) => {
    if (!expense.shares.some((share) => share.participantId === participantId)) return expense;
    return Object.freeze({ ...expense, shares: splitEvenly(expense.minorUnits, expense.shares.filter((share) => share.participantId !== participantId).map((share) => share.participantId)) });
  });
  const historyRemovedParticipantIds = Object.freeze([...new Set([...(ledger.historyRemovedParticipantIds ?? []), participantId])]);
  return withInactive({ ...ledger, historyRemovedParticipantIds, expenses: Object.freeze(expenses) }, alreadyInactive ? ledger.inactiveParticipantIds! : [...(ledger.inactiveParticipantIds ?? []), participantId]);
}

export function restoreTravelParticipant(ledger: TravelLedger, participantId: string): TravelLedger {
  requireManagement(ledger);
  if (!ledger.participants.some((person) => person.id === participantId)) throw new TravelParticipantError("not-found");
  if (ledger.historyRemovedParticipantIds?.includes(participantId)) throw new TravelParticipantError("history-removed");
  if (!ledger.inactiveParticipantIds?.includes(participantId)) return ledger;
  return withInactive(ledger, ledger.inactiveParticipantIds.filter((id) => id !== participantId));
}
