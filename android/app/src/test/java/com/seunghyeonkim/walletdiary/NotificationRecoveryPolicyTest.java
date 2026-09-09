package com.seunghyeonkim.walletdiary;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/** The retry policy must not bypass either Android access or the user's capture scope. */
public class NotificationRecoveryPolicyTest {

    @Test
    public void onlyGrantedConsentedDisconnectedStateMayRecover() {
        for (boolean access : new boolean[] {false, true}) {
            for (boolean capture : new boolean[] {false, true}) {
                for (boolean connected : new boolean[] {false, true}) {
                    assertEquals(access && capture && !connected,
                        NotificationRecoveryPolicy.shouldRecover(access, capture, connected));
                }
            }
        }
    }

    @Test
    public void accessRevocationOrCaptureOptOutStopsTheNextRetry() {
        assertTrue(NotificationRecoveryPolicy.shouldRecover(true, true, false));
        assertFalse(NotificationRecoveryPolicy.shouldRecover(false, true, false));
        assertFalse(NotificationRecoveryPolicy.shouldRecover(true, false, false));
    }

    @Test
    public void reconnectStopsRecoveryWithoutFurtherRequests() {
        assertFalse(NotificationRecoveryPolicy.shouldRecover(true, true, true));
    }

    @Test
    public void backoffHasExactlyFourAttemptsAndTerminates() {
        assertEquals(0L, NotificationRecoveryPolicy.delayForAttempt(0));
        assertEquals(1_000L, NotificationRecoveryPolicy.delayForAttempt(1));
        assertEquals(5_000L, NotificationRecoveryPolicy.delayForAttempt(2));
        assertEquals(15_000L, NotificationRecoveryPolicy.delayForAttempt(3));
        for (int attempt = 4; attempt < 100; attempt++) {
            assertEquals(-1L, NotificationRecoveryPolicy.delayForAttempt(attempt));
        }
    }

    @Test
    public void invalidAttemptIndexesNeverWrapAroundToRetry() {
        assertEquals(-1L, NotificationRecoveryPolicy.delayForAttempt(-1));
        assertEquals(-1L, NotificationRecoveryPolicy.delayForAttempt(Integer.MIN_VALUE));
        assertEquals(-1L, NotificationRecoveryPolicy.delayForAttempt(Integer.MAX_VALUE));
    }

    @Test
    public void emptySourcesAndDisabledDiscoveryCannotRecover() throws Exception {
        assertFalse(CardAutomationStore.hasCaptureScope(new JSONObject()));
        JSONObject config = new JSONObject().put("sources", new JSONArray())
            .put("ledgers", new JSONArray().put(new JSONObject().put("automationAllApps", true)))
            .put("detectAllApps", false);
        assertFalse(CardAutomationStore.hasCaptureScope(config));
        config.put("sources", new JSONArray().put(JSONObject.NULL).put(new JSONObject().put("packageName", "")));
        assertFalse(CardAutomationStore.hasCaptureScope(config));
    }

    @Test
    public void discoveryRecoveryRequiresAConsentingLedger() throws Exception {
        JSONObject config = new JSONObject().put("detectAllApps", true);
        assertFalse(CardAutomationStore.hasCaptureScope(config));
        config.put("ledgers", new JSONArray().put(new JSONObject().put("automationAllApps", false)));
        assertFalse(CardAutomationStore.hasCaptureScope(config));
        config.put("ledgers", new JSONArray().put(new JSONObject().put("automationAllApps", true)));
        assertTrue(CardAutomationStore.hasCaptureScope(config));
        config.put("ledgers", new JSONArray());
        assertFalse(CardAutomationStore.hasCaptureScope(config));
    }

    @Test
    public void registeredSourceMayRecoverWithoutGlobalDiscovery() throws Exception {
        JSONObject config = new JSONObject().put("detectAllApps", false)
            .put("sources", new JSONArray().put(new JSONObject().put("packageName", "bank.example")));
        assertTrue(CardAutomationStore.hasCaptureScope(config));
        config.put("sources", new JSONArray());
        assertFalse(CardAutomationStore.hasCaptureScope(config));
    }
}
