import type { AutomationPaymentReceipt, GeneralCategory, GeneralExpense, GeneralLedger, WalletState } from "./types";
import { MAX_AUTOMATION_PAYMENT_RECEIPTS, MAX_EXPENSES_PER_LEDGER } from "./wallet";

// A wallet and an issuer can use completely different merchant labels. Pair
// exact money across distinct notification apps, without a package allow-list.
// This window covers the WHOLE receipt: a third alert cannot extend it.
const SAME_PAYMENT_WINDOW_MS = 2 * 60_000;
const POSSIBLE_PAYMENT_WINDOW_MS = 15 * 60_000;
const MAX_TRANSACTION_TIME_SKEW_MS = 60 * 60_000;

export interface PaymentDuplicateEvidence {
  readonly expenseId: string;
  readonly packageName: string;
  readonly occurredAt: string;
  readonly deliveredAt?: string;
  readonly eventType?: "purchase" | "outgoing_transfer" | "direct_debit" | "standing_order" | "reversal";
  readonly originFingerprint: string;
  readonly reversalFingerprint: string;
  readonly merchant: string;
  readonly currency: string;
  readonly minorUnits: number;
  readonly category?: GeneralCategory;
  readonly occurredOn?: string;
}

export interface PaymentReceiptLocation {
  readonly ledgerIndex: number;
  readonly receiptIndex: number;
  readonly receipt: AutomationPaymentReceipt;
}

