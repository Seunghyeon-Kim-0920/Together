import { TRAVEL_CATEGORIES, type Participant, type TravelExpense, type TravelLedger } from "./types";

/** Cloud data is a deliberately small allowlist, never a WalletState serialization. */
export const MAX_SHARED_PARTICIPANTS = 20;
export const MAX_SHARED_EXPENSES = 5_000;
export const MAX_SHARED_DESCRIPTION_LENGTH = 200;
export type SharedTravelErrorCode = "not-configured" | "invalid-data" | "conflict" | "unavailable" | "quota" | "permission-denied" | "not-found" | "limit";
export class SharedTravelError extends Error {
  constructor(readonly code: SharedTravelErrorCode) { super(code); this.name = "SharedTravelError"; }
}
export interface SharedTrip {
  readonly id: string; readonly ownerUid: string; readonly title: string;
  readonly participants: readonly Participant[]; readonly currencies: readonly string[];
  readonly defaultCurrency: string; readonly revision: number; readonly deleted: boolean;
  /** Stable account-to-settlement identity; absent on trips created before 1.8.5. */
  readonly participantMembers?: Readonly<Record<string, string>>;
}
export interface SharedMember { readonly uid: string; readonly displayName: string; readonly role: "owner" | "member"; }
export interface SharedExpenseRecord {
  readonly id: string; readonly authorUid: string; readonly updatedBy: string;
  readonly revision: number; readonly mutationId: string; readonly deleted: boolean;
  readonly expense: TravelExpense | null;
}
export interface SharedTripSnapshot {
  readonly trip: SharedTrip; readonly expenses: readonly SharedExpenseRecord[];
  readonly members: readonly SharedMember[]; readonly fromCache: boolean;
}
export interface SharedExpenseMutation {
  readonly id: string; readonly expense: TravelExpense | null;
  readonly expectedRevision: number; readonly mutationId: string;
}
export interface SharedTravelClient {
  readonly uid: string;
  /** Creates only the trip header. Persist an outbox for approved initial expenses before publishing them. */
  createTrip(ledger: TravelLedger, displayName: string): Promise<{ trip: SharedTrip; created: boolean }>;
  createInvite(tripId: string): Promise<string>;
  revokeInvite(inviteCode: string): Promise<void>;
  joinTrip(inviteCode: string, displayName: string): Promise<{ trip: SharedTrip; joined: boolean }>;
  ensureParticipant(tripId: string, preferredParticipantId?: string | null): Promise<SharedTrip>;
  getSnapshot(tripId: string): Promise<SharedTripSnapshot>;
  listenTrip(tripId: string, onSnapshot: (snapshot: SharedTripSnapshot) => void, onError: (error: SharedTravelError) => void): () => void;
  publishExpense(tripId: string, mutation: SharedExpenseMutation): Promise<SharedExpenseRecord>;
  updateTrip(tripId: string, ledger: TravelLedger, expectedRevision: number): Promise<SharedTrip>;
  revokeMember(tripId: string, memberUid: string): Promise<void>;
  leaveTrip(tripId: string): Promise<void>;
  /** First revokes access, then deletes cloud documents. Retry on failure to complete cleanup. */
  deleteTrip(tripId: string): Promise<void>;
}

