export const SUPPORTED_LOCALES = ["ko", "en", "fr", "ja", "zh"] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export type LocalizedText = Readonly<Record<SupportedLocale, string>>;

export interface Coordinates {
  readonly latitude: number;
  readonly longitude: number;
}

export interface Country {
  readonly code: string;
  readonly names: LocalizedText;
}

export interface City {
  readonly id: string;
  readonly names: LocalizedText;
  readonly country: Country;
  readonly coordinates: Coordinates;
  readonly timeZone: string;
}

export const DATA_PROVENANCE_KINDS = [
  "observed",
  "scheduled",
  "estimated",
  "unavailable",
] as const;

export type DataProvenanceKind = (typeof DATA_PROVENANCE_KINDS)[number];

export type DataProvenance =
  | {
      readonly kind: "observed";
      readonly source: string;
      readonly observedAt: string;
      readonly sampleWindow?: string;
    }
  | {
      readonly kind: "scheduled";
      readonly source: string;
      readonly scheduleVersion?: string;
    }
  | {
      readonly kind: "estimated";
      readonly methodology: string;
      readonly source?: string;
      readonly calculatedAt?: string;
    }
  | {
      readonly kind: "unavailable";
      readonly reason: string;
    };

export const PROVENANCE_LABELS: Readonly<
  Record<DataProvenanceKind, LocalizedText>
> = {
  observed: {
    ko: "관측 평균",
    en: "Measured average",
    fr: "Moyenne mesurée",
    ja: "観測平均",
    zh: "观测平均",
  },
  scheduled: {
    ko: "공식 운행표",
    en: "Published schedule",
    fr: "Horaire publié",
    ja: "公開時刻表",
    zh: "公布时刻表",
  },
  estimated: {
    ko: "추정치",
    en: "Estimate",
    fr: "Estimation",
    ja: "推定値",
    zh: "估算值",
  },
  unavailable: {
    ko: "데이터 없음",
    en: "Unavailable",
    fr: "Indisponible",
    ja: "データなし",
    zh: "暂无数据",
  },
};

export const TRANSPORT_MODES = [
  "walk",
  "metro",
  "taxi",
  "car",
  "bus",
  "train",
  "flight",
  "ferry",
] as const;

export type TransportMode = (typeof TRANSPORT_MODES)[number];

export const DURATION_COMPONENT_KINDS = [
  "city_to_terminal",
  "waiting",
  "check_in_security",
  "border_control",
  "in_vehicle",
  "transfer",
  "baggage",
  "terminal_to_city",
  "buffer",
] as const;

export type DurationComponentKind =
  (typeof DURATION_COMPONENT_KINDS)[number];

export interface DurationComponent {
  readonly kind: DurationComponentKind;
  readonly label: string;
  readonly minutes: number;
}

export interface DurationBreakdown {
  readonly components: readonly DurationComponent[];
  readonly totalMinutes: number;
}

export interface TransportSegment {
  readonly id: string;
  readonly mode: TransportMode;
  readonly from: string;
  readonly to: string;
  readonly provenance: DataProvenance;
  readonly duration: DurationBreakdown | null;
}

export interface TravelLeg {
  readonly id: string;
  readonly fromCityId: string;
  readonly toCityId: string;
  readonly segments: readonly TransportSegment[];
  readonly modes: readonly TransportMode[];
  readonly isMixedTransport: boolean;
  readonly provenance: DataProvenance;
  readonly totalMinutes: number | null;
}

export interface OptimizedItinerary {
  readonly cityOrder: readonly string[];
  readonly legs: readonly TravelLeg[];
  readonly totalMinutes: number;
  readonly provenance: DataProvenance;
}

export const EXPENSE_CATEGORIES = [
  "accommodation",
  "transport",
  "food",
  "activities",
  "shopping",
  "insurance",
  "other",
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export interface Money {
  readonly currency: string;
  readonly minorUnits: number;
}

export interface ExpenseShare {
  readonly participantId: string;
  readonly minorUnits: number;
}

export interface Expense {
  readonly id: string;
  readonly tripId: string;
  readonly paidBy: string;
  readonly category: ExpenseCategory;
  readonly description: string;
  readonly amount: Money;
  readonly shares: readonly ExpenseShare[];
  readonly occurredAt: string;
}

export interface ParticipantBalance {
  readonly participantId: string;
  readonly amount: Money;
}

export interface SettlementTransfer {
  readonly fromParticipantId: string;
  readonly toParticipantId: string;
  readonly amount: Money;
}

export interface CurrencySettlement {
  readonly currency: string;
  readonly balances: readonly ParticipantBalance[];
  readonly transfers: readonly SettlementTransfer[];
}

export class DomainValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainValidationError";
  }
}

export function provenanceLabel(
  provenance: DataProvenance,
  locale: SupportedLocale = "en",
): string {
  return PROVENANCE_LABELS[provenance.kind][locale];
}
