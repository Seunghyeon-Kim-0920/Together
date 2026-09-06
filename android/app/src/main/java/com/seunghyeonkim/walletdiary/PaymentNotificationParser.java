package com.seunghyeonkim.walletdiary;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.text.Normalizer;
import java.text.SimpleDateFormat;
import java.util.Arrays;
import java.util.ArrayList;
import java.util.Currency;
import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.TimeZone;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONException;
import org.json.JSONObject;

final class PaymentNotificationParser {

    static final int PARSER_VERSION = 4;

    private static final Pattern ALWAYS_IGNORE = Pattern.compile(
        "(?iu)(\\b(?:declined|failed|rejected|verification|security code|one[ -]?time|otp|pin|pending|processing)\\b|en attente|refus[ée]|[ée]chou[ée]|abgelehnt|fehlgeschlagen|ausstehend|rechazad[oa]|fallid[oa]|pendiente|保留|失败|失敗|拒绝|拒絕|待处理|거절|실패|처리 ?중|승인 ?대기|인증|보안 ?코드|일회용|معلّق|مرفوض|فشل|अस्वीकृत)"
    );
    private static final Pattern ALWAYS_NON_PURCHASE = Pattern.compile(
        "(?iu)(\\b(?:cashback|top[ -]?up|deposit|cash withdrawal|withdrawal|credit(?![-\\s]+card\\b))\\b|rechargement|retrait|versement|depósito|prelievo|入金|입금|충전|캐시백|적립|إيداع)"
    );
    private static final Pattern CREDIT_BALANCE_LABEL = Pattern.compile("(?iuU)\\b(?:available\\s+credit|credit\\s+(?:available|remaining))\\b");
    private static final Pattern INCOMING_PAYMENT = Pattern.compile(
        "(?iuU)(\\b(?:incoming (?:payment|money|funds)|(?:payment|money|funds) received|payment credited|received (?:a )?payment|(?:you have|you've|you) received|paid you|credited to (?:your|the) account)\\b|paiement (?:reçu|crédité)|vous avez reçu|(?:결제|대금|송금|이체)(?:금|대금)?(?:을|를)?\\s*(?:받았|받음|수취)|(?:돈|금액)(?:을|를)?\\s*받았|받은 ?(?:돈|결제|송금))"
    );
    private static final Pattern TRANSFER_CONTEXT = Pattern.compile(
        "(?iuU)(\\b(?:transfer|wire transfer|direct debit|standing order|scheduled payment)\\b|virement|prélèvement|ordre permanent|überweisung|transferencia|transferência|bonifico|송금|이체|자동 ?납부|자동 ?출금|振込|振替)"
    );
    private static final Pattern INCOMING_TRANSFER = Pattern.compile(
        "(?iuU)(\\b(?:incoming transfer|transfer received|received (?:a )?transfer|money received|received (?:money|funds) from|received from|transferred from|credited to (?:your|the) account)\\b|"
            + "\\btransfer[\\s\\S]{0,100}\\bfrom\\s+(?!(?:your|my|the)\\s+(?:account|card)\\b)[\\p{L}\\p{N}]|"
            + "virement (?:reçu|crédité|entrant)|virement[\\s\\S]{0,100}\\bde\\s+(?!(?:votre|mon|le)\\s+compte\\b)[\\p{L}]|vous avez reçu|reçu(?:e|s|es)? de|provenant de|émis par|crédité sur (?:votre|le) compte|"
            + "받은 ?(?:송금|이체)|(?:송금|이체)(?:금)? ?(?:수취|받음)|(?:송금|이체)[\\s\\S]{0,80}(?:로부터|에게서|보낸 ?(?:분|사람)|송금인|입금자)|(?:송금|이체)(?:를|을)? ?받았|입금)"
    );
    private static final Pattern OWN_ACCOUNT_TRANSFER = Pattern.compile(
        "(?iuU)(\\b(?:internal transfer|between (?:your|own) accounts|to (?:your|an) own account|own-account transfer)\\b|virement interne|entre vos (?:propres )?comptes|vers votre propre compte|본인 ?계좌|내 ?계좌(?:로|간)|계좌 ?간 ?이체)"
    );
    private static final Pattern NOT_EXECUTED_TRANSFER = Pattern.compile(
        "(?iuU)(\\b(?:scheduled|created|set[ -]?up|registered|activated|mandate|instruction created|will be (?:sent|debited|transferred)|upcoming|due on|planned for)\\b|programm[ée]|prévu|mandat|mis en place|cré[ée]|enregistr[ée]|activ[ée]|예정|예약|실행 ?전|출금 ?예정|등록|신청|설정|약정)"
    );
    private static final Pattern RETURNED_OR_REJECTED_TRANSFER = Pattern.compile(
        "(?iuU)(\\b(?:returned|return(?:ed)? to sender|rejected|refused|revoked|recalled|bounced|unpaid)\\b|retourn[ée]|rejet[ée]|refus[ée]|révoqu[ée]|rappel[ée]|impay[ée]|반환|반송|송금 ?거절|이체 ?거절|출금 ?거절|자동 ?이체 ?반환|정기 ?이체 ?반환|철회)"
    );
    private static final Pattern EXECUTED_DEBIT = Pattern.compile(
        "(?iuU)(\\b(?:sent|completed|successful|executed|debited|collected|processed|paid)\\b|effectu[ée]|exécut[ée]|débit[ée]|pay[ée]|réussi|émis|envoy[ée]|완료|성공|출금|처리 ?완료|보냄)"
    );
    private static final Pattern DIRECT_DEBIT_SIGNAL = Pattern.compile(
        "(?iuU)(\\bdirect debit(?:\\s+(?:completed|collected|processed|executed|paid|debited|successful))?\\b|prélèvement(?:\\s+(?:sepa))?(?:\\s+(?:effectu[ée]|exécut[ée]|débit[ée]|pay[ée]|réussi))?\\b|자동 ?(?:이체|납부|출금)(?: ?(?:출금|완료|성공|처리 ?완료))?)"
    );
    private static final Pattern STANDING_ORDER_SIGNAL = Pattern.compile(
        "(?iuU)(\\bstanding order(?:\\s+(?:executed|completed|sent|paid|debited|successful))?\\b|virement permanent(?:\\s+(?:effectu[ée]|exécut[ée]|émis|envoy[ée]|débit[ée]|réussi))?\\b|정기 ?이체(?: ?(?:출금|완료|성공|처리 ?완료))?)"
    );
    private static final Pattern OUTGOING_TRANSFER_SIGNAL = Pattern.compile(
        "(?iuU)(\\b(?:(?:bank|money|wire)\\s+)?transfer\\s+(?:sent|made|debited)\\b|\\b(?:you\\s+)?sent\\b|\\btransferred\\s+to\\b|"
            + "\\b(?:(?:bank|money|wire)\\s+)?transfer\\s+(?:completed|successful|executed)\\b(?=[\\s\\S]{0,160}\\b(?:sent\\s+to|to|recipient|beneficiary|payee)\\b)|"
            + "virement\\s+(?:émis|envoy[ée]|débit[ée])\\b|virement\\s+(?:effectu[ée]|exécut[ée]|réussi)\\b(?=[\\s\\S]{0,160}(?:\\bvers\\b|bénéficiaire|destinataire))|vous avez (?:envoyé|viré)|"
            + "(?:송금|이체)(?:금)? ?(?:출금|보냄)|(?:송금|이체)(?:금)? ?(?:완료|성공|처리 ?완료)(?=[\\s\\S]{0,160}(?:받는 ?(?:분|사람)|수취인|예금주|에게 ?(?:송금|이체)|로 ?(?:송금|이체))))"
    );
    private static final Pattern BALANCE_BEFORE_AMOUNT = Pattern.compile(
        "(?iu)(?:(?<!new\\s)\\bbalance\\b|\\b(?:available|current|remaining|account|statement|ending|closing|updated)\\s+balance\\b|\\bbalance\\s+(?:after(?:\\s+(?:payment|purchase|transaction))?|available|remaining|left|now|of\\s+(?:account|card))\\b|\\bavailable\\s+(?:to\\s+spend|funds|credit)\\b|\\bcredit\\s+(?:available|remaining)\\b|\\b(?:nouveau\\s+)?solde(?:\\s+(?:disponible|restant|actuel|du\\s+compte|apr[èe]s(?:\\s+(?:paiement|achat|op[ée]ration))?))?\\b|\\b(?:neuer\\s+)?(?:kontostand|saldo)|\\b(?:verf[üu]gbarer\\s+betrag|verf[üu]gbares\\s+guthaben|restguthaben)\\b|\\b(?:nuevo|novo)\\s+saldo\\b|\\bsaldo(?:\\s+(?:disponible|restante|actual|atual|da\\s+conta|de\\s+la\\s+cuenta|residuo|del\\s+conto))?\\b|(?:결제\\s*후\\s*|거래\\s*후\\s*)?(?:남은\\s*|현재\\s*|계좌\\s*|가용\\s*|출금\\s*가능\\s*|이용\\s*가능\\s*|사용\\s*가능\\s*)?잔액|(?:이용|사용|출금)\\s*가능\\s*(?:금액|한도)|(?:利用可能|口座|現在)?残高|利用可能額|(?:可用|账户|賬戶|当前|當前|剩余|剩餘)?(?:余额|餘額)|可用(?:金额|金額)|الرصيد)(?:\\s*(?:is|are|est|reste|ist|es|[éeè]|now|현재|입니다|은|는|:|：|=|[-–—]))*$"
    );
    private static final Pattern NEW_BALANCE_BEFORE_AMOUNT = Pattern.compile(
        "(?iu)\\bnew\\s+balance(?:\\s*(?:is|now|:|：|=|[-–—]))*$"
    );
    private static final Pattern BALANCE_AFTER_AMOUNT = Pattern.compile(
        "(?iu)^\\s*(?:(?<!new\\s)\\bbalance\\b|\\b(?:available|current|remaining|account|statement|ending|closing)\\s+balance\\b|\\bbalance\\s+(?:available|remaining|left|after(?:\\s+(?:payment|purchase|transaction))?)\\b|\\b(?:solde|saldo|kontostand|guthaben)(?:\\s+(?:disponible|restant|restante|actual|atual|residuo))?\\b|(?:남은\\s*|결제\\s*후\\s*|계좌\\s*|가용\\s*)?잔액|残高|余额|餘額|الرصيد)\\b\\s*$"
    );
    private static final Pattern DEFINITIVE_BALANCE_TITLE = Pattern.compile(
        "(?iu)^(?:balance|solde|saldo|잔액|残高|余额|餘額|الرصيد|(?:available|current|remaining|account|statement|ending|closing|updated)\\s+balance|balance\\s+(?:update|updated|available|remaining|after\\s+(?:payment|purchase|transaction))|(?:nouveau\\s+)?solde\\s+(?:disponible|restant|actuel)|kontostand|saldo\\s+(?:disponible|restante|actual|atual)|(?:결제\\s*후\\s*|남은\\s*|현재\\s*|계좌\\s*)잔액|利用可能残高|可用余额|可用餘額)$"
    );
    private static final Pattern MARKETING = Pattern.compile(
        "(?iu)(\\b(?:weekend offer|special offer|promotion|promo code|save|discount|coupon)\\b|offre|promotion|remise|économisez|angebot|rabatt|oferta|descuento|promoção|desconto|割引|优惠|優惠|할인|쿠폰|프로모션)"
    );
    private static final Pattern REVERSAL = Pattern.compile(
        "(?iu)(\\b(?:refund(?:ed)?|revers(?:al|e[sd]?)|reverted|cancelled|canceled|chargeback|voided)\\b|rembours[ée]?|annul[ée]?|erstattet|storniert|rückbuchung|widerrufen|rückgängig|reversad[oa]?|revertid[oa]?|reembolsad[oa]?|reembolso|estornad[oa]?|estorno|cancelad[oa]?|rimborsat[oa]?|annullat[oa]?|stornat[oa]?|返金|取消|キャンセル|退款|撤销|撤銷|환불|결제 ?취소|승인 ?취소|취소 ?완료|استرداد|إلغاء|रिफंड|वापसी)"
    );
    private static final Pattern NON_TERMINAL_REVERSAL = Pattern.compile(
        "(?iu)(\\b(?:partial(?:ly)?|requested|initiated|expected|scheduled)\\b|remboursement partiel|demand[ée]|en cours|teilweise|beantragt|parcial|solicitad[oa]|iniciad[oa]|parziale|richiest[oa]|一部返金|返金申請|部分退款|退款申请|退款申請|부분 ?환불|환불 ?요청|취소 ?요청|استرداد جزئي|طلب استرداد)"
    );
    private static final Pattern PAYMENT_SIGNAL = Pattern.compile(
        "(?iu)(\\b(?:card payment|payment|purchase|paid|spent|card used|card charged|debit card|point of sale|pos transaction|approved|completed)\\b|paiement|achat|carte utilis[ée]e?|dépens[ée]|accept[ée]|zahlung|kartenzahlung|bezahlt|einkauf|compra|pago|pagamento|acquisto|carta usata|결제|카드 ?승인|사용 ?승인|체크카드|신용카드|이용 ?내역|支払|購入|カード利用|決済|消费|消費|付款|刷卡|交易成功|شراء|دفعة|تم الدفع|भुगतान|खरीद|pembayaran|pembelian|thanh toán|giao dịch thẻ|ชำระเงิน|ซื้อ)"
    );
    private static final Pattern KOREAN_APPROVAL_SIGNAL = Pattern.compile("(?u)(?<![\\p{L}\\p{N}])승인(?![\\p{L}\\p{N}])");
    // Bound the whole match so a code cannot be cut out of an ordinary word
    // such as "carte" (RTE) or "EUROPE" (EUR), while still accepting the
    // lowercase ISO codes used by some banks.
    private static final String CURRENCY_TOKEN = "(?iu:euros?|유로|원|円|[A-Z]{3}|US\\$|CA\\$|AU\\$|NZ\\$|HK\\$|S\\$|R\\$|NT\\$|€|£|₩|¥|￥|\\$|₹|₽|₺|₫|฿|₱|₪|₦|₴|₵|₾|₸|₭|₮|؋|₲|₡|zł|Kč|Ft)";
    private static final Pattern CURRENCY_BEFORE = Pattern.compile(
        "(?u)(?<![\\p{L}\\p{N}])([+−-]?)[\\p{Zs}\\t]*(" + CURRENCY_TOKEN + ")(?!\\p{L})[\\p{Zs}\\t]*([+−-]?\\(?\\d[\\d\\p{Zs}\\t\\u00a0\\u202f'.,]*\\)?)"
    );
    private static final Pattern CURRENCY_AFTER = Pattern.compile(
        "(?u)(?<![\\p{L}\\p{N}])([+−-]?\\(?\\d[\\d\\p{Zs}\\t\\u00a0\\u202f'.,]*\\)?)[\\p{Zs}\\t]*(" + CURRENCY_TOKEN + ")(?![\\p{L}\\p{N}])"
    );
    private static final Pattern MERCHANT_AFTER = Pattern.compile(
        "(?iu)(?:\\bat\\b|\\bchez\\b|\\bmerchant\\b|\\bcommer[çc]ant\\b|\\b(?:paid|payment)\\s+to\\b|\\b(?:pagado|pago)\\s+(?:a|en)\\b|\\b(?:pago|pagamento)\\s+(?:a|em)\\b|\\bbei\\b|\\bpresso\\b|\\besercente\\b|\\bcomercio\\b|\\bestablecimiento\\b|가맹점|사용처|에서|店舗|加盟店|商户|商戶|商家|لدى|متجر)\\s*[:：-]?\\s*([^\\n;]{2,100})"
    );
    private static final Pattern COUNTERPARTY_AFTER = Pattern.compile(
        "(?iuU)(?:\\b(?:sent|transferred)\\s+to\\b|\\b(?:recipient|beneficiary|payee|creditor)\\b|\\b(?:to|vers)\\b|\\b(?:bénéficiaire|destinataire|créancier)\\b|au bénéfice de|받는 ?(?:분|사람)|수취인|예금주)\\s*[:：-]?\\s*([^\\n;]{2,100})"
    );
    private static final Pattern GENERIC_TITLE = Pattern.compile(
        "(?iu)(payment|card|purchase|transaction|paid|paiement|carte|achat|zahlung|compra|pago|pagamento|acquisto|transfer|direct debit|standing order|virement|prélèvement|ordre permanent|송금|이체|자동 ?납부|정기 ?이체|결제|카드|승인|지출|支払|購入|決済|消费|付款|交易|شراء|دفعة|भुगतान|pembayaran|thanh toán|ชำระเงิน|refund|reversal|cancel|rembours|annul|환불|취소|退款|返金)"
    );
    private static final Pattern EMAIL = Pattern.compile("(?iu)[\\p{L}\\p{N}._%+-]+@[\\p{L}\\p{N}.-]+\\.[\\p{L}]{2,}");
    // Only short, standalone names may be inferred from an unlabelled body.
    // Prose, balances and account metadata must never be persisted as a merchant.
    private static final Pattern BODY_NARRATIVE = Pattern.compile(
        "(?iuU)(\\b(?:you|your|we|our|from|received|credited|debit|amount|spent|completed|successful|notification|alert|available|remaining|account|balance|solde|saldo|kontostand|votre|vous|nous|montant|effectu[ée]|reçu|d[ée]bit[ée]|b[ée]n[ée]ficiaire|aujourd'hui|yesterday|today|hier|tomorrow)\\b|잔액|금액|계좌|받았|입니다|되었습니다|알림|残高|余额|餘額)"
    );
    private static final Pattern URL = Pattern.compile("(?iu)\\b(?:https?://|www\\.)\\S+");
    private static final Pattern PHONE = Pattern.compile("(?u)(?<![\\p{L}\\p{N}])\\+?\\d(?:[\\s().-]*\\d){6,}(?![\\p{L}\\p{N}])");
    private static final Pattern IBAN = Pattern.compile("(?iu)\\b[A-Z]{2}\\d{2}(?:[\\s-]?[A-Z0-9]){11,30}\\b");
    private static final Pattern SENSITIVE_TRAILING_FIELD = Pattern.compile(
        "(?iu)\\b(?:iban|account(?:\\s+(?:number|no\\.?))?|acct|compte|konto|계좌(?:번호)?|card\\s+(?:ending|number)|carte\\s+(?:se terminant|num[ée]ro)|카드(?:번호|끝자리)|contact|e-?mail|courriel|phone|t[ée]l[ée]phone|tel\\.?|transaction\\s+(?:id|reference|ref)|reference|ref\\.?|authorization\\s+(?:id|code)|auth\\s+(?:id|code)|approval\\s+(?:id|code)|r[ée]f[ée]rence|code d['’]autorisation|transaktions?(?:nummer|referenz)|referencia|referência|c[óo]digo de autoriza[çc][aã]o|riferimento|codice di autorizzazione|取引(?:ID|番号)|参照番号|交易(?:编号|編號)|参考号|參考號|거래번호|참조번호|승인코드|승인번호)\\b.*$"
    );
    private static final Pattern TRAILING_REVERSAL_STATUS = Pattern.compile(
        "(?iu)\\b(?:(?:for|pour|für|por|per)\\s+)?(?:(?:has\\s+been|was|is|a\\s+[ée]t[ée]|wurde|ha\\s+sido|foi|[èe]\\s+stato)\\s+)?(?:refund(?:ed)?|revers(?:al|e[sd]?)|reverted|cancelled|canceled|voided|rembours[ée]?|annul[ée]?|erstattet|storniert|reversad[oa]?|revertid[oa]?|reembolsad[oa]?|estornad[oa]?|cancelad[oa]?|rimborsat[oa]?|annullat[oa]?|stornat[oa]?)\\b.*$"
    );
    private static final Pattern TRAILING_PURCHASE_STATUS = Pattern.compile(
        "(?iu)\\b(?:(?:has\\s+been|was|is|a\\s+[ée]t[ée]|wurde|ha\\s+sido|foi|[èe]\\s+stato)\\s+)?(?:approved|completed|accepted|authori[sz]ed|approuv[ée]|accept[ée]|autoris[ée]|genehmigt|abgeschlossen|aprobada?|completad[oa]|aprovad[oa]|conclu[íi]d[oa]|approvat[oa]|completat[oa])\\b.*$"
    );
    private static final Pattern TRAILING_BALANCE_FIELD = Pattern.compile(
        "(?iu)(?:[.;|•]|\\s[/｜]\\s|\\s[-–—]\\s)\\s*(?:(?:available|current|remaining|account|statement|ending|closing|updated|new)\\s+balance|balance(?:\\s+(?:after(?:\\s+(?:payment|purchase|transaction))?|available|remaining|left|now))?|(?:nouveau\\s+)?solde(?:\\s+(?:disponible|restant|actuel))?|(?:neuer\\s+)?(?:kontostand|saldo)|saldo(?:\\s+(?:disponible|restante|actual|atual))?|(?:결제\\s*후\\s*|거래\\s*후\\s*)?(?:남은\\s*|현재\\s*|계좌\\s*|가용\\s*|출금\\s*가능\\s*|이용\\s*가능\\s*|사용\\s*가능\\s*)?잔액|(?:利用可能|口座|現在)?残高|(?:可用|账户|賬戶|当前|當前|剩余|剩餘)?(?:余额|餘額)|الرصيد)\\b.*$"
    );
    private static final Set<String> DOLLAR_CURRENCIES = new HashSet<>(Arrays.asList("USD", "CAD", "AUD", "NZD", "SGD", "HKD", "TWD"));