function object(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function keys(value: Record<string, unknown>, allowed: readonly string[]): boolean { return Object.keys(value).every((key) => allowed.includes(key)); }
export function sharedId(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(value); }
function nonempty(value: unknown, max: number): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= max; }
function currency(value: unknown): value is string { return typeof value === "string" && /^[A-Z]{3}$/.test(value); }
function revision(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) > 0 && Number(value) < 2_000_000_000; }
function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-")) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function validateSharedExpense(expense: TravelExpense, trip: Pick<SharedTrip, "participants" | "currencies">): void {
  if (!object(expense) || !sharedId(expense.id) || !nonempty(expense.description, MAX_SHARED_DESCRIPTION_LENGTH) || !TRAVEL_CATEGORIES.includes(expense.category) || !currency(expense.currency) || !trip.currencies.includes(expense.currency) || !Number.isSafeInteger(expense.minorUnits) || expense.minorUnits <= 0 || expense.minorUnits > 1_000_000_000_000 || !validDate(expense.occurredOn) || !trip.participants.some((person) => person.id === expense.paidBy) || !Array.isArray(expense.shares) || !expense.shares.length || expense.shares.length > MAX_SHARED_PARTICIPANTS) throw new SharedTravelError("invalid-data");
  let total = 0; const ids = new Set<string>();
  for (const share of expense.shares) {
    if (!object(share) || !sharedId(share.participantId) || typeof share.minorUnits !== "number" || !trip.participants.some((person) => person.id === share.participantId) || ids.has(share.participantId) || !Number.isSafeInteger(share.minorUnits) || share.minorUnits < 0) throw new SharedTravelError("invalid-data");
    ids.add(share.participantId); total += share.minorUnits;
  }
  if (total !== expense.minorUnits) throw new SharedTravelError("invalid-data");
}
export function toSharedTripData(ledger: TravelLedger, ownerUid: string, nextRevision = 1): Record<string, unknown> {
  const data = { schema: 1, ownerUid, title: ledger.title, participantIds: ledger.participants.map((person) => person.id), participantNames: ledger.participants.map((person) => person.name), currencies: [...ledger.currencies], defaultCurrency: ledger.defaultCurrency, revision: nextRevision, deleted: false };
  if (!parseSharedTrip(ledger.id, data)) throw new SharedTravelError("invalid-data");
  return data;
}
export function parseSharedTrip(id: string, value: unknown): SharedTrip | null {
  if (!sharedId(id) || !object(value) || !keys(value, ["schema", "ownerUid", "title", "participantIds", "participantNames", "participantMembers", "currencies", "defaultCurrency", "revision", "deleted", "updatedAt"]) || value.schema !== 1 || !sharedId(value.ownerUid) || !nonempty(value.title, 80) || !revision(value.revision) || typeof value.deleted !== "boolean" || !Array.isArray(value.participantIds) || !Array.isArray(value.participantNames) || value.participantIds.length !== value.participantNames.length || value.participantIds.length > MAX_SHARED_PARTICIPANTS || !value.participantIds.every(sharedId) || new Set(value.participantIds).size !== value.participantIds.length || !value.participantNames.every((name) => nonempty(name, 80)) || !Array.isArray(value.currencies) || !value.currencies.length || value.currencies.length > 20 || !value.currencies.every(currency) || new Set(value.currencies).size !== value.currencies.length || !currency(value.defaultCurrency) || !value.currencies.includes(value.defaultCurrency)) return null;
  const names = value.participantNames as string[];
  // Match the server's bounded list encoding.
  if (!names.length || names.some((name) => name.includes("|"))) return null;
  if (value.participantMembers !== undefined && !validParticipantMembers(value.participantMembers, value.participantIds as string[])) return null;
  return { id, ownerUid: value.ownerUid, title: value.title, participants: value.participantIds.map((participantId, index) => ({ id: participantId as string, name: names[index] })), currencies: value.currencies as string[], defaultCurrency: value.defaultCurrency, revision: value.revision, deleted: value.deleted, ...(value.participantMembers !== undefined ? { participantMembers: { ...value.participantMembers as Record<string, string> } } : {}) };
}

export function validParticipantMembers(value: unknown, participantIds: readonly string[]): value is Record<string, string> {
  if (!object(value)) return false;
  const entries = Object.entries(value);
  return entries.length <= MAX_SHARED_PARTICIPANTS && entries.every(([uid, participantId]) => sharedId(uid) && sharedId(participantId) && participantIds.includes(participantId)) && new Set(Object.values(value)).size === entries.length;
}

