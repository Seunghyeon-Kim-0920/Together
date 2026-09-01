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

    private static final Pattern ALWAYS_IGNORE = Pattern.compile(
        "(?iu)(\\b(?:declined|failed|rejected|verification|security code|one[ -]?time|otp|pin|pending|processing)\\b|en attente|refus[ée]|[ée]chou[ée]|abgelehnt|fehlgeschlagen|ausstehend|rechazad[oa]|fallid[oa]|pendiente|保留|失败|失敗|拒绝|拒絕|待处理|거절|실패|처리 ?중|승인 ?대기|인증|보안 ?코드|일회용|승인번호|معلّق|مرفوض|فشل|अस्वीकृत)"
    );
    private static final Pattern ALWAYS_NON_PURCHASE = Pattern.compile(
        "(?iu)(\\b(?:cashback|top[ -]?up|transfer|deposit|cash withdrawal|withdrawal|credit(?![-\\s]+card\\b))\\b|virement|rechargement|retrait|versement|überweisung|transferencia|transferência|depósito|prelievo|bonifico|入金|振込|입금|충전|송금|출금|캐시백|적립|تحويل|إيداع)"
    );
    private static final Pattern NON_EXPENSE = Pattern.compile(
        "(?iu)(\\b(?:credited|account credit|available balance|current balance|statement balance)\\b|cr[ée]dit re[çc]u|solde disponible|verfügbarer betrag|saldo disponible|利用可能残高|可用余额|可用餘額|이용 가능 잔액)"
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
    private static final String CURRENCY_TOKEN = "(?:[A-Z]{3}|US\\$|CA\\$|AU\\$|NZ\\$|HK\\$|S\\$|R\\$|NT\\$|€|£|₩|¥|￥|\\$|₹|₽|₺|₫|฿|₱|₪|₦|₴|₵|₾|₸|₭|₮|؋|₲|₡|zł|Kč|Ft)";
    private static final Pattern CURRENCY_BEFORE = Pattern.compile(
        "(?iu)([+−-]?)\\s*(" + CURRENCY_TOKEN + ")\\s*([+−-]?\\(?\\d[\\d\\s\\u00a0\\u202f'.,]*\\)?)"
    );
    private static final Pattern CURRENCY_AFTER = Pattern.compile(
        "(?iu)([+−-]?\\(?\\d[\\d\\s\\u00a0\\u202f'.,]*\\)?)\\s*(" + CURRENCY_TOKEN + ")"
    );
    private static final Pattern MERCHANT_AFTER = Pattern.compile(
        "(?iu)(?:\\bat\\b|\\bchez\\b|\\bmerchant\\b|\\bcommer[çc]ant\\b|\\b(?:paid|payment)\\s+to\\b|\\b(?:pagado|pago)\\s+(?:a|en)\\b|\\b(?:pago|pagamento)\\s+(?:a|em)\\b|\\bbei\\b|\\bpresso\\b|\\besercente\\b|\\bcomercio\\b|\\bestablecimiento\\b|가맹점|사용처|에서|店舗|加盟店|商户|商戶|商家|لدى|متجر)\\s*[:：-]?\\s*([^\\n;]{2,100})"
    );
    private static final Pattern GENERIC_TITLE = Pattern.compile(
        "(?iu)(payment|card|purchase|transaction|paid|paiement|carte|achat|zahlung|compra|pago|pagamento|acquisto|결제|카드|승인|지출|支払|購入|決済|消费|付款|交易|شراء|دفعة|भुगतान|pembayaran|thanh toán|ชำระเงิน|refund|reversal|cancel|rembours|annul|환불|취소|退款|返金)"
    );
    private static final Pattern EMAIL = Pattern.compile("(?iu)[\\p{L}\\p{N}._%+-]+@[\\p{L}\\p{N}.-]+\\.[\\p{L}]{2,}");
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
        if (combined.isEmpty() || ALWAYS_IGNORE.matcher(combined).find() || ALWAYS_NON_PURCHASE.matcher(combined).find()) return null;
        boolean reversal = REVERSAL.matcher(combined).find();
        if (reversal && NON_TERMINAL_REVERSAL.matcher(combined).find()) return null;
        // Refund alerts often also say that money was "credited". A reversal
        // signal must therefore take precedence over the generic income filter.
        if (!reversal && NON_EXPENSE.matcher(combined).find()) return null;
        boolean paymentSignal = PAYMENT_SIGNAL.matcher(combined).find();
        if (!reversal && !paymentSignal && MARKETING.matcher(combined).find()) return null;

        AmountMatch amount = findSingleAmount(combined, currencyHint, reversal);
        if (amount == null || amount.minorUnits <= 0) return null;
        // Trusted apps may use a merchant title with only a signed debit in the
        // body (for example Swile). Positive amounts without a payment signal
        // are balance/offer-shaped and must never become automatic expenses.
        if (!reversal && !paymentSignal && (!explicitlyConfigured || !amount.explicitDebit)) return null;

        MerchantMatch merchant = findMerchant(safeTitle, body, sourceName, amount.raw);
        if (merchant == null || merchant.value.isEmpty()) return null;

        // Newly discovered packages remain review-only until the user registers
        // that exact package. This prevents silent expenses from spoofed alerts.
        String confidence = explicitlyConfigured && !manualOnly && merchant.highConfidence ? "high" : "review";
        try {
            String eventType = reversal ? "reversal" : "purchase";
            String eventId = fingerprint(packageName + "|" + notificationKey + "|" + postedAt);
            String queueToken = fingerprint(
                eventId + "|" + eventType + "|" + amount.currency + "|" + amount.minorUnits + "|" + merchant.value + "|" + confidence + "|" + manualOnly
            );
            JSONObject result = new JSONObject();
            result.put("id", eventId);
            result.put("queueToken", queueToken);
            result.put("packageName", packageName);
            result.put("sourceName", clean(sourceName).isEmpty() ? packageName : clean(sourceName));
            result.put("merchant", merchant.value);
            result.put("minorUnits", amount.minorUnits);
            result.put("currency", amount.currency);
            result.put("occurredAt", isoTimestamp(postedAt));
            result.put("occurredOn", localDate(postedAt));
            result.put("confidence", confidence);
            result.put("eventType", eventType);
            result.put("manualOnly", manualOnly);
            return result;
        } catch (JSONException ignored) {
            return null;
        }
    }

    private static AmountMatch findSingleAmount(String value, String currencyHint, boolean allowPlus) {
        AmountMatch first = null;
        Set<String> distinct = new HashSet<>();
        Matcher before = CURRENCY_BEFORE.matcher(value);
        while (before.find()) {
            String leadingSign = before.group(1);
            String number = before.group(3);
            AmountMatch candidate = parseAmount(leadingSign.isEmpty() ? number : leadingSign + number, normalizeCurrency(before.group(2), currencyHint), before.group(0), allowPlus);
            if (candidate != null) {
                if (first == null) first = candidate;
                distinct.add(candidate.currency + "|" + candidate.minorUnits + "|" + candidate.explicitDebit);
            }
        }
        Matcher after = CURRENCY_AFTER.matcher(value);
        while (after.find()) {
            AmountMatch candidate = parseAmount(after.group(1), normalizeCurrency(after.group(2), currencyHint), after.group(0), allowPlus);
            if (candidate != null) {
                if (first == null) first = candidate;
                distinct.add(candidate.currency + "|" + candidate.minorUnits + "|" + candidate.explicitDebit);
            }
        }
        return distinct.size() == 1 ? first : null;
    }

    private static AmountMatch parseAmount(String rawNumber, String currency, String raw, boolean allowPlus) {
        if (currency == null) return null;
        String signed = rawNumber.trim();
        boolean explicitDebit = signed.startsWith("-") || signed.startsWith("−") || signed.startsWith("(");
        String normalized = rawNumber.replace('\u2212', '-').replace("(", "-").replace(")", "");
        normalized = normalized.replace("\u00a0", "").replace("\u202f", "").replace(" ", "").replace("'", "");
        if (normalized.startsWith("+") && !allowPlus) return null;
        normalized = normalized.replace("+", "").replace("-", "");
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

    private static MerchantMatch findMerchant(String title, String body, String sourceName, String rawAmount) {
        Matcher labelled = MERCHANT_AFTER.matcher(body);
        if (labelled.find()) {
            String candidate = trimMerchant(labelled.group(1), rawAmount);
            if (!candidate.isEmpty()) return new MerchantMatch(candidate, true);
        }
        if (!title.isEmpty() && !title.equalsIgnoreCase(clean(sourceName)) && !GENERIC_TITLE.matcher(title).find()) {
            String candidate = trimMerchant(title, rawAmount);
            if (!candidate.isEmpty()) return new MerchantMatch(candidate, true);
        }
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
        result = CURRENCY_BEFORE.matcher(result).replaceAll(" ");
        result = CURRENCY_AFTER.matcher(result).replaceAll(" ");
        result = result.replaceAll("(?iu)\\b(card|payment|purchase|transaction|approved|paid|paiement|carte|achat|accept[ée]|zahlung|bezahlt|compra|pago|pagamento|결제|카드|승인|완료)\\b", " ");
        result = result.replaceAll("(?iu)\\b(balance|solde|account|compte|card ending|carte se terminant|saldo|kontostand|잔액|계좌|카드번호)\\b.*$", " ");
        result = result.replaceAll("(?u)\\b\\d{4,}\\b", " ");
        result = result.replaceAll("\\s+", " ").replaceAll("^[·•|:：,;—–-]+|[·•|:：,;—–-]+$", "").trim();
        return result.length() > 100 ? result.substring(0, 100).trim() : result;
    }

    private static String normalizeCurrency(String token, String hint) {
        if (token == null) return null;
        String value = token.trim();
        String normalizedHint = hint == null ? "" : hint.trim().toUpperCase(Locale.ROOT);
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
            case "zł": return "PLN";
            case "Kč": return "CZK";
            case "Ft": return "HUF";
            case "US$": return "USD";
            case "CA$": return "CAD";
            case "AU$": return "AUD";
            case "NZ$": return "NZD";
            case "HK$": return "HKD";
            case "S$": return "SGD";
            case "R$": return "BRL";
            case "NT$": return "TWD";
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
