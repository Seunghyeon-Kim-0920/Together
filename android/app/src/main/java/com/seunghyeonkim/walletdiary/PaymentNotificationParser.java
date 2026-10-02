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
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TimeZone;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONException;
import org.json.JSONObject;

final class PaymentNotificationParser {

    static final int PARSER_VERSION = 9;

    // Android uses ICU, not the desktop JDK regex engine. In particular the
    // embedded UNICODE_CHARACTER_CLASS flag (?U) is unsupported and throws
    // during class initialization; Android already uses Unicode classes.
    // Keep every expression precompiled so the native-ICU compatibility gate
    // can enumerate them, including the small cleanup/split expressions.

    // A following accented character must not be treated as a word boundary.
    // Express this explicitly for French phrase endings: unlike Android ICU,
    // the desktop JDK uses ASCII word boundaries without the unsupported flag.
    private static final String PHRASE_END = "(?![\\p{L}\\p{M}\\p{N}\\p{Pc}\\u200C\\u200D])";
    // Recurring debit labels describe the transaction, never the bank package.
    // They still need an executed status or an explicit debit sign below.
    private static final String INTERNATIONAL_DIRECT_DEBIT = "\\b(?:autopay|auto debit|automatic (?:payment|debit)|recurring payment)\\b|lastschrift|adeudo domiciliado|d[eé]bito domiciliado|d[eé]bito (?:direto|directo|autom[aá]tico)|addebito diretto|automatische incasso|口座振替|自動引(?:き)?落(?:とし)?|自动扣款|自動扣款|自动扣费|自動扣費";
    private static final String INTERNATIONAL_STANDING_ORDER = "dauerauftrag|orden permanente|transferencia peri[oó]dica|transfer[eê]ncia (?:peri[oó]dica|programada)|bonifico periodico|periodieke overboeking|定期振込|定期转账|定期轉帳";

