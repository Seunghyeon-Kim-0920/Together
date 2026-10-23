import { t } from "./i18n";
import type { ExpenseTransactionType, GeneralExpense, GeneralLedger, Locale } from "./types";

/** Older expenses retain debit evidence only in private notification receipts.
 * Never guess a transfer from the payee name or an ambiguous mixed receipt. */
export function expenseTransactionType(ledger: GeneralLedger, expense: GeneralExpense): ExpenseTransactionType | undefined {
  if (expense.transactionType) return expense.transactionType;
  const sources = (ledger.automationPaymentReceipts ?? []).filter((receipt) => receipt.expenseId === expense.id).flatMap((receipt) => receipt.sources);
  if (!sources.length) return undefined;
  const types = new Set(sources.map((source) => source.eventType ?? "purchase"));
  return types.size === 1 ? [...types][0] : undefined;
}

export function expenseTransactionLabel(locale: Locale, type: ExpenseTransactionType): string {
  if (type === "outgoing_transfer") return t(locale, "outgoingTransferEvent");
  if (type === "direct_debit") return t(locale, "directDebitEvent");
  if (type === "standing_order") return t(locale, "standingOrderEvent");
  return t(locale, "paymentEvent");
}
