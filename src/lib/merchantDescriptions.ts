import { merchantDisplayName } from "./merchant";
import type { GeneralExpense, GeneralLedger } from "./types";

export const MAX_MERCHANT_DESCRIPTION_PREFERENCES = 5_000;

/** Exact normalized name, not a fuzzy merchant/category key. Preserve branch
 * numbers, accents and punctuation so a different shop is not renamed. */
export function descriptionMerchantKey(value: string): string {
  const normalized = value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en");
  return normalized.length <= 500 && ![...normalized].some((character) => character.charCodeAt(0) < 32) ? normalized : "";
}

export function resolveMerchantDescription(ledger: GeneralLedger, original: string): string {
  const key = descriptionMerchantKey(original);
  return ledger.merchantDescriptionPreferences?.find((entry) => entry.merchantKey === key)?.description ?? original;
}

/** Called only on a user's explicit edit. A display alias never becomes a new
 * bank identity, and other old expenses are intentionally left untouched. */
export function rememberMerchantDescription(ledger: GeneralLedger, expense: GeneralExpense, previous?: GeneralExpense): GeneralLedger {
  if (!previous) return ledger;
  const description = merchantDisplayName(expense.description, expense.id).trim();
  if (!description || description.length > 500 || description === merchantDisplayName(previous.description, previous.id)) return ledger;
  const original = previous.originalMerchant ?? merchantDisplayName(previous.description, previous.id);
  const originals = [original];
  for (const receipt of ledger.automationPaymentReceipts ?? []) if (receipt.expenseId === previous.id) {
    originals.push(receipt.merchant);
    for (const source of receipt.sources) if (source.merchant) originals.push(source.merchant);
  }
  const keys = new Set(originals.map(descriptionMerchantKey).filter(Boolean));
  const updatedAt = new Date().toISOString();
  const preferences = [...(ledger.merchantDescriptionPreferences ?? []).filter((entry) => !keys.has(entry.merchantKey)),
    ...[...keys].map((merchantKey) => Object.freeze({ merchantKey, description, updatedAt }))];
  return Object.freeze({ ...ledger,
    merchantDescriptionPreferences: Object.freeze(preferences.slice(-MAX_MERCHANT_DESCRIPTION_PREFERENCES)),
    expenses: Object.freeze(ledger.expenses.map((item) => item.id === expense.id ? Object.freeze({ ...item, originalMerchant: original }) : item)),
  });
}
