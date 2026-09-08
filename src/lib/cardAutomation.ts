import { monthKey, monthTotal } from "./statistics";
import type { AutomationSource, GeneralCategory, GeneralExpense, GeneralLedger, Locale, WalletState } from "./types";
import { MAX_EXPENSES_PER_LEDGER } from "./wallet";

const MAX_NATIVE_EVENTS = 5_000;
const DATE_PREFIX = /^\d{4}-\d{2}-\d{2}/;
const PACKAGE_NAME = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/;

export type CardCandidateConfidence = "high" | "review";
export type CardCandidateEventType = "purchase" | "outgoing_transfer" | "direct_debit" | "standing_order" | "reversal";

const CARD_CANDIDATE_EVENT_TYPES: readonly CardCandidateEventType[] = Object.freeze([
  "purchase",
  "outgoing_transfer",
  "direct_debit",
  "standing_order",
  "reversal",
]);

export interface NativeCardCandidate {
  readonly id: string;
  /** Changes whenever a queued event with the same stable id changes content. */
  readonly queueToken: string | null;
  readonly packageName: string;
  readonly sourceName: string;
  readonly merchant: string;
  readonly minorUnits: number;
  readonly currency: string;
  readonly occurredAt: string;
  readonly occurredOn: string;
  readonly confidence: CardCandidateConfidence;
  readonly eventType: CardCandidateEventType;
  /** Messaging, email, browser, and social aggregators must always be reviewed. */
  readonly manualOnly: boolean;
  /** A payment amount was detected but a merchant must be supplied by the user. */
  readonly requiresMerchant?: boolean;
  /** A reused native notification identity now carries different content. */
  readonly identityConflict?: boolean;
}

export interface ParsedCandidateBatch {
  readonly candidates: readonly NativeCardCandidate[];
  readonly rejectedIds: readonly string[];
  readonly rejectedAcknowledgements: readonly NativeEventAcknowledgement[];
}

export interface NativeEventAcknowledgement {
  readonly id: string;
  readonly queueToken: string | null;
}

export interface AutomationBatchResult {
  readonly state: WalletState;
  readonly acknowledgedIds: readonly string[];
  readonly insertedIds: readonly string[];
  readonly reversedIds: readonly string[];
  readonly pending: readonly NativeCardCandidate[];
}

export interface MonthlyLimitStatus {
  readonly state: "unset" | "under" | "near" | "reached" | "over";
  readonly spentMinor: number;
  readonly limitMinor: number | null;
  readonly remainingMinor: number | null;
  readonly percent: number | null;
}

