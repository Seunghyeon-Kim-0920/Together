package com.seunghyeonkim.walletdiary;

import static org.junit.Assert.*;
import org.json.JSONObject;
import org.junit.Test;

/** Synthetic notification payloads, not real card/account/customer identifiers. */
public class SamsungSmsNotificationRegressionTest {
    private static final String SMS_APP = "com.samsung.android.messaging";
    private static final String SENDER = "예시카드 승인안내";
    private static final String RECEIPT = "[Web발신]\n[재발송]삼성가족1234 승인 김*명\n2,400원 일시불\n10/26 15:52 예시도시공사\n누적650,344원";

    private static JSONObject parse(String body, boolean trusted) {
        return PaymentNotificationParser.parse(SmsPaymentPolicy.sourceId(SMS_APP, SENDER),
            SmsPaymentPolicy.displayName(SENDER), "", body, "", "", 1793011020000L,
            "synthetic-samsung-sms", trusted, false, "KRW");
    }

    @Test public void oneLineReceiptKeepsMerchantAndIgnoresCumulativeTotal() {
        String body = RECEIPT.replace('\n', ' ');
        assertTrue("A flattened SMS receipt must reach the parser", SmsPaymentPolicy.hasFinancialReceiptEvidence(body));
        JSONObject result = parse(body, true);
        assertNotNull(result);
        assertEquals(2400, result.optLong("minorUnits"));
        assertEquals("예시도시공사", result.optString("merchant"));
        assertEquals("high", result.optString("confidence"));
        assertEquals("purchase", result.optString("eventType"));
    }

    @Test public void multilineReceiptStillRequiresTheSpecificSenderToBeTrusted() {
        assertTrue(SmsPaymentPolicy.hasFinancialReceiptEvidence(RECEIPT));
        JSONObject unknown = parse(RECEIPT, false);
        assertNotNull(unknown);
        assertEquals("review", unknown.optString("confidence"));
        assertEquals("예시도시공사", unknown.optString("merchant"));
        assertEquals("high", parse(RECEIPT, true).optString("confidence"));
    }

    @Test public void expandedNotificationHeadingDoesNotInvalidateTheSmsSender() {
        String collapsed = SENDER;
        String expanded = "알림";
        assertEquals("The old merged-title path discarded the receipt", "",
            SmsPaymentPolicy.sourceId(SMS_APP, NotificationTextContent.title(collapsed, expanded)));
        String sender = NotificationTextContent.smsSender(collapsed, expanded);
        assertEquals(SENDER, sender);
        assertEquals(SmsPaymentPolicy.sourceId(SMS_APP, SENDER), SmsPaymentPolicy.sourceId(SMS_APP, sender));
        assertTrue(SmsPaymentPolicy.hasFinancialReceiptEvidence(RECEIPT));
        assertEquals("예시도시공사", parse(RECEIPT, true).optString("merchant"));
        assertEquals(SENDER, NotificationTextContent.smsSender(null, SENDER));
        assertEquals("", NotificationTextContent.smsSender(null, null));
        // A generic/aggregate collapsed title does not get upgraded to a
        // different sender merely because its expanded heading looks useful.
        for (String generic : new String[] {"Messages", "알림", "새 알림", "Notification", "New notifications"})
            assertEquals("", SmsPaymentPolicy.sourceId(SMS_APP, NotificationTextContent.smsSender(generic, SENDER)));
        assertEquals("", SmsPaymentPolicy.sourceId(SMS_APP, NotificationTextContent.smsSender(null, "알림")));
    }

    @Test public void oneLineAndMultilineReceiptsKeepSameAmountMerchantAndCurrency() {
        String receipt = "[Web발신]\n삼성가족1234 승인 김*명\n43,200원 일시불\n10/26 10:48 예시병원\n누적647,944원";
        for (String body : new String[] {receipt, receipt.replace('\n', ' '), receipt.replace("\n누적647,944원", "").replace('\n', ' ')}) {
            assertTrue(SmsPaymentPolicy.hasFinancialReceiptEvidence(body));
            JSONObject result = parse(body, true);
            assertNotNull(result);
            assertEquals(43200, result.optLong("minorUnits"));
            assertEquals("KRW", result.optString("currency"));
            assertEquals("예시병원", result.optString("merchant"));
            assertEquals("high", result.optString("confidence"));
            assertEquals(PaymentNotificationParser.PARSER_VERSION, result.optInt("parserVersion"));
        }
    }

    @Test public void receiptShapeDoesNotAcceptRequestsFailureIncomeOrTwoPayments() {
        for (String suffix : new String[] {" 결제 승인 요청입니다", " 승인해 주세요", " 결제 실패", " 입금 완료"})
            assertNull(suffix, parse(RECEIPT.replace('\n', ' ') + suffix, true));
        assertNull(parse(RECEIPT + "\n삼성가족1234 승인 김*명\n3,000원 일시불\n10/26 15:55 다른가게", true));
    }
}
