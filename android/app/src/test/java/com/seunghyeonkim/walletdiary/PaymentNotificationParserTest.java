package com.seunghyeonkim.walletdiary;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

import org.json.JSONObject;
import org.junit.Test;

public class PaymentNotificationParserTest {

    @Test
    public void parsesRevolutEnglishPayment() {
        JSONObject result = parse("com.revolut.revolut", "Card payment", "€12.34 at Lidl", "revolut-key", 1_700_000_000_000L);
        assertNotNull(result);
        assertEquals("Lidl", result.optString("merchant"));
        assertEquals("EUR", result.optString("currency"));
        assertEquals(1234L, result.optLong("minorUnits"));
        assertEquals("high", result.optString("confidence"));
        assertEquals("purchase", result.optString("eventType"));
        assertEquals(PaymentNotificationParser.PARSER_VERSION, result.optInt("parserVersion"));
        assertNull(result.opt("text"));
        assertNull(result.opt("bigText"));
        assertNull(result.opt("notificationKey"));
    }

    @Test
    public void parsesSwileSignedFrenchPayment() {
        JSONObject result = parse("hr.lunc.client", "Lidl", "-1,24 €", "swile-key", 1_700_000_000_000L);
        assertNotNull(result);
        assertEquals("Lidl", result.optString("merchant"));
        assertEquals(124L, result.optLong("minorUnits"));
    }

    @Test
    public void parsesNarrowNbspAndKoreanMerchant() {
        JSONObject result = parse("com.mobiletoong.travelwallet", "해외결제 승인", "가맹점 스타벅스 1\u202f234,56 EUR", "travel-key", 1_700_000_000_000L);
        assertNotNull(result);
        assertEquals(123456L, result.optLong("minorUnits"));
        assertEquals("EUR", result.optString("currency"));
        assertEquals("스타벅스", result.optString("merchant"));
    }

    @Test
    public void rejectsFailedPendingIncomeTransferOtpAndMultipleAmounts() {
        assertNull(parse("hr.lunc.client", "Paiement refusé", "-4,20 €", "failed", 1L));
        assertNull(parse("com.revolut.revolut", "Balance update", "+ €12.34", "credit", 2L));
        assertNull(parse("com.example.bank", "Transfer completed", "€12.34 to Alice", "transfer", 2L));
        assertNull(parse("com.revolut.revolut", "Security code", "OTP 123456 for €1.00", "otp", 3L));
        assertNull(parse("com.revolut.revolut", "Card payment pending", "€12.34 at Lidl", "pending", 3L));
        assertNull(parse("com.revolut.revolut", "Refund failed", "+€12.34 at Lidl", "refund-failed", 3L));
        assertNull(parse("com.example.bank", "Available balance", "€500.00", "balance", 3L));
        assertNull(parse("com.example.bank", "Balance update", "-€500.00", "negative-balance", 3L));
        assertNull(parse("com.example.bank", "Available balance", "Payment completed. -€500.00", "payment-word-balance", 3L));
        assertNull(parse("com.example.bank", "Weekend offer", "Save €10 at Starbucks", "offer", 3L));
        assertNull(parse("com.example.bank", "Lidl", "€12.34", "unsigned-minimal", 3L));
        assertNotNull(parse("com.example.bank", "Lidl", "-€12.34", "signed-minimal", 3L));
        assertNull(parse("com.example.bank", "Transfer cancelled", "€12.34 at Lidl", "transfer-cancel", 3L));
        assertNull(parse("com.example.bank", "Top up reversed", "€12.34 at Lidl", "topup-reverse", 3L));
        assertNull(parse("com.example.bank", "Cash withdrawal reversed", "€12.34 at Lidl", "withdrawal-reverse", 3L));
        assertNull(parse("com.example.bank", "Cashback reversed", "€12.34 at Lidl", "cashback-reverse", 3L));
        JSONObject paymentWithBalance = parse("com.revolut.revolut", "Card payment", "€12.34 at Lidl. Balance €40.00", "multi", 4L);
        assertNotNull(paymentWithBalance);
        assertEquals(1234L, paymentWithBalance.optLong("minorUnits"));
        assertNotNull(parse("com.revolut.revolut", "Shopping Plaza", "-€12.34", "merchant-word", 5L));
    }

