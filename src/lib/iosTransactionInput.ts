import { parseNativeCardCandidate, type CardCandidateEventType, type NativeCardCandidate } from "./cardAutomation";
import { availableCurrencies, currencyDigits, parseMinorUnits } from "./currency";

/** Input supplied by a user-configured Shortcuts automation, not an authenticated
 * bank feed. Never accept a source package, confidence or category from input. */
export interface IosTransactionInput {
  readonly id: string;
  readonly queueToken: string;
  readonly kind: "notification" | "message" | "wallet";
  readonly sourceName: string;
  readonly title?: string;
  readonly body?: string;
  readonly receivedAt: number;
  readonly amount?: string;
  readonly currency?: string;
  readonly merchant?: string;
}

const CURRENCIES = new Set(availableCurrencies());
const MAX_TEXT = 8_000;
const MONEY_NUMBER = "[+−-]?\\s*\\d(?:[\\d.,'’\\u00a0\\u202f ]*\\d)?";
const MONEY_UNIT = "(?:[A-Z]{3}|US\\$|CA\\$|AU\\$|NZ\\$|HK\\$|SG\\$|€|£|₩|원|달러|유로)";
const MONEY = new RegExp(`(${MONEY_UNIT})\\s*(${MONEY_NUMBER})|(${MONEY_NUMBER})\\s*(${MONEY_UNIT})`, "gu");
const BALANCE = /(?:잔액|누적|이용한도|사용한도|가능금액|남은|balance|available|remaining|credit limit|solde|plafond|cumul)/iu;
const PROMOTION = /(?:[([]\s*(?:광고|ad|advertisement|publicit[eé]|werbung|広告|广告|廣告)\s*[)\]]|수신\s*거부|무료\s*수신|unsubscribe|reply\s+stop|대출\s*(?:승인|한도|가능|신청)|(?:loan|credit)\s+(?:(?:has been|was)\s+)?(?:approved|offer|eligible)|(?:pr[eê]t|cr[eé]dit)\s+(?:approuv[eé]|accord[eé]|offert)|(?:결제|사용|구매)(?:하면|\s*시(?:마다)?|만\s*하면)|(?:spend|pay|shop).{0,50}(?:to earn|to get|and get|and earn)|(?:쿠폰|포인트)\s*(?:지급|적립|증정|만료|소멸)|(?:points?|coupons?|vouchers?)\s+(?:credited|earned|awarded|expire)|(?:gagnez|profitez|offre promotionnelle)|월간\s*(?:명세|이용)|monthly\s*statement|relev[eé]\s+mensuel)/iu;
const NOT_COMPLETED = /(?:승인\s*(?:요청|필요|해\s*주|하세|해야)|인증\s*(?:요청|필요|번호)|결제\s*(?:요청|예정|대기)|이체\s*(?:요청|예정|예약|접수|대기)|취소\s*(?:요청|예정|접수)|환불\s*(?:요청|예정|접수)|출금\s*(?:예정|예약|요청)|실패|거절|미승인|처리되지|(?:verify|approve|confirm|authori[sz]e|authenticate)\s+(?:(?:this|your|the|a|an)\s+)?(?:(?:online|card)\s+)?(?:payment|purchase|transaction|transfer)|tap\s+to\s+(?:verify|approve|confirm|pay)|(?:payment|transfer|refund|withdrawal|direct debit|standing order).{0,35}(?:pending|requested|scheduled|due|declined|failed|unsuccessful|rejected|reminder)|(?:you(?:'|’)re|you are)\s+making\s+(?:an?\s+)?(?:online\s+)?(?:card\s+)?payment|(?:demande|demandez|confirmez|validez|autorisez|v[eé]rifiez).{0,30}(?:paiement|virement|transaction)|(?:paiement|virement|pr[eé]l[eè]vement).{0,30}(?:en attente|refus[eé]|[eé]chou[eé]|pr[eé]vu)|\b(?:OTP|one.time password|verification code|3D secure)\b|결제하지\s*않|not\s+(?:paid|completed|approved|sent)|nicht\s+(?:bezahlt|ausgef[uü]hrt)|支払いリクエスト|付款请求|付款請求)/iu;
// The status “결제 승인” is a completed authorization, not an instruction to
// authorize. Require an explicit request/imperative; a bare status is accepted.
const REQUEST = /(?:\b(?:payment|money|transfer|refund)\s+request\b|\brequest\s+(?:a |for |to )?(?:payment|pay|money)\b|\b(?:approval|authori[sz]ation|confirmation)\s+(?:requested|required|needed)\b|\b(?:awaiting|requires?)\s+(?:approval|confirmation|verification)\b|승인\s*해\s*야|결제를?\s*승인\s*(?:해\s*주|해\s*야|하세|하셔|바랍|부탁)|결제\s*확인\s*(?:요청|필요)|paiement.{0,20}[aà]\s+(?:valider|confirmer|v[eé]rifier)|Zahlung\s+(?:best[aä]tigen|freigeben)|best[aä]tigen\s+Sie.{0,30}Zahlung|(?:confirme|confirma|autoriza|autorizza|conferma).{0,30}(?:pago|pagamento)|(?:支払|決済).{0,20}(?:承認|確認)(?:して|が必要)|(?:请|請).{0,10}(?:确认|確認|批准).{0,10}(?:付款|支付))/iu;
const OFFER = /(?:\bpre.?approved\s+(?:loan|credit)\b|\b(?:loan|credit)\s+approval\b|\b(?:special|exclusive|limited.time)\s+offer\b|\b(?:payment|purchase|card)\s+(?:offer|benefits?|rewards?)\b|\bcashback\b.{0,30}\b(?:available|up to|eligible|offer|potential)\b|결제\s*혜택|캐시백\s*(?:최대|예정|예상)|카드\s*혜택|포인트\s*안내)/iu;
// Completion tokens must not override an explicit negative status. In particular,
// French « invalidé » contains « validé », but is never a completed payment.
const NEGATED_COMPLETION = /(?:(?<!\p{L})invalid[eé]e?(?!\p{L})|(?<!\p{L})(?:non|pas|jamais)\s+(?:valid[eé]e?|accept[eé]e?|autoris[eé]e?|confirm[eé]e?|effectu[eé]e?|pay[eé]e?|envoy[eé]e?)(?!\p{L})|n['’](?:est|a)\s+pas(?:\s+[eé]t[eé])?\s+(?:valid[eé]e?|accept[eé]e?|autoris[eé]e?|confirm[eé]e?|effectu[eé]e?|pay[eé]e?|envoy[eé]e?)(?!\p{L})|\b(?:not|never|hasn['’]t been|wasn['’]t)\s+(?:approved|authori[sz]ed|confirmed|completed|processed|paid|sent|executed|successful)\b|(?:결제|승인|이체|송금|출금)(?:이|가)?\s*(?:미완료|미처리|불가|불가능|안\s*(?:됨|됐|되)|되지))/iu;
const ADDITIONAL_REQUEST = /(?:\b(?:paiement|virement|transaction).{0,30}[aà]\s+(?:approuver|autoriser)|\bapprouvez.{0,30}(?:paiement|virement|transaction)|\b(?:payment|transaction|transfer).{0,35}(?:needs?|requires?)\s+(?:your\s+)?(?:approval|authori[sz]ation|verification|confirmation)|결제(?:를|는)?\s*(?:아직\s*)?(?:승인|확인|인증)\s*(?:해|하셔|해야|하기)|승인을?\s*(?:완료해\s*주|부탁|바랍))/iu;
const TOPUP = /(?:충전\s*(?:완료|성공)|(?:top.?up|recharge|chargement)\s+(?:completed|successful|effectu[eé])|자기\s*계좌|내\s*계좌|between\s+(?:your|my|own)\s+accounts|entre\s+(?:vos|mes)\s+comptes)/iu;
const REVERSAL = /(?:결제\s*취소|승인\s*취소|취소\s*완료|환불\s*(?:완료|처리)|\b(?:refunded|reversed)\b|(?:payment|purchase|transaction)\s+(?:cancelled|canceled|reversed)|refund\s+(?:completed|received)|rembours[eé](?:e)?|remboursement\s+(?:effectu[eé]|re[çc]u)|paiement\s+annul[eé]|払い戻し|退款成功)/iu;
const REWARD = /(?:캐시(?:백)?\s*(?:지급|적립)|인센티브\s*지급|페이백\s*지급|cashback\s+(?:credited|received|earned)|cashback\s+re[çc]u)/iu;
const INCOMING = /(?:입금(?:\s*완료)?|송금\s*받|이체\s*받|받았|급여|\b(?:received|incoming|credited|deposit|salary)\b|\b(?:sent|paid|transferred)\s+you\b|\b(?:sent|paid|transferred).{0,80}\bto\s+your?(?:\s+account)?\b|\btransfer\s+from\b|virement\s+re[çc]u|vous\s+avez\s+re[çc]u|Geldeingang|入金)/iu;
const DIRECT_DEBIT = /(?:자동\s*이체|자동\s*납부|direct\s+debit|pr[eé]l[eè]vement|Lastschrift)/iu;
const STANDING_ORDER = /(?:정기\s*이체|standing\s+order|virement\s+permanent|Dauerauftrag)/iu;
const ATM = /(?:현금\s*(?:인출|출금)|ATM\s*(?:인출|출금)|cash\s+withdrawal|withdrew|withdrawn|retrait\s+(?:d’esp[eè]ces|d'esp[eè]ces|effectu[eé]|au|de)|Bargeldabhebung)/iu;
const TRANSFER = /(?:이체|송금|보냈|보냄|\b(?:transfer|sent|wired|remittance)\b|virement|envoy[eé]|[uü]berweisung)/iu;
const EXECUTED = /(?:완료|성공|출금|보냈|보냄|\b(?:paid|spent|sent|debited|completed|successful|processed|withdrawn|withdrew|charged|executed)\b|effectu[eé](?:e)?|envoy[eé](?:e)?|d[eé]bit[eé](?:e)?|pay[eé](?:e)?|ausgef[uü]hrt)/iu;
const PURCHASE = /(?:결제|일시불|할부|\b(?:paid|spent|purchase|payment|charged)\b|paiement|pay[eé]|Zahlung|bezahlt|支払い|支付)/iu;
const APPROVED = /(?:\[승인\]|승인(?:\s|$|되었습니다|됐습니다)|\bapproved\b|(?<!\p{L})(?:valid[eé]e?|accept[eé]e?)(?!\p{L}))/iu;
const METADATA = /^(?:\[?(?:Web발신|재발송)\]?|(?:잔액|누적|한도|합계|총액|카드번호|계좌번호|승인번호|알림|balance|available|remaining|card|account|reference|solde|carte|notification)\b|(?:삼성|신한|현대|국민|농협|하나|롯데|우리|BC|KB|NH)(?:카드|체크|가족)?\s*[\d*]|\d{2,4}[-*][\d*-]+|[가-힣]\*[가-힣]|\d{1,4}[/.-]\d{1,2}(?:[/.-]\d{1,4})?(?:\s|$))/iu;
const STATUS_ONLY = /^(?:(?:카드\s*)?(?:결제|승인|취소|환불|이체|송금|출금|입금|알림)(?:\s*(?:완료|성공|안내|통지))?|(?:card\s*)?(?:payment|purchase|transfer|refund|transaction|cash withdrawal|direct debit|standing order)(?:\s+(?:approved|completed|successful|received|notification))?|(?:paiement|virement|remboursement)(?:\s+(?:valid[eé]|accept[eé]|effectu[eé]|re[çc]u))?|valid[eé]e?|approved|completed|successful|accept[eé]e?|일시불|할부|캐시\s*지급|인센티브\s*지급|cashback\s+(?:received|credited|earned))\s*[.!]*$/iu;

function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function clean(value: string): string { return value.normalize("NFKC").replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/gu, "").replace(/\r\n?/gu, "\n").trim(); }
function string(value: unknown, max: number, required = false): string | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || value.length > max || value.includes("\0")) return undefined;
  const result = clean(value); return result || undefined;
}

export function normalizeIosTransactionInput(value: unknown): IosTransactionInput | null {
  if (!record(value)) return null;
  const id = string(value.id, 200, true); const queueToken = string(value.queueToken, 200, true);
  const sourceName = string(value.sourceName, 80, true); const kind = value.kind; const receivedAt = value.receivedAt;
  if (!id || !queueToken || !sourceName || !["notification", "message", "wallet"].includes(String(kind)) || !Number.isSafeInteger(receivedAt) || (receivedAt as number) <= 0 || (receivedAt as number) > 8.64e15) return null;
  const fields: Partial<Record<"title" | "body" | "amount" | "currency" | "merchant", string>> = {};
  for (const [key, max] of [["title", 500], ["body", MAX_TEXT], ["amount", 80], ["currency", 3], ["merchant", 500]] as const) {
    if (value[key] !== undefined && typeof value[key] !== "string") return null;
    if (typeof value[key] === "string" && (value[key].length > max || value[key].includes("\0"))) return null;
    const field = string(value[key], max); if (field) fields[key] = field;
  }
  if (!fields.title && !fields.body && kind !== "wallet") return null;
  return Object.freeze({ id, queueToken, sourceName, kind: kind as IosTransactionInput["kind"], receivedAt: receivedAt as number, ...fields });
}

/** A display name is not proof of identity; trust is granted separately in UI. */
export function iosSourcePackageName(kind: IosTransactionInput["kind"], sourceName: string): string {
  if (kind === "wallet") return "walletdiary.ios.wallet";
  const source = clean(sourceName).toLocaleLowerCase("en");
  const hashes = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  for (let offset = 0; offset < source.length; offset += 1) for (let index = 0; index < hashes.length; index += 1) hashes[index] = Math.imul(hashes[index] ^ source.charCodeAt(offset), 0x01000193 + index * 2);
  return `walletdiary.ios.${kind}.s${hashes.map((hash) => (hash >>> 0).toString(16).padStart(8, "0")).join("")}`;
}

function currencyCode(unit: string): string | null {
  const mapped: Record<string, string> = { "€": "EUR", "£": "GBP", "₩": "KRW", "원": "KRW", "유로": "EUR", "US$": "USD", "CA$": "CAD", "AU$": "AUD", "NZ$": "NZD", "HK$": "HKD", "SG$": "SGD" };
  const code = mapped[unit] ?? unit; return CURRENCIES.has(code) ? code : null;
}

/** Interpret grouping only when all groups are valid; never use parseFloat. */
function minorAmount(raw: string, currency: string): number | null {
  const unsigned = raw.trim().replace(/^[+−-]\s*/u, "");
  if (/[\s'’]/u.test(unsigned)) {
    const grouped = unsigned.replace(/[\s'’]+/gu, " ");
    if (!/^\d{1,3}(?: \d{3})+(?:[.,]\d{1,3})?$/u.test(grouped)) return null;
  }
  let value = unsigned.replace(/[\s'’]/gu, "");
  const digits = currencyDigits(currency); const comma = value.lastIndexOf(","); const dot = value.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    const decimal = comma > dot ? "," : "."; const group = decimal === "," ? "." : ",";
    const [whole, fraction, extra] = value.split(decimal);
    if (extra !== undefined || !fraction || fraction.length > digits || !new RegExp(`^\\d{1,3}(?:\\${group}\\d{3})+$`).test(whole)) return null;
    value = whole.split(group).join("") + "." + fraction;
  } else if (comma >= 0 || dot >= 0) {
    const separator = comma >= 0 ? "," : "."; const parts = value.split(separator);
    if (parts.length === 2 && parts[1].length <= digits && digits > 0) value = parts.join(".");
    else if (parts.length > 1 && parts[0].length >= 1 && parts[0].length <= 3 && parts.slice(1).every((part) => part.length === 3)) value = parts.join("");
    else return null;
  }
  return parseMinorUnits(value, currency);
}

interface Money { readonly minorUnits: number; readonly currency: string; readonly raw: string; readonly plus: boolean; readonly index: number; readonly line: string }
function moneyValues(text: string): Money[] {
  const result: Money[] = [];
  for (const line of text.split("\n")) {
    let previousEnd = 0;
    for (const match of line.matchAll(MONEY)) {
      const index = match.index; const prefix = line.slice(previousEnd, index); previousEnd = index + match[0].length;
      if (BALANCE.test(prefix)) continue;
      const currency = currencyCode(match[1] ?? match[4]); const raw = match[2] ?? match[3];
      if (!currency) continue;
      const minorUnits = minorAmount(raw, currency); if (minorUnits === null) continue;
      result.push({ minorUnits, currency, raw: match[0], plus: /^\s*\+/u.test(raw) || /\+\s*$/u.test(prefix), index, line });
    }
  }
  // The title/expanded body commonly repeat exactly the same amount. Different
  // amounts are not picked heuristically: they need separately labelled benefit.
  return result.filter((value, index) => result.findIndex((item) => item.minorUnits === value.minorUnits && item.currency === value.currency && item.plus === value.plus) === index);
}

function merchantValue(value: string, sourceName: string): string | null {
  let result = clean(value).replace(/^[\s:：|·–—-]+|[\s:：|·–—.!]+$/gu, "");
  result = result.replace(/\s*(?:\||;|\b(?:balance|solde|card ending|reference|on \d{1,2}[/.-])\b|잔액|누적|승인번호|카드번호).*$/iu, "").replace(/[\s.!]+$/u, "");
  if (!result || result.length > 100 || result.toLocaleLowerCase("en") === sourceName.toLocaleLowerCase("en") || STATUS_ONLY.test(result) || METADATA.test(result) || BALANCE.test(result)
    || PROMOTION.test(result) || NOT_COMPLETED.test(result) || /^[\d\s*,:./+-]+$/u.test(result) || !/\p{L}/u.test(result)
    || /(?:^|\s)(?:\d{1,2}:\d{2}|\d+(?:[.,]\d+)?\s*(?:EUR|USD|KRW|원|€|£|₩))(?:\s|$)/u.test(result)) return null;
  return result;
}

function findMerchant(input: IosTransactionInput, text: string, transfer: boolean): string | null {
  if (input.merchant) { const value = merchantValue(input.merchant, input.sourceName); if (value) return value; }
  const lines = text.split("\n");
  const labelled = transfer
    ? /(?:수취인|받는\s*(?:분|사람)|받으시는\s*분|입금계좌\s*예금주|recipient|beneficiary|b[eé]n[eé]ficiaire|destinataire)\s*[:：]\s*(.+)$/iu
    : /(?:가맹점(?:명)?|사용처|이용처|거래처|결제처|merchant(?: name)?|commer[çc]ant|store)\s*[:：]\s*(.+)$/iu;
  for (const line of lines) { const matched = labelled.exec(line)?.[1]; if (matched) { const value = merchantValue(matched, input.sourceName); if (value) return value; } }
  if (transfer) {
    for (const line of lines) {
      const korean = /^(.{1,50}?)(?:님)?(?:에게|으로)\s+[\d₩]/u.exec(line)?.[1];
      if (korean) { const value = merchantValue(korean.replace(/님$/u, ""), input.sourceName); if (value) return value; }
    }
  }
  for (const line of lines) {
    const match = transfer ? /\b(?:to|vers|[aà])\s+(.+)$/iu.exec(line) : /\b(?:at|chez|to)\s+(.+)$/iu.exec(line);
    if (match) {
      const withoutAmount = match[1].replace(MONEY, "").replace(/\s+(?:for|pour|de)\s*$/iu, "");
      const value = merchantValue(withoutAmount, input.sourceName); if (value) return value;
    }
  }
  // Korean receipts often put their real merchant after the printed date/time.
  for (const line of lines) {
    const match = /^(?:\d{4}[/.-])?\d{1,2}[/.-]\d{1,2}\s+\d{1,2}:\d{2}\s+(.+)$/u.exec(line);
    if (match && !/^\s*\|/u.test(match[1])) { const value = merchantValue(match[1], input.sourceName); if (value) return value; }
  }
  const candidates: string[] = [];
  for (const line of lines) {
    const stripped = line.replace(MONEY, "").replace(/^\[(?:승인|Web발신|재발송)\]\s*/giu, "").replace(/\s+(?:일시불|할부)$/u, "").trim();
    if (PURCHASE.test(stripped) || APPROVED.test(stripped) || TRANSFER.test(stripped) || ATM.test(stripped) || REWARD.test(stripped) || INCOMING.test(stripped) || EXECUTED.test(stripped)) continue;
    const value = merchantValue(stripped, input.sourceName); if (value && !candidates.includes(value)) candidates.push(value);
  }
  return candidates.length === 1 ? candidates[0] : null;
}

function dates(input: IosTransactionInput, text: string): { occurredAt: string; occurredOn: string; uncertain: boolean } {
  const received = new Date(input.receivedAt);
  const localDay = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const fallback = { occurredAt: received.toISOString(), occurredOn: localDay(received), uncertain: false };
  const full = /\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/u.exec(text);
  const partial = /\b(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})\b/u.exec(text);
  if (!full && !partial) return fallback;
  let year = received.getFullYear(); let month: number; let day: number; let hours: number; let minutes: number;
  if (full) { year = Number(full[1]); month = Number(full[2]); day = Number(full[3]); hours = Number(full[4] ?? received.getHours()); minutes = Number(full[5] ?? received.getMinutes()); }
  else {
    // Only Korean MM/DD receipt convention is deterministic without locale.
    if (!/[가-힣]/u.test(text)) return { ...fallback, uncertain: true };
    month = Number(partial![1]); day = Number(partial![2]); hours = Number(partial![3]); minutes = Number(partial![4]);
    if (month === 12 && received.getMonth() === 0) year -= 1;
  }
  const date = new Date(year, month - 1, day, hours, minutes, 0);
  if (year < 2000 || month < 1 || month > 12 || hours > 23 || minutes > 59 || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day || date.getHours() !== hours || Math.abs(date.getTime() - input.receivedAt) > 7 * 86_400_000) return { ...fallback, uncertain: true };
  return { occurredAt: date.toISOString(), occurredOn: localDay(date), uncertain: false };
}

/** Reject non-transactions before producing even a review candidate. Missing
 * merchant/uncertain receipt dates produce review, never an invented merchant. */
export function parseIosTransactionInput(value: unknown): NativeCardCandidate | null {
  const input = normalizeIosTransactionInput(value); if (!input) return null;
  const text = [input.title, input.body].filter(Boolean).join("\n");
  if (PROMOTION.test(text) || OFFER.test(text) || NOT_COMPLETED.test(text) || REQUEST.test(text) || NEGATED_COMPLETION.test(text) || ADDITIONAL_REQUEST.test(text) || TOPUP.test(text)) return null;
  const reversal = REVERSAL.test(text); const reward = REWARD.test(text);
  // "입금계좌 예금주" names the destination account owner in an outgoing
  // receipt; the label is not evidence that the user received a deposit.
  // Remove only this exact label, preserving separate incoming status lines.
  const directionText = text.replace(/입금계좌\s*예금주\s*[:：]/gu, "");
  if (!reversal && !reward && INCOMING.test(directionText)) return null;
  let eventType: CardCandidateEventType = "purchase";
  if (reversal) eventType = "reversal";
  else if (reward && !PURCHASE.test(text)) eventType = "cashback";
  else if (ATM.test(text)) eventType = "cash_withdrawal";
  else if (STANDING_ORDER.test(text)) eventType = "standing_order";
  else if (DIRECT_DEBIT.test(text)) eventType = "direct_debit";
  else if (TRANSFER.test(text) || /출금/u.test(text) && /(?:수취인|받는\s*(?:분|사람)|입금계좌\s*예금주)\s*[:：]/u.test(text)) eventType = "outgoing_transfer";
  const structured = input.kind === "wallet";
  const transfer = ["outgoing_transfer", "direct_debit", "standing_order"].includes(eventType);
  if (!structured && eventType === "purchase" && !PURCHASE.test(text) && !APPROVED.test(text)) return null;
  if (transfer && !EXECUTED.test(text)) return null;
  if (eventType === "cash_withdrawal" && !EXECUTED.test(text) && !/현금\s*(?:인출|출금)|ATM\s*(?:인출|출금)/iu.test(text)) return null;
  const values = moneyValues(text);
  let amount: Pick<Money, "minorUnits" | "currency" | "plus"> | undefined;
  let cashbackMinorUnits: number | undefined;
  if (structured) {
    const currency = input.currency?.toUpperCase(); const raw = input.amount;
    if (!currency || !CURRENCIES.has(currency) || !raw || /^\s*[+−-]/u.test(raw)) return null;
    const minorUnits = minorAmount(raw, currency); if (!minorUnits) return null;
    // A wallet trigger is not evidence that contradictory text can be ignored.
    if (values.some((item) => item.currency !== currency || item.minorUnits !== minorUnits)) return null;
    amount = { currency, minorUnits, plus: false };
  } else {
    const rewards = values.filter((item) => REWARD.test(item.line));
    const debits = values.filter((item) => !REWARD.test(item.line));
    if (eventType === "purchase" && reward && debits.length === 1 && rewards.length === 1 && debits[0].currency === rewards[0].currency && rewards[0].minorUnits < debits[0].minorUnits) {
      amount = debits[0]; cashbackMinorUnits = rewards[0].minorUnits;
    } else if (values.length === 1) amount = values[0];
    if (!amount || amount.plus && !["reversal", "cashback"].includes(eventType)) return null;
  }
  const merchant = findMerchant(input, text, transfer) ?? "";
  const time = dates(input, text);
  // A generic 'payment' plus money alone does not establish completion. A
  // compact merchant+amount wallet alert remains review unless structured.
  const completion = structured || eventType === "reversal" || eventType === "cashback" || EXECUTED.test(text) || APPROVED.test(text) || /일시불|할부/u.test(text);
  const confidence = merchant && completion && !time.uncertain ? "high" : "review";
  return parseNativeCardCandidate({ id: input.id, queueToken: input.queueToken,
    packageName: iosSourcePackageName(input.kind, input.sourceName), sourceName: input.sourceName,
    merchant, minorUnits: amount.minorUnits, currency: amount.currency, occurredAt: time.occurredAt,
    deliveredAt: new Date(input.receivedAt).toISOString(), occurredOn: time.occurredOn,
    eventType, confidence, manualOnly: false, requiresMerchant: !merchant,
    ...(cashbackMinorUnits ? { cashbackMinorUnits } : {}) });
}
