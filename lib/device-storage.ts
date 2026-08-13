import type { Expense } from "./domain.js";
import { parseExpenseLedger, settleExpensesByCurrency } from "./expenses.js";
import { parseRouteSnapshot, type RouteSnapshot } from "./route-snapshot.js";

export const DEVICE_TRIPS_KEY = "together-device-trips-v1";
export const DEVICE_EXPENSES_KEY = "together-device-expenses-v1";
export const DEVICE_PROFILE_KEY = "together-device-profile-v1";
export const MAX_DEVICE_TRIPS = 200;
export const MAX_DEVICE_PARTICIPANTS = 100;
export const MAX_DEVICE_EXPENSES = 1_000;

export type DeviceTrip = {
  readonly id: string;
  readonly name: string;
  readonly payload: RouteSnapshot;
  readonly updatedAt: string;
};

export type DeviceParticipant = {
  readonly id: string;
  readonly name: string;
};

export type DeviceExpenseLedger = {
  readonly version: 1;
  readonly participants: readonly DeviceParticipant[];
  readonly selfParticipantId: string | null;
  readonly expenses: readonly Expense[];
};

/** Share-safe ledger: intentionally excludes profile and selfParticipantId. */
export type SharedExpenseLedger = {
  readonly version: 1;
  readonly participants: readonly DeviceParticipant[];
  readonly expenses: readonly Expense[];
};

export const MAX_SHARED_LEDGER_ENCODED_LENGTH = 24_000;
export const MAX_SHARED_LEDGER_DECODED_BYTES = 500_000;

export function parseSharedExpenseLedger(value: unknown): SharedExpenseLedger | null {
  if (!isRecord(value) || value.version !== 1 || "selfParticipantId" in value || "profile" in value) return null;
  const parsed = parseDeviceExpenseLedger({
    version: 1,
    participants: value.participants,
    selfParticipantId: null,
    expenses: value.expenses,
  });
  if (!Array.isArray(value.participants) || !Array.isArray(value.expenses)) return null;
  if (parsed.participants.length !== value.participants.length || parsed.expenses.length !== value.expenses.length) return null;
  return Object.freeze({
    version: 1,
    participants: parsed.participants,
    expenses: parsed.expenses,
  });
}

export type DeviceProfile = {
  readonly displayName: string;
  readonly ageBand: string;
  readonly smoking: string;
  readonly drinking: string;
  readonly mbti: string;
};

const AGE_BANDS = new Set(["unspecified", "teens", "20s", "30s", "40s", "50s", "60s", "70plus"]);
const PREFERENCES = new Set(["unspecified", "yes", "no"]);
const MBTI_TYPES = new Set(["unspecified", "INTJ", "INTP", "ENTJ", "ENTP", "INFJ", "INFP", "ENFJ", "ENFP", "ISTJ", "ISFJ", "ESTJ", "ESFJ", "ISTP", "ISFP", "ESTP", "ESFP"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, maximum: number, allowEmpty = false): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if ((!allowEmpty && !normalized) || normalized.length > maximum) return null;
  return normalized;
}

function validTimestamp(value: unknown): string | null {
  const timestamp = boundedString(value, 80);
  return timestamp && !Number.isNaN(Date.parse(timestamp)) ? timestamp : null;
}

export function parseDeviceTrips(value: unknown): readonly DeviceTrip[] {
  if (!Array.isArray(value) || value.length > MAX_DEVICE_TRIPS) return [];
  const trips: DeviceTrip[] = [];
  const ids = new Set<string>();
  for (const candidate of value) {
    if (!isRecord(candidate)) return [];
    const id = boundedString(candidate.id, 100);
    const name = boundedString(candidate.name, 100);
    const updatedAt = validTimestamp(candidate.updatedAt);
    const payload = parseRouteSnapshot(candidate.payload);
    if (!id || !name || !updatedAt || !payload || ids.has(id)) return [];
    ids.add(id);
    trips.push(Object.freeze({ id, name, updatedAt, payload }));
  }
  return Object.freeze(trips.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)));
}

export function parseDeviceExpenseLedger(value: unknown): DeviceExpenseLedger {
  const empty: DeviceExpenseLedger = Object.freeze({
    version: 1,
    participants: Object.freeze([]),
    selfParticipantId: null,
    expenses: Object.freeze([]),
  });
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.participants) || value.participants.length > MAX_DEVICE_PARTICIPANTS) return empty;
  const participants: DeviceParticipant[] = [];
  const participantIds = new Set<string>();
  for (const candidate of value.participants) {
    if (!isRecord(candidate)) return empty;
    const id = boundedString(candidate.id, 100);
    const name = boundedString(candidate.name, 80);
    if (!id || !name || participantIds.has(id)) return empty;
    participantIds.add(id);
    participants.push(Object.freeze({ id, name }));
  }
  const ledger = parseExpenseLedger({ version: 1, expenses: value.expenses });
  if (!ledger) return empty;
  if (ledger.expenses.some((expense) => expense.amount.currency !== "EUR")) return empty;
  if (ledger.expenses.some((expense) => !participantIds.has(expense.paidBy) || expense.shares.some((share) => !participantIds.has(share.participantId)))) return empty;
  try {
    settleExpensesByCurrency(ledger.expenses);
  } catch {
    return empty;
  }
  const selfParticipantId = value.selfParticipantId === null
    ? null
    : typeof value.selfParticipantId === "string" && participantIds.has(value.selfParticipantId)
      ? value.selfParticipantId
      : null;
  return Object.freeze({
    version: 1,
    participants: Object.freeze(participants),
    selfParticipantId,
    expenses: ledger.expenses,
  });
}

export function parseDeviceProfile(value: unknown): DeviceProfile {
  const empty = Object.freeze({ displayName: "", ageBand: "unspecified", smoking: "unspecified", drinking: "unspecified", mbti: "unspecified" });
  if (!isRecord(value)) return empty;
  const displayName = boundedString(value.displayName, 80, true);
  if (displayName === null || typeof value.ageBand !== "string" || !AGE_BANDS.has(value.ageBand) || typeof value.smoking !== "string" || !PREFERENCES.has(value.smoking) || typeof value.drinking !== "string" || !PREFERENCES.has(value.drinking) || typeof value.mbti !== "string" || !MBTI_TYPES.has(value.mbti)) return empty;
  return Object.freeze({ displayName, ageBand: value.ageBand, smoking: value.smoking, drinking: value.drinking, mbti: value.mbti });
}

export function readDeviceValue<T>(key: string, parser: (value: unknown) => T, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : parser(JSON.parse(raw));
  } catch {
    return fallback;
  }
}

export function writeDeviceValue(key: string, value: unknown): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
