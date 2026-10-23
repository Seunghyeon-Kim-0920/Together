package com.seunghyeonkim.walletdiary;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.text.Normalizer;
import java.util.Locale;
import java.util.regex.Pattern;

/** Opt-in notification-only SMS handling; never reads the SMS database. */
final class SmsPaymentPolicy {
    static final String SOURCE_PREFIX = "walletdiary.sms.s";
    private static final Pattern SENDER_SOURCE = Pattern.compile("walletdiary\\.sms\\.s[0-9a-f]{64}");
    private static final Pattern AGGREGATE_SENDER = Pattern.compile("(?iu)(?:messages?|messaging|new messages?|sms|문자(?:메시지)?|메시지|새 메시지|\\d+ (?:new )?messages?)");
    private static final Pattern FINANCIAL_RECEIPT = Pattern.compile(
        "(?isu)(?:\\[(?:[^\\]\\r\\n]{0,30})?(?:승인|취소)\\]|(?:카드|체크|신용|은행|계좌|이체|송금|출금).{0,45}(?:승인|결제|출금|완료|취소)|(?:승인|결제|출금|이체|송금|취소).{0,45}(?:완료|되었습니다|됐습니다|하였습니다)|(?:card|account|payment|transfer|debit|purchase|transaction).{0,55}(?:approved|completed|successful|processed|debited|charged|paid|sent|reversed|refunded|cancelled|canceled)(?![\\p{L}\\p{N}_])|(?:you(?:'ve| have)? paid|you sent|your card was charged|your account was debited)(?![\\p{L}\\p{N}_])|(?:paiement|virement|pr[ée]l[èe]vement|carte).{0,45}(?:effectu[ée]|valid[ée]|accept[ée]|d[ée]bit[ée]|annul[ée]|rembours[ée])(?:e?s)?(?![\\p{L}\\p{N}_])|(?:zahlung|[üu]berweisung|lastschrift).{0,45}(?:erfolgreich|ausgef[üu]hrt|abgebucht|storniert)(?![\\p{L}\\p{N}_])|(?:pago|transferencia).{0,45}(?:realizad[oa]|completad[oa]|aprobad[oa]|cancelad[oa])(?![\\p{L}\\p{N}_])|(?:pagamento|bonifico).{0,45}(?:effettuato|eseguito|approvato|annullato)(?![\\p{L}\\p{N}_])|(?:決済|支払|振込|送金).{0,25}(?:完了|承認|取消)|(?:支付|付款|转账|轉帳).{0,25}(?:成功|完成|取消))");

    private SmsPaymentPolicy() {}

    static boolean isSenderSource(String value) {
        return value != null && SENDER_SOURCE.matcher(value).matches();
    }

    /** A package-scoped, exact sender identity; the body can never choose its sender. */
    static String sourceId(String smsPackage, String sender) {
        if (smsPackage == null || sender == null) return "";
        String normalized = Normalizer.normalize(sender, Normalizer.Form.NFKC).trim().toLowerCase(Locale.ROOT);
        if (normalized.isEmpty() || normalized.length() > 100 || normalized.contains("\n") || normalized.contains("\r")) return "";
        // Common aggregate titles must never become a trusted sender identity.
        if (AGGREGATE_SENDER.matcher(normalized).matches()) return "";
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256").digest((smsPackage + "\u0000" + normalized).getBytes(StandardCharsets.UTF_8));
            StringBuilder result = new StringBuilder(SOURCE_PREFIX);
            for (byte value : hash) result.append(String.format(Locale.ROOT, "%02x", value & 0xff));
            return result.toString();
        } catch (Exception unavailable) { return ""; }
    }

    static boolean hasFinancialReceiptEvidence(String body) {
        return body != null && body.length() <= 20_000 && FINANCIAL_RECEIPT.matcher(body).find();
    }

    static String displayName(String sender) {
        String value = sender == null ? "" : sender.trim();
        return "SMS · " + (value.length() <= 74 ? value : value.substring(0, 74));
    }
}
