import type { GeneralExpense } from "./types";

export const MAX_BANK_SYNC_TRANSACTIONS = 5_000;

export type BankTransactionKind = "card_purchase" | "outgoing_transfer" | "direct_debit" | "standing_order";
export type BankTransactionStatus = "booked" | "completed";
export type BankTransactionDirection = "debit" | "outgoing";
export type BankSyncDecision = "automatic" | "review";
export type BankSyncReviewReason = "internal_transfer_unknown";
export type BankSyncRemovalReason = "reversed" | "refunded";
export type BankSyncExclusionReason =
  | "incoming"
  | "not_booked"
  | "failed"
  | "reversed"
  | "balance"
  | "unsupported_kind"
  | "internal_transfer"
  | "already_imported"
  | "already_removed"
  | "duplicate"
  | "conflicting_duplicate"
  | "invalid_transaction";
export type BankSyncEnvelopeError =
  | "invalid_envelope"
  | "invalid_provider"
  | "invalid_connection"
  | "invalid_account"
  | "invalid_owned_accounts"
  | "invalid_transactions"
  | "invalid_pagination";

export interface BankSyncSource {
  readonly provider: string;
  readonly connectionId: string;
  readonly accountId: string;
}

/** Metadata that cannot currently be represented by GeneralExpense. It stays
 * on the preview candidate so a future persistence schema can retain the
 * provider's auditable values without putting them in the display text. */
export interface BankSyncCandidateMetadata {
  readonly bookedAt: string | null;
  readonly valueOn: string | null;
  readonly counterpartyName: string | null;
  readonly counterpartyAccountId: string | null;
  readonly reference: string | null;
  readonly providerCategory: string | null;
  readonly relatedTransactionId: string | null;
  readonly originalMinorUnits: number | null;
  readonly originalCurrency: string | null;
  readonly feeMinorUnits: number | null;
  readonly feeCurrency: string | null;
  readonly internalTransfer: boolean | null;
}

export interface BankSyncCandidate extends BankSyncSource {
  readonly stableKey: string;
  readonly expenseId: string;
  readonly transactionId: string;
  readonly status: BankTransactionStatus;
  readonly direction: BankTransactionDirection;
  readonly kind: BankTransactionKind;
  readonly description: string;
  readonly minorUnits: number;
  readonly currency: string;
  readonly occurredOn: string;
  readonly decision: BankSyncDecision;
  readonly reviewReasons: readonly BankSyncReviewReason[];
  readonly metadata: BankSyncCandidateMetadata;
  /** This object is accepted by the current GeneralExpense model. The module
   * deliberately does not apply it to a ledger; the caller must first obtain
   * explicit user confirmation for the preview. */
  readonly proposedExpense: GeneralExpense;
}

/** A read-only request to remove one previously synchronized expense. It is
 * intentionally separate from BankSyncCandidate and has no database mutation
 * callback, so the caller must show it in a preview and obtain confirmation. */
export interface BankSyncRemovalCandidate extends BankSyncSource {
  readonly tombstoneKey: string;
  readonly transactionId: string;
  readonly targetTransactionId: string;
  readonly targetStableKey: string;
  readonly targetExpenseId: string;
  readonly reason: BankSyncRemovalReason;
  readonly requiresConfirmation: true;
}

export interface BankSyncExcludedRow {
  readonly index: number;
  readonly transactionId: string | null;
  readonly reason: BankSyncExclusionReason;
}

export interface BankSyncCurrencyTotal {
  readonly currency: string;
  /** A decimal string avoids overflow when as many as 5,000 safe integers are summed. */
  readonly automaticMinorUnits: string;
  readonly reviewMinorUnits: string;
  readonly automaticCount: number;
  readonly reviewCount: number;
}

export interface BankSyncPreviewCounts {
  readonly received: number;
  readonly inspected: number;
  readonly candidates: number;
  readonly removals: number;
  readonly automatic: number;
  readonly review: number;
  readonly excluded: number;
  readonly invalid: number;
  readonly duplicate: number;
  readonly overflow: number;
  /** null means the provider says more rows exist but did not report how many. */
  readonly providerMissing: number | null;
  /** Includes both locally truncated overflow and known provider-side missing rows. */
  readonly missing: number | null;
  readonly hasMissing: boolean;
}

