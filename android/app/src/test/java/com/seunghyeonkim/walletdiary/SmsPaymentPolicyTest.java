package com.seunghyeonkim.walletdiary;

import static org.junit.Assert.*;
import org.junit.Test;
import org.json.JSONArray;
import org.json.JSONObject;

public class SmsPaymentPolicyTest {
    private static final String APP = "com.google.android.apps.messaging";

    @Test public void senderIdentityIsStableScopedAndRejectsAggregateTitles() {
        String id = SmsPaymentPolicy.sourceId(APP, "1588-9999");
        assertTrue(SmsPaymentPolicy.isSenderSource(id));
        assertEquals(id, SmsPaymentPolicy.sourceId(APP, " 1588-9999 "));
        assertNotEquals(id, SmsPaymentPolicy.sourceId(APP, "1588-1111"));
        assertNotEquals(id, SmsPaymentPolicy.sourceId("com.samsung.android.messaging", "1588-9999"));
        for (String value : new String[] {"", "Messages", "새 메시지", "3 new messages", "sender\nother"})
            assertEquals(value, "", SmsPaymentPolicy.sourceId(APP, value));
        assertFalse(id.contains("1588"));
    }

    @Test public void ordinaryMessagesAmountsAndPendingRequestsAreNotReceipts() {
        for (String value : new String[] {
            "점심 12,000원 보내줘", "밥값 3만원 보냈어", "You owe me EUR 12.34", "Dinner costs $30",
            "Please approve your EUR 12.34 payment", "Votre paiement de 12,34 € est à valider",
            "Verification code 123456. Payment EUR 12.34", "€12.34 at Example Cafe", "잔액 10,000원",
        }) assertFalse(value, SmsPaymentPolicy.hasFinancialReceiptEvidence(value));
    }

    @Test public void financialCompletionEvidenceCoversMultipleLanguages() {
        for (String value : new String[] {
            "[KB국민카드] 승인 12,000원 예시식당", "하나은행 계좌이체가 완료되었습니다. 12,000원 홍길동",
            "[예시카드]\n승인 12,000원\n예시식당", "Card payment\nEUR 12.34\nApproved\nExample Cafe",
            "Your card payment of EUR 12.34 at Example Cafe was approved",
            "Your account was debited USD 12.34", "You sent EUR 12.34 to Alex Example",
            "Paiement de 12,34 EUR chez Exemple Cafe effectué", "Virement de 12,34 EUR effectué",
            "Zahlung 12,34 EUR erfolgreich", "Pago de 12,34 EUR realizado", "Pagamento 12,34 EUR effettuato",
            "カード決済 1,200円 完了", "支付12.34元成功", "카드 결제 취소 12,000원 예시식당",
        }) assertTrue(value, SmsPaymentPolicy.hasFinancialReceiptEvidence(value));
    }

    @Test public void senderIsNotMerchantAndTrustIsPerSender() throws Exception {
        String source = SmsPaymentPolicy.sourceId(APP, "Example Bank");
        String body = "[승인] EUR 12.34\nEXAMPLE CAFE\n10/23 14:00";
        assertTrue(SmsPaymentPolicy.hasFinancialReceiptEvidence(body));
        JSONObject unknown = PaymentNotificationParser.parse(source, "SMS · Example Bank", "", body, "", "", 1792756800000L, "sms1", false, false, "EUR");
        assertNotNull(unknown);
        assertEquals("EXAMPLE CAFE", unknown.getString("merchant"));
        assertEquals("review", unknown.getString("confidence"));
        JSONObject trusted = PaymentNotificationParser.parse(source, "SMS · Example Bank", "", body, "", "", 1792756800000L, "sms1", true, false, "EUR");
        assertNotNull(trusted);
        assertEquals("high", trusted.getString("confidence"));
        assertEquals(unknown.getString("id"), trusted.getString("id"));
        assertFalse(trusted.optBoolean("manualOnly"));
    }

    @Test public void financialEvidenceNeverBypassesRequestOrIncomingGuard() {
        String source = SmsPaymentPolicy.sourceId(APP, "Example Bank");
        for (String body : new String[] {
            "Your card payment was approved? Tap to verify EUR 12.34 at Example Cafe",
            "Your account was debited? Verify a payment of EUR 12.34",
            "You received EUR 12.34 from Alex Example",
        }) assertNull(body, PaymentNotificationParser.parse(source, "SMS · Example Bank", "", body, "", "", 1792756800000L, "sms-request", true, false, "EUR"));
    }

    @Test public void optOutPurgesSmsCandidatesDespiteBroadDiscoveryAndTrust() throws Exception {
        String senderSource = SmsPaymentPolicy.sourceId(APP, "Example Bank");
        JSONObject source = new JSONObject().put("packageName", senderSource);
        JSONArray events = new JSONArray().put(new JSONObject().put("packageName", senderSource));
        JSONObject broadOnly = new JSONObject().put("detectAllApps", true).put("sources", new JSONArray().put(source));
        assertFalse(CardAutomationStore.smsEnabled(broadOnly));
        assertEquals(0, CardAutomationStore.retainAllowedEvents(events, broadOnly, "wallet.app").length());
        JSONObject enabled = new JSONObject(broadOnly.toString()).put("detectSmsNotifications", true)
            .put("ledgers", new JSONArray().put(new JSONObject().put("ledgerId", "sms-ledger").put("automationSmsNotifications", true)));
        assertTrue(CardAutomationStore.smsEnabled(enabled));
        assertTrue(CardAutomationStore.hasCaptureScope(enabled));
        assertEquals(1, CardAutomationStore.retainAllowedEvents(events, enabled, "wallet.app").length());
        assertTrue(CardAutomationStore.captureScopeChanged(broadOnly, enabled));
        JSONObject deleted = new JSONObject(enabled.toString()).put("ledgers", new JSONArray());
        assertFalse(CardAutomationStore.smsEnabled(deleted));
        assertEquals(0, CardAutomationStore.retainAllowedEvents(events, deleted, "wallet.app").length());
    }
}