export interface NativeAutomationConfiguration {
  readonly ledgers: readonly { readonly ledgerId: string; readonly title: string; readonly currency: string; readonly monthlyLimitMinor: number | null; readonly spentMinor: number; readonly locale: Locale; readonly automationAllApps: boolean }[];
  readonly sources: readonly { readonly packageName: string; readonly ledgerId: string; readonly currency: string }[];
  readonly detectAllApps: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function boundedText(value: unknown, maximum: number): string | null { const normalized = typeof value === "string" ? value.trim() : ""; return normalized && normalized.length <= maximum ? normalized : null; }
function validTimestamp(value: unknown): string | null {
  const timestamp = boundedText(value, 80); const datePart = timestamp?.match(DATE_PREFIX)?.[0];
  if (!timestamp || !datePart || !/^\d{4}-\d{2}-\d{2}T/.test(timestamp) || Number.isNaN(Date.parse(timestamp))) return null;
  return new Date(`${datePart}T00:00:00Z`).toISOString().slice(0, 10) === datePart ? timestamp : null;
}
function validCalendarDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}
function localCalendarDate(timestamp: string): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function parseNativeCardCandidate(value: unknown): NativeCardCandidate | null {
  if (!isRecord(value)) return null;
  const requiresMerchant = value.requiresMerchant === undefined ? false : value.requiresMerchant;
  const id = boundedText(value.id, 200); const packageName = boundedText(value.packageName, 200); const sourceName = boundedText(value.sourceName, 80); const merchant = requiresMerchant === true && value.merchant === "" ? "" : boundedText(value.merchant, 500); const occurredAt = validTimestamp(value.occurredAt); const currency = typeof value.currency === "string" ? value.currency.trim().toUpperCase() : "";
  // Older native queue entries did not have a content token. Keep those
  // readable while still rejecting malformed non-null tokens.
  const queueToken = value.queueToken === undefined || value.queueToken === null ? null : boundedText(value.queueToken, 200);
  const eventType = value.eventType === undefined ? "purchase" : value.eventType;
  const manualOnly = value.manualOnly === undefined ? false : value.manualOnly;
  if (!id || (value.queueToken !== undefined && value.queueToken !== null && !queueToken) || !packageName || !PACKAGE_NAME.test(packageName) || !sourceName || merchant === null || !occurredAt || !Number.isSafeInteger(value.minorUnits) || (value.minorUnits as number) <= 0 || !/^[A-Z]{3}$/.test(currency) || (value.confidence !== "high" && value.confidence !== "review") || !CARD_CANDIDATE_EVENT_TYPES.includes(eventType as CardCandidateEventType) || typeof manualOnly !== "boolean" || typeof requiresMerchant !== "boolean") return null;
  const occurredOn = value.occurredOn === undefined ? localCalendarDate(occurredAt) : validCalendarDate(value.occurredOn);
  if (!occurredOn) return null;
  return Object.freeze({ id, queueToken, packageName, sourceName, merchant, minorUnits: value.minorUnits as number, currency, occurredAt, occurredOn, confidence: requiresMerchant ? "review" : value.confidence, eventType: eventType as CardCandidateEventType, manualOnly, ...(requiresMerchant ? { requiresMerchant: true } : {}) });
}

export function completeCandidateMerchant(candidate: NativeCardCandidate, merchant: string): NativeCardCandidate {
  const value = boundedText(merchant, 100);
  if (!value) throw new Error("merchant required");
  // Retain the native id/content token so confirmation acknowledges the
  // original notification, not a synthetic event created by editing a draft.
  const completed = Object.freeze({ ...candidate, merchant: value, requiresMerchant: false, confidence: "review" as const });
  completedDraftOrigins.set(completed, automationOriginFingerprint(candidate));
  return completed;
}

export function visibleCardCandidates(ledgers: WalletState["ledgers"], activeLedgerId: string | null, candidates: readonly NativeCardCandidate[]): readonly NativeCardCandidate[] {
  const active = ledgers.find((ledger) => ledger.id === activeLedgerId);
  if (!active || active.kind !== "general") return Object.freeze([]);
  return Object.freeze(candidates.filter((candidate) => {
    const owners = candidateOwnerLedgerIds(ledgers, candidate);
    // Foreign-currency items remain visible with a blocking explanation. Never
    // convert their money or silently hide an unresolved bank notification.
    return candidate.currency !== active.currency || owners.length === 0 || owners.includes(active.id);
  }));
}

export function parseNativeCandidateBatch(value: unknown): ParsedCandidateBatch {
  const rawEvents = isRecord(value) && Array.isArray(value.events) ? value.events.slice(0, MAX_NATIVE_EVENTS) : [];
  const candidates: NativeCardCandidate[] = []; const rejectedIds = new Set<string>(); const rejectedAcknowledgements = new Map<string, NativeEventAcknowledgement>(); const stableKeys = new Set<string>();
  for (const raw of rawEvents) {
    const candidate = parseNativeCardCandidate(raw);
    if (!candidate) {
      if (isRecord(raw)) {
        const id = boundedText(raw.id, 200);
        const rawToken = raw.queueToken === undefined || raw.queueToken === null ? null : boundedText(raw.queueToken, 200);
        if (id && (raw.queueToken === undefined || raw.queueToken === null || rawToken)) {
          rejectedIds.add(id);
          const acknowledgement = Object.freeze({ id, queueToken: rawToken });
          rejectedAcknowledgements.set(`${id}\u0000${rawToken ?? ""}`, acknowledgement);
        }
      }
      continue;
    }
    const stableKey = `${candidate.packageName}\u0000${candidate.id}`;
    if (stableKeys.has(stableKey)) continue;
    stableKeys.add(stableKey); candidates.push(candidate);
  }
  return Object.freeze({ candidates: Object.freeze(candidates), rejectedIds: Object.freeze([...rejectedIds]), rejectedAcknowledgements: Object.freeze([...rejectedAcknowledgements.values()]) });
}

