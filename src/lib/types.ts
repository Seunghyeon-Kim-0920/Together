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

interface LedgerBase {
  readonly id: string;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TravelLedger extends LedgerBase {
  readonly kind: "travel";
  readonly currencies: readonly string[];
  readonly defaultCurrency: string;
  readonly participants: readonly Participant[];
  readonly selfParticipantId: string | null;
  readonly expenses: readonly TravelExpense[];
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