    @Test
    public void emitsRefundsAndCancellationsAsReversalsInsteadOfExpenses() {
        JSONObject refund = parse("com.revolut.revolut", "Refund credited", "+€12.34 at Lidl", "refund", 2L);
        JSONObject cancelled = parse("com.example.bank", "결제 취소 완료", "가맹점 스타벅스 5,000 KRW", "cancel", 3L, true, "KRW");
        JSONObject reversed = parse("com.example.bank", "Card payment reversed", "Your card payment at Lidl for €12.34 has been reversed", "reversed", 4L);
        JSONObject partial = parse("com.example.bank", "Partial refund", "€10 at Amazon", "partial", 5L);
        JSONObject requested = parse("com.example.bank", "Refund requested", "€10 at Amazon", "requested", 6L);
        assertNotNull(refund);
        assertNotNull(cancelled);
        assertNotNull(reversed);
        assertNull(partial);
        assertNull(requested);
        assertEquals("reversal", refund.optString("eventType"));
        assertEquals("reversal", cancelled.optString("eventType"));
        assertEquals("reversal", reversed.optString("eventType"));
        assertEquals(1234L, refund.optLong("minorUnits"));
        assertEquals(5000L, cancelled.optLong("minorUnits"));
        assertEquals("Lidl", reversed.optString("merchant"));
    }

    @Test
    public void discoversWorldwidePaymentAppsAsReviewOnly() {
        JSONObject japanese = parse("jp.example.bank", "カード利用", "店舗: コンビニ JPY 1,200", "jp", 10L, false, "JPY");
        JSONObject german = parse("de.example.bank", "Kartenzahlung", "EUR 12,34 bei REWE", "de", 11L, false, "EUR");
        JSONObject brazilian = parse("br.example.bank", "Mercado Livre", "Pagamento aprovado R$ 12,34", "br", 12L, false, "BRL");
        assertNotNull(japanese);
        assertNotNull(german);
        assertNotNull(brazilian);
        assertEquals("review", japanese.optString("confidence"));
        assertEquals("JPY", japanese.optString("currency"));
        assertEquals("REWE", german.optString("merchant"));
        assertEquals("BRL", brazilian.optString("currency"));
        JSONObject lowerCaseIso = parse("nl.example.bank", "Card payment", "12,34 eur at HEMA", "nl", 13L, false, "EUR");
        assertNotNull(lowerCaseIso);
        assertEquals("EUR", lowerCaseIso.optString("currency"));
    }

    @Test
    public void requiresPaymentSignalForUnregisteredAppsAndHintForAmbiguousSymbols() {
        assertNull(parse("com.example.shop", "Sale", "$12.34 at Store", "not-bank", 20L, false, ""));
        assertNull(parse("com.example.bank", "Payment approved", "$12.34 at Store", "ambiguous", 21L, false, ""));
        JSONObject cad = parse("com.example.bank", "Payment approved", "$12.34 at Store", "cad", 22L, false, "CAD");
        assertNotNull(cad);
        assertEquals("CAD", cad.optString("currency"));
        assertEquals("review", cad.optString("confidence"));
    }

    @Test
    public void rejectsPaymentWithoutAnExplicitMerchant() {
        assertNull(parse("com.revolut.revolut", "Card payment", "€12.34 completed", "no-merchant", 6L));
    }

    @Test
    public void stripsSensitiveContactAndAccountDataFromMerchantCandidates() {
        JSONObject email = parse("com.example.bank", "Card payment", "€12.34 Merchant: Lidl contact alice@example.com", "email", 30L);
        JSONObject iban = parse("com.example.bank", "Card payment", "€12.34 Merchant: Lidl IBAN FR76 3000 6000 0112 3456 7890 189", "iban", 31L);
        JSONObject phone = parse("com.example.bank", "Card payment", "€12.34 Merchant: Lidl phone +33 6 00 00 00 00", "phone", 32L);
        JSONObject cardTail = parse("com.example.bank", "Card payment", "€12.34 Merchant: Lidl card ending 1234", "card", 33L);
        JSONObject reference = parse("com.example.bank", "Card payment", "€12.34 at Lidl reference TXN-A9B8C7D6", "reference", 34L);
        assertNotNull(email);
        assertNotNull(iban);
        assertNotNull(phone);
        assertNotNull(cardTail);
        assertNotNull(reference);
        assertEquals("Lidl", email.optString("merchant"));
        assertEquals("Lidl", iban.optString("merchant"));
        assertEquals("Lidl", phone.optString("merchant"));
        assertEquals("Lidl", cardTail.optString("merchant"));
        assertEquals("Lidl", reference.optString("merchant"));
        assertNull(email.opt("text"));
    }

    @Test
    public void collapsesDuplicateAmountsAndIgnoresASeparateBalanceAmount() {
        JSONObject duplicate = PaymentNotificationParser.parse(
            "com.example.bank", "Source", "Card payment", "€12.34 at Lidl",
            "Your card payment of €12.34 at Lidl was approved", "", 40L, "duplicate", true, false, "EUR"
        );
        JSONObject withBalance = PaymentNotificationParser.parse(
            "com.example.bank", "Source", "Card payment", "€12.34 at Lidl",
            "Your card payment of €12.34 at Lidl. Available balance €40.00", "", 41L, "distinct", true, false, "EUR"
        );
        assertNotNull(duplicate);
        assertEquals(1234L, duplicate.optLong("minorUnits"));
        assertEquals("Lidl", duplicate.optString("merchant"));
        assertNotNull(withBalance);
        assertEquals(1234L, withBalance.optLong("minorUnits"));
    }