/** Called inside a Firestore transaction so simultaneous joins cannot claim the same person. */
export function registerSharedParticipant(trip: SharedTrip, uid: string, displayName: string, preferredParticipantId?: string | null): SharedTrip {
  const name = displayName.trim();
  if (!sharedId(uid) || !nonempty(name, 80) || name.includes("|") || trip.deleted) throw new SharedTravelError("invalid-data");
  if (Object.hasOwn(trip.participantMembers ?? {}, uid)) return trip;
  const claimed = new Set(Object.values(trip.participantMembers ?? {}));
  const preferred = trip.ownerUid === uid ? trip.participants.find((person) => person.id === preferredParticipantId && !claimed.has(person.id)) : undefined;
  // Reuse one exact, unclaimed name; never merge two connected people merely because their names match.
  const matches = trip.participants.filter((person) => person.name === name);
  const existing = preferred ?? (matches.length === 1 && !claimed.has(matches[0].id) ? matches[0] : undefined);
  let participants = trip.participants;
  let participantId = existing?.id;
  if (!participantId) {
    if (participants.length >= MAX_SHARED_PARTICIPANTS) throw new SharedTravelError("limit");
    // Firebase anonymous UIDs fit this prefix; reject custom overlong UIDs rather than truncate identity.
    participantId = `member_${uid}`;
    if (!sharedId(participantId) || participants.some((person) => person.id === participantId)) throw new SharedTravelError("invalid-data");
    participants = [...participants, { id: participantId, name }];
  }
  return { ...trip, participants, participantMembers: { ...trip.participantMembers, [uid]: participantId }, revision: trip.revision + 1 };
}
export function toSharedExpenseData(expense: TravelExpense, trip: SharedTrip, authorUid: string, updatedBy: string, nextRevision: number, mutationId: string): Record<string, unknown> {
  validateSharedExpense(expense, trip);
  if (!sharedId(authorUid) || !sharedId(updatedBy) || !revision(nextRevision) || !sharedId(mutationId)) throw new SharedTravelError("invalid-data");
  return { schema: 1, authorUid, updatedBy, revision: nextRevision, mutationId, deleted: false, description: expense.description, category: expense.category, currency: expense.currency, minorUnits: expense.minorUnits, paidBy: expense.paidBy, participantIds: expense.shares.map((share) => share.participantId), shareMinorUnits: expense.shares.map((share) => share.minorUnits), occurredOn: expense.occurredOn };
}
export function parseSharedExpense(id: string, value: unknown, trip: SharedTrip): SharedExpenseRecord | null {
  if (!sharedId(id) || !object(value) || !keys(value, ["schema", "authorUid", "updatedBy", "revision", "mutationId", "deleted", "description", "category", "currency", "minorUnits", "paidBy", "participantIds", "shareMinorUnits", "occurredOn", "updatedAt"]) || value.schema !== 1 || !sharedId(value.authorUid) || !sharedId(value.updatedBy) || !sharedId(value.mutationId) || !revision(value.revision) || typeof value.deleted !== "boolean") return null;
  const base = { id, authorUid: value.authorUid, updatedBy: value.updatedBy, revision: value.revision, mutationId: value.mutationId, deleted: value.deleted };
  if (value.deleted) return keys(value, ["schema", "authorUid", "updatedBy", "revision", "mutationId", "deleted", "updatedAt"]) ? { ...base, expense: null } : null;
  if (!Array.isArray(value.participantIds) || !Array.isArray(value.shareMinorUnits) || value.participantIds.length !== value.shareMinorUnits.length) return null;
  const amounts = value.shareMinorUnits;
  const expense = { id, description: value.description, category: value.category, currency: value.currency, minorUnits: value.minorUnits, paidBy: value.paidBy, shares: value.participantIds.map((participantId, index) => ({ participantId, minorUnits: amounts[index] })), occurredOn: value.occurredOn } as TravelExpense;
  try { validateSharedExpense(expense, trip); return { ...base, expense }; } catch { return null; }
}
export function parseSharedMember(uid: string, value: unknown): SharedMember | null {
  return sharedId(uid) && object(value) && keys(value, ["schema", "role", "displayName", "inviteToken", "joinedAt"]) && value.schema === 1 && (value.role === "member" || value.role === "owner") && nonempty(value.displayName, 80) ? { uid, displayName: value.displayName, role: value.role } : null;
}
export function normalizeSharedError(error: unknown): SharedTravelError {
  if (error instanceof SharedTravelError) return error;
  const code = object(error) && typeof error.code === "string" ? error.code.replace(/^.*\//, "") : "";
  return new SharedTravelError(code === "resource-exhausted" ? "quota" : code === "permission-denied" || code === "unauthenticated" ? "permission-denied" : code === "not-found" ? "not-found" : "unavailable");
}
