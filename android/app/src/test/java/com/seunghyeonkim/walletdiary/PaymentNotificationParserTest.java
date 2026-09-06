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
    public void rejectsFailedPendingIncomeOtpAndMultipleAmounts() {
        assertNull(parse("hr.lunc.client", "Paiement refusé", "-4,20 €", "failed", 1L));
        assertNull(parse("com.revolut.revolut", "Balance update", "+ €12.34", "credit", 2L));
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
    public void parsesCompletedOutgoingTransfersAcrossSupportedLanguages() {
        JSONObject english = parse("com.example.bank", "Transfer completed", "€12.34 sent to Alice", "transfer-en", 110L);
        JSONObject french = parse("fr.example.bank", "Virement effectué", "12,34 € vers Alice", "transfer-fr", 111L);
        JSONObject korean = parse("kr.example.bank", "송금 완료", "받는 분 김민지 12,000 KRW", "transfer-ko", 112L, true, "KRW");
        JSONObject withBalance = parse("com.example.bank", "Transfer completed", "€12.34 to Alice. Remaining balance €500.00", "transfer-balance", 113L);

        assertNotNull(english);
        assertNotNull(french);
        assertNotNull(korean);
        assertNotNull(withBalance);
        assertEquals("outgoing_transfer", english.optString("eventType"));
        assertEquals("outgoing_transfer", french.optString("eventType"));
        assertEquals("outgoing_transfer", korean.optString("eventType"));
        assertEquals("Alice", english.optString("merchant"));
        assertEquals("Alice", french.optString("merchant"));
        assertEquals("김민지", korean.optString("merchant"));
        assertEquals(1234L, withBalance.optLong("minorUnits"));
        assertEquals("Alice", withBalance.optString("merchant"));
    }

    @Test
    public void parsesExecutedDirectDebitsAcrossSupportedLanguages() {
        JSONObject english = parse("com.example.bank", "Direct debit completed", "£45.67 creditor EDF", "debit-en", 120L, true, "GBP");
        JSONObject french = parse("fr.example.bank", "Prélèvement SEPA effectué", "42,00 € créancier EDF", "debit-fr", 121L);
        JSONObject korean = parse("kr.example.bank", "자동이체 출금 완료", "예금주 통신사 55,000 KRW", "debit-ko", 122L, true, "KRW");

        assertNotNull(english);
        assertNotNull(french);
        assertNotNull(korean);
        assertEquals("direct_debit", english.optString("eventType"));
        assertEquals("direct_debit", french.optString("eventType"));
        assertEquals("direct_debit", korean.optString("eventType"));
        assertEquals("EDF", english.optString("merchant"));
        assertEquals("EDF", french.optString("merchant"));
        assertEquals("통신사", korean.optString("merchant"));
    }

    @Test
    public void parsesExecutedStandingOrdersAcrossSupportedLanguages() {
        JSONObject english = parse("com.example.bank", "Standing order executed", "€700.00 to Landlord", "standing-en", 130L);
        JSONObject french = parse("fr.example.bank", "Virement permanent exécuté", "700,00 € vers Propriétaire", "standing-fr", 131L);
        JSONObject korean = parse("kr.example.bank", "정기이체 완료", "받는 분 집주인 700,000 KRW", "standing-ko", 132L, true, "KRW");

        assertNotNull(english);
        assertNotNull(french);
        assertNotNull(korean);
        assertEquals("standing_order", english.optString("eventType"));
        assertEquals("standing_order", french.optString("eventType"));
        assertEquals("standing_order", korean.optString("eventType"));
        assertEquals("Landlord", english.optString("merchant"));
        assertEquals("Propriétaire", french.optString("merchant"));
        assertEquals("집주인", korean.optString("merchant"));
    }

    @Test
    public void rejectsIncomingFutureFailedAndOwnAccountTransfers() {
        assertNull(parse("com.example.bank", "Transfer received", "€12.34 from Alice", "incoming-en", 140L));
        assertNull(parse("com.example.bank", "Transfer completed", "€12.34 from Alice", "incoming-from-en", 1401L));
        assertNull(parse("com.example.bank", "Alice", "Transfer completed €12.34 received from Alice", "incoming-received-from-en", 1402L));
        assertNull(parse("fr.example.bank", "Virement reçu", "12,34 € de Alice", "incoming-fr", 141L));
        assertNull(parse("fr.example.bank", "Virement effectué", "12,34 € de Alice", "incoming-de-fr", 1411L));
        assertNull(parse("fr.example.bank", "Alice", "Virement provenant de Alice : 12,34 €", "incoming-source-fr", 1412L));
        assertNull(parse("kr.example.bank", "송금 받음", "입금 12,000 KRW", "incoming-ko", 142L, true, "KRW"));
        assertNull(parse("kr.example.bank", "이체 완료", "김민지로부터 12,000 KRW", "incoming-from-ko", 1421L, true, "KRW"));
        assertNull(parse("kr.example.bank", "김민지", "송금을 받았습니다 12,000 KRW", "incoming-received-ko", 1422L, true, "KRW"));
        assertNull(parse("com.example.bank", "Transfer completed", "-€12.34", "ambiguous-transfer-en", 1423L));
        assertNull(parse("com.example.bank", "Alice", "Transfer completed -€12.34", "ambiguous-title-en", 1424L));
        assertNull(parse("fr.example.bank", "Virement effectué", "-12,34 €", "ambiguous-transfer-fr", 1425L));
        assertNull(parse("kr.example.bank", "이체 완료", "-12,000 KRW", "ambiguous-transfer-ko", 1426L, true, "KRW"));
        assertNull(parse("com.example.bank", "Standing order", "€12.34 scheduled for tomorrow to Alice", "future-en", 143L));
        assertNull(parse("fr.example.bank", "Virement permanent", "12,34 € prévu pour demain vers Alice", "future-fr", 144L));
        assertNull(parse("kr.example.bank", "정기이체 출금 예정", "내일 12,000 KRW", "future-ko", 145L, true, "KRW"));
        assertNull(parse("com.example.bank", "Direct debit created", "-€20.00 creditor EDF", "created-debit", 1451L));
        assertNull(parse("com.example.bank", "Standing order mandate set up", "-€20.00 to Alice", "mandate-en", 1452L));
        assertNull(parse("fr.example.bank", "Prélèvement enregistré", "-20,00 € créancier EDF", "registered-fr", 1453L));
        assertNull(parse("kr.example.bank", "자동이체 등록", "-20,000 KRW 예금주 통신사", "registered-ko", 1454L, true, "KRW"));
        assertNull(parse("com.example.bank", "Direct debit", "€20.00 creditor EDF", "unsigned-bare-debit", 1455L));
        assertNull(parse("com.example.bank", "Standing order", "€20.00 to Alice", "unsigned-bare-standing", 1456L));
        assertNull(parse("com.example.bank", "Transfer pending", "€12.34 to Alice", "pending-transfer", 146L));
        assertNull(parse("com.example.bank", "Transfer failed", "€12.34 to Alice", "failed-transfer", 147L));
        assertNull(parse("com.example.bank", "Transfer completed", "€12.34 between your own accounts", "own-en", 148L));
        assertNull(parse("fr.example.bank", "Virement effectué", "12,34 € entre vos comptes", "own-fr", 149L));
        assertNull(parse("kr.example.bank", "이체 완료", "내 계좌 간 이체 12,000 KRW", "own-ko", 150L, true, "KRW"));
        assertNull(parse("com.example.bank", "Transfer cancelled", "€12.34 to Alice", "cancelled-transfer", 151L));
        assertNull(parse("com.example.bank", "Direct debit returned", "-€20.00 creditor EDF", "returned-debit-en", 152L));
        assertNull(parse("com.example.bank", "Transfer returned", "-€20.00 to Alice", "returned-transfer-en", 153L));
        assertNull(parse("fr.example.bank", "Prélèvement rejeté", "-20,00 € créancier EDF", "rejected-debit-fr", 154L));
        assertNull(parse("fr.example.bank", "Virement retourné", "-20,00 € vers Alice", "returned-transfer-fr", 155L));
        assertNull(parse("kr.example.bank", "자동이체 반환", "-20,000 KRW 예금주 통신사", "returned-debit-ko", 156L, true, "KRW"));
        assertNull(parse("kr.example.bank", "송금 반송", "-20,000 KRW 받는 분 김민지", "returned-transfer-ko", 157L, true, "KRW"));
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
    public void keepsPaymentWithoutAnExplicitMerchantForRequiredUserReview() {
        JSONObject draft = parse("com.revolut.revolut", "Card payment", "€12.34 completed", "no-merchant", 6L);
        assertNotNull(draft);
        assertEquals("", draft.optString("merchant"));
        assertEquals(true, draft.optBoolean("requiresMerchant"));
        assertEquals("review", draft.optString("confidence"));
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

    @Test
    public void discoversPreviouslyUnknownCompactDebitAppsWithoutWhitelist() {
        for (String packageName : new String[] {"hr.lunc.client", "kr.example.newbank", "fr.example.nouvellebanque", "jp.example.bank", "com.somewhere.newcard"}) {
            JSONObject result = parse(packageName, "Lidl", "-1,24 €", "new-app", 500L, false, "EUR");
            assertNotNull(packageName, result);
            assertEquals("review", result.optString("confidence"));
            assertEquals("Lidl", result.optString("merchant"));
            assertEquals(124L, result.optLong("minorUnits"));
        }
    }

    @Test
    public void swileAppTitleAndBodyMerchantAreRetainedForReview() {
        for (String body : new String[] {"Lidl -1,24 €", "Lidl\n-1,24 €", "Lidl\n-1,24 €\nSolde disponible 180,00 €"}) {
            JSONObject result = PaymentNotificationParser.parse("hr.lunc.client", "Swile", "Swile", body, "", "", 600L, "swile", false, false, "EUR");
            assertNotNull(body, result);
            assertEquals("review", result.optString("confidence"));
            assertEquals("Lidl", result.optString("merchant"));
            assertEquals(124L, result.optLong("minorUnits"));
        }
    }

    @Test
    public void unknownMerchantIsAnIncompleteDraftNotAGuessedBankName() {
        JSONObject result = parse("com.any.bank", "Card payment", "€12.34", "no-merchant", 700L, true, "EUR");
        assertNotNull(result);
        assertEquals("", result.optString("merchant"));
        assertEquals(true, result.optBoolean("requiresMerchant"));
        assertEquals("review", result.optString("confidence"));
        assertEquals(false, result.has("text"));
    }

    @Test
    public void localCurrencyWordsAndWorldwidePaymentFormatsReachReview() {
        String[][] rows = {
            {"Card payment", "12.34 Euros at Lidl", "EUR", "1234"},
            {"카드 결제", "가맹점 스타벅스 12,000원", "KRW", "12000"},
            {"카드 결제", "가맹점 스타벅스 12,000원 승인번호: 123456", "KRW", "12000"},
            {"카드 결제", "가맹점 스타벅스 12.34 유로", "EUR", "1234"},
            {"カード利用", "店舗 東京店 1200円", "JPY", "1200"},
            {"Kartenzahlung", "12,34 EUR bei Markt", "EUR", "1234"},
            {"Pago", "12,34 EUR comercio Tienda", "EUR", "1234"},
            {"刷卡", "商户 商店 12.34 CNY", "CNY", "1234"},
        };
        for (String[] row : rows) {
            JSONObject result = parse("com.unlisted.payment", row[0], row[1], "global", 710L, false, row[2]);
            assertNotNull(row[0], result);
            assertEquals(row[2], result.optString("currency"));
            assertEquals(Long.parseLong(row[3]), result.optLong("minorUnits"));
            assertEquals("review", result.optString("confidence"));
        }
    }

    @Test
    public void unknownAppsStillRejectBalancesCreditsFailuresAndOffers() {
        for (String title : new String[] {"Balance", "Solde", "Saldo", "잔액", "残高", "余额", "餘額", "الرصيد"}) {
            for (boolean trusted : new boolean[] {false, true}) {
                assertNull(parse("com.unlisted.app", title, "-12,00 €", "bare-balance", 800L, trusted, "EUR"));
            }
        }
        assertNull(parse("com.unlisted.app", "Solde disponible", "-120,00 €", "balance", 800L, false, "EUR"));
        assertNull(parse("com.unlisted.app", "Lidl", "+12,00 €", "incoming", 801L, false, "EUR"));
        assertNull(parse("com.unlisted.app", "Paiement refusé", "-12,00 € chez Lidl", "failed", 802L, false, "EUR"));
        assertNull(parse("com.unlisted.app", "Promotion", "Save -12,00 € at Lidl", "offer", 803L, false, "EUR"));
        assertNull(parse("com.unlisted.app", "OTP", "123456 for -12,00 €", "otp", 804L, false, "EUR"));
        assertNull(parse("com.unlisted.app", "Lidl", "12,00 €", "unsigned", 805L, false, "EUR"));
    }

    @Test
    public void duplicateCollapsedAndExpandedAmountsRetainDebitEvidence() {
        for (String[] bodies : new String[][] {
            {"-12,34 € at Lidl", "Card payment 12,34 € at Lidl"},
            {"Card payment 12,34 € at Lidl", "-12,34 € at Lidl"},
            {"Lidl -€12.34", "-12.34 EUR at Lidl"},
        }) {
            JSONObject result = PaymentNotificationParser.parse("com.unlisted.bank", "Bank", "Lidl", bodies[0], bodies[1], "", 901L, "same-amount", false, false, "EUR");
            assertNotNull(result);
            assertEquals(1234L, result.optLong("minorUnits"));
            assertEquals("review", result.optString("confidence"));
        }
        assertNull(PaymentNotificationParser.parse("com.unlisted.bank", "Bank", "Lidl", "-12,34 € at Lidl", "Card payment 23,45 € at Lidl", "", 901L, "different-amount", false, false, "EUR"));
        assertNull(PaymentNotificationParser.parse("com.unlisted.bank", "Bank", "Lidl", "-12,34 € at Lidl", "Card payment 12.34 GBP at Lidl", "", 901L, "different-currency", false, false, "EUR"));
    }

    @Test
    public void incomingPaymentsAreNotExpensesEvenWithoutTheWordTransfer() {
        for (String text : new String[] {
            "Payment received €12.34", "Received a payment €12.34", "You received €12.34 payment",
            "Paiement reçu 12,34 €", "Vous avez reçu un paiement de 12,34 €", "결제 대금을 받았습니다 12,000원",
        }) {
            assertNull(text, parse("com.unlisted.bank", "Alice", text, "incoming-payment", 902L, true, "EUR"));
        }
        JSONObject refund = parse("com.unlisted.bank", "Refund received", "Payment received €12.34 at Lidl", "refund-payment", 903L, true, "EUR");
        assertNotNull(refund);
        assertEquals("reversal", refund.optString("eventType"));
    }

    @Test
    public void availableCreditIsOnlyBalanceMetadataWhileCreditsRemainExcluded() {
        for (String label : new String[] {"Available credit", "Credit available", "Credit remaining"}) {
            JSONObject result = parse("com.unlisted.bank", "Card payment", "€12.34 at Lidl. " + label + " €500.00", "credit-balance", 904L, false, "EUR");
            assertNotNull(label, result);
            assertEquals(1234L, result.optLong("minorUnits"));
            assertNull(parse("com.unlisted.bank", "Card payment", label + " €500.00", "only-credit-balance", 904L, false, "EUR"));
        }
        assertNull(parse("com.unlisted.bank", "Credit", "€12.34", "income-credit", 905L, false, "EUR"));
        assertNull(parse("com.unlisted.bank", "Credit received", "-€12.34", "income-credit-signed", 905L, true, "EUR"));
    }

    @Test
    public void koreanStandaloneApprovalReachesReviewWithoutTreatingApprovalIdsAsPayments() {
        JSONObject result = parse("com.unlisted.bank", "KB국민카드", "12,300원 일시불 승인\n가맹점 스타벅스\n잔액 120,000원", "korean-approval", 906L, true, "KRW");
        assertNotNull(result);
        assertEquals(12300L, result.optLong("minorUnits"));
        assertEquals("review", result.optString("confidence"));
        assertNull(parse("com.unlisted.bank", "KB국민카드", "승인번호 123456\n12,300원", "only-approval-id", 906L, true, "KRW"));
        assertNull(parse("com.unlisted.bank", "KB국민카드", "승인\n잔액 120,000원", "approval-balance", 906L, true, "KRW"));
        assertNull(parse("com.unlisted.bank", "KB국민카드", "입금 12,300원 승인", "approval-income", 906L, true, "KRW"));
    }

    @Test
    public void queueReceiptIsIndependentOfTrustAndManualOnlyPolicy() {
        JSONObject unknown = PaymentNotificationParser.parse("com.unlisted.bank", "Bank", "Card payment", "€12.34 at Lidl", "", "", 907L, "policy-change", false, false, "EUR");
        JSONObject trusted = PaymentNotificationParser.parse("com.unlisted.bank", "Bank", "Card payment", "€12.34 at Lidl", "", "", 907L, "policy-change", true, false, "EUR");
        JSONObject manual = PaymentNotificationParser.parse("com.unlisted.bank", "Bank", "Card payment", "€12.34 at Lidl", "", "", 907L, "policy-change", true, true, "EUR");
        assertNotNull(unknown);
        assertNotNull(trusted);
        assertNotNull(manual);
        assertEquals(unknown.optString("queueToken"), trusted.optString("queueToken"));
        assertEquals(unknown.optString("queueToken"), manual.optString("queueToken"));
        assertEquals("review", unknown.optString("confidence"));
        assertEquals("high", trusted.optString("confidence"));
        assertEquals("review", manual.optString("confidence"));
    }

    private static JSONObject parse(String packageName, String title, String text, String key, long time) {
        return parse(packageName, title, text, key, time, true, "EUR");
    }

    private static JSONObject parse(String packageName, String title, String text, String key, long time, boolean configured, String currencyHint) {
        return PaymentNotificationParser.parse(packageName, "Source", title, text, "", "", time, key, configured, false, currencyHint);
    }
}