function merchantTokens(value: string): string[] {
  return value.normalize("NFKD").toLocaleLowerCase("en").replace(/\p{Diacritic}/gu, "")
    .replace(/^(?:google\s*(?:pay|wallet)|samsung\s*(?:pay|wallet)|gpay)\s*[*:·-]?\s*/u, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ").trim().split(/\s+/u).filter(Boolean);
}

function sameMerchant(left: string, right: string, differenceMs: number): boolean {
  const leftTokens = merchantTokens(left); const rightTokens = merchantTokens(right);
  if (!leftTokens.length || !rightTokens.length) return false;
  if (leftTokens.join("") === rightTokens.join("")) return differenceMs <= 10 * 60_000;
  // Wallets often omit an issuer's branch suffix. Only a full token prefix and
  // closely delivered alerts qualify; substrings such as Lidl/Lidlina do not.
  const [shorter, longer] = leftTokens.length < rightTokens.length ? [leftTokens, rightTokens] : [rightTokens, leftTokens];
  return differenceMs <= 90_000 && shorter.join("").length >= 4 && shorter.length < longer.length
    && shorter.every((token, index) => token === longer[index]);
}

function comparisonTimes(receipt: AutomationPaymentReceipt, evidence: PaymentDuplicateEvidence): { readonly candidate: number; readonly sources: readonly number[]; readonly usesDelivery: boolean } {
  // Notification.when is controlled by each payment app and can describe a
  // different point in the transaction. When both sides have Android's actual
  // post time, compare that instead. A receipt migrated from an older version
  // may contain both old and new sources; use its known delivery times rather
  // than letting one legacy source force every new alert back to event time.
  const useDelivery = Boolean(evidence.deliveredAt && receipt.sources.some((source) => source.deliveredAt));
  return { candidate: Date.parse(useDelivery ? evidence.deliveredAt! : evidence.occurredAt), usesDelivery: useDelivery,
    sources: receipt.sources.flatMap((source) => useDelivery && !source.deliveredAt ? [] : [Date.parse(useDelivery ? source.deliveredAt! : source.occurredAt)]) };
}

function compatiblePaymentTypes(receipt: AutomationPaymentReceipt, evidence: PaymentDuplicateEvidence): boolean {
  // A real standing order can coincide with a wallet purchase for the same
  // amount. Different debit types still go through duplicate review, but do
  // not silently discard a potentially separate outgoing payment.
  return (evidence.eventType ?? "purchase") === "purchase"
    && receipt.sources.every((source) => (source.eventType ?? "purchase") === "purchase");
}

export function paymentReceiptIdentity(ledgers: WalletState["ledgers"], evidence: PaymentDuplicateEvidence): "none" | "same" | "conflict" {
  let found = false;
  for (const ledger of ledgers) if (ledger.kind === "general") for (const receipt of ledger.automationPaymentReceipts ?? []) {
    for (const source of receipt.sources) if (source.expenseId === evidence.expenseId) {
      if (source.originFingerprint !== evidence.originFingerprint) return "conflict";
      found = true;
    }
  }
  return found ? "same" : "none";
}

/** Pair alerts one-to-one. An issuer's second event cannot attach to a
 * receipt that already consumed a different event from that same issuer. */
export function findCrossSourcePayment(ledgers: WalletState["ledgers"], evidence: PaymentDuplicateEvidence): PaymentReceiptLocation | null {
  const candidates: PaymentReceiptLocation[] = [];
  for (const [ledgerIndex, ledger] of ledgers.entries()) if (ledger.kind === "general") {
    for (const [receiptIndex, receipt] of (ledger.automationPaymentReceipts ?? []).entries()) {
      if (receipt.currency !== evidence.currency || receipt.minorUnits !== evidence.minorUnits || receipt.sources.length >= 8 || !compatiblePaymentTypes(receipt, evidence)
        || receipt.separatedSourceIds?.includes(evidence.expenseId)
        || receipt.sources.some((source) => source.packageName === evidence.packageName)) continue;
      const times = comparisonTimes(receipt, evidence);
      const timestamps = [times.candidate, ...times.sources];
      const spanMs = Math.max(...timestamps) - Math.min(...timestamps);
      if (times.usesDelivery) {
        // A mixed pre-upgrade receipt lacks the complete delivery window.
        // A further app alert may be related, but should wait for review.
        if (receipt.sources.some((source) => !source.deliveredAt)) continue;
        // Two delayed historical alerts can be posted together even though
        // they describe different purchases. Keep such a pair for review.
        const transactionTimes = [Date.parse(evidence.occurredAt), ...receipt.sources.map((source) => Date.parse(source.occurredAt))];
        const transactionSpanMs = Math.max(...transactionTimes) - Math.min(...transactionTimes);
        if (!Number.isFinite(transactionSpanMs) || transactionSpanMs > MAX_TRANSACTION_TIME_SKEW_MS) continue;
      }
      if (Number.isFinite(spanMs) && (spanMs <= SAME_PAYMENT_WINDOW_MS || sameMerchant(receipt.merchant, evidence.merchant, spanMs))) candidates.push({ ledgerIndex, receiptIndex, receipt });
    }
  }
  // Repeated equal purchases in the same store cannot be resolved just by
  // choosing the nearest timestamp. Keep an ambiguous alert for review.
  return candidates.length === 1 ? candidates[0] : null;
}

/** Longer delays and multiple equally plausible receipts need a decision.
 * This never deletes or merges an expense on merchant/amount alone. */
export function hasPossibleCrossSourcePayment(ledgers: WalletState["ledgers"], evidence: PaymentDuplicateEvidence): boolean {
  return ledgers.some((ledger) => ledger.kind === "general" && (ledger.automationPaymentReceipts ?? []).some((receipt) => {
    if (evidence.eventType === "reversal" || receipt.currency !== evidence.currency || receipt.minorUnits !== evidence.minorUnits
      || receipt.separatedSourceIds?.includes(evidence.expenseId)
      || receipt.sources.some((source) => source.expenseId === evidence.expenseId)) return false;
    const times = comparisonTimes(receipt, evidence);
    // A slower issuer notification is not proof of the same purchase, but it
    // must not become a second automatic expense without user review either.
    return times.sources.some((time) => Math.abs(times.candidate - time) <= POSSIBLE_PAYMENT_WINDOW_MS)
      || sameMerchant(receipt.merchant, evidence.merchant, 0)
        && Math.abs(times.candidate - times.sources[0]) <= 24 * 60 * 60_000;
  }));
}

export function paymentReceipt(evidence: PaymentDuplicateEvidence, expenseId = evidence.expenseId): AutomationPaymentReceipt {
  if (evidence.eventType === "reversal") throw new Error("payment-receipt-reversal");
  return Object.freeze({ expenseId, merchant: evidence.merchant, currency: evidence.currency, minorUnits: evidence.minorUnits, sources: Object.freeze([paymentReceiptSource(evidence)]) });
}

function paymentReceiptSource(evidence: PaymentDuplicateEvidence): AutomationPaymentReceipt["sources"][number] {
  if (evidence.eventType === "reversal") throw new Error("payment-receipt-reversal");
  return Object.freeze({ expenseId: evidence.expenseId, packageName: evidence.packageName, occurredAt: evidence.occurredAt, originFingerprint: evidence.originFingerprint, reversalFingerprint: evidence.reversalFingerprint,
    ...(evidence.deliveredAt ? { deliveredAt: evidence.deliveredAt } : {}),
    ...(evidence.eventType ? { eventType: evidence.eventType } : {}),
    ...(evidence.merchant && evidence.category && evidence.occurredOn ? { merchant: evidence.merchant, category: evidence.category, occurredOn: evidence.occurredOn } : {}) });
}

export function joinPaymentReceipt(ledger: GeneralLedger, location: PaymentReceiptLocation, evidence: PaymentDuplicateEvidence): GeneralLedger {
  const receipts = [...ledger.automationPaymentReceipts ?? []];
  const current = receipts[location.receiptIndex];
  // Recheck the durable receipt rather than applying a stale UI location.
  if (!current || current.expenseId !== location.receipt.expenseId || current.currency !== evidence.currency || current.minorUnits !== evidence.minorUnits || !compatiblePaymentTypes(current, evidence)
    || current.sources.length >= 8 || current.separatedSourceIds?.includes(evidence.expenseId)
    || current.sources.some((source) => source.expenseId === evidence.expenseId || source.packageName === evidence.packageName)) throw new Error("payment-merge-conflict");
  receipts[location.receiptIndex] = Object.freeze({ ...current, sources: Object.freeze([...current.sources, paymentReceiptSource(evidence)]) });
  return Object.freeze({ ...ledger, automationPaymentReceipts: Object.freeze(receipts), updatedAt: new Date().toISOString() });
}

export interface AutomationPaymentHistoryEntry {
  readonly expenseId: string;
  readonly status: "recorded" | "merged" | "restored" | "removed";
  readonly merchant: string;
  readonly currency: string;
  readonly minorUnits: number;
  readonly occurredOn: string;
  readonly sources: readonly {
    readonly expenseId: string;
    readonly packageName: string;
    readonly occurredAt: string;
    readonly merchant: string;
    readonly canRestore: boolean;
    readonly legacySnapshot: boolean;
  }[];
}

/** Local audit view only. Removed/moved receipts cannot restore an expense;
 * automatic transfers and old records without receipts still appear. */
export function getAutomationPaymentHistory(ledger: GeneralLedger): readonly AutomationPaymentHistoryEntry[] {
  const byId = new Map(ledger.expenses.map((expense) => [expense.id, expense]));
  const entries: AutomationPaymentHistoryEntry[] = [];
  for (const receipt of ledger.automationPaymentReceipts ?? []) {
    const expense = byId.get(receipt.expenseId);
    byId.delete(receipt.expenseId);
    entries.push(Object.freeze({ expenseId: receipt.expenseId,
      status: !expense ? "removed" : receipt.sources.length > 1 ? "merged" : receipt.restoredFromExpenseId ? "restored" : "recorded",
      merchant: expense?.description ?? receipt.merchant, currency: expense?.currency ?? receipt.currency,
      minorUnits: expense?.minorUnits ?? receipt.minorUnits, occurredOn: expense?.occurredOn ?? receipt.sources[0].occurredOn ?? receipt.sources[0].occurredAt.slice(0, 10),
      sources: Object.freeze(receipt.sources.map((source, index) => Object.freeze({ expenseId: source.expenseId, packageName: source.packageName,
        occurredAt: source.occurredAt, merchant: source.merchant ?? receipt.merchant,
        canRestore: Boolean(expense) && index > 0 && source.expenseId !== receipt.expenseId,
        legacySnapshot: !source.merchant || !source.category || !source.occurredOn }))) }));
  }
  for (const expense of byId.values()) if (expense.automationFingerprint || expense.id.startsWith("card-auto-")) {
    entries.push(Object.freeze({ expenseId: expense.id, status: "recorded", merchant: expense.description,
      currency: expense.currency, minorUnits: expense.minorUnits, occurredOn: expense.occurredOn, sources: Object.freeze([]) }));
  }
  const latestTime = (entry: AutomationPaymentHistoryEntry) => entry.sources.length
    ? Math.max(...entry.sources.map((source) => Date.parse(source.occurredAt))) : Date.parse(`${entry.occurredOn}T00:00:00Z`);
  return Object.freeze(entries.sort((left, right) => latestTime(right) - latestTime(left) || left.expenseId.localeCompare(right.expenseId)));
}

/** Undo exactly one joined alert against the latest durable state. No raw
 * notification is needed and a repeated click/replayed native event cannot
 * add another expense. Explicit separation is retained on both receipts. */
export function undoPaymentMerge(state: WalletState, ledgerId: string, primaryExpenseId: string, sourceExpenseId: string): {
  readonly state: WalletState; readonly restoredExpenseId: string; readonly usedLegacySnapshot: boolean;
} {
  const ledgerIndex = state.ledgers.findIndex((ledger) => ledger.id === ledgerId);
  const ledger = state.ledgers[ledgerIndex];
  if (!ledger || ledger.kind !== "general") throw new Error("payment-undo-unavailable");
  const receipts = [...ledger.automationPaymentReceipts ?? []];
  const receiptIndex = receipts.findIndex((receipt) => receipt.expenseId === primaryExpenseId);
  const receipt = receipts[receiptIndex];
  const sourceIndex = receipt?.sources.findIndex((source) => source.expenseId === sourceExpenseId) ?? -1;
  if (sourceIndex < 0) {
    const restored = receipts.find((item) => item.expenseId === sourceExpenseId && item.restoredFromExpenseId === primaryExpenseId);
    if (restored) return Object.freeze({ state, restoredExpenseId: sourceExpenseId, usedLegacySnapshot: !restored.sources[0].merchant });
    throw new Error("payment-undo-unavailable");
  }
  const primary = ledger.expenses.find((expense) => expense.id === primaryExpenseId);
  if (!primary || sourceIndex === 0 || sourceExpenseId === primaryExpenseId) throw new Error("payment-undo-unavailable");
  if (ledger.expenses.length >= MAX_EXPENSES_PER_LEDGER || receipts.length >= MAX_AUTOMATION_PAYMENT_RECEIPTS) throw new Error("payment-undo-limit");
  // Never resurrect a source already moved, cancelled, or retained elsewhere.
  if (state.ledgers.some((item) => item.expenses.some((expense) => expense.id === sourceExpenseId)
    || item.kind === "general" && (item.movedExpenseIds.includes(sourceExpenseId) || item.automationReversalIds.includes(sourceExpenseId)))) throw new Error("payment-undo-conflict");
  const source = receipt.sources[sourceIndex];
  const remaining = receipt.sources.filter((_, index) => index !== sourceIndex);
  const originalExclusions = [...new Set([...receipt.separatedSourceIds ?? [], sourceExpenseId])];
  const restoredExclusions = [...new Set([...receipt.separatedSourceIds ?? [], ...remaining.map((item) => item.expenseId)])];
  if (originalExclusions.length > 64 || restoredExclusions.length > 64) throw new Error("payment-undo-limit");
  const usedLegacySnapshot = !source.merchant || !source.category || !source.occurredOn;
  const expense: GeneralExpense = Object.freeze({ id: sourceExpenseId, description: source.merchant ?? receipt.merchant,
    category: source.category ?? primary.category, currency: receipt.currency, minorUnits: receipt.minorUnits,
    occurredOn: source.occurredOn ?? source.occurredAt.slice(0, 10),
    automationFingerprint: source.originFingerprint, automationReversalFingerprint: source.reversalFingerprint });
  const total = ledger.expenses.reduce((sum, item) => sum + BigInt(item.minorUnits), BigInt(expense.minorUnits));
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("payment-undo-limit");
  receipts[receiptIndex] = Object.freeze({ ...receipt, sources: Object.freeze(remaining), separatedSourceIds: Object.freeze(originalExclusions) });
  receipts.push(Object.freeze({ expenseId: sourceExpenseId, merchant: expense.description, currency: receipt.currency, minorUnits: receipt.minorUnits,
    sources: Object.freeze([source]), separatedSourceIds: Object.freeze(restoredExclusions), restoredFromExpenseId: primaryExpenseId }));
  const ledgers = [...state.ledgers];
  ledgers[ledgerIndex] = Object.freeze({ ...ledger, expenses: Object.freeze([...ledger.expenses, expense]), automationPaymentReceipts: Object.freeze(receipts), updatedAt: new Date().toISOString() });
  return Object.freeze({ state: Object.freeze({ ...state, ledgers: Object.freeze(ledgers) }), restoredExpenseId: sourceExpenseId, usedLegacySnapshot });
}
