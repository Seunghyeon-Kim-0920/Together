package com.seunghyeonkim.walletdiary;

import static org.junit.Assert.*;
import org.json.JSONObject;
import org.junit.Test;

/** Synthetic fixtures only. An ignored alert must not even create a review draft. */
public class PromotionalNotificationRegressionTest {
    private static JSONObject parse(String title, String body, boolean trusted, boolean manual) {
        return PaymentNotificationParser.parse("com.example.bank", "Example Bank", title, body, "", "",
            1793617200000L, "synthetic-promotion", trusted, manual, "KRW");
    }

    private static void rejected(String title, String body) {
        for (boolean trusted : new boolean[] {false, true}) {
            for (boolean manual : new boolean[] {false, true}) {
                assertNull(title + " / " + body, parse(title, body, trusted, manual));
            }
        }
    }

    @Test public void explicitAdsCannotBypassFiltersWithPaymentTransferOrRefundWords() {
        rejected("(광고) 카드 혜택", "예시카페 결제 10,000원");
        rejected("카드 결제", "[Web발신]\n[광고] 승인 10,000원 예시카페\n무료수신거부 080-000-0000");
        rejected("(광고) 송금 완료 이벤트", "받는 분 예시가게 10,000원");
        rejected("[AD] Refund", "EUR 10.00 at Example Shop");
        rejected("[Publicité] Paiement", "10,00 EUR chez Exemple");
        rejected("[Werbung] Zahlung", "10,00 EUR bei Beispiel");
        rejected("[Publicidad] Pago", "10,00 EUR en Ejemplo");
        rejected("[広告] カード利用", "1,000 JPY 店舗: 例店");
        rejected("【广告】交易成功", "100 CNY 商户: 示例店");
        rejected("【廣告】付款", "100 TWD 商戶: 示例店");
    }

    @Test public void loanEligibilityAndCreditLimitAreNotSpending() {
        rejected("대출 승인 안내", "한도 30,000,000원 지금 신청하세요");
        rejected("대출 가능", "5,000,000원 상담 신청");
        rejected("사전 승인 완료", "대출 한도 10,000,000원");
        rejected("Loan approved", "USD 5000 available. Apply now");
        rejected("Your loan has been approved", "EUR 5000");
        rejected("Your loan was approved", "EUR 5000");
        rejected("You are pre-approved", "Personal loan EUR 5000");
        rejected("Crédit préapprouvé", "5 000 EUR disponibles");
        rejected("Kredit genehmigt", "5.000 EUR verfügbar");
        rejected("Préstamo aprobado", "5.000 EUR disponibles");
        rejected("Credit limit increased", "Your credit limit is USD 5000");
        rejected("이용한도 상향 완료", "카드 이용한도 5,000,000원");
    }

    @Test public void pointsCouponsAndShoppingBenefitsAreNotTransactions() {
        rejected("포인트 지급 완료", "결제 포인트 1,400원 지급");
        rejected("포인트 소멸 안내", "사용 가능한 포인트 5,000원");
        rejected("쿠폰 발급", "10,000원 결제 쿠폰이 도착했어요");
        rejected("상품권 증정", "50,000원 구매 혜택");
        rejected("Points credited", "Payment reward worth EUR 10.00");
        rejected("Reward points", "-EUR 10.00");
        rejected("Points de fidélité", "Paiement 10,00 EUR");
        rejected("Treuepunkte gutgeschrieben", "Zahlung 10,00 EUR");
        rejected("Puntos de recompensa", "Pago 10,00 EUR");
        rejected("ポイント付与", "カード利用 1,000 JPY");
        rejected("积分到账", "消费 100 CNY");
        rejected("Shopping voucher", "USD 10.00");
        rejected("보너스 지급 완료", "결제 보너스 1,000원");
        rejected("리워드 적립", "카드 결제 혜택 1,000원");
        rejected("결제 할인 10,000원", "지금 확인하세요");
        rejected("Card payment", "Bonus credited USD 10.00");
        rejected("Redeem EUR 10.00", "Card payment rewards");
    }

