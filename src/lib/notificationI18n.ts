import type { Locale } from "./types";

const ko = {
  merchantRequired: "결제 금액은 찾았지만 사용처를 확인하지 못했습니다. 사용처를 입력하고 실제 결제인지 확인한 뒤 기록해주세요.",
  merchantUnknown: "사용처 확인 필요",
  currencyMismatch: "이 내역은 {currency}입니다. 같은 화폐의 일반 가계부를 열거나 새로 만들어 기록해주세요. 임의로 환산하지 않습니다.",
  discoveryOff: "새 은행·카드 앱을 찾으려면 ‘앱 제한 없이 결제·이체 알림 감지’를 켜주세요. 처음 보는 앱은 확인 대기로 보내며 자동으로 신뢰하지 않습니다.",
  recheck: "현재 알림 다시 확인",
  recheckHelp: "알림창에 아직 남아 있는 알림만 다시 확인합니다. 삭제된 알림이나 은행 거래내역은 복원하지 못합니다.",
  disconnected: "알림 접근은 허용됐지만 감지 서비스가 연결되지 않았습니다. 다시 확인을 누르거나 Android 설정에서 알림 접근을 껐다 켜주세요.",
  recheckError: "알림을 다시 확인하지 못했습니다. 알림 접근 권한을 확인해주세요.",
  history: "새 알림과 사용자가 다시 확인한 현재 알림만 처리합니다. 은행의 과거 거래내역을 직접 읽지는 않습니다.",
};
type Key = keyof typeof ko;
const en: Record<Key, string> = {
  merchantRequired: "An amount was detected, but the merchant is missing. Enter the merchant and verify that this is a real payment before saving.",
  merchantUnknown: "Merchant required",
  currencyMismatch: "This item is in {currency}. Open or create a general ledger using that currency to record it. No exchange rate is assumed.",
  discoveryOff: "Turn on detection from all apps to discover new bank or card apps. New apps go to review and are never trusted automatically.",
  recheck: "Recheck current notifications",
  recheckHelp: "Only notifications still in the notification shade can be rechecked. Dismissed notifications and bank history cannot be recovered.",
  disconnected: "Notification access is allowed, but the listener is disconnected. Recheck, or turn notification access off and on in Android settings.",
  recheckError: "Could not recheck notifications. Please check notification access permission.",
  history: "Processes new notifications and current notifications you explicitly recheck. It does not read past bank transactions directly.",
};
const fr: Record<Key, string> = {
  merchantRequired: "Un montant a été détecté, mais le commerçant manque. Saisissez-le et vérifiez qu’il s’agit d’un paiement réel avant d’enregistrer.",
  merchantUnknown: "Commerçant à préciser",
  currencyMismatch: "Cette opération est en {currency}. Ouvrez ou créez un carnet quotidien dans cette devise pour l’enregistrer. Aucune conversion n’est supposée.",
  discoveryOff: "Activez la détection de toutes les applications pour découvrir de nouvelles applications bancaires ou de cartes. Elles restent à vérifier et ne sont jamais approuvées automatiquement.",
  recheck: "Revérifier les notifications actuelles",
  recheckHelp: "Seules les notifications encore présentes dans le volet peuvent être revérifiées. Les notifications effacées et l’historique bancaire ne peuvent pas être récupérés.",
  disconnected: "L’accès aux notifications est autorisé, mais le service est déconnecté. Relancez la vérification ou désactivez puis réactivez cet accès dans les paramètres Android.",
  recheckError: "Impossible de revérifier les notifications. Vérifiez l’autorisation d’accès.",
  history: "Traite les nouvelles notifications et celles encore présentes que vous choisissez de revérifier. Ne lit pas directement l’historique bancaire.",
};
const messages = { ko, en, fr };
export function notificationText(locale: Locale, key: Key): string { return messages[locale][key]; }