    private PaymentNotificationParser() {}

    static JSONObject parse(
        String packageName,
        String sourceName,
        String title,
        String text,
        String bigText,
        String subText,
        long postedAt,
        String notificationKey,
        boolean explicitlyConfigured,
        boolean manualOnly,
        String currencyHint
    ) {
        String safeTitle = clean(title);
        String body = join(text, bigText, subText);
        String combined = join(safeTitle, body);
        // A credit-limit balance is metadata, not an incoming credit. The
        // original text is still used for per-amount balance exclusion below.
        String incomeContext = CREDIT_BALANCE_LABEL.matcher(combined).replaceAll("available funds");
        if (combined.isEmpty() || ALWAYS_IGNORE.matcher(combined).find() || ALWAYS_NON_PURCHASE.matcher(incomeContext).find()) return null;
        boolean reversal = REVERSAL.matcher(combined).find();
        if (reversal && NON_TERMINAL_REVERSAL.matcher(combined).find()) return null;
        // Receiving a payment is income even when the alert does not use the
        // word "transfer". A completed refund remains a reversal candidate.
        if (!reversal && INCOMING_PAYMENT.matcher(combined).find()) return null;
        boolean transferContext = TRANSFER_CONTEXT.matcher(combined).find();
        // A received transfer is income, and a transfer between accounts owned
        // by the same user is not consumption. Future instructions are also not
        // expenses until the bank reports an executed debit.
        if (transferContext && (INCOMING_TRANSFER.matcher(combined).find()
            || OWN_ACCOUNT_TRANSFER.matcher(combined).find()
            || NOT_EXECUTED_TRANSFER.matcher(combined).find()
            || RETURNED_OR_REJECTED_TRANSFER.matcher(combined).find())) return null;
        // The notification-based cancellation matcher was designed for card
        // purchases. A bank transfer cancellation must not remove an unrelated
        // expense until an account-data provider supplies a stable linkage.
        if (reversal && transferContext) return null;
        String debitEventType = classifyDebitEvent(combined);
        // Never let an ambiguous transfer fall through the broad signed-payment
        // fallback. Generic wording such as "Transfer completed" does not prove
        // whether money was sent or received; an explicit outbound marker is
        // required before it can become an expense.
        if (transferContext && debitEventType == null) return null;
        // Refund alerts often also say that money was "credited". A reversal
        // signal must therefore take precedence over the generic income filter.
        boolean paymentSignal = PAYMENT_SIGNAL.matcher(combined).find();
        boolean approvalSignal = !paymentSignal && KOREAN_APPROVAL_SIGNAL.matcher(combined).find();
        paymentSignal = paymentSignal || approvalSignal;
        // Balance fields are classified per amount below. A global rejection
        // here would also discard valid signed-debit alerts from apps such as
        // Swile when the same notification happens to include a balance.
        if (!reversal && debitEventType == null && !paymentSignal && MARKETING.matcher(combined).find()) return null;

        int bodyStart = body.isEmpty() || !combined.endsWith(body) ? 0 : combined.length() - body.length();
        AmountMatch amount = findSingleAmount(combined, currencyHint, reversal, bodyStart);
        if (amount == null || amount.minorUnits <= 0) return null;
        if (!reversal && DEFINITIVE_BALANCE_TITLE.matcher(safeTitle).matches()) return null;
        // Some banks use a bare "Direct debit" or "Standing order" title only
        // after posting the debit. Accept that compact form only when the amount
        // itself carries an explicit minus sign; unsigned alerts need an
        // unambiguous completion word.
        if (debitEventType != null && !amount.explicitDebit && !EXECUTED_DEBIT.matcher(combined).find()) return null;
        // Compact debit alerts are not restricted to pre-registered apps. The
        // confidence gate below still requires the user to trust the exact app
        // before any high-confidence event may be recorded automatically.
        if (!reversal && debitEventType == null && !paymentSignal && !amount.explicitDebit) return null;

        MerchantMatch merchant = findMerchant(safeTitle, body, sourceName, amount.raw, debitEventType != null);
        boolean requiresMerchant = merchant == null || merchant.value.isEmpty();
        String merchantValue = requiresMerchant ? "" : merchant.value;

        // Newly discovered packages remain review-only until the user registers
        // that exact package. This prevents silent expenses from spoofed alerts.
        String confidence = explicitlyConfigured && !manualOnly && !approvalSignal && !requiresMerchant && merchant.highConfidence ? "high" : "review";
        try {
            String eventType = reversal ? "reversal" : debitEventType == null ? "purchase" : debitEventType;
            String eventId = fingerprint(packageName + "|" + notificationKey + "|" + postedAt);
            String queueToken = fingerprint(
                eventId + "|" + eventType + "|" + amount.currency + "|" + amount.minorUnits + "|" + merchantValue + "|" + requiresMerchant
            );
            JSONObject result = new JSONObject();
            result.put("id", eventId);
            result.put("queueToken", queueToken);
            result.put("packageName", packageName);
            result.put("sourceName", clean(sourceName).isEmpty() ? packageName : clean(sourceName));
            result.put("merchant", merchantValue);
            result.put("requiresMerchant", requiresMerchant);
            result.put("minorUnits", amount.minorUnits);
            result.put("currency", amount.currency);
            result.put("occurredAt", isoTimestamp(postedAt));
            result.put("occurredOn", localDate(postedAt));
            result.put("confidence", confidence);
            result.put("eventType", eventType);
            result.put("manualOnly", manualOnly);
            result.put("parserVersion", PARSER_VERSION);
            return result;
        } catch (JSONException ignored) {
            return null;
        }
    }

