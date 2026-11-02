package com.seunghyeonkim.walletdiary;

import static org.junit.Assert.*;
import org.json.JSONObject;
import org.junit.Test;

/** Screenshot-shaped synthetic receipts: masked customer/card identifiers. */
public class KoreanSmsRegionalCurrencyTest {
    private static JSONObject parse(String title, String body) {
        return PaymentNotificationParser.parse("example.local.wallet", "예시 지역화폐", title, body,
            "", "", 1793011020000L, "synthetic-receipt", true, false, "KRW");
    }

    @Test public void samsungFamilyCardAndResentSmsKeepShopAndIgnoreCumulativeSpend() {
        String[] bodies = {
            "[Web발신]\n삼성가족1234 승인 김*명\n43,200원 일시불\n10/26 10:48 예시병원\n누적647,944원",
            "[Web발신]\n[재발송]삼성가족1234 승인 김*명\n2,400원 일시불\n10/26 15:52 예시도시공사\n누적 650,344원"
        };
        long[] amounts = {43200, 2400};
        String[] merchants = {"예시병원", "예시도시공사"};
        for (int i = 0; i < bodies.length; i++) {
            assertTrue(bodies[i], SmsPaymentPolicy.hasFinancialReceiptEvidence(bodies[i]));
            JSONObject candidate = parse("", bodies[i]);
            assertNotNull(bodies[i], candidate);
            assertEquals(amounts[i], candidate.optLong("minorUnits"));
            assertEquals(merchants[i], candidate.optString("merchant"));
            assertEquals("high", candidate.optString("confidence"));
            assertEquals("purchase", candidate.optString("eventType"));
        }
    }

    @Test public void samsungReceiptShapeNeverBypassesAuthorizationRequestGuard() {
        assertNull(parse("결제 승인 요청", "삼성가족1234 승인\n2,400원 일시불\n10/26 15:52 예시상점\n승인해 주세요"));
        assertFalse(SmsPaymentPolicy.hasFinancialReceiptEvidence("승인 2,400원 보내주세요"));
    }

    @Test public void storedValueBalanceIsNotTopupAndNegativePurchaseIsRetained() {
        JSONObject candidate = parse("결제 완료", "예시김밥\n-14,000원\n충전 잔액 45,205원");
        assertNotNull(candidate);
        assertEquals("예시김밥", candidate.optString("merchant"));
        assertEquals(14000, candidate.optLong("minorUnits"));
        assertEquals("purchase", candidate.optString("eventType"));
        assertEquals("high", candidate.optString("confidence"));
    }

    @Test public void cashbackCreditNeverBecomesPositiveSpending() {
        for (String title : new String[] {"캐시 지급", "인센티브 지급", "캐시백 적립 완료"}) {
            JSONObject candidate = parse(title, "1,400원");
            assertNotNull(title, candidate);
            assertEquals("cashback", candidate.optString("eventType"));
            assertEquals(1400, candidate.optLong("minorUnits"));
            assertEquals("", candidate.optString("merchant"));
            assertTrue(candidate.optBoolean("requiresMerchant"));
            assertEquals("review", candidate.optString("confidence"));
        }
        JSONObject linked = parse("캐시 지급", "+1,400원\n가맹점: 예시김밥");
        assertNotNull(linked);
        assertEquals("cashback", linked.optString("eventType"));
        assertEquals("예시김밥", linked.optString("merchant"));
        JSONObject balance = parse("캐시 지급", "+1,400원\n충전 잔액 45,205원");
        assertNotNull(balance);
        assertEquals("cashback", balance.optString("eventType"));
        assertEquals(1400, balance.optLong("minorUnits"));
        // Unsupported prose is safer to ignore than to book as consumption.
        assertNull(parse("", "캐시 지급 받았습니다 1,400원"));
        JSONObject international = parse("cashback credited EUR 1.40", "Merchant: Example Cafe");
        assertNotNull(international);
        assertEquals("cashback", international.optString("eventType"));
        assertEquals("EUR", international.optString("currency"));
        assertEquals(140, international.optLong("minorUnits"));
    }

    @Test public void combinedPurchaseRetainsGrossAndExactGrantedCashbackOnly() {
        JSONObject candidate = parse("결제 완료", "예시김밥\n결제 -14,000원\n캐시 지급 1,400원\n충전 잔액 45,205원");
        assertNotNull(candidate);
        assertEquals("purchase", candidate.optString("eventType"));
        assertEquals(14000, candidate.optLong("minorUnits"));
        assertEquals(1400, candidate.optLong("cashbackMinorUnits"));
        assertEquals("예시김밥", candidate.optString("merchant"));
        assertEquals(PaymentNotificationParser.contentToken(candidate), candidate.optString("queueToken"));
        assertFalse(PaymentNotificationParser.hasMultiplePaymentLines(new String[] {"결제 -14,000원", "캐시 지급 1,400원", "충전 잔액 45,205원"}, "KRW"));
        assertTrue(PaymentNotificationParser.hasMultiplePaymentLines(new String[] {"예시가게 결제 -14,000원", "다른가게 결제 -11,000원"}, "KRW"));
    }

    @Test public void discountsTopupsPointsAndFutureRewardsAreNotExpensesOrEarnedCashback() {
        for (String body : new String[] {
            "충전 완료 100,000원\n10% 할인 결제 90,000원", "충전 인센티브 지급 10,000원",
            "캐시 지급 예정 1,400원", "캐시 지급 이벤트 최대 1,400원", "캐시백 적립 1,400포인트",
            "인센티브 지급 취소 1,400원", "캐시백 적립 1,400원\n충전 보너스",
            "cashback credited EUR 1.40\nTop-up reward", "캐시 지급 1,400원\n결제 1,000원"
        }) assertNull(body, parse("", body));
    }
}
