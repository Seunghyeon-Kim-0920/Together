export const SUPPORTED_LOCALES = ["ko", "en", "fr"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export type LedgerKind = "travel" | "general";

export const TRAVEL_CATEGORIES = ["accommodation", "transport", "food", "activities", "shopping", "insurance", "other"] as const;
export type TravelCategory = (typeof TRAVEL_CATEGORIES)[number];
export const GENERAL_CATEGORIES = ["food", "transport", "housing", "utilities", "shopping", "health", "leisure", "education", "subscriptions", "travel", "other"] as const;
export type GeneralCategory = (typeof GENERAL_CATEGORIES)[number];

export interface Participant {
  readonly id: string;
  readonly name: string;
}

export interface ExpenseShare {
  readonly participantId: string;
  readonly minorUnits: number;
}

export interface TravelExpense {
  readonly id: string;
  readonly description: string;
  readonly category: TravelCategory;
  readonly currency: string;
  readonly minorUnits: number;
  readonly paidBy: string;
  readonly shares: readonly ExpenseShare[];
  readonly occurredOn: string;
}

export interface GeneralExpense {
  readonly id: string;
  readonly description: string;
  readonly category: GeneralCategory;
  readonly currency: string;
  readonly minorUnits: number;
  readonly occurredOn: string;
  /** Immutable, private deduplication marker for card-notification imports. */
  readonly automationFingerprint?: string;
  /** Immutable, private merchant/amount marker used to match later reversals. */
  readonly automationReversalFingerprint?: string;
}

export interface AutomationSource {
  readonly packageName: string;
  readonly displayName: string;
  /** The user explicitly confirmed this is a direct bank/card app, not a relay. */
  readonly trustedDirectApp: true;
}

/** Explicit local user choices, excluded from shared ledgers/PDFs. */
export interface MerchantCategoryPreference {
  readonly merchantKey: string;
  readonly category: GeneralCategory;
  readonly updatedAt: string;
}

/** Private evidence joining one wallet alert to its issuing bank alert. Kept
 * separately from editable expenses, and never included in shared files. */
export interface AutomationPaymentReceipt {
  readonly expenseId: string;
  readonly merchant: string;
  readonly currency: string;
  readonly minorUnits: number;
  /** Explicit local corrections: these native source ids must never rejoin. */
  readonly separatedSourceIds?: readonly string[];
  /** A restored notification remains auditable without exposing raw text. */
  readonly restoredFromExpenseId?: string;
  readonly sources: readonly {
    readonly expenseId: string;
    readonly packageName: string;
    readonly occurredAt: string;
    /** Android notification post time; older receipts may not have it. */
    readonly deliveredAt?: string;
    /** Receipts before v1.8.4 were created for purchases only. */
    readonly eventType?: "purchase" | "outgoing_transfer" | "direct_debit" | "standing_order";
    readonly originFingerprint: string;
    readonly reversalFingerprint: string;
    /** Immutable display fields captured before any later expense edits.
     * All three are absent on receipts written before merge-undo existed. */
    readonly merchant?: string;
    readonly category?: GeneralCategory;
    readonly occurredOn?: string;
  }[];
}

/** Private, local import receipts. These never belong in a shared ledger. */
export interface StatementImportReceipt {
  readonly kind: "payment" | "adjustment";
  readonly id: string;
  readonly expenseId: string;
  readonly transactionKey?: string;
}

interface LedgerBase {
  readonly id: string;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly statementImportHistory?: readonly StatementImportReceipt[];
}

export interface TravelLedger extends LedgerBase {
  readonly kind: "travel";
  readonly currencies: readonly string[];
  readonly defaultCurrency: string;
  readonly participants: readonly Participant[];
  readonly selfParticipantId: string | null;
  readonly expenses: readonly TravelExpense[];
  /** Private opt-in collaboration identity, cloud baseline and durable outbox. */
  readonly sharedSync?: import("./sharedTravelLocal").SharedTravelLocalState;
}

export interface GeneralLedger extends LedgerBase {
  readonly kind: "general";
  readonly currency: string;
  readonly monthlyLimitMinor: number | null;
  /** Explicit consent to inspect payment-shaped notifications from any app. */
  readonly automationAllApps: boolean;
  readonly automationSources: readonly AutomationSource[];
  /** Private idempotency tombstones for durably applied cancellation alerts. */
  readonly automationReversalIds: readonly string[];
  /** Private source expense ids and automation fingerprints retained after a
   * move, so imports cannot recreate the expense in this general ledger. */
  readonly movedExpenseIds: readonly string[];
  readonly automationPaymentReceipts?: readonly AutomationPaymentReceipt[];
  readonly merchantCategoryPreferences?: readonly MerchantCategoryPreference[];
  readonly expenses: readonly GeneralExpense[];
}

export type Ledger = TravelLedger | GeneralLedger;

export interface WalletState {
  readonly version: 2;
  readonly locale: Locale;
  readonly activeLedgerId: string | null;
  readonly ledgers: readonly Ledger[];
}

export const EMPTY_WALLET_STATE: WalletState = Object.freeze({
  version: 2,
  locale: "ko",
  activeLedgerId: null,
  ledgers: Object.freeze([]),
});