export function candidateAcknowledgement(candidate: Pick<NativeCardCandidate, "id" | "queueToken">): NativeEventAcknowledgement {
  return Object.freeze({ id: candidate.id, queueToken: candidate.queueToken });
}

export function automationExpenseId(candidate: Pick<NativeCardCandidate, "id" | "packageName">): string {
  return `card-auto-${shortFingerprint(`${candidate.packageName}\u0000${candidate.id}`)}`;
}

function automationRevisionExpenseId(candidate: NativeCardCandidate): string {
  // A queue token is the native content revision. Legacy candidates without a
  // token fall back to their content fingerprint, while retaining a separate
  // domain from the original stable notification id.
  const revision = candidate.queueToken ?? automationOriginFingerprint(candidate);
  return `card-auto-${shortFingerprint(`${candidate.packageName}\u0000${candidate.id}\u0000revision\u0000${revision}`)}`;
}

function shortFingerprint(value: string): string {
  let left = 0x811c9dc5; let right = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) { const code = value.charCodeAt(index); left = Math.imul(left ^ code, 0x01000193); right = Math.imul(right ^ code, 0x85ebca6b); right ^= right >>> 13; }
  return `${(left >>> 0).toString(16).padStart(8, "0")}${(right >>> 0).toString(16).padStart(8, "0")}`;
}

const CATEGORY_RULES: readonly [GeneralCategory, RegExp][] = [
  ["transport", /\b(?:uber|bolt|taxi|sncf|ratp|train|metro|bus|tram|parking|fuel|essence|shell|totalenergies)\b/iu],
  ["food", /\b(?:lidl|carrefour|auchan|monoprix|restaurant|cafe|café|coffee|starbucks|kfc|burger|mcdonald|market|supermarch|grocery|boulanger)\b/iu],
  ["housing", /\b(?:rent|loyer|residence|résidence|landlord)\b/iu],
  ["utilities", /\b(?:electric|électric|energy|energie|énergie|water|eau|internet|mobile|telecom|télécom)\b/iu],
  ["health", /\b(?:pharmacy|pharmacie|doctor|médecin|hospital|hôpital|dentist|dentiste)\b/iu],
  ["subscriptions", /\b(?:spotify|netflix|youtube|subscription|abonnement|icloud)\b/iu],
  ["travel", /\b(?:hotel|hôtel|airbnb|airline|booking|hostel|aéroport|airport)\b/iu],
  ["education", /\b(?:school|école|university|université|course|formation)\b/iu],
  ["leisure", /\b(?:cinema|cinéma|theatre|théâtre|museum|musée|concert|game)\b/iu],
  ["shopping", /\b(?:amazon|ikea|zara|uniqlo|decathlon|action|store|shop)\b/iu],
];

export function inferGeneralCategory(merchant: string): GeneralCategory {
  for (const [category, pattern] of CATEGORY_RULES) if (pattern.test(merchant)) return category;
  return "other";
}

