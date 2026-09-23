import { SharedTravelError, sharedId, validateSharedExpense, type SharedExpenseMutation, type SharedExpenseRecord, type SharedMember, type SharedTrip, type SharedTripSnapshot } from "./sharedTravel";
import type { TravelExpense, TravelLedger, WalletState } from "./types";

/** Private, durably saved in the same SQLite transaction as the visible ledger.
 * Never include this structure in exported PDFs or ledger share files. */
export interface SharedTravelLocalState {
  readonly version: 1;
  readonly tripId: string;
  readonly uid: string;
  readonly trip: SharedTrip;
  readonly records: readonly SharedExpenseRecord[];
  readonly members: readonly SharedMember[];
  readonly pending: readonly (SharedExpenseMutation & { readonly conflict: boolean })[];
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function parseSharedLocal(value: unknown): SharedTravelLocalState | null {
  if (!record(value) || value.version !== 1 || !sharedId(value.tripId) || !sharedId(value.uid) || !record(value.trip)) return null;
  const trip = value.trip as unknown as SharedTrip;
  if (trip.id !== value.tripId || !sharedId(trip.ownerUid) || typeof trip.title !== "string" || !trip.title.trim() || trip.title.length > 80 || !Number.isInteger(trip.revision) || trip.revision < 1 || typeof trip.deleted !== "boolean" || !Array.isArray(trip.participants) || trip.participants.length > 20 || !Array.isArray(trip.currencies) || !trip.currencies.length || trip.currencies.length > 20 || !trip.currencies.every((code) => typeof code === "string" && /^[A-Z]{3}$/.test(code)) || new Set(trip.currencies).size !== trip.currencies.length || !trip.currencies.includes(trip.defaultCurrency)) return null;
  if (!trip.participants.every((p) => record(p) && sharedId(p.id) && typeof p.name === "string" && p.name.trim() && p.name.length <= 80) || new Set(trip.participants.map((p) => p.id)).size !== trip.participants.length) return null;
  if (!Array.isArray(value.records) || value.records.length > 5000 || !Array.isArray(value.pending) || value.pending.length > 5000 || !Array.isArray(value.members) || value.members.length > 100) return null;
  const records: SharedExpenseRecord[] = []; const recordIds = new Set<string>();
  for (const r of value.records) {
    if (!record(r) || !sharedId(r.id) || recordIds.has(r.id) || !sharedId(r.authorUid) || !sharedId(r.updatedBy) || !sharedId(r.mutationId) || !Number.isSafeInteger(r.revision) || Number(r.revision) < 1 || typeof r.deleted !== "boolean" || r.deleted !== (r.expense === null)) return null;
    try { if (r.expense !== null) { validateSharedExpense(r.expense as TravelExpense, trip); if ((r.expense as TravelExpense).id !== r.id) return null; } } catch { return null; }
    records.push({ id: r.id, authorUid: r.authorUid, updatedBy: r.updatedBy, mutationId: r.mutationId, revision: Number(r.revision), deleted: r.deleted, expense: r.expense as TravelExpense | null }); recordIds.add(r.id);
  }
  const pending: SharedTravelLocalState["pending"][number][] = []; const pendingIds = new Set<string>();
  for (const op of value.pending) {
    if (!record(op) || !sharedId(op.id) || pendingIds.has(op.id) || !sharedId(op.mutationId) || !Number.isSafeInteger(op.expectedRevision) || Number(op.expectedRevision) < 0 || typeof op.conflict !== "boolean") return null;
    try { if (op.expense !== null) { validateSharedExpense(op.expense as TravelExpense, trip); if ((op.expense as TravelExpense).id !== op.id) return null; } } catch { return null; }
    pending.push({ id: op.id, mutationId: op.mutationId, expectedRevision: Number(op.expectedRevision), expense: op.expense as TravelExpense | null, conflict: op.conflict }); pendingIds.add(op.id);
  }
  const members: SharedMember[] = []; const memberIds = new Set<string>();
  for (const m of value.members) {
    if (!record(m) || !sharedId(m.uid) || memberIds.has(m.uid) || typeof m.displayName !== "string" || !m.displayName.trim() || m.displayName.length > 80 || (m.role !== "member" && m.role !== "owner")) return null;
    members.push({ uid: m.uid, displayName: m.displayName, role: m.role }); memberIds.add(m.uid);
  }
  return { version: 1, tripId: value.tripId, uid: value.uid, trip: { id: trip.id, ownerUid: trip.ownerUid, title: trip.title, participants: trip.participants.map((p) => ({ id: p.id, name: p.name })), currencies: [...trip.currencies], defaultCurrency: trip.defaultCurrency, revision: trip.revision, deleted: trip.deleted }, records, pending, members };
}

export function connectSharedLedger(ledger: TravelLedger, trip: SharedTrip, uid: string, snapshot?: SharedTripSnapshot): TravelLedger {
  if (ledger.sharedSync || trip.deleted || !sharedId(uid) || snapshot && (snapshot.trip.id !== trip.id || snapshot.trip.deleted || snapshot.fromCache)) throw new SharedTravelError("invalid-data");
  const pending = snapshot ? [] : ledger.expenses.map((expense) => {
    validateSharedExpense(expense, trip);
    return { id: expense.id, expense, expectedRevision: 0, mutationId: crypto.randomUUID(), conflict: false };
  });
  const sync: SharedTravelLocalState = { version: 1, tripId: trip.id, uid, trip, records: snapshot?.expenses ?? [], members: snapshot?.members ?? [], pending };
  if (!parseSharedLocal(sync)) throw new SharedTravelError("invalid-data");
  return { ...ledger, title: trip.title, participants: trip.participants, currencies: trip.currencies, defaultCurrency: trip.defaultCurrency,
    selfParticipantId: trip.participants.some((p) => p.id === ledger.selfParticipantId) ? ledger.selfParticipantId : null,
    expenses: snapshot ? snapshot.expenses.flatMap((r) => r.expense ? [r.expense] : []) : ledger.expenses, sharedSync: sync, updatedAt: new Date().toISOString() };
}

/** Runs for LOCAL mutations only. Incoming sync/ack writes bypass this function. */
export function queueSharedWalletChanges(before: WalletState, desired: WalletState): WalletState {
  const ledgers = desired.ledgers.map((ledger) => {
    const base = before.ledgers.find((item) => item.id === ledger.id);
    if (ledger.kind !== "travel" || base?.kind !== "travel" || !base.sharedSync) return ledger;
    const sync = base.sharedSync;
    if (!same(base.participants, ledger.participants) || !same(base.currencies, ledger.currencies) || base.defaultCurrency !== ledger.defaultCurrency || base.title !== ledger.title) throw new SharedTravelError("permission-denied");
    const pending = new Map(sync.pending.map((op) => [op.id, op]));
    const oldExpenses = new Map(base.expenses.map((expense) => [expense.id, expense]));
    const desiredExpenses = new Map(ledger.expenses.map((expense) => [expense.id, expense]));
    const remote = new Map(sync.records.map((r) => [r.id, r]));
    for (const id of new Set([...oldExpenses.keys(), ...desiredExpenses.keys()])) {
      const expense = desiredExpenses.get(id) ?? null;
      if (same(oldExpenses.get(id) ?? null, expense)) continue;
      const r = remote.get(id);
      if (sync.trip.deleted || r && r.authorUid !== sync.uid && sync.trip.ownerUid !== sync.uid) throw new SharedTravelError("permission-denied");
      if (expense) validateSharedExpense(expense, sync.trip);
      // Keep an explicit delete even before its first upload: an in-flight
      // creation may succeed after the user deletes it locally.
      pending.set(id, { id, expense, expectedRevision: pending.get(id)?.expectedRevision ?? r?.revision ?? 0, mutationId: crypto.randomUUID(), conflict: pending.get(id)?.conflict ?? false });
    }
    return { ...ledger, sharedSync: { ...sync, pending: [...pending.values()] } };
  });
  // Deleting a tab must not silently leave a cloud membership/unsent queue.
  if (before.ledgers.some((l) => l.kind === "travel" && l.sharedSync && !desired.ledgers.some((d) => d.id === l.id))) throw new SharedTravelError("permission-denied");
  return { ...desired, ledgers };
}

/** Remote updates never replace a pending local edit. A differing revision
 * becomes a visible conflict, not last-write-wins. */
export function receiveSharedSnapshot(ledger: TravelLedger, snapshot: SharedTripSnapshot): TravelLedger {
  const sync = ledger.sharedSync;
  if (!sync || sync.tripId !== snapshot.trip.id || snapshot.fromCache) return ledger;
  if (!same(sync.trip.participants, snapshot.trip.participants) || !same(sync.trip.currencies, snapshot.trip.currencies)) throw new SharedTravelError("invalid-data");
  const records = new Map(sync.records.map((r) => [r.id, r]));
  for (const r of snapshot.expenses) if ((records.get(r.id)?.revision ?? 0) <= r.revision) records.set(r.id, r);
  const pending = new Map(sync.pending.map((op) => [op.id, op]));
  const expenses = new Map(ledger.expenses.map((expense) => [expense.id, expense]));
  for (const r of records.values()) {
    const op = pending.get(r.id);
    if (op && op.mutationId === r.mutationId) pending.delete(r.id);
    else if (op) { if (r.revision > op.expectedRevision) pending.set(r.id, { ...op, conflict: true }); continue; }
    if (r.expense) expenses.set(r.id, r.expense); else expenses.delete(r.id);
  }
  const next = { ...ledger, expenses: [...expenses.values()], sharedSync: { ...sync, trip: snapshot.trip.revision >= sync.trip.revision ? snapshot.trip : sync.trip, members: snapshot.members, records: [...records.values()], pending: [...pending.values()] } };
  return same(next, ledger) ? ledger : next;
}

export function acknowledgeSharedMutation(ledger: TravelLedger, sent: SharedExpenseMutation, result: SharedExpenseRecord): TravelLedger {
  const sync = ledger.sharedSync;
  if (!sync || sent.id !== result.id || result.mutationId !== sent.mutationId) throw new SharedTravelError("invalid-data");
  const known = sync.records.find((r) => r.id === result.id);
  const newer = known && known.revision > result.revision;
  const pending = sync.pending.flatMap((op) => op.id !== sent.id ? [op] : op.mutationId === sent.mutationId && !newer ? [] : [{ ...op, expectedRevision: Math.max(op.expectedRevision, result.revision), conflict: Boolean(newer) || op.conflict && op.expectedRevision > result.revision }]);
  const records = newer ? sync.records : [...sync.records.filter((r) => r.id !== result.id), result];
  // The visible expense may already contain a newer local edit. Do not replace it.
  return { ...ledger, sharedSync: { ...sync, pending, records } };
}

export function resolveSharedConflict(ledger: TravelLedger, id: string, keepLocal: boolean): TravelLedger {
  const sync = ledger.sharedSync; const op = sync?.pending.find((p) => p.id === id); const r = sync?.records.find((item) => item.id === id);
  if (!sync || !op?.conflict || !r) throw new SharedTravelError("conflict");
  if (keepLocal && (sync.trip.deleted || r.authorUid !== sync.uid && sync.trip.ownerUid !== sync.uid)) throw new SharedTravelError("permission-denied");
  const pending = sync.pending.flatMap((p) => p.id !== id ? [p] : keepLocal ? [{ ...p, expectedRevision: r.revision, mutationId: crypto.randomUUID(), conflict: false }] : []);
  return { ...ledger, expenses: keepLocal ? ledger.expenses : [...ledger.expenses.filter((expense) => expense.id !== id), ...(r.expense ? [r.expense] : [])], sharedSync: { ...sync, pending } };
}

export function disconnectSharedLedger(ledger: TravelLedger): TravelLedger {
  const { sharedSync: _privateSync, ...local } = ledger;
  void _privateSync;
  return { ...local, updatedAt: new Date().toISOString() };
}