    @Test
    public void keepsOnlyThePaymentAmountWhenAlertsAlsoShowBalances() {
        JSONObject english = parse("com.example.bank", "Card payment", "€12.34 at Lidl. Remaining balance €500.00", "balance-en", 70L);
        JSONObject balanceFirst = parse("com.example.bank", "Card payment", "Available balance £500.00. Card payment €12.34 at Lidl", "balance-first", 71L);
        JSONObject sameNumber = parse("com.example.bank", "Card payment", "€12.34 at Lidl. Account balance €12.34", "balance-same", 72L);
        JSONObject french = parse("fr.example.bank", "Paiement par carte", "12,34 € chez Lidl. Nouveau solde : 840,22 €", "balance-fr", 73L);
        JSONObject korean = parse("kr.example.bank", "카드 승인", "결제금액 5,000 KRW / 가맹점 스타벅스 / 결제 후 잔액 125,000 KRW", "balance-ko", 74L, true, "KRW");
        JSONObject refund = parse("com.example.bank", "Refund credited", "+€12.34 at Lidl. New balance €40.00", "balance-refund", 75L);
        JSONObject signedFrench = parse("fr.example.bank", "Lidl", "-12,34 €\nSolde restant 840,22 €", "balance-signed-fr", 76L);
        JSONObject signedEnglish = parse("com.example.bank", "Lidl", "-€12.34 | Available balance €500.00", "balance-signed-en", 77L);
        JSONObject sentencePeriod = parse("com.example.bank", "Lidl", "Card payment €12.34. Remaining balance €500.00", "balance-period", 78L);
        JSONObject sentenceComma = parse("com.example.bank", "Store", "Payment completed. $12.34, Remaining balance $500.00", "balance-comma", 79L, true, "USD");
        assertNotNull(english);
        assertNotNull(balanceFirst);
        assertNotNull(sameNumber);
        assertNotNull(french);
        assertNotNull(korean);
        assertNotNull(refund);
        assertNotNull(signedFrench);
        assertNotNull(signedEnglish);
        assertNotNull(sentencePeriod);
        assertNotNull(sentenceComma);
        assertEquals(1234L, english.optLong("minorUnits"));
        assertEquals("EUR", balanceFirst.optString("currency"));
        assertEquals(1234L, balanceFirst.optLong("minorUnits"));
        assertEquals(1234L, sameNumber.optLong("minorUnits"));
        assertEquals(1234L, french.optLong("minorUnits"));
        assertEquals(5000L, korean.optLong("minorUnits"));
        assertEquals("reversal", refund.optString("eventType"));
        assertEquals(1234L, refund.optLong("minorUnits"));
        assertEquals(1234L, signedFrench.optLong("minorUnits"));
        assertEquals(1234L, signedEnglish.optLong("minorUnits"));
        assertEquals(1234L, sentencePeriod.optLong("minorUnits"));
        assertEquals(1234L, sentenceComma.optLong("minorUnits"));
    }

    @Test
    public void rejectsBalanceOnlyAlertsAcrossLanguagesAndSigns() {
        assertNull(parse("com.example.bank", "Lidl", "Payment completed. Remaining balance €500.00", "only-en", 80L));
        assertNull(parse("com.example.bank", "Lidl", "Payment completed. Balance after transaction: -€40.00", "only-negative", 81L));
        assertNull(parse("fr.example.bank", "Lidl", "Paiement accepté. Solde restant 840,22 €", "only-fr", 82L));
        assertNull(parse("kr.example.bank", "스타벅스", "카드 승인. 결제 후 잔액 -125,000 KRW", "only-ko", 83L, true, "KRW"));
        assertNull(parse("de.example.bank", "REWE", "Kartenzahlung. Kontostand EUR 840,22", "only-de", 84L));
        assertNull(parse("es.example.bank", "Mercado", "Pago con tarjeta. Saldo disponible 840,22 EUR", "only-es", 85L));
        assertNull(parse("pt.example.bank", "Mercado", "Pagamento aprovado. Saldo atual 840,22 EUR", "only-pt", 86L));
        assertNull(parse("jp.example.bank", "コンビニ", "カード利用. 利用可能残高 JPY 120,000", "only-ja", 87L, true, "JPY"));
        assertNull(parse("cn.example.bank", "便利店", "卡消费. 可用余额 CNY 8,000.00", "only-zh", 88L, true, "CNY"));
        assertNull(parse("com.example.bank", "Lidl", "Payment completed. Available balance €500.00 / account balance £400.00", "only-multi", 89L));
        assertNull(parse("com.example.bank", "Lidl", "Payment completed. -€500.00 remaining balance", "only-after", 90L));
        assertNull(parse("com.example.bank", "Lidl", "Payment completed. New balance: -€40.00", "only-new-negative", 91L));
        assertNull(parse("com.example.bank", "Lidl", "Payment completed. New balance -€40.00", "only-new-minus", 92L));
        assertNull(parse("com.example.bank", "Lidl", "Payment completed. New balance −€40.00", "only-new-unicode-minus", 93L));
        assertNull(parse("com.example.bank", "Lidl", "Payment completed. New balance -40 EUR", "only-new-after", 94L));
        assertNull(parse("fr.example.bank", "Lidl", "Paiement accepté\nSolde restant\n840,22 €", "only-fr-lines", 95L));
        assertNull(parse("kr.example.bank", "스타벅스", "카드 승인\n결제 후 잔액\n125,000 KRW", "only-ko-lines", 96L, true, "KRW"));
    }