    private static final Pattern ALWAYS_IGNORE = Pattern.compile(
        "(?iu)(\\b(?:declined|failed|rejected|verification|security code|one[ -]?time|otp|pin|pending|processing)\\b|en attente|refus[ée]|[ée]chou[ée]|abgelehnt|fehlgeschlagen|ausstehend|rechazad[oa]|fallid[oa]|pendiente|保留|失败|失敗|拒绝|拒絕|待处理|거절|실패|처리 ?중|승인 ?대기|인증|보안 ?코드|일회용|معلّق|مرفوض|فشل|अस्वीकृत)"
    );
    private static final Pattern ALWAYS_NON_PURCHASE = Pattern.compile(
        "(?iu)(\\b(?:cashback|top[ -]?up|deposit|cash withdrawal|withdrawal|credit(?![-\\s]+card\\b))\\b|rechargement|retrait|versement|depósito|prelievo|入金|입금|현금\\s*(?:출금|인출)|(?:ATM|CD)\\s*(?:현금|출금|인출)|충전|캐시백|적립|إيداع)"
    );
    private static final Pattern CREDIT_BALANCE_LABEL = Pattern.compile("(?iu)\\b(?:available\\s+credit|credit\\s+(?:available|remaining))\\b");
    // These are destination labels, not an incoming credit. Only mask them
    // for direction classification after explicit outgoing evidence exists.
    private static final Pattern KOREAN_DESTINATION_LABEL = Pattern.compile("입금\\s*(?:은행|계좌)");
    private static final Pattern KOREAN_MIXED_ALERT_TITLE = Pattern.compile("입금\\s*[/·]\\s*출금");
    private static final Pattern INCOMING_PAYMENT = Pattern.compile(
        "(?iu)(\\b(?:incoming (?:payment|money|funds)|(?:payment|money|funds) received|payment credited|received (?:a )?payment|(?:you have|you've|you) received|paid you|credited to (?:your|the) account)\\b|paiement (?:reçu|crédité)|vous avez reçu|(?:결제|대금|송금|이체)(?:금|대금)?(?:을|를)?\\s*(?:받았|받음|수취)|(?:돈|금액)(?:을|를)?\\s*받았|받은 ?(?:돈|결제|송금))"
    );
    private static final Pattern TRANSFER_CONTEXT = Pattern.compile(
        "(?iu)(\\b(?:transfer|wire transfer|direct debit|standing order|scheduled payment)\\b|virement|prélèvement|ordre permanent|überweisung|transferencia|transferência|bonifico|송금|이체|자동 ?납부|자동 ?출금|振込|振替|" + INTERNATIONAL_DIRECT_DEBIT + "|" + INTERNATIONAL_STANDING_ORDER + ")"
    );
    private static final Pattern KOREAN_DEBIT_CONTEXT = Pattern.compile("출금(?!\\s*(?:계좌|가능|기관))");
    private static final Pattern KOREAN_WITHDRAWAL_RECIPIENT = Pattern.compile("받는 ?(?:분|사람)|수취인|[\\p{L}\\p{N}](?:님)?에게");
    private static final Pattern INCOMING_TRANSFER = Pattern.compile(
        "(?iu)(\\b(?:incoming transfer|transfer received|received (?:a )?transfer|money received|received (?:money|funds) from|received from|transferred from|credited to (?:your|the) account)\\b|"
            + "\\btransfer[\\s\\S]{0,100}\\bfrom\\s+(?!(?:your|my|the)\\s+(?:account|card)\\b)[\\p{L}\\p{N}]|"
            + "virement (?:reçu|crédité|entrant)|virement[\\s\\S]{0,100}\\bde\\s+(?!(?:votre|mon|le)\\s+compte\\b)[\\p{L}]|vous avez reçu|reçu(?:e|s|es)? de|provenant de|émis par|crédité sur (?:votre|le) compte|"
            + "받은 ?(?:송금|이체)|(?:송금|이체)(?:금)? ?(?:수취|받음)|(?:송금|이체)[\\s\\S]{0,80}(?:로부터|에게서|보낸 ?(?:분|사람)|송금인|입금자)|(?:송금|이체)(?:를|을)? ?받았|입금|gutschrift|zahlungseingang|abono recibido|ingreso recibido|recebid[oa]|accredit[oa]|ricevut[oa]|bijschrijving|ontvangen|入金|受取|转入|轉入|到账|到賬|收到)"
    );
    private static final Pattern OWN_ACCOUNT_TRANSFER = Pattern.compile(
        "(?iu)(\\b(?:internal transfer|between (?:your|own) accounts|to (?:your|an) own account|own-account transfer)\\b|virement interne|entre vos (?:propres )?comptes|vers votre propre compte|본인 ?계좌|내 ?계좌(?:로|간)|계좌 ?간 ?이체)"
    );
    private static final Pattern NOT_EXECUTED_TRANSFER = Pattern.compile(
        "(?iu)(\\b(?:created|set[ -]?up|registered|activated|mandate|instruction created|will be (?:sent|debited|transferred)|upcoming|due on|planned for)\\b|prévu|mandat|mis en place|cré[ée]|enregistr[ée]|activ[ée]|예정|실행 ?전|출금 ?예정|(?:송금|이체|출금)\\s*(?:요청|대기)|등록|신청|설정|약정|vorgemerkt|geplant|wird abgebucht|eingerichtet|programad[oa]|agendad[oa]|previst[oa]|ser[aá] debitad[oa]|sarà addebitato|programmato|gepland|wordt afgeschreven|em processamento|en proceso|in attesa|in lavorazione|in behandeling|予定|未実行|将于|將於|待扣|尚未)"
    );
    private static final Pattern SCHEDULED_INSTRUCTION = Pattern.compile("(?iu)(\\bscheduled\\b|programm[ée]|예약)");
    private static final Pattern NOT_EXECUTED_PAYMENT = Pattern.compile(
        "(?iu)(\\b(?:payment request|request (?:a |for )?payment|invoice due|unpaid|amount due|payment due|upcoming payment|will be charged|will be debited|scheduled for|due on|pay now|pay by)\\b|demande de paiement|paiement à venir|sera (?:débité|prélevé)|facture à payer|결제 ?(?:예정|요청)|청구 ?예정|납부 ?예정|미납|支払予定|請求予定|付款请求|付款請求)"
    );
    private static final Pattern RETURNED_OR_REJECTED_TRANSFER = Pattern.compile(
        "(?iu)(\\b(?:returned|return(?:ed)? to sender|rejected|refused|revoked|recalled|bounced|unpaid)\\b|retourn[ée]|rejet[ée]|refus[ée]|révoqu[ée]|rappel[ée]|impay[ée]|반환|반송|송금 ?거절|이체 ?거절|출금 ?거절|자동 ?이체 ?반환|정기 ?이체 ?반환|철회|abgewiesen|zurückgegeben|rechazad[oa]|devuelt[oa]|recusad[oa]|devolvid[oa]|rifiutat[oa]|respint[oa]|mislukt|geweigerd|geannuleerd|teruggeboekt|未成立|不能|取消|取り消し|취소)"
    );
    private static final Pattern EXECUTED_DEBIT = Pattern.compile(
        "(?iu)(\\b(?:sent|completed|successful|executed|debited|collected|processed|paid)\\b|effectu[ée]|exécut[ée]|débit[ée]|pay[ée]|réussi|émis|envoy[ée]|완료|성공|출금(?!\\s*(?:계좌|가능|기관))|처리 ?완료|보냄|ausgeführt|abgebucht|eingezogen|completad[oa]|realizad[oa]|cargad[oa]|efetuad[oa]|debitad[oa]|conclu[íi]d[oa]|eseguit[oa]|addebitat[oa]|voltooid|uitgevoerd|afgeschreven|実行済|完了|引き落とされ|扣款成功|扣费成功|扣費成功|已扣款|已扣费|已扣費|转账成功|轉帳成功)"
    );
    private static final Pattern DIRECT_DEBIT_SIGNAL = Pattern.compile(
        "(?iu)(\\bdirect debit(?:\\s+(?:completed|collected|processed|executed|paid|debited|successful))?\\b|prélèvement(?:\\s+(?:sepa))?(?:\\s+(?:effectu[ée]|exécut[ée]|débit[ée]|pay[ée]|réussi))?" + PHRASE_END + "|자동 ?(?:이체|납부|출금)(?: ?(?:출금|완료|성공|처리 ?완료))?|" + INTERNATIONAL_DIRECT_DEBIT + ")"
    );
    private static final Pattern STANDING_ORDER_SIGNAL = Pattern.compile(
        "(?iu)(\\b(?:standing order|scheduled (?:payment|transfer)|recurring transfer)(?:\\s+(?:executed|completed|sent|paid|debited|successful))?\\b|virement (?:permanent|programmé)(?:\\s+(?:effectu[ée]|exécut[ée]|émis|envoy[ée]|débit[ée]|réussi))?" + PHRASE_END + "|(?:정기|예약) ?이체(?: ?(?:출금|완료|성공|처리 ?완료))?|" + INTERNATIONAL_STANDING_ORDER + ")"
    );
    private static final Pattern OUTGOING_TRANSFER_SIGNAL = Pattern.compile(
        "(?iu)(\\b(?:(?:bank|money|wire)\\s+)?transfer\\s+(?:sent|made|debited)\\b|\\b(?:you\\s+)?sent\\b|\\btransferred\\s+to\\b|"
            + "\\b(?:(?:bank|money|wire)\\s+)?transfer\\s+(?:completed|successful|executed)\\b(?=[\\s\\S]{0,160}\\b(?:sent\\s+to|to|recipient|beneficiary|payee)\\b)|"
            + "virement\\s+(?:émis|envoy[ée]|débit[ée])" + PHRASE_END + "|virement\\s+(?:effectu[ée]|exécut[ée]|réussi)" + PHRASE_END + "(?=[\\s\\S]{0,160}(?:\\bvers\\b|bénéficiaire|destinataire))|vous avez (?:envoyé|viré)|"
            + "(?:송금|이체)(?:금)? ?(?:출금|보냄)|(?:송금|이체)(?:금)? ?(?:완료|성공|처리 ?완료)(?=[\\s\\S]{0,160}(?:받는 ?(?:분|사람)|수취인|예금주|에게 ?(?:송금|이체)|로 ?(?:송금|이체))))"
    );
    private static final Pattern OUTGOING_DESTINATION = Pattern.compile(
        "(?iu)(\\b(?:to|recipient|beneficiary|payee|vers|bénéficiaire|destinataire)\\b|받는 ?(?:분|사람)|수취인|예금주|[\\p{L}\\p{N}](?:님)?에게)"
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
        "(?iu)(\\b(?:weekend offer|special offer|promotion|promo code|save|discount|coupon|sale|price|offer)\\b|offre|promotion|remise|économisez|prix|angebot|rabatt|oferta|descuento|promoção|desconto|割引|优惠|優惠|할인|쿠폰|프로모션|판매가|가격)"
    );
    private static final Pattern REVERSAL = Pattern.compile(
        "(?iu)(\\b(?:refund(?:ed)?|revers(?:al|e[sd]?)|reverted|cancelled|canceled|chargeback|voided)\\b|rembours[ée]?|annul[ée]?|erstattet|storniert|rückbuchung|widerrufen|rückgängig|reversad[oa]?|revertid[oa]?|reembolsad[oa]?|reembolso|estornad[oa]?|estorno|cancelad[oa]?|rimborsat[oa]?|annullat[oa]?|stornat[oa]?|返金|取消|キャンセル|退款|撤销|撤銷|환불|결제 ?취소|승인 ?취소|취소 ?완료|استرداد|إلغاء|रिफंड|वापसी)"
    );
    private static final Pattern NON_TERMINAL_REVERSAL = Pattern.compile(
        "(?iu)(\\b(?:partial(?:ly)?|requested|initiated|expected|scheduled)\\b|remboursement partiel|demand[ée]|en cours|teilweise|beantragt|parcial|solicitad[oa]|iniciad[oa]|parziale|richiest[oa]|一部返金|返金申請|部分退款|退款申请|退款申請|부분 ?환불|환불 ?요청|취소 ?요청|استرداد جزئي|طلب استرداد)"
    );
    private static final Pattern PAYMENT_SIGNAL = Pattern.compile(
        "(?iu)(\\b(?:card payment|payment|purchase|paid|spent|card used|card charged|charged|debit card|point of sale|pos transaction|approved|completed)\\b|paiement|achat|carte utilis[ée]e?|dépens[ée]|pay[ée]|accept[ée]|zahlung|kartenzahlung|bezahlt|einkauf|compra|pago|pagamento|acquisto|carta usata|결제|카드 ?승인|사용 ?승인|체크카드|신용카드|이용 ?내역|支払|購入|カード利用|決済|消费|消費|付款|刷卡|交易成功|شراء|دفعة|تم الدفع|भुगतान|खरीद|pembayaran|pembelian|thanh toán|giao dịch thẻ|ชำระเงิน|ซื้อ)"
    );
    private static final Pattern KOREAN_APPROVAL_SIGNAL = Pattern.compile("(?u)(?<![\\p{L}\\p{N}])승인(?![\\p{L}\\p{N}])");
    private static final Pattern KOREAN_CARD_APPROVAL = Pattern.compile("(?u)카드[\\s*•●\\d()-]{0,16}승인(?!번호)");
    private static final Pattern CARD_PURCHASE_CONTEXT = Pattern.compile(
        "(?iu)(\\b(?:card payment|card purchase|purchase|card used|card charged|debit card|credit card|point of sale|pos transaction)\\b|paiement (?:par )?carte|achat|kartenzahlung|결제|사용 ?승인|카드 ?승인|체크카드|신용카드|カード利用|카드 ?이용)"
    );
    // Bound the whole match so a code cannot be cut out of an ordinary word
    // such as "carte" (RTE) or "EUROPE" (EUR), while still accepting the
    // lowercase ISO codes used by some banks.
    private static final String CURRENCY_TOKEN = "(?iu:euros?|유로|원|円|[A-Z]{3}|US\\$|CA\\$|AU\\$|NZ\\$|HK\\$|S\\$|R\\$|NT\\$|€|£|₩|¥|￥|\\$|₹|₽|₺|₫|฿|₱|₪|₦|₴|₵|₾|₸|₭|₮|؋|₲|₡|zł|Kč|Ft)";
    private static final Pattern CURRENCY_BEFORE = Pattern.compile(
        "(?u)(?<![\\p{L}\\p{N}])([+−-]?)[\\p{Zs}\\t]*(" + CURRENCY_TOKEN + ")(?!\\p{L})[\\p{Zs}\\t]*([+−-]?[\\p{Zs}\\t]*\\(?\\d[\\d\\p{Zs}\\t\\u00a0\\u202f'.,]*\\)?)"
    );
    private static final Pattern CURRENCY_AFTER = Pattern.compile(
        "(?u)(?<![\\p{L}\\p{N}])([+−-]?[\\p{Zs}\\t]*\\(?\\d[\\d\\p{Zs}\\t\\u00a0\\u202f'.,]*\\)?)[\\p{Zs}\\t]*(" + CURRENCY_TOKEN + ")(?![\\p{L}\\p{N}])"
    );
    // Some Korean bank alerts omit the space between a field label and its
    // value. Keep the ordinary currency boundary strict for unrelated words.
    private static final Pattern KOREAN_LABELLED_AMOUNT = Pattern.compile(
        "(?u)(출금(?:금액|액)?|(?:이체|송금|결제|이용|승인)(?:금액)?|잔액)([+−-]?\\d[\\d, .]*원)(?![\\p{L}\\p{N}])"
    );
    private static final Pattern MERCHANT_FIELD_BOUNDARY = Pattern.compile(
        "(?iu)\\s+(?:(?:결제|승인|이용|사용|출금|송금|이체)\\s*금액|입금\\s*(?:은행|계좌)|출금\\s*계좌|잔액)(?:\\s|[:：]|(?=\\d))"
    );
    private static final Pattern MERCHANT_FIRST_NARRATIVE = Pattern.compile(
        "(?iu)(?:\\s*[:：]\\s*|\\s+[–—-]\\s*)(?:(?:votre|your)\\s+)?(?:paiement|payment|purchase|montant)" + PHRASE_END
    );
    private static final Pattern MERCHANT_DECORATION = Pattern.compile("^[\\p{So}\\p{Sk}\\uFE0F\\u200D\\s]+|[\\p{So}\\p{Sk}\\uFE0F\\u200D\\s]+$");
    private static final Pattern KOREAN_OWNER_FIELD = Pattern.compile("예금주|계좌주|(?:카드)?명의자");
    private static final Pattern MERCHANT_AMOUNT_TAIL = Pattern.compile(
        "(?iu)^(?:[\\d\\s/.:(),–—-]|일시불|개월|할부|승인|결제|완료|approved|completed|accepted|accept[ée]|a été|has been|was|\\p{So}|\\uFE0F)*$"
    );
    private static final Pattern MERCHANT_AFTER = Pattern.compile(
        "(?iu)(?:\\bat\\b|\\bchez\\b|\\bmerchant(?:\\s+name)?\\b|\\b(?:retailer|store|business)\\s+name\\b|\\bcommer[çc]ant\\b|\\b(?:paid|payment)\\s+to\\b|\\b(?:pagado|pago)\\s+(?:a|en)\\b|\\b(?:pago|pagamento)\\s+(?:a|em)\\b|\\bbei\\b|\\bpresso\\b|\\besercente\\b|\\bcomercio\\b|\\bestablecimiento\\b|(?:이용|사용)?가맹점(?:명)?|사용처|이용처|거래처|결제처|店舗(?:名)?|加盟店(?:名)?|商户(?:名称)?|商戶(?:名稱)?|商家|لدى|متجر)\\s*[:：-]?\\s*([^\\n;]{1,100})"
    );
    private static final Pattern MERCHANT_PAYMENT_TO = Pattern.compile(
        "(?iu)\\b(?:paid|payment|purchase|spent|paiement|achat|pagamento|dépens[ée])" + PHRASE_END + "[^\\n;]{0,80}?\\s(?:to|à|a(?!\\s+[ée]t[ée]" + PHRASE_END + ")|en|em)\\s+([^\\n;]{1,100})"
    );
    private static final Pattern MERCHANT_NOTIFICATION_PREFIX = Pattern.compile(
        "(?imu)^\\s*(?:(?:\\[(?:[^\\]\\n]{0,25}(?:카드|결제|승인|알림)|Web발신)\\]\\s*)|(?:[\\p{L}*•]{1,20}님\\s+))+"
    );
    private static final Pattern MERCHANT_KOREAN_BEFORE = Pattern.compile(
        "(?mu)^\\s*([\\p{L}\\p{N}][\\p{L}\\p{M}\\p{N} &+’'().*/#-]{0,79}?)에서(?=\\s|\\d)(?:[^\\n]*)$"
    );
    private static final Pattern MERCHANT_METADATA = Pattern.compile(
        "(?iu)(^(?:of|for|at|to|in|from|de|du|à|n/?a|null|none|미상|알\\s*수\\s*없음|不明)$|\\b(?:ending|ends in|used with|success(?:ful(?:ly)?)?|unknown|unavailable|details|debit|credit|visa|mastercard|amex|web.?sent|reference|ref|you|your|we|our|received|credited|account|votre|vous|nous|montant)\\b|일시불|할부|누적|총 ?이용|이용 ?누계|결제 ?완료|사용 ?완료|승인|거래 ?일시|이용 ?일시|결제 ?일시|Web발신|가맹점명|사용처|이용처|거래처|결제처|카드 ?번호|계좌|잔액|금액|받았|입니다|되었습니다|알림|님(?:께서|의|이)?(?:\\s|$)|利用日時|利用金額|卡号|卡號)"
    );
    private static final Pattern COUNTERPARTY_AFTER = Pattern.compile(
        "(?iu)(?:\\b(?:sent|transferred)\\s+to\\b|\\b(?:recipient|beneficiary|payee|creditor)\\b|\\b(?:to|vers)\\b|\\b(?:bénéficiaire|destinataire|créancier|empfänger|gläubiger|begünstigter|beneficiario|acreedor|beneficiário|credor|creditore|ontvanger|begunstigde|incassant)\\b|au bénéfice de|받는 ?(?:분|사람)|수취인|예금주|납부처|출금기관|기관명|引落先|振替先|受取人|收款方|收款人)\\s*[:：-]?\\s*([^\\n;]{2,100})"
    );
    private static final Pattern GENERIC_TITLE = Pattern.compile(
        "(?iu)(payment|card|purchase|transaction|paid|paiement|carte|achat|zahlung|compra|pago|pagamento|acquisto|transfer|direct debit|standing order|virement|prélèvement|ordre permanent|송금|이체|자동 ?납부|자동 ?출금|정기 ?이체|결제|카드|승인|지출|支払|購入|決済|消费|付款|交易|شراء|دفعة|भुगतान|pembayaran|thanh toán|ชำระเงิน|refund|reversal|cancel|rembours|annul|환불|취소|退款|返金|" + INTERNATIONAL_DIRECT_DEBIT + "|" + INTERNATIONAL_STANDING_ORDER + ")"
    );
    private static final Pattern STATUS_ONLY_MERCHANT = Pattern.compile(
        "(?iu)^(?:성공|완료|출금|처리|처리 ?완료|정상 ?처리|정상 ?승인|일시불|successful|success|completed|processed|executed|debited|effectu[ée]|exécut[ée]|réussi|ausgeführt|abgebucht|completad[oa]|realizad[oa]|efetuad[oa]|debitad[oa]|eseguit[oa]|addebitat[oa]|voltooid|uitgevoerd|afgeschreven|完了|成功|已扣款)$"
    );
    private static final Pattern EMAIL = Pattern.compile("(?iu)[\\p{L}\\p{N}._%+-]+@[\\p{L}\\p{N}.-]+\\.[\\p{L}]{2,}");
    // Only short, standalone names may be inferred from an unlabelled body.
    // Prose, balances and account metadata must never be persisted as a merchant.
    private static final Pattern BODY_NARRATIVE = Pattern.compile(
        "(?iu)(\\b(?:you|your|we|our|from|received|credited|debit|amount|spent|completed|successful|notification|alert|available|remaining|account|balance|solde|saldo|kontostand|votre|vous|nous|montant|effectu[ée]|reçu|d[ée]bit[ée]|b[ée]n[ée]ficiaire|aujourd'hui|yesterday|today|hier|tomorrow)\\b|잔액|금액|계좌|받았|입니다|되었습니다|알림|残高|余额|餘額)"
    );
    // These standalone fields can be separated from the amount by several
    // lines. Exclude them before searching the whole single-payment body.
    private static final Pattern MERCHANT_METADATA_LINE = Pattern.compile(
        "(?iu)^(?:(?:cardholder|card holder|customer|client|titulaire|holder|name|date|time|sent|sent on|sent at|address|adresse|고객명|성명|이름|일시|날짜|시간|주소)\\s*[:：].*|(?:cardholder|card holder|customer|titulaire)\\s+.*|(?:\\d{2,4}[-/.])?\\d{1,2}[-/.]\\d{1,2}(?:\\s+.*)?|\\d{1,2}:\\d{2}(?::\\d{2})?(?:\\s*.*)?|\\d{1,2}\\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\b.*)$"
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
    private static final Pattern LINE_BREAK = Pattern.compile("\\n");
    private static final Pattern TRAILING_WHITESPACE = Pattern.compile("\\s+$");
    private static final Pattern TRAILING_DECIMAL_PUNCTUATION = Pattern.compile("[.,]+$");
    private static final Pattern NUMBER_SHAPE = Pattern.compile("\\d[\\d.,]*");
    private static final Pattern BODY_MERCHANT_SHAPE = Pattern.compile("(?u)[\\p{L}\\p{N}][\\p{L}\\p{M}\\p{N} &+’'().*/#-]*");
    private static final Pattern MERCHANT_SHAPE = Pattern.compile("(?u)[\\p{L}\\p{N}][\\p{L}\\p{M}\\p{N} &+’'().*/#-]*");
    private static final Pattern LETTER = Pattern.compile("\\p{L}");
    private static final Pattern WHITESPACE = Pattern.compile("\\s+");
    private static final Pattern GENERIC_MERCHANT_WORD = Pattern.compile("(?iu)(?<![\\p{L}\\p{M}\\p{N}])(?:card|payment|purchase|transaction|approved|paid|paiement|carte|achat|accept[ée]|zahlung|bezahlt|compra|pago|pagamento|결제|카드|승인|완료)" + PHRASE_END);
    private static final Pattern LONG_NUMBER = Pattern.compile("(?u)\\b\\d{4,}\\b");
    private static final Pattern EDGE_PUNCTUATION = Pattern.compile("^[.·•|:：,;—–-]+|[.·•|:：,;—–-]+$");
    private static final Pattern CONTROL_EXCEPT_LINE_BREAK = Pattern.compile("[\\p{Cntrl}&&[^\\n]]");
    private static final Pattern HORIZONTAL_WHITESPACE = Pattern.compile("[ \\t]+");
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
        // Existing callers and tests supplied only the transaction time.
        return parse(packageName, sourceName, title, text, bigText, subText,
            postedAt, postedAt, notificationKey, explicitlyConfigured, manualOnly, currencyHint);
    }