    private static String classifyDebitEvent(String value) {
        // More specific recurring forms must win over the generic word
        // "transfer" that may occur in the same notification.
        if (STANDING_ORDER_SIGNAL.matcher(value).find()) return "standing_order";
        if (DIRECT_DEBIT_SIGNAL.matcher(value).find()) return "direct_debit";
        return OUTGOING_TRANSFER_SIGNAL.matcher(value).find() ? "outgoing_transfer" : null;
    }

    private static AmountMatch findSingleAmount(String value, String currencyHint, boolean allowPlus, int bodyStart) {
        AmountMatch first = null;
        Set<String> distinct = new HashSet<>();
        Matcher before = CURRENCY_BEFORE.matcher(value);
        while (before.find()) {
            String leadingSign = before.group(1);
            String number = before.group(3);
            AmountMatch candidate = parseAmount(leadingSign.isEmpty() ? number : leadingSign + number, normalizeCurrency(before.group(2), currencyHint), before.group(0), allowPlus);
            if (candidate != null && !isBalanceAmount(value, before.start(), before.end(), bodyStart)) {
                // Expanded and collapsed versions may repeat one payment with
                // different signs. Preserve explicit debit evidence, but never
                // merge different amounts or currencies into a guessed total.
                if (first == null || !first.explicitDebit && candidate.explicitDebit) first = candidate;
                distinct.add(candidate.currency + "|" + candidate.minorUnits);
            }
        }
        Matcher after = CURRENCY_AFTER.matcher(value);
        while (after.find()) {
            AmountMatch candidate = parseAmount(after.group(1), normalizeCurrency(after.group(2), currencyHint), after.group(0), allowPlus);
            if (candidate != null && !isBalanceAmount(value, after.start(), after.end(), bodyStart)) {
                if (first == null || !first.explicitDebit && candidate.explicitDebit) first = candidate;
                distinct.add(candidate.currency + "|" + candidate.minorUnits);
            }
        }
        return distinct.size() == 1 ? first : null;
    }

