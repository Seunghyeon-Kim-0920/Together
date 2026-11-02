import type { Locale } from "./types";

const COPY = {
  ko: {
    received: "받은 캐시백 · 지출 아님",
    selectPurchase: "캐시백을 받은 원래 결제",
    choosePurchase: "원래 결제를 직접 선택하세요",
    help: "어떤 결제의 캐시백인지 확실하지 않아 자동으로 차감하지 않았습니다. 해당 결제를 선택하면 그 지출에서만 차감합니다.",
    noMatch: "연결할 수 있는 원래 결제가 없습니다. 결제 알림이 기록된 뒤 다시 확인해주세요. 캐시백만으로 지출을 만들지는 않습니다.",
    topup: "충전할 때 받은 할인·충전 보너스는 결제 캐시백으로 다시 차감하지 마세요.",
    apply: "원래 결제에서 차감",
    applied: "캐시백을 원래 결제에서 차감했습니다.",
    net: "결제 {gross} − 캐시백 {cashback} = 기록할 지출 {net}",
    pending: "확인할 결제·이체·취소·캐시백",
  },
  en: {
    received: "Cashback received · not spending",
    selectPurchase: "Purchase that earned this cashback",
    choosePurchase: "Select the original purchase",
    help: "The original purchase could not be identified with certainty, so nothing was deducted automatically. Select the purchase to deduct this cashback from that expense only.",
    noMatch: "No eligible original purchase is available. Check again after its payment notification has been recorded. Cashback alone never creates an expense.",
    topup: "Do not deduct top-up discounts or top-up bonuses again as purchase cashback.",
    apply: "Deduct from original purchase",
    applied: "Cashback was deducted from the original purchase.",
    net: "Payment {gross} − cashback {cashback} = expense {net}",
    pending: "Payments, transfers, cancellations & cashback to review",
  },
  fr: {
    received: "Cashback reçu · pas une dépense",
    selectPurchase: "Achat ayant généré ce cashback",
    choosePurchase: "Sélectionnez l’achat d’origine",
    help: "L’achat d’origine n’a pas pu être identifié avec certitude : aucune déduction automatique n’a été effectuée. Sélectionnez l’achat pour déduire ce cashback uniquement de cette dépense.",
    noMatch: "Aucun achat d’origine admissible n’est disponible. Vérifiez à nouveau après l’enregistrement de sa notification de paiement. Un cashback seul ne crée jamais de dépense.",
    topup: "Ne déduisez pas une seconde fois les remises ou bonus de recharge en tant que cashback sur un achat.",
    apply: "Déduire de l’achat d’origine",
    applied: "Le cashback a été déduit de l’achat d’origine.",
    net: "Paiement {gross} − cashback {cashback} = dépense {net}",
    pending: "Paiements, virements, annulations et cashback à vérifier",
  },
} as const;

export function cashbackText(locale: Locale, key: keyof typeof COPY.ko): string {
  return COPY[locale][key];
}
