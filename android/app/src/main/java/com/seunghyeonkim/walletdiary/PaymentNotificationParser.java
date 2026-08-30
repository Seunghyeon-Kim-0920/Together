package com.seunghyeonkim.walletdiary;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.text.Normalizer;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONException;
import org.json.JSONObject;

final class PaymentNotificationParser {

    private static final Pattern REJECTED = Pattern.compile(
        "(?iu)(\\b(?:declined|failed|reverted|reversal|refunded?|refund|cancel(?:led)?|rejected|cashback|credit(?:ed)?|top[ -]?up|transfer|deposit|verification|security code|one[ -]?time|otp|pin|pending|processing)\\b|\\bcr[ée]dit\\b|en attente|rembours[ée]|annul[ée]|refus[ée]|[ée]chou[ée]|virement|rechargement|입금|충전|송금|환불|취소|거절|실패|처리 ?중|승인 ?대기|캐시백|적립|인증|보안 ?코드|일회용|승인번호)"
    );
    private static final Pattern CURRENCY_BEFORE = Pattern.compile(
        "(?iu)(EUR|USD|GBP|KRW|JPY|CHF|CAD|AUD|CNY|HKD|SGD|THB|VND|PHP|IDR|MYR|TRY|AED|KWD|€|£|₩|¥|\\$)\\s*([+−-]?\\(?\\d[\\d\\s\\u00a0\\u202f'.,]*\\)?)"
    );
    private static final Pattern CURRENCY_AFTER = Pattern.compile(
        "(?iu)([+−-]?\\(?\\d[\\d\\s\\u00a0\\u202f'.,]*\\)?)\\s*(EUR|USD|GBP|KRW|JPY|CHF|CAD|AUD|CNY|HKD|SGD|THB|VND|PHP|IDR|MYR|TRY|AED|KWD|€|£|₩|¥|\\$)"
    );
    private static final Pattern MERCHANT_AFTER = Pattern.compile(
        "(?iu)(?:\\bat\\b|\\bchez\\b|\\bmerchant\\b|\\bcommer[çc]ant\\b|가맹점|사용처|에서)\\s*[:：-]?\\s*([^\\n;]{2,100})"
    );
    private static final Pattern GENERIC_TITLE = Pattern.compile(
        "(?iu)(payment|card|purchase|transaction|paiement|carte|achat|결제|카드|승인|revolut|swile|travel ?wallet)"
    );

    private PaymentNotificationParser() {}

    static JSONObject parse(
        String packageName,
        String sourceName,
        String title,
        String text,
        String bigText,
        String subText,
        long postedAt,
        String notificationKey
    ) {
        String safeTitle = clean(title);
        String body = join(text, bigText, subText);
        String combined = join(safeTitle, body);
        if (combined.isEmpty() || REJECTED.matcher(combined).find()) return null;

        AmountMatch amount = findSingleAmount(combined);
        if (amount == null || amount.minorUnits <= 0) return null;

        MerchantMatch merchant = findMerchant(safeTitle, body, sourceName, amount.raw);
        if (merchant == null || merchant.value.isEmpty()) return null;

        String confidence = merchant.highConfidence ? "high" : "review";
        try {
            JSONObject result = new JSONObject();
            result.put("id", fingerprint(packageName + "|" + notificationKey + "|" + postedAt));
            result.put("packageName", packageName);
            result.put("sourceName", clean(sourceName).isEmpty() ? packageName : clean(sourceName));
            result.put("merchant", merchant.value);
            result.put("minorUnits", amount.minorUnits);
            result.put("currency", amount.currency);
            result.put("occurredAt", isoTimestamp(postedAt));
            result.put("occurredOn", localDate(postedAt));
            result.put("confidence", confidence);
            return result;
        } catch (JSONException ignored) {
            return null;
        }
    }

    private static AmountMatch findSingleAmount(String value) {
        AmountMatch first = null;
        int matches = 0;
        Matcher before = CURRENCY_BEFORE.matcher(value);
        while (before.find()) {
            AmountMatch candidate = parseAmount(before.group(2), normalizeCurrency(before.group(1)), before.group(0));
            if (candidate != null) {
                if (first == null) first = candidate;
                matches++;
            }
        }
        Matcher after = CURRENCY_AFTER.matcher(value);
        while (after.find()) {
            AmountMatch candidate = parseAmount(after.group(1), normalizeCurrency(after.group(2)), after.group(0));
            if (candidate != null && (first == null || !candidate.raw.equals(first.raw))) {
                if (first == null) first = candidate;
                matches++;
            }
        }
        // Two monetary values commonly mean "amount + remaining balance". Do
        // not guess which one is the purchase.
        return matches == 1 ? first : null;
    }