    private static boolean isBalanceAmount(String value, int start, int end, int bodyStart) {
        int contextFloor = start >= bodyStart ? bodyStart : 0;
        int beforeStart = Math.max(contextFloor, start - 180);
        String before = value.substring(beforeStart, start);
        int boundary = Math.max(before.lastIndexOf(';'), Math.max(before.lastIndexOf('|'), before.lastIndexOf('•')));
        if (boundary >= 0) before = before.substring(boundary + 1);
        before = before.replaceFirst("\\s+$", "");
        String after = value.substring(end, Math.min(value.length(), end + 120));
        int afterBoundary = firstBoundary(after);
        if (afterBoundary >= 0) after = after.substring(0, afterBoundary);
        if (BALANCE_BEFORE_AMOUNT.matcher(before).find()
            || NEW_BALANCE_BEFORE_AMOUNT.matcher(before).find()
            || BALANCE_AFTER_AMOUNT.matcher(after).find()) return true;
        return false;
    }

    private static int firstBoundary(String value) {
        int result = -1;
        for (char marker : new char[] {';', '|', '•'}) {
            int index = value.indexOf(marker);
            if (index >= 0 && (result < 0 || index < result)) result = index;
        }
        return result;
    }

    private static AmountMatch parseAmount(String rawNumber, String currency, String raw, boolean allowPlus) {
        if (currency == null) return null;
        String signed = rawNumber.trim();
        boolean explicitDebit = signed.startsWith("-") || signed.startsWith("−") || signed.startsWith("(");
        String normalized = rawNumber.replace('\u2212', '-').replace("(", "-").replace(")", "");
        normalized = normalized.replace("\u00a0", "").replace("\u202f", "").replace(" ", "").replace("'", "");
        if (normalized.startsWith("+") && !allowPlus) return null;
        normalized = normalized.replace("+", "").replace("-", "");
        // Currency-before matches may include sentence punctuation immediately
        // after the amount (for example "€12.34."). It is not a decimal mark.
        normalized = normalized.replaceFirst("[.,]+$", "");
        if (!normalized.matches("\\d[\\d.,]*")) return null;

        int digits = currencyDigits(currency);
        int decimalIndex = Math.max(normalized.lastIndexOf(','), normalized.lastIndexOf('.'));
        if (digits == 0) {
            normalized = normalized.replace(",", "").replace(".", "");
        } else if (decimalIndex >= 0 && normalized.length() - decimalIndex - 1 <= digits) {
            String whole = normalized.substring(0, decimalIndex).replace(",", "").replace(".", "");
            String fraction = normalized.substring(decimalIndex + 1).replace(",", "").replace(".", "");
            normalized = whole + "." + fraction;
        } else {
            normalized = normalized.replace(",", "").replace(".", "");
        }
        try {
            BigDecimal value = new BigDecimal(normalized).abs();
            if (value.signum() <= 0) return null;
            long minor = value.movePointRight(digits).setScale(0, RoundingMode.UNNECESSARY).longValueExact();
            return minor > 0 ? new AmountMatch(currency, minor, raw, explicitDebit) : null;
        } catch (ArithmeticException | NumberFormatException ignored) {
            return null;
        }
    }