    @Test
    public void balanceWordsInMerchantNamesDoNotHideRealPayments() {
        JSONObject merchant = parse("com.example.bank", "Balance Coffee", "-€12.34", "merchant-balance", 100L);
        JSONObject frenchMerchant = parse("fr.example.bank", "Solde Café", "-12,34 €", "merchant-solde", 101L);
        JSONObject labelledMerchant = parse("com.example.bank", "Card payment", "€12.34 at Balance Coffee", "merchant-labelled", 102L);
        JSONObject labelledFrenchMerchant = parse("fr.example.bank", "Paiement par carte", "12,34 € chez Solde Café", "merchant-labelled-fr", 103L);
        JSONObject newBalanceMerchant = parse("com.example.bank", "New Balance", "-€12.34", "merchant-new-balance", 104L);
        assertNotNull(merchant);
        assertNotNull(frenchMerchant);
        assertNotNull(labelledMerchant);
        assertNotNull(labelledFrenchMerchant);
        assertNotNull(newBalanceMerchant);
        assertEquals("Balance Coffee", merchant.optString("merchant"));
        assertEquals("Solde Café", frenchMerchant.optString("merchant"));
        assertEquals("Balance Coffee", labelledMerchant.optString("merchant"));
        assertEquals("Solde Café", labelledFrenchMerchant.optString("merchant"));
        assertEquals("New Balance", newBalanceMerchant.optString("merchant"));
        assertEquals(1234L, merchant.optLong("minorUnits"));
        assertNull(parse("com.example.bank", "Card payment", "€12.34 at Lidl. Tip €2.00", "two-purchases", 105L));
    }

    @Test
    public void createsStableButDistinctEventIds() {
        JSONObject first = parse("com.revolut.revolut", "Lidl", "-€12.34", "same-key", 10L);
        JSONObject replay = parse("com.revolut.revolut", "Lidl", "-€12.34", "same-key", 10L);
        JSONObject next = parse("com.revolut.revolut", "Lidl", "-€12.34", "next-key", 11L);
        assertNotNull(first);
        assertNotNull(replay);
        assertNotNull(next);
        assertEquals(first.optString("id"), replay.optString("id"));
        assertNotEquals(first.optString("id"), next.optString("id"));
    }

    @Test
    public void queueTokenChangesWhenTheSameStableEventBecomesAReversal() {
        JSONObject purchase = parse("com.revolut.revolut", "Card payment", "€12.34 at Lidl", "updated-key", 60L);
        JSONObject reversal = parse("com.revolut.revolut", "Card payment reversed", "€12.34 at Lidl", "updated-key", 60L);
        assertNotNull(purchase);
        assertNotNull(reversal);
        assertEquals(purchase.optString("id"), reversal.optString("id"));
        assertNotEquals(purchase.optString("queueToken"), reversal.optString("queueToken"));
    }

    @Test
    public void aggregatorSourcesRemainManualEvenAfterPackageRegistration() {
        JSONObject result = PaymentNotificationParser.parse(
            "com.google.android.apps.messaging", "Messages", "Card payment",
            "€12.34 at Lidl", "", "", 50L, "sms-key", true, true, "EUR"
        );
        assertNotNull(result);
        assertEquals("review", result.optString("confidence"));
        assertEquals(true, result.optBoolean("manualOnly"));
    }

    private static JSONObject parse(String packageName, String title, String text, String key, long time) {
        return parse(packageName, title, text, key, time, true, "EUR");
    }

    private static JSONObject parse(String packageName, String title, String text, String key, long time, boolean configured, String currencyHint) {
        return PaymentNotificationParser.parse(packageName, "Source", title, text, "", "", time, key, configured, false, currencyHint);
    }
}