    @Test public void conditionalSpendOffersDoNotCountAsExecutedPurchases() {
        rejected("카드 결제 혜택", "10,000원 결제하면 캐시 지급");
        rejected("이번 주 특별 혜택", "10,000원 이상 이용 시 증정");
        rejected("Cashback credited", "EUR 10.00\nSpend EUR 100 to earn a reward");
        rejected("Card payment", "Spend USD 50 and get bonus points");
        rejected("Card payment", "Earn USD 10 cashback on your next purchase");
        rejected("Paiement", "Payez 10 EUR pour obtenir un cadeau");
        rejected("Kartenzahlung", "Jetzt 10 EUR sparen");
        rejected("Pago", "Gana 10 EUR en tu próxima compra");
        rejected("Pagamento", "Ganhe 10 EUR na próxima compra");
        rejected("Acquisto", "Ricevi un buono da 10 EUR");
        rejected("カード利用", "1,000 JPY ご利用でポイントプレゼント");
        rejected("消费", "消费满 100 CNY 返现");
        rejected("Card payment", "EUR 10.00 coupon at Example Shop");
        rejected("Card payment", "EUR 10.00 discount at Example Shop");
        rejected("Card payment", "EUR 10.00 at Example Shop\n20% discount this weekend");
        rejected("Card payment", "Pay EUR 10.00 at Example Shop and save today");
        for (String condition : new String[] {"사용하고 혜택 받으세요", "결제하고 선물 받으세요", "결제 시마다 증정", "결제만 하면 선물 증정"})
            rejected("카드 결제", "사용처 예시가게\n10,000원 " + condition);
    }

    @Test public void billsStatementsAndInvestmentQuotesAreNotNewPurchases() {
        rejected("카드 이용대금 명세서", "총 결제 금액 100,000원");
        rejected("이번 달 결제 예정 금액", "100,000원");
        rejected("Monthly statement", "Card payment total USD 500.00");
        rejected("Relevé mensuel", "Paiement 500 EUR");
        rejected("Price alert", "Example share USD 50.00");
        rejected("결제 요청", "예시상점 10,000원 결제를 승인해 주세요");
        rejected("입금 완료", "10,000원 받았어요");
    }

    @Test public void unmarkedPromotionsAndOptoutMessagesDoNotMasqueradeAsReceipts() {
        rejected("카드 결제 이벤트", "예시가게 10,000원");
        rejected("Payment promotion", "USD 10.00 at Example Shop");
        rejected("Refund offer", "EUR 10.00 at Example Shop");
        rejected("Offre spéciale", "Paiement 10 EUR chez Exemple");
        rejected("Offerta speciale", "Pagamento 10 EUR");
        rejected("카드 결제", "예시가게 10,000원\n무료수신거부 080-000-0000");
        rejected("Payment", "USD 10.00 at Example Shop\nReply STOP to unsubscribe");
        rejected("Card payment", "EUR 10.00 at Example Shop\n(광고) 혜택\nTap to verify");
        rejected("Card payment", "EUR 10.00 at Example Shop\n(광고) 혜택\nPayment failed");
        rejected("카드 승인", "5,000,000원\n대출 한도 안내");
        rejected("Card payment", "EUR 10.00\n(광고) 결제 이벤트\nReply STOP to unsubscribe");
        rejected("Card payment", "EUR 10.00 at Example Shop\nSpecial offer: pay with our card");
        rejected("Card payment", "EUR 10.00 at Example Shop\n[AD] Card payment EUR 10.00 at Example Shop");
    }

    @Test public void eachNotificationTextFieldIsCheckedBeforeAnyCandidateIsCreated() {
        String ad = "[광고] 예시가게 결제 10,000원";
        for (int field = 0; field < 4; field++) {
            String[] fields = {"", "", "", ""};
            fields[field] = ad;
            assertNull(PaymentNotificationParser.parse("com.example.bank", "Example", fields[0], fields[1],
                fields[2], fields[3], 1793617200000L, "fields", true, false, "KRW"));
        }
        // An expanded ad may contain the collapsed text verbatim.
        assertNull(PaymentNotificationParser.parse("com.example.bank", "Example", "카드 결제",
            "예시상점 10,000원", "[광고] 예시상점 10,000원 결제 이벤트", "", 1793617200000L,
            "expanded", true, false, "KRW"));
        assertNull(PaymentNotificationParser.parse("com.example.bank", "Example", "카드 승인",
            "예시카드 승인 10,000원 일시불 11/02 12:30 예시가게",
            "(광고) 카드 승인 이벤트 10,000원", "", 1793617200000L,
            "expanded-ad-complete-preview", true, false, "KRW"));
    }