function merchantFingerprint(value: string): string { return value.normalize("NFKD").toLocaleLowerCase("en").replace(/[\p{Diacritic}\p{Punctuation}\p{Separator}]+/gu, ""); }
function candidateDate(candidate: NativeCardCandidate): string { return candidate.occurredOn; }
const completedDraftOrigins = new WeakMap<NativeCardCandidate, string>();
export function automationOriginFingerprint(candidate: NativeCardCandidate): string {
  // Deliberately excludes the app package: the same physical card payment can
  // be announced by both a wallet and a card-provider app.
  return `card-origin-${shortFingerprint([candidate.currency, candidate.minorUnits, candidate.occurredOn, merchantFingerprint(candidate.merchant)].join("\u0000"))}`;
}
export function automationReversalFingerprint(candidate: Pick<NativeCardCandidate, "packageName" | "currency" | "minorUnits" | "merchant">): string {
  return `card-reversal-${shortFingerprint([candidate.packageName, candidate.currency, candidate.minorUnits, merchantFingerprint(candidate.merchant)].join("\u0000"))}`;
}
function likelyExistingExpense(expenses: readonly GeneralExpense[], candidate: NativeCardCandidate): boolean {
  const merchant = merchantFingerprint(candidate.merchant); const occurredOn = candidateDate(candidate);
  const origin = automationOriginFingerprint(candidate);
  return expenses.some((expense) => expense.automationFingerprint === origin || (expense.currency === candidate.currency && expense.minorUnits === candidate.minorUnits && expense.occurredOn === occurredOn && merchantFingerprint(expense.description) === merchant));
}

function candidateExpense(candidate: NativeCardCandidate, id = automationExpenseId(candidate)): GeneralExpense {
  const category = candidate.eventType === "outgoing_transfer" ? "other" : inferGeneralCategory(candidate.merchant);
  // When a user supplies a missing merchant, retain the fingerprint of the
  // original native draft. A replay of that unchanged alert must remain an
  // idempotent acknowledgement rather than looking like a changed identity.
  const automationFingerprint = completedDraftOrigins.get(candidate) ?? automationOriginFingerprint(candidate);
  return Object.freeze({ id, description: candidate.merchant, category, currency: candidate.currency, minorUnits: candidate.minorUnits, occurredOn: candidateDate(candidate), automationFingerprint, automationReversalFingerprint: automationReversalFingerprint(candidate) });
}

type RecordedIdentity = "none" | "same" | "conflict";

function recordedIdentity(expensesById: ReadonlyMap<string, readonly GeneralExpense[]>, expenseId: string, origin: string): RecordedIdentity {
  const matches = expensesById.get(expenseId);
  if (!matches?.length) return "none";
  return matches.every((expense) => expense.automationFingerprint === origin) ? "same" : "conflict";
}

function identityConflictCandidate(candidate: NativeCardCandidate): NativeCardCandidate {
  return Object.freeze({ ...candidate, confidence: "review", identityConflict: true });
}

export function candidateOwnerLedgerIds(ledgers: readonly WalletState["ledgers"][number][], candidate: NativeCardCandidate): readonly string[] {
  const eligible = ledgers.filter((ledger): ledger is GeneralLedger => ledger.kind === "general" && ledger.currency === candidate.currency);
  const explicit = eligible.filter((ledger) => ledger.automationSources.some((source) => source.packageName === candidate.packageName));
  // An exact user assignment always wins over broad discovery. Otherwise a
  // same-currency discovery ledger could make an already trusted source look
  // ambiguous and silently stop its automatic records.
  const owners = explicit.length ? explicit : eligible.filter((ledger) => ledger.automationAllApps);
  return Object.freeze(owners.map((ledger) => ledger.id));
}

function ownerIndexes(ledgers: readonly WalletState["ledgers"][number][], candidate: NativeCardCandidate): number[] {
  const ownerIds = new Set(candidateOwnerLedgerIds(ledgers, candidate));
  return ledgers.flatMap((ledger, index) => ownerIds.has(ledger.id) ? [index] : []);
}