    private static MerchantMatch findMerchant(String title, String body, String sourceName, String rawAmount, boolean allowCounterparty) {
        Matcher labelled = MERCHANT_AFTER.matcher(body);
        if (labelled.find()) {
            String candidate = trimMerchant(labelled.group(1), rawAmount);
            if (!candidate.isEmpty()) return new MerchantMatch(candidate, true);
        }
        if (allowCounterparty) {
            Matcher counterparty = COUNTERPARTY_AFTER.matcher(body);
            if (counterparty.find()) {
                String candidate = trimMerchant(counterparty.group(1), rawAmount);
                if (!candidate.isEmpty()) return new MerchantMatch(candidate, true);
            }
        }
        if (!title.isEmpty() && !title.equalsIgnoreCase(clean(sourceName)) && !GENERIC_TITLE.matcher(title).find()) {
            String candidate = trimMerchant(title, rawAmount);
            if (!candidate.isEmpty()) return new MerchantMatch(candidate, true);
        }
        // A generic/app-name title can be followed by "Lidl -1,24 €" or
        // separate "Lidl" and "-1,24 €" lines. Do not promote this inferred
        // name to high confidence, even if the source is trusted.
        Set<String> candidates = new HashSet<>();
        String[] lines = body.split("\\n");
        for (int index = 0; index < lines.length; index++) {
            String line = clean(lines[index]);
            boolean besideAmount = line.contains(rawAmount)
                || index > 0 && clean(lines[index - 1]).equals(rawAmount.trim())
                || index + 1 < lines.length && clean(lines[index + 1]).equals(rawAmount.trim());
            if (!besideAmount || GENERIC_TITLE.matcher(line).find() || BODY_NARRATIVE.matcher(line).find()
                || SENSITIVE_TRAILING_FIELD.matcher(line).find() || EMAIL.matcher(line).find()
                || URL.matcher(line).find() || PHONE.matcher(line).find() || IBAN.matcher(line).find()) continue;
            String candidate = trimMerchant(line, rawAmount);
            if (candidate.isEmpty() || candidate.equalsIgnoreCase(clean(sourceName)) || candidate.length() > 80
                || !candidate.matches("(?u)[\\p{L}\\p{N}][\\p{L}\\p{M}\\p{N} '&’().-]*")
                || !Pattern.compile("\\p{L}").matcher(candidate).find() || candidate.split("\\s+").length > 8) continue;
            candidates.add(candidate);
        }
        if (candidates.size() == 1) return new MerchantMatch(candidates.iterator().next(), false);
        return null;
    }

