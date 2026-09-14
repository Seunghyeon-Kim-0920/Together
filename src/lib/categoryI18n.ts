import type { Locale } from "./types";

const copy = {
  ko: { remembered: "같은 사용처의 다음 결제에도 이 분류를 적용합니다.", currencyReview: "신뢰한 앱이어도 기존 연결 가계부와 다른 화폐의 결제는 직접 검토해야 합니다. 금액을 자동 환산하지 않습니다." },
  en: { remembered: "This category will also be used for future payments at the same merchant.", currencyReview: "Payments in a different currency from an existing linked ledger require your review, even from a trusted app. Amounts are not automatically converted." },
  fr: { remembered: "Cette catégorie sera aussi utilisée pour les prochains paiements chez ce commerçant.", currencyReview: "Un paiement dans une devise différente d’un carnet déjà associé doit être vérifié, même si l’application est approuvée. Aucun montant n’est converti automatiquement." },
} satisfies Record<Locale, Record<string, string>>;

export function categoryText(locale: Locale, key: keyof typeof copy.ko): string { return copy[locale][key]; }