function isAutomatedExpense(expense: GeneralExpense): boolean {
  return Boolean(expense.automationFingerprint || expense.id.startsWith("card-auto-"));
}

function appendReversalIds(existing: readonly string[], additions: readonly string[]): readonly string[] {
  const uniqueAdditions = [...new Set(additions)];
  const additionSet = new Set(uniqueAdditions);
  const combined = [...existing.filter((id) => !additionSet.has(id)), ...uniqueAdditions];
  return Object.freeze(combined.slice(-MAX_EXPENSES_PER_LEDGER));
}

export function reversalMatchIndexes(expenses: readonly GeneralExpense[], candidate: NativeCardCandidate): readonly number[] {
  if (candidate.eventType !== "reversal") return Object.freeze([]);
  const fingerprint = automationReversalFingerprint(candidate);
  return Object.freeze(expenses.flatMap((expense, index) => isAutomatedExpense(expense) && expense.occurredOn <= candidate.occurredOn && expense.automationReversalFingerprint === fingerprint ? [index] : []));
}

export function applyHighConfidenceCardAutomation(state: WalletState, candidates: readonly NativeCardCandidate[]): AutomationBatchResult {
  const ledgers = [...state.ledgers]; const acknowledgedIds = new Set<string>(); const insertedIds: string[] = []; const reversedIds: string[] = []; const pending: NativeCardCandidate[] = [];
  const globallyRecorded = new Map<string, GeneralExpense[]>();
  for (const ledger of state.ledgers) if (ledger.kind === "general") for (const expense of ledger.expenses) {
    const matches = globallyRecorded.get(expense.id) ?? [];
    matches.push(expense); globallyRecorded.set(expense.id, matches);
  }
  const movedExpenseIds = new Set(state.ledgers.flatMap((ledger) => ledger.kind === "general" ? ledger.movedExpenseIds ?? [] : []));
  const appliedReversals = new Set(state.ledgers.flatMap((ledger) => ledger.kind === "general" ? ledger.automationReversalIds : []));
  // Purchases are processed before reversals regardless of notification order,
  // so a delayed or out-of-order cancellation wins within the same batch.
  const orderedCandidates = [...candidates].sort((left, right) => Number(left.eventType === "reversal") - Number(right.eventType === "reversal"));
  for (const candidate of orderedCandidates) {
    const expenseId = automationExpenseId(candidate);
    const origin = automationOriginFingerprint(candidate);
    if (candidate.eventType !== "reversal") {
      const revisionId = automationRevisionExpenseId(candidate);
      const revisionIdentity = recordedIdentity(globallyRecorded, revisionId, origin);
      if (revisionIdentity === "same" || movedExpenseIds.has(revisionId) && movedExpenseIds.has(origin) || appliedReversals.has(revisionId) && appliedReversals.has(origin)) {
        acknowledgedIds.add(candidate.id); continue;
      }
      if (revisionIdentity === "conflict" || movedExpenseIds.has(revisionId) || appliedReversals.has(revisionId)) {
        pending.push(identityConflictCandidate(candidate)); continue;
      }
    }
    if (candidate.eventType !== "reversal" && movedExpenseIds.has(expenseId)) {
      if (movedExpenseIds.has(origin)) acknowledgedIds.add(candidate.id);
      else pending.push(identityConflictCandidate(candidate));
      continue;
    }
    // A moved expense now belongs to a shared trip. Never cancel a different
    // general-ledger expense merely because merchant and amount match it.
    if (candidate.eventType === "reversal" && (movedExpenseIds.has(expenseId) || movedExpenseIds.has(automationReversalFingerprint(candidate)))) {
      pending.push(Object.freeze({ ...candidate, confidence: "review" })); continue;
    }
    // A cancellation tombstones both its own event and the removed purchase.
    // This prevents a stale purchase notification from recreating the charge.
    if (candidate.eventType !== "reversal" && appliedReversals.has(expenseId)) {
      if (appliedReversals.has(origin)) acknowledgedIds.add(candidate.id);
      else pending.push(identityConflictCandidate(candidate));
      continue;
    }
    if (candidate.eventType !== "reversal") {
      const identity = recordedIdentity(globallyRecorded, expenseId, origin);
      if (identity === "same") { acknowledgedIds.add(candidate.id); continue; }
      if (identity === "conflict") { pending.push(identityConflictCandidate(candidate)); continue; }
    }
    const owners = ownerIndexes(ledgers, candidate);
    if (candidate.manualOnly || candidate.requiresMerchant) { pending.push(candidate.confidence === "review" ? candidate : Object.freeze({ ...candidate, confidence: "review" })); continue; }
    if (candidate.confidence !== "high" || owners.length !== 1) { pending.push(candidate); continue; }
    const index = owners[0]; const ledger = ledgers[index];
    if (ledger.kind !== "general") { pending.push(candidate); continue; }
    if (!ledger.automationSources.some((source) => source.packageName === candidate.packageName)) {
      pending.push(Object.freeze({ ...candidate, confidence: "review" }));
      continue;
    }
    if (candidate.eventType === "reversal") {
      const matches = reversalMatchIndexes(ledger.expenses, candidate);
      const reversalFingerprint = automationReversalFingerprint(candidate);
      // Some providers repost an old cancellation under a fresh notification
      // id. If another identical purchase happened later, automatically using
      // only merchant + amount would delete the wrong charge. Repeated
      // semantics therefore require an explicit review whenever a match exists.
      if (appliedReversals.has(reversalFingerprint)) {
        if (matches.length === 0) acknowledgedIds.add(candidate.id);
        else pending.push(Object.freeze({ ...candidate, confidence: "review" }));
        continue;
      }
      // Merchant and amount alone are never enough for an automatic delete.
      // Only an updated notification with the same stable event id may remove
      // its purchase. Other unique matches remain available for user review.
      const exactMatches = matches.filter((expenseIndex) => ledger.expenses[expenseIndex].id === expenseId);
      if (exactMatches.length !== 1) { pending.push(Object.freeze({ ...candidate, confidence: "review" })); continue; }
      const removed = ledger.expenses[exactMatches[0]];
      const automationReversalIds = appendReversalIds(ledger.automationReversalIds, [removed.id, expenseId, reversalFingerprint, ...(removed.automationFingerprint ? [removed.automationFingerprint] : [])]);
      ledgers[index] = Object.freeze({ ...ledger, automationReversalIds, expenses: Object.freeze(ledger.expenses.filter((_, expenseIndex) => expenseIndex !== exactMatches[0])), updatedAt: new Date().toISOString() });
      globallyRecorded.delete(removed.id); for (const id of automationReversalIds) appliedReversals.add(id); reversedIds.push(candidate.id); acknowledgedIds.add(candidate.id);
      continue;
    }
    if (ledger.expenses.length >= MAX_EXPENSES_PER_LEDGER) { pending.push(candidate); continue; }
    // A same-day purchase for the same amount at the same merchant can be a
    // legitimate second purchase. Keep fuzzy matches for explicit review and
    // only acknowledge deterministic native IDs automatically.
    if (movedExpenseIds.has(automationOriginFingerprint(candidate)) || likelyExistingExpense(ledger.expenses, candidate)) { pending.push(Object.freeze({ ...candidate, confidence: "review" })); continue; }
    const expense = candidateExpense(candidate); globallyRecorded.set(expense.id, [expense]); insertedIds.push(candidate.id); acknowledgedIds.add(candidate.id);
    ledgers[index] = Object.freeze({ ...ledger, expenses: Object.freeze([...ledger.expenses, expense]), updatedAt: new Date().toISOString() });
  }
  const nextState = insertedIds.length || reversedIds.length ? Object.freeze({ ...state, ledgers: Object.freeze(ledgers) }) : state;
  return Object.freeze({ state: nextState, acknowledgedIds: Object.freeze([...acknowledgedIds]), insertedIds: Object.freeze(insertedIds), reversedIds: Object.freeze(reversedIds), pending: Object.freeze(pending) });
}

