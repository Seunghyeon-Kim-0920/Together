package com.seunghyeonkim.walletdiary;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;

import org.json.JSONObject;
import org.junit.Test;

/**
 * Synthetic layouts for the reported merchant-before-amount ordering.
 * These examples are not captured user notifications or verified provider templates.
 */
public class PaymentMerchantNotificationRegressionTest {
    private static final long POSTED_AT = 1_790_683_200_000L;

    @Test
    public void frenchMerchantBeforePaymentNarrativeIsPreserved() {
        for (String body : new String[] {
            "Café Exemple : votre paiement de 12,34 € a été accepté.",
            "Café Exemple - Paiement de 12,34 € accepté",
        }) {
            assertPurchase("Swile", "Paiement accepté", body, "Café Exemple", "EUR", 1234L);
        }
    }

    @Test
    public void frenchDecoratedMerchantBeforeAmountIsPreserved() {
        assertPurchase("Swile", "Paiement accepté", "🥐 Café Exemple\n12,34 €", "Café Exemple", "EUR", 1234L);
        assertPurchase("Swile", "Paiement accepté", "Café Exemple ✅\n12,34 €", "Café Exemple", "EUR", 1234L);
    }

    @Test
    public void frenchMerchantThenAmountLabelAndBalanceRemainOnePurchase() {
        assertPurchase("Swile", "Paiement accepté",
            "Café Exemple\nMontant : 12,34 €\nSolde disponible : 180,00 €",
            "Café Exemple", "EUR", 1234L);
    }

    @Test
    public void frenchMerchantInExpandedLinesSurvivesGenericBigText() {
        String expanded = NotificationTextContent.expandedBody(
            "Votre paiement a été accepté.",
            new CharSequence[] {"Café Exemple", "Montant : 12,34 €", "Solde disponible : 180,00 €"},
            null);
        JSONObject result = parse("Swile", "Paiement accepté", "Paiement accepté", expanded, "EUR", true);
        assertPurchaseResult(expanded, result, "Café Exemple", "EUR", 1234L);
    }

    @Test
    public void koreanMerchantBeforeAmountWithInstallmentAndApprovalIsPreserved() {
        for (String source : koreanCardSources()) {
            for (String body : new String[] {
                "카페 봄 12,000원 일시불 승인",
                "카페 봄 12,000원 3개월 할부 승인",
            }) {
                assertPurchase(source, "카드 결제", body, "카페 봄", "KRW", 12000L);
            }
        }
    }

    @Test
    public void koreanMerchantBeforeAmountWithTrailingTransactionTimeIsPreserved() {
        for (String source : koreanCardSources()) {
            assertPurchase(source, "카드 결제", "카페 봄 12,000원 승인 09/29 12:34",
                "카페 봄", "KRW", 12000L);
        }
    }

    @Test
    public void koreanExplicitMerchantLabelStopsBeforeAmountMetadata() {
        assertPurchase("KB국민카드", "카드 결제", "이용가맹점: 카페 봄 결제금액: 12,000원 일시불",
            "카페 봄", "KRW", 12000L);
    }

    @Test
    public void koreanMerchantBeforeAmountOnSeparateLinesRemainsSupported() {
        for (String source : koreanCardSources()) {
            assertPurchase(source, "카드 결제",
                "[Web발신]\n" + source + "(1234)승인\n김*지님\n카페 봄\n12,000원 일시불\n09/29 12:34",
                "카페 봄", "KRW", 12000L);
        }
    }

    @Test
    public void accountOwnerAndCardholderMetadataAreNotMerchants() {
        for (String owner : new String[] {"예금주 김민지", "계좌주 김민지", "카드명의자 김민지", "명의자 김민지"}) {
            String body = owner + "\n12,000원 결제 승인";
            JSONObject result = parse("하나카드", "카드 결제", body, "", "KRW", true);
            assertNotNull(body, result);
            assertEquals(body, "", result.optString("merchant"));
            assertEquals(body, true, result.optBoolean("requiresMerchant"));
            assertEquals(body, "review", result.optString("confidence"));
        }
    }

    @Test
    public void conflictingMerchantFirstLinesStayInReview() {
        String body = "카페 봄 12,000원 일시불 승인\n서점 가을 12,000원 일시불 승인";
        JSONObject result = parse("KB국민카드", "카드 결제", body, "", "KRW", true);
        assertNotNull(body, result);
        assertEquals(body, "", result.optString("merchant"));
        assertEquals(body, true, result.optBoolean("requiresMerchant"));
        assertEquals(body, "review", result.optString("confidence"));
    }