    private static String trimMerchant(String value, String rawAmount) {
        String result = clean(value).replace(rawAmount, " ");
        result = EMAIL.matcher(result).replaceAll(" ");
        result = URL.matcher(result).replaceAll(" ");
        result = PHONE.matcher(result).replaceAll(" ");
        result = IBAN.matcher(result).replaceAll(" ");
        result = SENSITIVE_TRAILING_FIELD.matcher(result).replaceAll(" ");
        result = TRAILING_REVERSAL_STATUS.matcher(result).replaceAll(" ");
        result = TRAILING_PURCHASE_STATUS.matcher(result).replaceAll(" ");
        result = TRAILING_BALANCE_FIELD.matcher(result).replaceAll(" ");
        result = CURRENCY_BEFORE.matcher(result).replaceAll(" ");
        result = CURRENCY_AFTER.matcher(result).replaceAll(" ");
        result = result.replaceAll("(?iu)\\b(card|payment|purchase|transaction|approved|paid|paiement|carte|achat|accept[ée]|zahlung|bezahlt|compra|pago|pagamento|결제|카드|승인|완료)\\b", " ");
        result = result.replaceAll("(?u)\\b\\d{4,}\\b", " ");
        result = result.replaceAll("\\s+", " ").replaceAll("^[.·•|:：,;—–-]+|[.·•|:：,;—–-]+$", "").trim();
        return result.length() > 100 ? result.substring(0, 100).trim() : result;
    }