export function confirmCardCandidate(state: WalletState, ledgerId: string, candidate: NativeCardCandidate, options: { readonly asNewTransaction?: boolean } = {}): { readonly state: WalletState; readonly inserted: boolean; readonly reversed: boolean } {
  if (candidate.requiresMerchant || !parseNativeCardCandidate(candidate)) throw new Error("incomplete candidate");
  const index = state.ledgers.findIndex((ledger) => ledger.id === ledgerId); const ledger = state.ledgers[index];
  if (!ledger || ledger.kind !== "general" || ledger.currency !== candidate.currency) throw new Error("incompatible candidate");
  const expenseId = automationExpenseId(candidate);
  const movedExpenseIds = new Set(state.ledgers.flatMap((item) => item.kind === "general" ? item.movedExpenseIds ?? [] : []));
  const appliedReversals = new Set(state.ledgers.flatMap((item) => item.kind === "general" ? item.automationReversalIds : []));
  const recorded = new Map<string, GeneralExpense[]>();
  for (const item of state.ledgers) if (item.kind === "general") for (const expense of item.expenses) {
    const matches = recorded.get(expense.id) ?? [];
    matches.push(expense); recorded.set(expense.id, matches);
  }
  if (candidate.eventType === "reversal") {
    if (options.asNewTransaction) throw new Error("candidate-conflict");
    if (movedExpenseIds.has(expenseId) || movedExpenseIds.has(automationReversalFingerprint(candidate))) throw new Error("moved expense reversal requires travel ledger review");
    if (ledger.automationReversalIds.includes(expenseId) || ledger.automationReversalIds.includes(automationReversalFingerprint(candidate))) return Object.freeze({ state, inserted: false, reversed: false });
    const matches = reversalMatchIndexes(ledger.expenses, candidate);
    if (matches.length !== 1) throw new Error("ambiguous reversal");
    const removed = ledger.expenses[matches[0]];
    const automationReversalIds = appendReversalIds(ledger.automationReversalIds, [removed.id, expenseId, automationReversalFingerprint(candidate), ...(removed.automationFingerprint ? [removed.automationFingerprint] : [])]);
    const updated = Object.freeze({ ...ledger, automationReversalIds, expenses: Object.freeze(ledger.expenses.filter((_, expenseIndex) => expenseIndex !== matches[0])), updatedAt: new Date().toISOString() }); const ledgers = [...state.ledgers]; ledgers[index] = updated;
    return Object.freeze({ state: Object.freeze({ ...state, ledgers: Object.freeze(ledgers) }), inserted: false, reversed: true });
  }
  const origin = automationOriginFingerprint(candidate);
  const identity = recordedIdentity(recorded, expenseId, origin);
  const movedIdentity = movedExpenseIds.has(expenseId) ? movedExpenseIds.has(origin) ? "same" : "conflict" : "none";
  const reversedIdentity = appliedReversals.has(expenseId) ? appliedReversals.has(origin) ? "same" : "conflict" : "none";
  const hasIdentityConflict = identity === "conflict" || movedIdentity === "conflict" || reversedIdentity === "conflict";
  const hasKnownIdentity = identity === "same" || movedIdentity === "same" || reversedIdentity === "same";
  if ((candidate.identityConflict || hasIdentityConflict) && !options.asNewTransaction) throw new Error("candidate-conflict");
  if (options.asNewTransaction) {
    // Never trust a caller-supplied flag by itself: the latest durable state
    // must still contain a conflicting use of the stable notification id.
    if (!hasIdentityConflict) throw new Error("candidate-conflict");
    const revisionId = automationRevisionExpenseId(candidate);
    const revisionIdentity = recordedIdentity(recorded, revisionId, origin);
    if (revisionIdentity === "same" || movedExpenseIds.has(revisionId) && movedExpenseIds.has(origin) || appliedReversals.has(revisionId) && appliedReversals.has(origin)) return Object.freeze({ state, inserted: false, reversed: false });
    if (revisionIdentity === "conflict" || movedExpenseIds.has(revisionId) || appliedReversals.has(revisionId)) throw new Error("candidate-conflict");
    if (ledger.expenses.length >= MAX_EXPENSES_PER_LEDGER) throw new Error("incompatible candidate");
    const updated = Object.freeze({ ...ledger, expenses: Object.freeze([...ledger.expenses, candidateExpense(candidate, revisionId)]), updatedAt: new Date().toISOString() }); const ledgers = [...state.ledgers]; ledgers[index] = updated;
    return Object.freeze({ state: Object.freeze({ ...state, ledgers: Object.freeze(ledgers) }), inserted: true, reversed: false });
  }
  if (hasKnownIdentity) return Object.freeze({ state, inserted: false, reversed: false });
  if (ledger.expenses.length >= MAX_EXPENSES_PER_LEDGER) throw new Error("incompatible candidate");
  const updated = Object.freeze({ ...ledger, expenses: Object.freeze([...ledger.expenses, candidateExpense(candidate)]), updatedAt: new Date().toISOString() }); const ledgers = [...state.ledgers]; ledgers[index] = updated;
  return Object.freeze({ state: Object.freeze({ ...state, ledgers: Object.freeze(ledgers) }), inserted: true, reversed: false });
}

