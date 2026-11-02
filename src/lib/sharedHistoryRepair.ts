import { removeParticipantsFromSharedExpense, SharedTravelError, validateSharedExpense, type SharedTrip } from "./sharedTravel";
import type { TravelExpense, TravelLedger } from "./types";
import { splitEvenly } from "./wallet";

/** A remote owner cannot see another device's unsent, single-sharer expense.
 * Keep it intact until that device explicitly chooses replacement sharers. */
export function orphanedPendingHistoryExpenses(ledger: TravelLedger, trip: SharedTrip): readonly TravelExpense[] {
  if (!ledger.sharedSync || ledger.sharedSync.tripId !== trip.id || trip.participantHistoryRemoval) return [];
  return ledger.sharedSync.pending.flatMap((op) => {
    if (!op.expense || trip.historyRemovedParticipantIds?.includes(op.expense.paidBy)) return [];
    try {
      removeParticipantsFromSharedExpense(op.expense, trip.historyRemovedParticipantIds ?? []);
      return [];
    } catch (error) { if (error instanceof SharedTravelError && error.code === "orphan-shares") return [op.expense]; throw error; }
  });
}

export function repairPendingHistoryShares(ledger: TravelLedger, trip: SharedTrip, confirmed: TravelExpense, participantIds: readonly string[]): TravelLedger {
  const sync = ledger.sharedSync;
  const op = sync?.pending.find((entry) => entry.id === confirmed.id);
  if (!sync || sync.tripId !== trip.id || trip.deleted || trip.participantHistoryRemoval || trip.revision < sync.trip.revision || !op?.expense || JSON.stringify(op.expense) !== JSON.stringify(confirmed) || !orphanedPendingHistoryExpenses(ledger, trip).some((entry) => entry.id === confirmed.id)) throw new SharedTravelError("conflict");
  const record = sync.records.find((entry) => entry.id === confirmed.id);
  if (record && record.authorUid !== sync.uid && trip.ownerUid !== sync.uid) throw new SharedTravelError("permission-denied");
  if (participantIds.some((id) => trip.historyRemovedParticipantIds?.includes(id) || !trip.participants.some((person) => person.id === id) || !ledger.participants.some((person) => person.id === id))) throw new SharedTravelError("invalid-data");
  const expense = { ...op.expense, shares: splitEvenly(op.expense.minorUnits, participantIds) };
  validateSharedExpense(expense, trip);
  return { ...ledger, expenses: ledger.expenses.map((entry) => entry.id === expense.id ? expense : entry), sharedSync: { ...sync, pending: sync.pending.map((entry) => entry.id === expense.id ? { ...entry, expense, mutationId: crypto.randomUUID() } : entry) } };
}
