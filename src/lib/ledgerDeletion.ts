import { SharedTravelError, type SharedTravelClient } from "./sharedTravel";
import type { Ledger, WalletState } from "./types";

export type LedgerDeletionScope = "device" | "leave" | "everyone";

/** Removing a tab must never replace unrelated ledgers or a new connection. */
export function removeConfirmedLedger(current: WalletState, confirmed: Ledger): WalletState {
  const latest = current.ledgers.find((ledger) => ledger.id === confirmed.id);
  if (!latest) return current;
  const before = confirmed.kind === "travel" ? confirmed.sharedSync : undefined;
  const after = latest.kind === "travel" ? latest.sharedSync : undefined;
  if (latest.kind !== confirmed.kind || before?.tripId !== after?.tripId || before?.uid !== after?.uid) throw new SharedTravelError("conflict");
  const ledgers = Object.freeze(current.ledgers.filter((ledger) => ledger.id !== confirmed.id));
  return Object.freeze({ ...current, ledgers, activeLedgerId: current.activeLedgerId === confirmed.id ? ledgers[0]?.id ?? null : current.activeLedgerId });
}

/** No local deletion on remote failure. Device-only is a separate explicit choice. */
export async function deleteConfirmedLedger(ledger: Ledger, scope: LedgerDeletionScope, loadClient: () => Promise<SharedTravelClient>, removeLocal: () => Promise<void>): Promise<void> {
  const sync = ledger.kind === "travel" ? ledger.sharedSync : undefined;
  if (scope !== "device") {
    if (!sync) throw new SharedTravelError("invalid-data");
    const owner = sync.uid === sync.trip.ownerUid;
    if ((scope === "everyone") !== owner) throw new SharedTravelError("permission-denied");
    const client = await loadClient();
    if (client.uid !== sync.uid) throw new SharedTravelError("permission-denied");
    if (scope === "everyone") await client.deleteTrip(sync.tripId);
    else await client.leaveTrip(sync.tripId);
  }
  await removeLocal();
}