    private static AmountMatch parseAmount(String rawNumber, String currency, String raw) {
        if (currency == null) return null;
        String normalized = rawNumber.replace('\u2212', '-').replace("(", "-").replace(")", "");
        normalized = normalized.replace("\u00a0", "").replace("\u202f", "").replace(" ", "").replace("'", "");
        if (normalized.startsWith("+")) return null;
        normalized = normalized.replace("+", "").replace("-", "");
        if (!normalized.matches("\\d[\\d.,]*")) return null;

        int digits = currencyDigits(currency);
        int lastComma = normalized.lastIndexOf(',');
        int lastDot = normalized.lastIndexOf('.');
        int decimalIndex = Math.max(lastComma, lastDot);
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
            // Card apps commonly prefix completed expenses with a minus sign.
            // Credit/refund notifications are rejected by their status text,
            // while a signed debit is stored as a positive expense amount.
            if (value.signum() <= 0) return null;
            long minor = value.movePointRight(digits).setScale(0, RoundingMode.UNNECESSARY).longValueExact();
            return minor > 0 ? new AmountMatch(currency, minor, raw) : null;
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
        // Never persist an unlabelled copy of the notification body. It may
        // contain a balance, account suffix, or other private text. Unknown
        // templates are ignored until a source-specific merchant rule exists.
        return null;
    }

    private static String trimMerchant(String value, String rawAmount) {
        String result = clean(value).replace(rawAmount, " ");
        result = CURRENCY_BEFORE.matcher(result).replaceAll(" ");
        result = CURRENCY_AFTER.matcher(result).replaceAll(" ");
        result = result.replaceAll("(?iu)\\b(card|payment|purchase|transaction|approved|paid|paiement|carte|achat|accept[ée]|결제|카드|승인|완료)\\b", " ");
        result = result.replaceAll("(?iu)\\b(balance|solde|account|compte|card ending|carte se terminant|잔액|계좌|카드번호)\\b.*$", " ");
        result = result.replaceAll("(?u)\\b\\d{4,}\\b", " ");
        result = result.replaceAll("\\s+", " ").replaceAll("^[·•|:：,;—–-]+|[·•|:：,;—–-]+$", "").trim();
        return result.length() > 100 ? result.substring(0, 100).trim() : result;
    }

    private static String normalizeCurrency(String token) {
        if (token == null) return null;
        switch (token.toUpperCase(Locale.ROOT)) {
            case "€": return "EUR";
            case "£": return "GBP";
            case "₩": return "KRW";
            case "¥": return "JPY";
            case "$": return "USD";
            default: return token.toUpperCase(Locale.ROOT);
        }
    }

    private static int currencyDigits(String currency) {
        if ("JPY".equals(currency) || "KRW".equals(currency) || "VND".equals(currency)) return 0;
        if ("KWD".equals(currency)) return 3;
        return 2;
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
        StringBuilder result = new StringBuilder();
        for (String value : values) {
            String cleaned = clean(value);
            if (cleaned.isEmpty() || result.indexOf(cleaned) >= 0) continue;
            if (result.length() > 0) result.append('\n');
            result.append(cleaned);
        }
        return result.toString();
    }

    private static String clean(String value) {
        if (value == null) return "";
        return Normalizer.normalize(value, Normalizer.Form.NFKC).replaceAll("[\\p{Cntrl}&&[^\\n]]", " ").replaceAll("[ \\t]+", " ").trim();
    }

    private static final class AmountMatch {
        final String currency;
        final long minorUnits;
        final String raw;
        AmountMatch(String currency, long minorUnits, String raw) { this.currency = currency; this.minorUnits = minorUnits; this.raw = raw; }
    }

    private static final class MerchantMatch {
        final String value;
        final boolean highConfidence;
        MerchantMatch(String value, boolean highConfidence) { this.value = value; this.highConfidence = highConfidence; }
    }
}
