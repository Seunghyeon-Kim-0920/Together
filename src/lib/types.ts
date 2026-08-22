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