    private static String normalizeCurrency(String token, String hint) {
        if (token == null) return null;
        String value = token.trim();
        String normalizedHint = hint == null ? "" : hint.trim().toUpperCase(Locale.ROOT);
        if (value.equalsIgnoreCase("euro") || value.equalsIgnoreCase("euros") || value.equals("유로")) return "EUR";
        if (value.equals("원")) return "KRW";
        if (value.equals("円")) return "JPY";
        if (value.equalsIgnoreCase("zł")) return "PLN";
        if (value.equalsIgnoreCase("Kč")) return "CZK";
        if (value.equalsIgnoreCase("Ft")) return "HUF";
        if (value.equalsIgnoreCase("US$")) return "USD";
        if (value.equalsIgnoreCase("CA$")) return "CAD";
        if (value.equalsIgnoreCase("AU$")) return "AUD";
        if (value.equalsIgnoreCase("NZ$")) return "NZD";
        if (value.equalsIgnoreCase("HK$")) return "HKD";
        if (value.equalsIgnoreCase("S$")) return "SGD";
        if (value.equalsIgnoreCase("R$")) return "BRL";
        if (value.equalsIgnoreCase("NT$")) return "TWD";
        switch (value) {
            case "€": return "EUR";
            case "£": return "GBP";
            case "₩": return "KRW";
            case "₹": return "INR";
            case "₽": return "RUB";
            case "₺": return "TRY";
            case "₫": return "VND";
            case "฿": return "THB";
            case "₱": return "PHP";
            case "₪": return "ILS";
            case "₦": return "NGN";
            case "₴": return "UAH";
            case "₵": return "GHS";
            case "₾": return "GEL";
            case "₸": return "KZT";
            case "₭": return "LAK";
            case "₮": return "MNT";
            case "؋": return "AFN";
            case "₲": return "PYG";
            case "₡": return "CRC";
            case "$": return DOLLAR_CURRENCIES.contains(normalizedHint) ? normalizedHint : null;
            case "¥":
            case "￥": return "JPY".equals(normalizedHint) || "CNY".equals(normalizedHint) ? normalizedHint : null;
            default:
                String code = value.toUpperCase(Locale.ROOT);
                try { Currency.getInstance(code); return code; } catch (IllegalArgumentException ignored) { return null; }
        }
    }