export interface BankSyncPreview {
  readonly valid: boolean;
  readonly source: BankSyncSource | null;
  readonly candidates: readonly BankSyncCandidate[];
  readonly removalCandidates: readonly BankSyncRemovalCandidate[];
  readonly automaticCandidates: readonly BankSyncCandidate[];
  readonly reviewCandidates: readonly BankSyncCandidate[];
  readonly exclusions: readonly BankSyncExcludedRow[];
  readonly currencyTotals: readonly BankSyncCurrencyTotal[];
  readonly counts: BankSyncPreviewCounts;
  readonly validationErrors: readonly BankSyncEnvelopeError[];
}

export interface BankSyncPreviewOptions {
  readonly existingStableKeys?: readonly string[];
  readonly existingExpenseIds?: readonly string[];
  readonly existingTombstoneKeys?: readonly string[];
}

interface ParsedEnvelope extends BankSyncSource {
  readonly ownedAccountIds: ReadonlySet<string>;
  readonly transactions: readonly unknown[];
  readonly reportedTotal: number | null;
  readonly hasMore: boolean;
}

interface CandidateRow {
  readonly index: number;
  readonly candidate: BankSyncCandidate;
  readonly signature: string;
}

interface RemovalRow {
  readonly index: number;
  readonly candidate: BankSyncRemovalCandidate;
  readonly signature: string;
}

interface ParsedRowResult {
  readonly row: CandidateRow | null;
  readonly removalRow: RemovalRow | null;
  readonly exclusion: BankSyncExcludedRow | null;
}