export function calculateMonthlyLimitStatus(ledger: GeneralLedger, selectedMonth: string): MonthlyLimitStatus {
  const spentMinor = monthTotal(ledger.expenses, selectedMonth); const limitMinor = ledger.monthlyLimitMinor;
  if (limitMinor === null) return Object.freeze({ state: "unset", spentMinor, limitMinor, remainingMinor: null, percent: null });
  const remainingMinor = limitMinor - spentMinor; const percentTenths = Number((BigInt(spentMinor) * 1000n + BigInt(limitMinor) / 2n) / BigInt(limitMinor)); const percent = percentTenths / 10;
  const status = spentMinor > limitMinor ? "over" : spentMinor === limitMinor ? "reached" : percent >= 80 ? "near" : "under";
  return Object.freeze({ state: status, spentMinor, limitMinor, remainingMinor, percent });
}

export function buildNativeAutomationConfiguration(state: WalletState, locale: Locale, now = new Date()): NativeAutomationConfiguration {
  const currentMonth = monthKey(now); const generalLedgers = state.ledgers.filter((ledger): ledger is GeneralLedger => ledger.kind === "general");
  const ownerCount = new Map<string, number>();
  for (const ledger of generalLedgers) for (const source of ledger.automationSources) {
    const key = `${source.packageName}\u0000${ledger.currency}`;
    ownerCount.set(key, (ownerCount.get(key) ?? 0) + 1);
  }
  return Object.freeze({
    ledgers: Object.freeze(generalLedgers.map((ledger) => Object.freeze({ ledgerId: ledger.id, title: ledger.title, currency: ledger.currency, monthlyLimitMinor: ledger.monthlyLimitMinor, spentMinor: monthTotal(ledger.expenses, currentMonth), locale, automationAllApps: ledger.automationAllApps }))),
    // Ambiguous package assignments are never sent to native code: assigning
    // a purchase to the first ledger would silently corrupt another ledger.
    sources: Object.freeze(generalLedgers.flatMap((ledger) => ledger.automationSources.filter((source) => ownerCount.get(`${source.packageName}\u0000${ledger.currency}`) === 1).map((source: AutomationSource) => Object.freeze({ packageName: source.packageName, ledgerId: ledger.id, currency: ledger.currency })))),
    detectAllApps: generalLedgers.some((ledger) => ledger.automationAllApps),
  });
}