    static JSONObject parse(
        String packageName,
        String sourceName,
        String title,
        String text,
        String bigText,
        String subText,
        long postedAt,
        long deliveredAt,
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
        boolean explicitCardApproval = KOREAN_CARD_APPROVAL.matcher(combined).find();
        boolean cardPurchase = CARD_PURCHASE_CONTEXT.matcher(combined).find() || explicitCardApproval;
        boolean explicitTransferContext = TRANSFER_CONTEXT.matcher(combined).find();
        boolean transferContext = explicitTransferContext
            || !cardPurchase && KOREAN_DEBIT_CONTEXT.matcher(combined).find();
        // A bare account owner (예금주) is not evidence of sending money to
        // somebody else. Withdrawal-only alerts need a recipient field.
        if (transferContext && !explicitTransferContext && !KOREAN_WITHDRAWAL_RECIPIENT.matcher(combined).find()) return null;
        if (transferContext && EXECUTED_DEBIT.matcher(combined).find()
            && OUTGOING_DESTINATION.matcher(combined).find()) {
            // Keep actual incoming markers (입금액 / 거래구분: 입금 / 입금 완료).
            // A mixed service heading and the recipient's bank/account labels
            // must not veto an otherwise explicit outgoing transfer.
            String directionTitle = KOREAN_MIXED_ALERT_TITLE.matcher(safeTitle).replaceAll("거래");
            incomeContext = KOREAN_DESTINATION_LABEL.matcher(join(directionTitle, body)).replaceAll("목적지");
            incomeContext = CREDIT_BALANCE_LABEL.matcher(incomeContext).replaceAll("available funds");
        }
        if (combined.isEmpty() || ALWAYS_IGNORE.matcher(combined).find() || ALWAYS_NON_PURCHASE.matcher(incomeContext).find()
            || NOT_EXECUTED_PAYMENT.matcher(combined).find()) return null;
        boolean reversal = REVERSAL.matcher(combined).find();
        if (reversal && NON_TERMINAL_REVERSAL.matcher(combined).find()) return null;
        // Receiving a payment is income even when the alert does not use the
        // word "transfer". A completed refund remains a reversal candidate.
        if (!reversal && INCOMING_PAYMENT.matcher(combined).find()) return null;
        // A received transfer is income, and a transfer between accounts owned
        // by the same user is not consumption. Future instructions are also not
        // expenses until the bank reports an executed debit.
        if (transferContext && (INCOMING_TRANSFER.matcher(incomeContext).find()
            || OWN_ACCOUNT_TRANSFER.matcher(combined).find()
            || NOT_EXECUTED_TRANSFER.matcher(combined).find()
            || SCHEDULED_INSTRUCTION.matcher(combined).find() && !EXECUTED_DEBIT.matcher(combined).find()
            || RETURNED_OR_REJECTED_TRANSFER.matcher(combined).find())) return null;
        // The notification-based cancellation matcher was designed for card
        // purchases. A bank transfer cancellation must not remove an unrelated
        // expense until an account-data provider supplies a stable linkage.
        if (reversal && transferContext) return null;
        // "Sent" can describe notification delivery or a merchant name in a
        // card alert. Only use the broad outbound fallback when no explicit
        // purchase is present, or when the alert actually names a transfer.
        String debitEventType = transferContext || !cardPurchase
            ? classifyDebitEvent(combined) : null;
        // Never let an ambiguous transfer fall through the broad signed-payment
        // fallback. Generic wording such as "Transfer completed" does not prove
        // whether money was sent or received; an explicit outbound marker is
        // required before it can become an expense.
        // Refund alerts often also say that money was "credited". A reversal
        // signal must therefore take precedence over the generic income filter.
        boolean paymentSignal = PAYMENT_SIGNAL.matcher(combined).find() || explicitCardApproval;
        boolean approvalSignal = !paymentSignal && KOREAN_APPROVAL_SIGNAL.matcher(combined).find();
        paymentSignal = paymentSignal || approvalSignal;
        // Balance fields are classified per amount below. A global rejection
        // here would also discard valid signed-debit alerts from apps such as
        // Swile when the same notification happens to include a balance.
        if (!reversal && debitEventType == null && !paymentSignal && MARKETING.matcher(combined).find()) return null;

        int bodyStart = body.isEmpty() || !combined.endsWith(body) ? 0 : combined.length() - body.length();
        AmountMatch amount = findSingleAmount(combined, currencyHint, reversal, bodyStart);
        if (amount == null || amount.minorUnits <= 0) return null;
        if (transferContext && debitEventType == null) {
            if (amount.explicitDebit && OUTGOING_DESTINATION.matcher(combined).find()) debitEventType = "outgoing_transfer";
            else return null;
        }
        if (!reversal && isBalanceTitle(safeTitle)) return null;
        // Some banks use a bare "Direct debit" or "Standing order" title only
        // after posting the debit. Accept that compact form only when the amount
        // itself carries an explicit minus sign; unsigned alerts need an
        // unambiguous completion word.
        if (debitEventType != null && !amount.explicitDebit && !EXECUTED_DEBIT.matcher(combined).find()) return null;
        // Compact debit alerts are not restricted to pre-registered apps. The
        // confidence gate below still requires the user to trust the exact app
        // before any high-confidence event may be recorded automatically.
        boolean explicitPurchase = paymentSignal && !approvalSignal && !reversal && debitEventType == null;
        MerchantMatch merchant = findMerchant(safeTitle, body, sourceName, amount.raw, debitEventType != null, explicitPurchase || debitEventType != null);
        boolean requiresMerchant = merchant == null || merchant.value.isEmpty();
        String merchantValue = requiresMerchant ? "" : merchant.value;
        // Merchant + amount is a common compact card notification even without
        // a minus sign or translated payment verb. Keep it as a review draft;
        // trusting its app does not make this ambiguous format auto-postable.
        boolean compactUnsigned = !reversal && debitEventType == null && !paymentSignal && !amount.explicitDebit;
        if (compactUnsigned && (requiresMerchant || !isCompactMerchant(merchantValue))) return null;

        // Newly discovered packages remain review-only until the user registers
        // that exact package. This prevents silent expenses from spoofed alerts.
        String confidence = explicitlyConfigured && !manualOnly && !approvalSignal && !compactUnsigned && !requiresMerchant && merchant.highConfidence ? "high" : "review";
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
            String categoryHint = PaymentCategoryHints.infer(merchantValue, safeTitle, body);
            if (categoryHint != null) result.put("categoryHint", categoryHint);
            result.put("requiresMerchant", requiresMerchant);
            result.put("minorUnits", amount.minorUnits);
            result.put("currency", amount.currency);
            result.put("occurredAt", isoTimestamp(postedAt));
            // Android's actual notification post time is independent of
            // Notification.when, which different payment apps may backdate.
            result.put("deliveredAt", isoTimestamp(deliveredAt));
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
        if (OUTGOING_TRANSFER_SIGNAL.matcher(value).find()) return "outgoing_transfer";
        // Real alerts put amount/beneficiary between the transfer name and its
        // completion status. Direction and execution evidence need not be in
        // one rigid phrase, but both must be present.
        return (TRANSFER_CONTEXT.matcher(value).find() || KOREAN_DEBIT_CONTEXT.matcher(value).find()) && EXECUTED_DEBIT.matcher(value).find()
            && OUTGOING_DESTINATION.matcher(value).find() ? "outgoing_transfer" : null;
    }

