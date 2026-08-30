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
    public void rejectsFailedRefundOtpAndMultipleAmounts() {
        assertNull(parse("hr.lunc.client", "Paiement refusé", "-4,20 €", "failed", 1L));
        assertNull(parse("com.revolut.revolut", "Refund", "€12.34 at Lidl", "refund", 2L));
        assertNull(parse("com.revolut.revolut", "Balance update", "+ €12.34", "credit", 2L));
        assertNull(parse("com.revolut.revolut", "Security code", "OTP 123456 for €1.00", "otp", 3L));
        assertNull(parse("com.revolut.revolut", "Card payment pending", "€12.34 at Lidl", "pending", 3L));
        assertNull(parse("com.revolut.revolut", "Card payment", "€12.34 at Lidl. Balance €40.00", "multi", 4L));
        assertNotNull(parse("com.revolut.revolut", "Shopping Plaza", "€12.34", "merchant-word", 5L));
    }

    @Test
    public void rejectsPaymentWithoutAnExplicitMerchant() {
        assertNull(parse("com.revolut.revolut", "Card payment", "€12.34 completed", "no-merchant", 6L));
    }

    @Test
    public void createsStableButDistinctEventIds() {
        JSONObject first = parse("com.revolut.revolut", "Lidl", "€12.34", "same-key", 10L);
        JSONObject replay = parse("com.revolut.revolut", "Lidl", "€12.34", "same-key", 10L);
        JSONObject next = parse("com.revolut.revolut", "Lidl", "€12.34", "next-key", 11L);
        assertNotNull(first);
        assertNotNull(replay);
        assertNotNull(next);
        assertEquals(first.optString("id"), replay.optString("id"));
        assertNotEquals(first.optString("id"), next.optString("id"));
    }

    private static JSONObject parse(String packageName, String title, String text, String key, long time) {
        return PaymentNotificationParser.parse(packageName, "Source", title, text, "", "", time, key);
    }
}