    @Test public void rawExpandedAdLabelIsCheckedBeforeAndroidTextLinesArePrepended() {
        assertTrue(PaymentNotificationParser.hasLeadingAdvertisingLabel("[Web발신]\n(광고) 결제 이벤트"));
        assertTrue(PaymentNotificationParser.hasLeadingAdvertisingLabel("  [AD] Card payment at Example Shop"));
        assertFalse(PaymentNotificationParser.hasLeadingAdvertisingLabel("결제 완료\n(광고) 별도 안내"));
        assertFalse(PaymentNotificationParser.hasLeadingAdvertisingLabel("카드 결제 완료"));
        assertFalse(PaymentNotificationParser.hasLeadingAdvertisingLabel(null));
    }

    @Test public void smsReceiptShapeIsNotPermissionToRecordAnAdvert() {
        String body = "[Web발신]\n(광고) 예시카드 승인 10,000원\n결제 시 혜택 지급";
        String source = SmsPaymentPolicy.sourceId("com.samsung.android.messaging", "예시카드");
        assertNull(PaymentNotificationParser.parse(source, "예시카드", "", body, "", "",
            1793617200000L, "sms-ad", true, false, "KRW"));
    }

    @Test public void actualPurchasesAndOutgoingMovementsStillWork() {
        String[][] fixtures = {
            {"Card payment", "EUR 12.34 at Example Café", "purchase"},
            {"Transfer completed", "EUR 12.34 sent to Alice", "outgoing_transfer"},
            {"Direct debit completed", "EUR 12.34 creditor Example Telecom", "direct_debit"},
            {"Standing order executed", "EUR 12.34 to Landlord", "standing_order"},
            {"Cash withdrawal completed", "EUR 50.00\nATM: Example Branch", "cash_withdrawal"},
            {"Card payment refunded", "EUR 12.34 at Example Café", "reversal"},
            {"자동이체 출금 완료", "납부처 대출상환 50,000원", "direct_debit"}
        };
        for (String[] fixture : fixtures) {
            JSONObject result = parse(fixture[0], fixture[1], true, false);
            assertNotNull(fixture[0], result);
            assertEquals(fixture[0], fixture[2], result.optString("eventType"));
        }
    }

    @Test public void realMerchantNamesAreNotKeywordBlacklisted() {
        for (String merchant : new String[] {"Discount Pharmacy", "Point Café", "Sale Market", "Loan Café", "Offer Cafe", "Coupon Cafe", "쿠폰카페", "포인트문구"}) {
            JSONObject result = parse("Card payment", "EUR 12.34 at " + merchant, true, false);
            assertNotNull(merchant, result);
            assertEquals(merchant, result.optString("merchant"));
            assertFalse(merchant, PaymentNotificationParser.hasLeakedPromotion(merchant));
        }
    }

    @Test public void separablePromotionalFooterCannotChangeActualReceiptAmount() {
        String receipt = "[Web발신]\n예시카드 승인 김*명\n12,000원 일시불\n11/02 12:30 예시식당";
        JSONObject original = parse("", receipt, true, false);
        assertNotNull(original);
        for (String footer : new String[] {"(광고) 대출 한도 5,000,000원", "포인트 적립 예정 500원", "결제 시 쿠폰 지급 3,000원"}) {
            JSONObject result = parse("", receipt + "\n" + footer, true, false);
            assertNotNull(footer, result);
            assertEquals(12000L, result.optLong("minorUnits"));
            assertEquals("예시식당", result.optString("merchant"));
            assertFalse(result.has("cashbackMinorUnits"));
        }
        assertNull(parse("(광고)", receipt, true, false));
        assertNull(parse("카드 결제", "(광고) " + receipt, true, false));
    }

    @Test public void genuineGrantedCashbackStillOffsetsButPromotionalRewardsDoNot() {
        JSONObject result = parse("캐시 지급", "1,400원", true, false);
        assertNotNull(result);
        assertEquals("cashback", result.optString("eventType"));
        result = parse("결제 완료", "사용처 예시식당\n14,000원\n캐시 지급 1,400원", true, false);
        assertNotNull(result);
        assertEquals(14000L, result.optLong("minorUnits"));
        assertEquals(1400L, result.optLong("cashbackMinorUnits"));
        rejected("(광고) 캐시 지급", "1,400원");
        rejected("캐시 지급", "1,400원\n이벤트 참여하면 지급");
    }
}