    private static int currencyDigits(String currency) {
        try {
            int digits = Currency.getInstance(currency).getDefaultFractionDigits();
            return digits < 0 ? 2 : digits;
        } catch (IllegalArgumentException ignored) {
            return 2;
        }
    }

    private static String fingerprint(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder result = new StringBuilder();
            for (byte item : digest) result.append(String.format(Locale.ROOT, "%02x", item));
            return result.toString();
        } catch (Exception ignored) {
            return Integer.toHexString(value.hashCode());
        }
    }

    /** Stable receipt identity for older queue versions as well as new events. */
    static String contentToken(JSONObject event) {
        if (event == null || event.optString("id").isEmpty() || !event.has("eventType")
            || !event.has("currency") || !event.has("minorUnits") || !event.has("merchant")) return null;
        return fingerprint(event.optString("id") + "|" + event.optString("eventType") + "|"
            + event.optString("currency") + "|" + event.optLong("minorUnits") + "|"
            + event.optString("merchant") + "|" + event.optBoolean("requiresMerchant", false));
    }

    private static String isoTimestamp(long time) {
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        return format.format(new Date(time));
    }

    private static String localDate(long time) {
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
        return format.format(new Date(time));
    }

    private static String join(String... values) {
        List<String> parts = new ArrayList<>();
        for (String value : values) {
            String cleaned = clean(value);
            if (cleaned.isEmpty()) continue;
            boolean alreadyContained = false;
            for (String part : parts) if (part.contains(cleaned)) { alreadyContained = true; break; }
            if (alreadyContained) continue;
            parts.removeIf(cleaned::contains);
            parts.add(cleaned);
        }
        return String.join("\n", parts);
    }

    private static String clean(String value) {
        if (value == null) return "";
        String bounded = value.length() > 2_000 ? value.substring(0, 2_000) : value;
        return Normalizer.normalize(bounded, Normalizer.Form.NFKC).replaceAll("[\\p{Cntrl}&&[^\\n]]", " ").replaceAll("[ \\t]+", " ").trim();
    }

    private static final class AmountMatch {
        final String currency;
        final long minorUnits;
        final String raw;
        final boolean explicitDebit;
        AmountMatch(String currency, long minorUnits, String raw, boolean explicitDebit) { this.currency = currency; this.minorUnits = minorUnits; this.raw = raw; this.explicitDebit = explicitDebit; }
    }

    private static final class MerchantMatch {
        final String value;
        final boolean highConfidence;
        MerchantMatch(String value, boolean highConfidence) { this.value = value; this.highConfidence = highConfidence; }
    }
}
