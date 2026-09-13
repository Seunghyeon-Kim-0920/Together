import type { AutomationPaymentReceipt, GeneralLedger, WalletState } from "./types";

// Exact package identities are only used to recognize the wallet/issuer pair,
// never as a capture allow-list. Unknown banks still enter the normal review.
const WALLET_PACKAGES = new Set([
  "com.google.android.apps.walletnfcrel", "com.google.android.apps.nbu.paisa.user",
  "com.google.android.apps.gmoney", "com.samsung.android.spay", "com.samsung.android.spaymini",
]);

export interface PaymentDuplicateEvidence {
  readonly expenseId: string;
  readonly packageName: string;
  readonly occurredAt: string;
  readonly originFingerprint: string;
  readonly reversalFingerprint: string;
  readonly merchant: string;
  readonly currency: string;
  readonly minorUnits: number;
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
  const candidateWallet = WALLET_PACKAGES.has(evidence.packageName.toLowerCase());
  const candidates: PaymentReceiptLocation[] = [];
  const deliveredAt = Date.parse(evidence.occurredAt);
  for (const [ledgerIndex, ledger] of ledgers.entries()) if (ledger.kind === "general") {
    for (const [receiptIndex, receipt] of (ledger.automationPaymentReceipts ?? []).entries()) {
      if (receipt.currency !== evidence.currency || receipt.minorUnits !== evidence.minorUnits || receipt.sources.length >= 8
        || receipt.sources.some((source) => source.packageName === evidence.packageName)) continue;
      const corresponding = receipt.sources.filter((source) => WALLET_PACKAGES.has(source.packageName.toLowerCase()) !== candidateWallet);
      if (!corresponding.length) continue;
      const differenceMs = Math.min(...corresponding.map((source) => Math.abs(deliveredAt - Date.parse(source.occurredAt))));
      if (Number.isFinite(differenceMs) && sameMerchant(receipt.merchant, evidence.merchant, differenceMs)) candidates.push({ ledgerIndex, receiptIndex, receipt });
    }
  }
  // Repeated equal purchases in the same store cannot be resolved just by
  // choosing the nearest timestamp. Keep an ambiguous alert for review.
  return candidates.length === 1 ? candidates[0] : null;
}

/** Longer delays and multiple equally plausible receipts need a decision.
 * This never deletes or merges an expense on merchant/amount alone. */
export function hasPossibleCrossSourcePayment(ledgers: WalletState["ledgers"], evidence: PaymentDuplicateEvidence): boolean {
  const candidateWallet = WALLET_PACKAGES.has(evidence.packageName.toLowerCase());
  const deliveredAt = Date.parse(evidence.occurredAt);
  return ledgers.some((ledger) => ledger.kind === "general" && (ledger.automationPaymentReceipts ?? []).some((receipt) =>
    receipt.currency === evidence.currency && receipt.minorUnits === evidence.minorUnits
    && !receipt.sources.some((source) => source.packageName === evidence.packageName)
    && sameMerchant(receipt.merchant, evidence.merchant, 0)
    && receipt.sources.some((source) => WALLET_PACKAGES.has(source.packageName.toLowerCase()) !== candidateWallet
      && Math.abs(deliveredAt - Date.parse(source.occurredAt)) <= 24 * 60 * 60_000)));
}

export function paymentReceipt(evidence: PaymentDuplicateEvidence, expenseId = evidence.expenseId): AutomationPaymentReceipt {
  return Object.freeze({ expenseId, merchant: evidence.merchant, currency: evidence.currency, minorUnits: evidence.minorUnits, sources: Object.freeze([paymentReceiptSource(evidence)]) });
}

function paymentReceiptSource(evidence: PaymentDuplicateEvidence): AutomationPaymentReceipt["sources"][number] {
  return Object.freeze({ expenseId: evidence.expenseId, packageName: evidence.packageName, occurredAt: evidence.occurredAt, originFingerprint: evidence.originFingerprint, reversalFingerprint: evidence.reversalFingerprint });
}

export function joinPaymentReceipt(ledger: GeneralLedger, location: PaymentReceiptLocation, evidence: PaymentDuplicateEvidence): GeneralLedger {
  const receipts = [...ledger.automationPaymentReceipts ?? []];
  receipts[location.receiptIndex] = Object.freeze({ ...location.receipt, sources: Object.freeze([...location.receipt.sources, paymentReceiptSource(evidence)]) });
  return Object.freeze({ ...ledger, automationPaymentReceipts: Object.freeze(receipts), updatedAt: new Date().toISOString() });
}
