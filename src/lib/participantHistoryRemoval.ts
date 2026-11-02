import type { TravelLedger, WalletState } from "./types";
import { removeTravelParticipantHistory } from "./travelParticipants";
import { SharedTravelError } from "./sharedTravel";
import { replaceLedger } from "./wallet";

/** A destructive confirmation applies to the exact local snapshot the user saw.
 * Do not use the ordinary delta merge: a concurrently added payer expense could
 * otherwise escape removal, or a newly edited split could be overwritten. */
export function applyConfirmedLocalHistoryRemoval(state: WalletState, confirmed: TravelLedger, participantId: string): WalletState {
  const latest = state.ledgers.find((ledger) => ledger.id === confirmed.id);
  if (latest?.kind !== "travel" || latest.sharedSync || confirmed.sharedSync || JSON.stringify(latest) !== JSON.stringify(confirmed)) throw new SharedTravelError("conflict");
  return replaceLedger(state, removeTravelParticipantHistory(latest, participantId));
}
