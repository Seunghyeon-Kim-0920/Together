package com.seunghyeonkim.walletdiary;

import static org.junit.Assert.assertEquals;

import org.junit.Test;
import org.json.JSONArray;
import org.json.JSONObject;

public class CardAutomationStoreTest {

    @Test
    public void budgetLevelsMatchTheConfiguredThresholds() {
        assertEquals(0, CardAutomationStore.budgetLevel(79, 100));
        assertEquals(80, CardAutomationStore.budgetLevel(80, 100));
        assertEquals(90, CardAutomationStore.budgetLevel(90, 100));
        assertEquals(100, CardAutomationStore.budgetLevel(100, 100));
        assertEquals(100, CardAutomationStore.budgetLevel(125, 100));
    }

    @Test
    public void budgetLevelComparisonDoesNotOverflow() {
        assertEquals(90, CardAutomationStore.budgetLevel(Long.MAX_VALUE - 1L, Long.MAX_VALUE));
        assertEquals(0, CardAutomationStore.budgetLevel(-1L, 100L));
        assertEquals(0, CardAutomationStore.budgetLevel(100L, 0L));
    }

    @Test
    public void staleAcknowledgementCannotDeleteUpdatedReversal() throws Exception {
        JSONArray current = new JSONArray().put(new JSONObject().put("id", "stable-id").put("queueToken", "reversal-token"));
        JSONArray stalePurchaseAck = new JSONArray().put(new JSONObject().put("id", "stable-id").put("queueToken", "purchase-token"));
        JSONArray remaining = CardAutomationStore.removeAcknowledged(current, stalePurchaseAck);
        assertEquals(1, remaining.length());
        assertEquals("reversal-token", remaining.getJSONObject(0).getString("queueToken"));

        JSONArray exactReversalAck = new JSONArray().put(new JSONObject().put("id", "stable-id").put("queueToken", "reversal-token"));
        assertEquals(0, CardAutomationStore.removeAcknowledged(remaining, exactReversalAck).length());
    }

    @Test
    public void updateDropsCandidatesCreatedByTheOldAmountParser() throws Exception {
        JSONArray stored = new JSONArray()
            .put(new JSONObject().put("id", "legacy-balance"))
            .put(new JSONObject().put("id", "current-payment").put("parserVersion", PaymentNotificationParser.PARSER_VERSION));
        JSONArray current = CardAutomationStore.retainCurrentParserEvents(stored);
        assertEquals(1, current.length());
        assertEquals("current-payment", current.getJSONObject(0).getString("id"));
    }

    @Test
    public void currentAndV3ReviewQueueArePreserved() throws Exception {
        JSONArray stored = new JSONArray().put(new JSONObject().put("id", "v3").put("parserVersion", 3)).put(new JSONObject().put("id", "v4").put("parserVersion", 4)).put(new JSONObject().put("id", "unsafe-old").put("parserVersion", 2));
        assertEquals(2, CardAutomationStore.retainCurrentParserEvents(stored).length());
    }

    @Test
    public void recheckDoesNotResurfaceAcknowledgedEventsButAllowsChangedCancellations() throws Exception {
        JSONObject payment = new JSONObject().put("id", "event").put("queueToken", "payment");
        JSONObject reversal = new JSONObject().put("id", "event").put("queueToken", "reversal");
        JSONArray current = new JSONArray().put(payment);
        JSONArray history = CardAutomationStore.mergeAcknowledgements(new JSONArray(), current, current);
        assertEquals(true, CardAutomationStore.containsAcknowledgement(history, payment));
        assertEquals(false, CardAutomationStore.containsAcknowledgement(history, reversal));
        assertEquals(0, CardAutomationStore.mergeAcknowledgements(new JSONArray(), new JSONArray().put(reversal), current).length());
        assertEquals(1, CardAutomationStore.mergeAcknowledgements(history, current, current).length());
    }

    @Test
    public void acknowledgementReceiptsRetainNoNotificationContentAndNormalizeLegacyNullTokens() throws Exception {
        JSONObject legacy = new JSONObject().put("id", "old-event").put("queueToken", JSONObject.NULL).put("merchant", "Private merchant").put("minorUnits", 124);
        JSONArray current = new JSONArray().put(legacy);
        JSONArray request = new JSONArray().put(new JSONObject().put("id", "old-event").put("queueToken", JSONObject.NULL));
        JSONArray history = CardAutomationStore.mergeAcknowledgements(new JSONArray(), current, request);
        assertEquals(1, history.length());
        assertEquals(2, history.getJSONObject(0).length());
        assertEquals("", history.getJSONObject(0).getString("queueToken"));
        assertEquals(true, CardAutomationStore.containsAcknowledgement(history, legacy));
        assertEquals(0, CardAutomationStore.removeAcknowledged(current, request).length());
    }

    @Test
    public void dismissedV3QueueEventCannotReturnAfterParserOrTrustUpgrade() throws Exception {
        JSONObject event = PaymentNotificationParser.parse("com.unlisted.bank", "Bank", "Card payment", "€12.34 at Lidl", "", "", 907L, "legacy-policy", false, false, "EUR");
        String newToken = event.getString("queueToken");
        event.put("queueToken", "v3-policy-dependent-token").put("parserVersion", 3);
        JSONArray oldQueue = new JSONArray().put(event);
        JSONArray history = CardAutomationStore.mergeAcknowledgements(new JSONArray(), oldQueue, oldQueue);
        JSONObject rechecked = new JSONObject(event.toString()).put("queueToken", newToken).put("confidence", "high").put("parserVersion", 4);
        assertEquals(true, CardAutomationStore.containsAcknowledgement(history, rechecked));
        assertEquals(3, history.getJSONObject(0).length());
        assertEquals(false, history.getJSONObject(0).has("merchant"));
        assertEquals(false, CardAutomationStore.containsAcknowledgement(history, new JSONObject(rechecked.toString()).put("eventType", "reversal").put("queueToken", "reversal")));
        assertEquals(false, CardAutomationStore.containsAcknowledgement(history, new JSONObject(rechecked.toString()).put("minorUnits", 999).put("queueToken", "changed-amount")));
    }
}