    @Test
    public void unknownAppNeverAutoPostsDespiteRecognizedMerchant() {
        JSONObject result = parse("새 카드 앱", "카드 결제", "카페 봄 12,000원 일시불 승인", "", "KRW", false);
        assertNotNull(result);
        assertEquals("카페 봄", result.optString("merchant"));
        assertEquals("review", result.optString("confidence"));
    }

    @Test
    public void frenchMerchantNarrativeAllowsColonWithoutExtraSpacing() {
        for (String body : new String[] {
            "Café Exemple: votre paiement de 12,34 € a été accepté.",
            "Café Exemple:paiement de 12,34 € accepté",
        }) {
            assertPurchase("Swile", "Paiement accepté", body, "Café Exemple", "EUR", 1234L);
        }
    }

    @Test
    public void narrativePrefixesAreNotInventedMerchants() {
        for (String body : new String[] {
            "Your - payment of 12,34 € completed",
            "You : payment of 12,34 € completed",
            "Vous : votre paiement de 12,34 € a été accepté.",
            "Votre : paiement de 12,34 € accepté",
            "Nous - paiement de 12,34 € accepté",
        }) {
            assertNeedsMerchantReview(body, parse("Synthetic Card", "Card payment", body, "", "EUR", true));
        }
    }

    @Test
    public void unlabelledTextAfterAmountDoesNotJoinTwoPossibleMerchants() {
        for (String body : new String[] {
            "카페 봄 12,000원 서점 가을",
            "카페 봄 12,000원 / 서점 가을",
        }) {
            assertNeedsMerchantReview(body, parse("KB국민카드", "카드 결제", body, "", "KRW", true));
        }
        assertNeedsMerchantReview("French second merchant",
            parse("Swile", "Paiement accepté", "Café Exemple 12,34 € Green Cafe", "", "EUR", true));
    }

    @Test
    public void ownerMetadataInMerchantPositionIsStillRejected() {
        for (String body : new String[] {
            "예금주 김민지 12,000원 일시불 승인",
            "카드명의자 김민지 12,000원 승인",
            "계좌주 김민지\n12,000원 결제 승인",
        }) {
            assertNeedsMerchantReview(body, parse("하나카드", "카드 결제", body, "", "KRW", true));
        }
    }

    @Test
    public void recognizedFrenchMerchantFromUnknownSourceRemainsReviewOnly() {
        JSONObject result = parse("Unregistered Payment App", "Paiement accepté",
            "Café Exemple : votre paiement de 12,34 € a été accepté.", "", "EUR", false);
        assertNotNull(result);
        assertEquals("Café Exemple", result.optString("merchant"));
        assertEquals(false, result.optBoolean("requiresMerchant"));
        assertEquals("review", result.optString("confidence"));
    }

    private static void assertNeedsMerchantReview(String message, JSONObject result) {
        assertNotNull(message, result);
        assertEquals(message, "", result.optString("merchant"));
        assertEquals(message, true, result.optBoolean("requiresMerchant"));
        assertEquals(message, "review", result.optString("confidence"));
    }

    private static String[] koreanCardSources() {
        return new String[] {"하나카드", "KB국민카드", "삼성카드", "현대카드", "NH농협카드", "신한카드"};
    }

    private static void assertPurchase(String source, String title, String body, String merchant, String currency, long amount) {
        assertPurchaseResult(source + ": " + body, parse(source, title, body, "", currency, true), merchant, currency, amount);
    }

    private static void assertPurchaseResult(String message, JSONObject result, String merchant, String currency, long amount) {
        assertNotNull(message, result);
        assertEquals(message, merchant, result.optString("merchant"));
        assertEquals(message, false, result.optBoolean("requiresMerchant"));
        assertEquals(message, amount, result.optLong("minorUnits"));
        assertEquals(message, currency, result.optString("currency"));
        assertEquals(message, "purchase", result.optString("eventType"));
        assertEquals(message, "high", result.optString("confidence"));
    }

    private static JSONObject parse(String source, String title, String body, String expanded, String currency, boolean trusted) {
        return PaymentNotificationParser.parse("com.synthetic.card", source, title, body, expanded, "",
            POSTED_AT, "synthetic-merchant-first", trusted, false, currency);
    }
}
