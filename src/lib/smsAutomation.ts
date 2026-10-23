import type { Locale } from "./types";

/** Native-generated, package-scoped sender identity, never a real app package. */
export function isSmsSenderSource(value: string): boolean {
  return /^walletdiary\.sms\.s[0-9a-f]{64}$/.test(value);
}

const ko = {
  title: "문자 결제·이체 알림도 감지",
  consent: "켜면 기본 문자 앱이 표시한 알림 본문과 발신자를 기기 안에서 검사합니다. 결제·보낸 이체·취소 완료 표현이 있는 알림만 후보로 만듭니다. 문자함·과거 문자·연락처는 읽지 않고 원문을 저장하거나 전송하지 않습니다. 새 발신자는 검토하며, 직접 신뢰한 발신자만 자동 기록합니다. 발신자 표시는 위조될 수 있으므로 은행에서 온 문자인지 확인하세요. 숨겨진 알림, 일부 언어·형식은 인식하지 못할 수 있습니다. 언제든 끌 수 있습니다.",
  confirm: "이 문자 발신자가 내 은행·카드사의 거래 알림 발신자임을 확인합니다.",
  trust: "이 문자 발신자를 신뢰",
  source: "신뢰한 문자 발신자",
  off: "문자 감지가 꺼져 있습니다. 신뢰한 발신자도 자동 기록하지 않습니다.",
};
const en: Record<keyof typeof ko, string> = {
  title: "Also detect SMS payment & transfer alerts",
  consent: "When enabled, notification text and senders from your default SMS app are checked only on this device. Only alerts with completed payment, outgoing transfer or cancellation wording become candidates. Your inbox, past messages and contacts are not read; raw text is never stored or sent. New senders need review; only senders you trust can be recorded automatically. Sender labels can be spoofed: verify the message came from your bank. Hidden alerts and some languages or formats may be missed. You can turn this off at any time.",
  confirm: "I confirm this SMS sender sends transaction alerts from my bank or card provider.",
  trust: "Trust this SMS sender",
  source: "Trusted SMS sender",
  off: "SMS detection is off. Even trusted senders will not be recorded automatically.",
};
const fr: Record<keyof typeof ko, string> = {
  title: "Détecter aussi les alertes de paiement et virement par SMS",
  consent: "Cette option analyse uniquement sur cet appareil le texte et l’expéditeur des notifications de votre application SMS par défaut. Seules les alertes indiquant un paiement, un virement émis ou une annulation effectués deviennent des suggestions. La boîte SMS, les anciens messages et les contacts ne sont pas lus ; le texte brut n’est ni conservé ni envoyé. Les nouveaux expéditeurs sont à vérifier ; seuls ceux que vous approuvez peuvent être enregistrés automatiquement. Un nom d’expéditeur peut être usurpé : vérifiez l’origine bancaire du message. Des alertes masquées, langues ou formats peuvent ne pas être reconnus. Vous pouvez désactiver cette option à tout moment.",
  confirm: "Je confirme que cet expéditeur SMS envoie les alertes de ma banque ou de ma carte.",
  trust: "Faire confiance à cet expéditeur SMS",
  source: "Expéditeur SMS approuvé",
  off: "La détection SMS est désactivée, y compris pour les expéditeurs approuvés.",
};
export function smsText(locale: Locale, key: keyof typeof ko): string { return ({ ko, en, fr })[locale][key]; }