const CURRENCY = /^[A-Z]{3}$/u;
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/u;
const CANDIDATE_KINDS = new Set<BankTransactionKind>(["card_purchase", "outgoing_transfer", "direct_debit", "standing_order"]);
const BOOKED_STATUSES = new Set<BankTransactionStatus>(["booked", "completed"]);
const NOT_BOOKED_STATUSES = new Set(["pending", "scheduled", "authorized", "processing"]);
const FAILED_STATUSES = new Set(["failed", "declined", "rejected"]);
const REVERSED_STATUSES = new Set(["reversed", "cancelled", "canceled", "returned", "refunded"]);
const BOOKED_REMOVAL_KINDS: ReadonlyMap<string, BankSyncRemovalReason> = new Map([
  ["refund", "refunded"],
  ["refunded", "refunded"],
  ["chargeback", "refunded"],
  ["reversal", "reversed"],
  ["reversed", "reversed"],
  ["reverted", "reversed"],
]);
const OUTGOING_DIRECTIONS = new Set<BankTransactionDirection>(["debit", "outgoing"]);
const INCOMING_DIRECTIONS = new Set(["credit", "incoming"]);
const IBAN_LIKE = /\b[A-Z]{2}\d{2}(?:[\s-]?[A-Z0-9]){11,30}\b/giu;
const LONG_DIGIT_SEQUENCE = /(?<!\p{L})(?:\d[\s.-]?){5,18}\d(?!\p{L})/gu;
const MASKED_FINANCIAL_NUMBER = /(?<!\p{L})(?:(?:[*Xx•#][\s.-]?){2,}(?:\d[\s.-]?){2,6}|(?:\d[\s.-]?){2,6}(?:[*Xx•#][\s.-]?){2,})(?!\p{L})/gu;
const LABELLED_FINANCIAL_IDENTIFIER = /((?:iban|bic|rib|bank\s+account|account(?:\s+(?:number|no\.?))?|acct|card(?:\s+(?:number|no\.?))?|compte|carte|kontonummer|kartennummer|cuenta|tarjeta|계좌(?:번호)?|카드(?:번호)?|口座番号|カード番号|账号|银行卡号)\s*[:#-]?\s*)([A-Z0-9*Xx•#][A-Z0-9*Xx•# .-]{2,39})/giu;
const REDACTION_MARKER = "••••";
const MOVEMENT_FALLBACK: Readonly<Record<Exclude<BankTransactionKind, "card_purchase">, string>> = Object.freeze({
  outgoing_transfer: "Bank transfer",
  direct_debit: "Direct debit",
  standing_order: "Standing order",
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 31 || codePoint === 127)) return true;
  }
  return false;
}

function boundedIdentifier(value: unknown, maximum: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maximum && !containsControlCharacter(normalized) ? normalized : null;
}

function boundedDisplayText(value: unknown, maximum: number): string | null {
  const text = boundedIdentifier(value, maximum);
  return text === null ? null : text.normalize("NFKC").replace(/\s+/gu, " ");
}

/** Removes common IBAN, account-number, PAN and masked-card forms before any
 * provider text can become user-visible. Raw descriptions are not retained. */
function privacySafeDisplayText(value: string | null): string | null {
  if (value === null) return null;
  const redacted = value
    .replace(LABELLED_FINANCIAL_IDENTIFIER, `$1${REDACTION_MARKER}`)
    .replace(IBAN_LIKE, REDACTION_MARKER)
    .replace(LONG_DIGIT_SEQUENCE, REDACTION_MARKER)
    .replace(MASKED_FINANCIAL_NUMBER, REDACTION_MARKER)
    .replace(new RegExp(`(?:${REDACTION_MARKER}\\s*){2,}`, "gu"), REDACTION_MARKER)
    .replace(/\s+/gu, " ")
    .trim();
  return redacted.length > 0 ? redacted : null;
}

function optionalText(value: unknown, maximum: number, display = false): { readonly valid: boolean; readonly value: string | null } {
  if (value === undefined || value === null) return Object.freeze({ valid: true, value: null });
  const parsed = display ? boundedDisplayText(value, maximum) : boundedIdentifier(value, maximum);
  return Object.freeze({ valid: parsed !== null, value: parsed });
}

function normalizedWord(value: unknown): string | null {
  return typeof value === "string" && value.trim().length <= 40 && !containsControlCharacter(value) ? value.trim().toLowerCase() : null;
}

function currency(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
  return CURRENCY.test(normalized) ? normalized : null;
}

function calendarDate(value: unknown): string | null {
  if (typeof value !== "string" || !CALENDAR_DATE.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}

function optionalCalendarDate(value: unknown): { readonly valid: boolean; readonly value: string | null } {
  if (value === undefined || value === null) return Object.freeze({ valid: true, value: null });
  const parsed = calendarDate(value);
  return Object.freeze({ valid: parsed !== null, value: parsed });
}

function optionalTimestamp(value: unknown): { readonly valid: boolean; readonly value: string | null } {
  if (value === undefined || value === null) return Object.freeze({ valid: true, value: null });
  if (typeof value !== "string" || value.length > 80 || !TIMESTAMP.test(value) || Number.isNaN(Date.parse(value))) return Object.freeze({ valid: false, value: null });
  return Object.freeze({ valid: true, value });
}

function positiveMinor(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) > 0 ? value as number : null;
}

function nonNegativeMinor(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : null;
}

function parseOptionalMoney(amountValue: unknown, currencyValue: unknown, allowZero: boolean): { readonly valid: boolean; readonly minorUnits: number | null; readonly currency: string | null } {
  const amountPresent = amountValue !== undefined && amountValue !== null;
  const currencyPresent = currencyValue !== undefined && currencyValue !== null;
  if (!amountPresent && !currencyPresent) return Object.freeze({ valid: true, minorUnits: null, currency: null });
  if (!amountPresent || !currencyPresent) return Object.freeze({ valid: false, minorUnits: null, currency: null });
  const parsedAmount = allowZero ? nonNegativeMinor(amountValue) : positiveMinor(amountValue);
  const parsedCurrency = currency(currencyValue);
  return Object.freeze({ valid: parsedAmount !== null && parsedCurrency !== null, minorUnits: parsedAmount, currency: parsedCurrency });
}

function exclusion(index: number, transactionId: string | null, reason: BankSyncExclusionReason): BankSyncExcludedRow {
  return Object.freeze({ index, transactionId, reason });
}

function excludedResult(index: number, transactionId: string | null, reason: BankSyncExclusionReason): ParsedRowResult {
  return Object.freeze({ row: null, removalRow: null, exclusion: exclusion(index, transactionId, reason) });
}

function parseEnvelope(value: unknown): { readonly value: ParsedEnvelope | null; readonly error: BankSyncEnvelopeError | null } {
  if (!isRecord(value)) return Object.freeze({ value: null, error: "invalid_envelope" });
  const provider = boundedIdentifier(value.provider, 80);
  if (!provider) return Object.freeze({ value: null, error: "invalid_provider" });
  const connectionId = boundedIdentifier(value.connectionId, 200);
  if (!connectionId) return Object.freeze({ value: null, error: "invalid_connection" });
  const accountId = boundedIdentifier(value.accountId, 200);
  if (!accountId) return Object.freeze({ value: null, error: "invalid_account" });
  if (!Array.isArray(value.transactions)) return Object.freeze({ value: null, error: "invalid_transactions" });

  const ownedAccountIds = new Set<string>();
  if (value.ownedAccountIds !== undefined) {
    if (!Array.isArray(value.ownedAccountIds) || value.ownedAccountIds.length > MAX_BANK_SYNC_TRANSACTIONS) return Object.freeze({ value: null, error: "invalid_owned_accounts" });
    for (const raw of value.ownedAccountIds) {
      const owned = boundedIdentifier(raw, 200);
      if (!owned || ownedAccountIds.has(owned)) return Object.freeze({ value: null, error: "invalid_owned_accounts" });
      ownedAccountIds.add(owned);
    }
  }

  let reportedTotal: number | null = null;
  if (value.reportedTotal !== undefined && value.reportedTotal !== null) {
    if (!Number.isSafeInteger(value.reportedTotal) || (value.reportedTotal as number) < value.transactions.length) return Object.freeze({ value: null, error: "invalid_pagination" });
    reportedTotal = value.reportedTotal as number;
  }
  const hasMore = value.hasMore === undefined ? false : value.hasMore;
  if (typeof hasMore !== "boolean") return Object.freeze({ value: null, error: "invalid_pagination" });
  return Object.freeze({ value: Object.freeze({ provider, connectionId, accountId, ownedAccountIds, transactions: value.transactions, reportedTotal, hasMore }), error: null });
}

/** Length-prefixed components make the key unambiguous even when provider IDs contain separators. */
export function bankTransactionStableKey(source: BankSyncSource & { readonly transactionId: string }): string {
  const parts = [source.provider, source.connectionId, source.accountId, source.transactionId];
  return `bank:${parts.map((part) => `${part.length}:${part}`).join("|")}`;
}

/** Separate namespace from an imported transaction key lets an in-place
 * reversal target the same provider transaction without colliding with it. */
export function bankSyncTombstoneKey(source: BankSyncSource & { readonly transactionId: string }): string {
  const parts = [source.provider, source.connectionId, source.accountId, source.transactionId];
  return `bank-tombstone:${parts.map((part) => `${part.length}:${part}`).join("|")}`;
}

function fingerprint128(value: string): string {
  let a = 0x811c9dc5; let b = 0x9e3779b9; let c = 0x85ebca6b; let d = 0xc2b2ae35;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    a = Math.imul(a ^ code, 0x01000193);
    b = Math.imul(b ^ code, 0x85ebca6b); b ^= b >>> 13;
    c = Math.imul(c ^ code, 0xc2b2ae35); c ^= c >>> 16;
    d = Math.imul(d ^ code, 0x27d4eb2f); d ^= d >>> 15;
  }
  return [a, b, c, d].map((part) => (part >>> 0).toString(16).padStart(8, "0")).join("");
}

export function bankSyncExpenseId(stableKey: string): string {
  return `bank-sync-${fingerprint128(stableKey)}`;
}

function parseRemovalRow(raw: Record<string, unknown>, index: number, source: BankSyncSource, transactionId: string, reason: BankSyncRemovalReason, allowSelfTarget: boolean): ParsedRowResult {
  const relatedTransactionId = optionalText(raw.relatedTransactionId, 200);
  if (!relatedTransactionId.valid || (!allowSelfTarget && relatedTransactionId.value === null)) return excludedResult(index, transactionId, "invalid_transaction");
  const targetTransactionId = relatedTransactionId.value ?? transactionId;
  const targetStableKey = bankTransactionStableKey({ ...source, transactionId: targetTransactionId });
  const candidate: BankSyncRemovalCandidate = Object.freeze({
    ...source,
    tombstoneKey: bankSyncTombstoneKey({ ...source, transactionId }),
    transactionId,
    targetTransactionId,
    targetStableKey,
    targetExpenseId: bankSyncExpenseId(targetStableKey),
    reason,
    requiresConfirmation: true,
  });
  const signature = JSON.stringify(candidate);
  return Object.freeze({ row: null, removalRow: Object.freeze({ index, candidate, signature }), exclusion: null });
}

function parseCandidateRow(raw: unknown, index: number, source: BankSyncSource, ownedAccountIds: ReadonlySet<string>): ParsedRowResult {
  if (!isRecord(raw)) return excludedResult(index, null, "invalid_transaction");
  const transactionIdResult = optionalText(raw.transactionId, 200);
  const transactionId = transactionIdResult.value;
  const kindValue = normalizedWord(raw.kind);
  if (kindValue === "balance") return excludedResult(index, transactionId, "balance");

  const statusValue = normalizedWord(raw.status);
  if (statusValue && NOT_BOOKED_STATUSES.has(statusValue)) return excludedResult(index, transactionId, "not_booked");
  if (statusValue && FAILED_STATUSES.has(statusValue)) return excludedResult(index, transactionId, "failed");
  if (statusValue && REVERSED_STATUSES.has(statusValue)) {
    return transactionIdResult.valid && transactionId
      ? parseRemovalRow(raw, index, source, transactionId, statusValue === "refunded" ? "refunded" : "reversed", true)
      : excludedResult(index, null, "invalid_transaction");
  }
  if (!statusValue || !BOOKED_STATUSES.has(statusValue as BankTransactionStatus)) return excludedResult(index, transactionId, "invalid_transaction");
  const bookedRemovalReason = kindValue ? BOOKED_REMOVAL_KINDS.get(kindValue) : undefined;
  if (bookedRemovalReason) {
    return transactionIdResult.valid && transactionId
      ? parseRemovalRow(raw, index, source, transactionId, bookedRemovalReason, false)
      : excludedResult(index, null, "invalid_transaction");
  }

  const directionValue = normalizedWord(raw.direction);
  if (directionValue && INCOMING_DIRECTIONS.has(directionValue)) return excludedResult(index, transactionId, "incoming");
  if (!directionValue || !OUTGOING_DIRECTIONS.has(directionValue as BankTransactionDirection)) return excludedResult(index, transactionId, "invalid_transaction");
  if (!kindValue || !CANDIDATE_KINDS.has(kindValue as BankTransactionKind)) return excludedResult(index, transactionId, "unsupported_kind");
  if (!transactionIdResult.valid || !transactionId) return excludedResult(index, null, "invalid_transaction");

  const kind = kindValue as BankTransactionKind;
  const descriptionValue = optionalText(raw.description, 500, true);
  const counterpartyName = optionalText(raw.counterpartyName, 200, true);
  const counterpartyAccountId = optionalText(raw.counterpartyAccountId, 200);
  const reference = optionalText(raw.reference, 500, true);
  const providerCategory = optionalText(raw.providerCategory, 100, true);
  const relatedTransactionId = optionalText(raw.relatedTransactionId, 200);
  const bookedAt = optionalTimestamp(raw.bookedAt);
  const valueOn = optionalCalendarDate(raw.valueOn);
  const original = parseOptionalMoney(raw.originalMinorUnits, raw.originalCurrency, false);
  const fee = parseOptionalMoney(raw.feeMinorUnits, raw.feeCurrency, true);
  const minorUnits = positiveMinor(raw.minorUnits);
  const transactionCurrency = currency(raw.currency);
  const occurredOn = calendarDate(raw.bookedOn);
  const internalTransferValid = raw.internalTransfer === undefined || raw.internalTransfer === null || typeof raw.internalTransfer === "boolean";
  const safeDescription = privacySafeDisplayText(descriptionValue.value);
  const safeCounterpartyName = privacySafeDisplayText(counterpartyName.value);
  const safeReference = privacySafeDisplayText(reference.value);
  const description = kind === "card_purchase"
    ? safeDescription ?? safeCounterpartyName ?? safeReference
    : safeCounterpartyName ?? MOVEMENT_FALLBACK[kind];
  if (!descriptionValue.valid || !counterpartyName.valid || !counterpartyAccountId.valid || !reference.valid || !providerCategory.valid || !relatedTransactionId.valid || !bookedAt.valid || !valueOn.valid || !original.valid || !fee.valid || !minorUnits || !transactionCurrency || !occurredOn || !internalTransferValid || !description) {
    return excludedResult(index, transactionId, "invalid_transaction");
  }

  const explicitlyInternal = raw.internalTransfer === true;
  const matchesOwnedAccount = counterpartyAccountId.value !== null && ownedAccountIds.has(counterpartyAccountId.value);
  if (explicitlyInternal || matchesOwnedAccount) return excludedResult(index, transactionId, "internal_transfer");

  const internalTransfer = typeof raw.internalTransfer === "boolean" ? raw.internalTransfer : null;
  const needsInternalReview = (kind === "outgoing_transfer" || kind === "standing_order") && internalTransfer !== false;
  const decision: BankSyncDecision = needsInternalReview ? "review" : "automatic";
  const reviewReasons: readonly BankSyncReviewReason[] = Object.freeze(needsInternalReview ? ["internal_transfer_unknown"] : []);
  const stableKey = bankTransactionStableKey({ ...source, transactionId });
  const expenseId = bankSyncExpenseId(stableKey);
  const metadata: BankSyncCandidateMetadata = Object.freeze({
    bookedAt: bookedAt.value,
    valueOn: valueOn.value,
    counterpartyName: counterpartyName.value,
    counterpartyAccountId: counterpartyAccountId.value,
    reference: reference.value,
    providerCategory: providerCategory.value,
    relatedTransactionId: relatedTransactionId.value,
    originalMinorUnits: original.minorUnits,
    originalCurrency: original.currency,
    feeMinorUnits: fee.minorUnits,
    feeCurrency: fee.currency,
    internalTransfer,
  });
  const proposedExpense: GeneralExpense = Object.freeze({ id: expenseId, description, category: "other", currency: transactionCurrency, minorUnits, occurredOn });
  const candidate: BankSyncCandidate = Object.freeze({
    ...source,
    stableKey,
    expenseId,
    transactionId,
    status: statusValue as BankTransactionStatus,
    direction: directionValue as BankTransactionDirection,
    kind,
    description,
    minorUnits,
    currency: transactionCurrency,
    occurredOn,
    decision,
    reviewReasons,
    metadata,
    proposedExpense,
  });
  const signature = JSON.stringify({ status: candidate.status, direction: candidate.direction, kind, description, minorUnits, currency: transactionCurrency, occurredOn, decision, reviewReasons, metadata });
  return Object.freeze({ row: Object.freeze({ index, candidate, signature }), removalRow: null, exclusion: null });
}

function emptyCounts(received: number): BankSyncPreviewCounts {
  return Object.freeze({ received, inspected: 0, candidates: 0, removals: 0, automatic: 0, review: 0, excluded: 0, invalid: 0, duplicate: 0, overflow: 0, providerMissing: null, missing: null, hasMissing: false });
}

function invalidPreview(input: unknown, error: BankSyncEnvelopeError): BankSyncPreview {
  const received = isRecord(input) && Array.isArray(input.transactions) ? input.transactions.length : 0;
  return Object.freeze({ valid: false, source: null, candidates: Object.freeze([]), removalCandidates: Object.freeze([]), automaticCandidates: Object.freeze([]), reviewCandidates: Object.freeze([]), exclusions: Object.freeze([]), currencyTotals: Object.freeze([]), counts: emptyCounts(received), validationErrors: Object.freeze([error]) });
}

function totalsFor(candidates: readonly BankSyncCandidate[]): readonly BankSyncCurrencyTotal[] {
  const totals = new Map<string, { automaticMinorUnits: bigint; reviewMinorUnits: bigint; automaticCount: number; reviewCount: number }>();
  for (const candidate of candidates) {
    const current = totals.get(candidate.currency) ?? { automaticMinorUnits: 0n, reviewMinorUnits: 0n, automaticCount: 0, reviewCount: 0 };
    if (candidate.decision === "automatic") { current.automaticMinorUnits += BigInt(candidate.minorUnits); current.automaticCount += 1; }
    else { current.reviewMinorUnits += BigInt(candidate.minorUnits); current.reviewCount += 1; }
    totals.set(candidate.currency, current);
  }
  return Object.freeze([...totals].sort(([left], [right]) => left.localeCompare(right)).map(([currencyCode, value]) => Object.freeze({ currency: currencyCode, automaticMinorUnits: value.automaticMinorUnits.toString(), reviewMinorUnits: value.reviewMinorUnits.toString(), automaticCount: value.automaticCount, reviewCount: value.reviewCount })));
}

/** Builds a read-only preview. It never accepts a WalletState and cannot mutate
 * the database; applying candidates must be a separate, user-confirmed step. */
export function previewBankSync(input: unknown, options: BankSyncPreviewOptions = {}): BankSyncPreview {
  const envelopeResult = parseEnvelope(input);
  if (!envelopeResult.value || envelopeResult.error) return invalidPreview(input, envelopeResult.error ?? "invalid_envelope");
  const envelope = envelopeResult.value;
  const source: BankSyncSource = Object.freeze({ provider: envelope.provider, connectionId: envelope.connectionId, accountId: envelope.accountId });
  const existingStableKeys = new Set(options.existingStableKeys ?? []);
  const existingExpenseIds = new Set(options.existingExpenseIds ?? []);
  const existingTombstoneKeys = new Set(options.existingTombstoneKeys ?? []);
  const inspected = Math.min(envelope.transactions.length, MAX_BANK_SYNC_TRANSACTIONS);
  const exclusions: BankSyncExcludedRow[] = [];
  const groupedRows = new Map<string, CandidateRow[]>();
  const groupedRemovalRows = new Map<string, RemovalRow[]>();

  for (let index = 0; index < inspected; index += 1) {
    const parsed = parseCandidateRow(envelope.transactions[index], index, source, envelope.ownedAccountIds);
    if (parsed.exclusion) exclusions.push(parsed.exclusion);
    if (parsed.row) {
      const group = groupedRows.get(parsed.row.candidate.stableKey) ?? [];
      group.push(parsed.row);
      groupedRows.set(parsed.row.candidate.stableKey, group);
    }
    if (parsed.removalRow) {
      const group = groupedRemovalRows.get(parsed.removalRow.candidate.tombstoneKey) ?? [];
      group.push(parsed.removalRow);
      groupedRemovalRows.set(parsed.removalRow.candidate.tombstoneKey, group);
    }
  }

  // If one provider event ID is simultaneously represented as booked and
  // reversed, there is no safe ordering information. Quarantine both views.
  for (const [tombstoneKey, removalRows] of groupedRemovalRows) {
    const firstRemoval = removalRows[0];
    if (!firstRemoval) continue;
    const eventStableKey = bankTransactionStableKey({ ...source, transactionId: firstRemoval.candidate.transactionId });
    const bookedRows = groupedRows.get(eventStableKey);
    if (!bookedRows) continue;
    for (const row of bookedRows) exclusions.push(exclusion(row.index, row.candidate.transactionId, "conflicting_duplicate"));
    for (const row of removalRows) exclusions.push(exclusion(row.index, row.candidate.transactionId, "conflicting_duplicate"));
    groupedRows.delete(eventStableKey);
    groupedRemovalRows.delete(tombstoneKey);
  }

  const candidates: BankSyncCandidate[] = [];
  for (const rows of groupedRows.values()) {
    const [first] = rows;
    if (!first) continue;
    if (rows.some((row) => row.signature !== first.signature)) {
      for (const row of rows) exclusions.push(exclusion(row.index, row.candidate.transactionId, "conflicting_duplicate"));
      continue;
    }
    if (existingStableKeys.has(first.candidate.stableKey) || existingExpenseIds.has(first.candidate.expenseId)) exclusions.push(exclusion(first.index, first.candidate.transactionId, "already_imported"));
    else candidates.push(first.candidate);
    for (const duplicate of rows.slice(1)) exclusions.push(exclusion(duplicate.index, duplicate.candidate.transactionId, "duplicate"));
  }

  const removalCandidates: BankSyncRemovalCandidate[] = [];
  for (const rows of groupedRemovalRows.values()) {
    const [first] = rows;
    if (!first) continue;
    if (rows.some((row) => row.signature !== first.signature)) {
      for (const row of rows) exclusions.push(exclusion(row.index, row.candidate.transactionId, "conflicting_duplicate"));
      continue;
    }
    if (existingTombstoneKeys.has(first.candidate.tombstoneKey)) exclusions.push(exclusion(first.index, first.candidate.transactionId, "already_removed"));
    else removalCandidates.push(first.candidate);
    for (const duplicate of rows.slice(1)) exclusions.push(exclusion(duplicate.index, duplicate.candidate.transactionId, "duplicate"));
  }

  candidates.sort((left, right) => {
    const leftRow = groupedRows.get(left.stableKey)?.[0]?.index ?? 0;
    const rightRow = groupedRows.get(right.stableKey)?.[0]?.index ?? 0;
    return leftRow - rightRow;
  });
  removalCandidates.sort((left, right) => {
    const leftRow = groupedRemovalRows.get(left.tombstoneKey)?.[0]?.index ?? 0;
    const rightRow = groupedRemovalRows.get(right.tombstoneKey)?.[0]?.index ?? 0;
    return leftRow - rightRow;
  });
  exclusions.sort((left, right) => left.index - right.index);
  const frozenCandidates = Object.freeze(candidates);
  const frozenRemovalCandidates = Object.freeze(removalCandidates);
  const automaticCandidates = Object.freeze(candidates.filter((candidate) => candidate.decision === "automatic"));
  const reviewCandidates = Object.freeze(candidates.filter((candidate) => candidate.decision === "review"));
  const overflow = Math.max(0, envelope.transactions.length - inspected);
  const providerMissing = envelope.reportedTotal === null ? (envelope.hasMore ? null : 0) : Math.max(0, envelope.reportedTotal - envelope.transactions.length);
  const missing = providerMissing === null ? null : overflow + providerMissing;
  const hasMissing = overflow > 0 || envelope.hasMore || (providerMissing ?? 0) > 0;
  const counts: BankSyncPreviewCounts = Object.freeze({
    received: envelope.transactions.length,
    inspected,
    candidates: candidates.length,
    removals: removalCandidates.length,
    automatic: automaticCandidates.length,
    review: reviewCandidates.length,
    excluded: exclusions.length,
    invalid: exclusions.filter((item) => item.reason === "invalid_transaction").length,
    duplicate: exclusions.filter((item) => item.reason === "duplicate" || item.reason === "conflicting_duplicate").length,
    overflow,
    providerMissing,
    missing,
    hasMissing,
  });
  return Object.freeze({ valid: true, source, candidates: frozenCandidates, removalCandidates: frozenRemovalCandidates, automaticCandidates, reviewCandidates, exclusions: Object.freeze(exclusions), currencyTotals: totalsFor(candidates), counts, validationErrors: Object.freeze([]) });
}

export const buildBankSyncPreview = previewBankSync;