    private static boolean isBalanceTitle(String value) {
        for (String line : LINE_BREAK.split(value)) if (DEFINITIVE_BALANCE_TITLE.matcher(line.trim()).matches()) return true;
        return false;
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
        before = TRAILING_WHITESPACE.matcher(before).replaceFirst("");
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
        normalized = TRAILING_DECIMAL_PUNCTUATION.matcher(normalized).replaceFirst("");
        if (!NUMBER_SHAPE.matcher(normalized).matches()) return null;

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

    private static MerchantMatch findMerchant(String title, String body, String sourceName, String rawAmount, boolean allowCounterparty, boolean explicitPurchase) {
        // Some banks place the labelled merchant in the expanded title, and
        // Korean alerts put it before "에서", not after it. Try every labelled
        // field so an empty/status field cannot hide a later actual merchant.
        Map<String, String> labelledCandidates = new LinkedHashMap<>();
        for (String content : new String[] {body, title}) {
            content = MERCHANT_NOTIFICATION_PREFIX.matcher(content).replaceAll("");
            for (Pattern pattern : new Pattern[] {MERCHANT_AFTER, MERCHANT_PAYMENT_TO, MERCHANT_KOREAN_BEFORE}) {
                Matcher labelled = pattern.matcher(content);
                while (labelled.find()) {
                    String candidate = trimMerchant(labelled.group(1), rawAmount);
                    if (isUsableMerchant(candidate, sourceName)) labelledCandidates.putIfAbsent(candidate.toLowerCase(Locale.ROOT), candidate);
                }
            }
        }
        if (labelledCandidates.size() == 1) return new MerchantMatch(labelledCandidates.values().iterator().next(), true);
        if (labelledCandidates.size() > 1) return null;
        if (allowCounterparty) {
            Matcher counterparty = COUNTERPARTY_AFTER.matcher(body);
            if (counterparty.find()) {
                String candidate = trimMerchant(counterparty.group(1), rawAmount);
                if (isUsableMerchant(candidate, sourceName)) return new MerchantMatch(candidate, true);
            }
        }
        Set<String> titleCandidates = new HashSet<>();
        for (String titleLine : LINE_BREAK.split(title)) {
            if (!titleLine.isEmpty() && !titleLine.equalsIgnoreCase(clean(sourceName))) {
                String prefix = merchantBeforePayment(titleLine, rawAmount, sourceName);
                if (prefix == null && hasUnstructuredAmountSuffix(titleLine, rawAmount, sourceName)) continue;
                String candidate = prefix == null ? trimMerchant(titleLine, rawAmount) : prefix;
                if (!GENERIC_TITLE.matcher(candidate).find() && isMerchantShape(candidate)
                    && isUsableMerchant(candidate, sourceName)) titleCandidates.add(candidate);
            }
        }
        if (titleCandidates.size() == 1) return new MerchantMatch(titleCandidates.iterator().next(), true);
        // Explicit single-payment alerts often separate merchant and amount
        // with a date or card details. Search all body lines after filtering
        // metadata, and require exactly one remaining merchant. Compact alerts
        // without a payment signal retain the nearby-only review fallback.
        Set<String> candidates = new HashSet<>();
        String[] lines = LINE_BREAK.split(body);
        for (int index = 0; index < lines.length; index++) {
            String line = MERCHANT_NOTIFICATION_PREFIX.matcher(clean(lines[index])).replaceAll("");
            boolean besideAmount = line.contains(rawAmount)
                || index > 0 && lines[index - 1].contains(rawAmount)
                || index + 1 < lines.length && lines[index + 1].contains(rawAmount);
            if (!explicitPurchase && !besideAmount) continue;
            String prefix = merchantBeforePayment(line, rawAmount, sourceName);
            if (prefix != null) {
                candidates.add(prefix);
                continue;
            }
            if (hasUnstructuredAmountSuffix(line, rawAmount, sourceName)) continue;
            if (BODY_NARRATIVE.matcher(line).find()
                || MERCHANT_METADATA_LINE.matcher(line).matches()
                || SENSITIVE_TRAILING_FIELD.matcher(line).find() || EMAIL.matcher(line).find()
                || URL.matcher(line).find() || PHONE.matcher(line).find() || IBAN.matcher(line).find()) continue;
            String candidate = trimMerchant(line, rawAmount);
            if (!isUsableMerchant(candidate, sourceName) || GENERIC_TITLE.matcher(candidate).find() || candidate.length() > 80
                || !BODY_MERCHANT_SHAPE.matcher(candidate).matches()
                || !LETTER.matcher(candidate).find() || WHITESPACE.split(candidate).length > 8) continue;
            candidates.add(candidate);
        }
        if (candidates.size() == 1) return new MerchantMatch(candidates.iterator().next(), explicitPurchase);
        return null;
    }

    static boolean hasMultiplePaymentLines(CharSequence[] lines, String currencyHint) {
        if (lines == null) return false;
        int paymentLines = 0;
        for (int index = 0; index < Math.min(lines.length, 20); index++) {
            String line = clean(lines[index] == null ? "" : lines[index].toString());
            // Identical summary rows may still be two distinct real purchases.
            if (findSingleAmount(line, currencyHint, true, 0) != null && ++paymentLines > 1) return true;
        }
        return false;
    }

    private static boolean isUsableMerchant(String candidate, String sourceName) {
        return !candidate.isEmpty() && !candidate.equalsIgnoreCase(clean(sourceName))
            && !KOREAN_OWNER_FIELD.matcher(candidate).find()
            && LETTER.matcher(candidate).find() && !DEFINITIVE_BALANCE_TITLE.matcher(candidate).matches()
            && !STATUS_ONLY_MERCHANT.matcher(candidate).matches()
            && !MERCHANT_METADATA.matcher(candidate).find();
    }

    private static boolean isCompactMerchant(String candidate) {
        return isMerchantShape(candidate) && !BODY_NARRATIVE.matcher(candidate).find();
    }

    private static boolean isMerchantShape(String candidate) {
        return !candidate.isEmpty() && candidate.length() <= 80
            && !SENSITIVE_TRAILING_FIELD.matcher(candidate).find()
            && !EMAIL.matcher(candidate).find() && !URL.matcher(candidate).find()
            && !PHONE.matcher(candidate).find() && !IBAN.matcher(candidate).find()
            && MERCHANT_SHAPE.matcher(candidate).matches()
            && LETTER.matcher(candidate).find() && WHITESPACE.split(candidate).length <= 8;
    }

    private static String trimMerchant(String value, String rawAmount) {
        String result = clean(value);
        Matcher field = MERCHANT_FIELD_BOUNDARY.matcher(result);
        boolean hasFollowingField = field.find();
        if (hasFollowingField) result = result.substring(0, field.start());
        result = result.replace(rawAmount, " ");
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
        result = GENERIC_MERCHANT_WORD.matcher(result).replaceAll(" ");
        result = LONG_NUMBER.matcher(result).replaceAll(" ");
        result = MERCHANT_DECORATION.matcher(result).replaceAll("");
        result = EDGE_PUNCTUATION.matcher(WHITESPACE.matcher(result).replaceAll(" ").trim()).replaceAll("").trim();
        // A separator before a following bank field is not part of its payee.
        if (hasFollowingField && result.endsWith(" /")) result = result.substring(0, result.length() - 2).trim();
        return result.length() > 100 ? result.substring(0, 100).trim() : result;
    }

    /** Merchant-first layout only: do not remove narrative words to invent a name. */
    private static String merchantBeforePayment(String value, String rawAmount, String sourceName) {
        String line = MERCHANT_NOTIFICATION_PREFIX.matcher(clean(value)).replaceAll("");
        int boundary = -1;
        Matcher narrative = MERCHANT_FIRST_NARRATIVE.matcher(line);
        if (narrative.find() && line.substring(narrative.end()).contains(rawAmount)) boundary = narrative.start();
        int amountStart = line.indexOf(rawAmount);
        if (boundary < 0 && amountStart > 0
            && MERCHANT_AMOUNT_TAIL.matcher(line.substring(amountStart + rawAmount.length())).matches()) boundary = amountStart;
        if (boundary <= 0) return null;
        String candidate = trimMerchant(line.substring(0, boundary), rawAmount);
        return isUsableMerchant(candidate, sourceName) && isCompactMerchant(candidate)
            && !GENERIC_TITLE.matcher(candidate).find() ? candidate : null;
    }

    private static boolean hasUnstructuredAmountSuffix(String value, String rawAmount, String sourceName) {
        String line = clean(value);
        int amountStart = line.indexOf(rawAmount);
        if (amountStart <= 0) return false;
        String suffix = line.substring(amountStart + rawAmount.length());
        if (!LETTER.matcher(suffix).find() || MERCHANT_AMOUNT_TAIL.matcher(suffix).matches()) return false;
        String prefix = trimMerchant(line.substring(0, amountStart), rawAmount);
        // Never turn "Cafe <amount> Bookshop" into the invented merchant
        // "Cafe Bookshop" by deleting the amount in an unlabelled field.
        return isUsableMerchant(prefix, sourceName) && isCompactMerchant(prefix)
            && !GENERIC_TITLE.matcher(prefix).find();
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
        StringBuilder result = new StringBuilder();
        for (String part : parts) {
            if (result.length() > 0) result.append('\n');
            result.append(part);
        }
        return result.toString();
    }

    private static String clean(String value) {
        if (value == null) return "";
        String bounded = value.length() > 2_000 ? value.substring(0, 2_000) : value;
        String normalized = Normalizer.normalize(bounded, Normalizer.Form.NFKC);
        String cleaned = HORIZONTAL_WHITESPACE.matcher(CONTROL_EXCEPT_LINE_BREAK.matcher(normalized).replaceAll(" ")).replaceAll(" ").trim();
        return KOREAN_LABELLED_AMOUNT.matcher(cleaned).replaceAll("$1 $2");
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
