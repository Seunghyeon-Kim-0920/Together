import type { Locale } from "./types";

const copy = {
  ko: { descriptionRemembered: "내용을 바꾸면 이 가계부에서 같은 사용처의 다음 알림도 바꾼 내용으로 기록합니다.", remembered: "같은 사용처의 다음 결제에도 이 분류를 적용합니다.", currencyReview: "신뢰한 앱이어도 기존 연결 가계부와 다른 화폐의 결제는 직접 검토해야 합니다. 금액을 자동 환산하지 않습니다." },
  en: { descriptionRemembered: "Renaming this expense also names future alerts from the same merchant in this ledger.", remembered: "This category will also be used for future payments at the same merchant.", currencyReview: "Payments in a different currency from an existing linked ledger require your review, even from a trusted app. Amounts are not automatically converted." },
  fr: { descriptionRemembered: "Le libellé modifié sera repris pour les prochaines alertes du même commerçant dans ce carnet.", remembered: "Cette catégorie sera aussi utilisée pour les prochains paiements chez ce commerçant.", currencyReview: "Un paiement dans une devise différente d’un carnet déjà associé doit être vérifié, même si l’application est approuvée. Aucun montant n’est converti automatiquement." },
} satisfies Record<Locale, Record<string, string>>;

export function categoryText(locale: Locale, key: keyof typeof copy.ko): string { return copy[locale][key]; }
