package com.seunghyeonkim.walletdiary;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.content.pm.ApplicationInfo;
import org.junit.Test;
import org.json.JSONObject;

public class PaymentSourcePolicyTest {

    @Test
    public void messagingMailBrowserAndSocialAggregatorsRequireManualReview() {
        assertTrue(PaymentSourcePolicy.isKnownAggregatorPackage("com.google.android.apps.messaging"));
        assertTrue(PaymentSourcePolicy.isKnownAggregatorPackage("com.sec.android.app.sbrowser"));
        assertTrue(PaymentSourcePolicy.isKnownAggregatorPackage("com.google.android.gm"));
        assertTrue(PaymentSourcePolicy.isKnownAggregatorPackage("com.whatsapp"));
        assertTrue(PaymentSourcePolicy.isKnownAggregatorPackage("com.microsoft.teams"));
        assertTrue(PaymentSourcePolicy.isKnownAggregatorPackage("com.fsck.k9"));
        assertTrue(PaymentSourcePolicy.isKnownAggregatorPackage("org.mozilla.focus"));
        assertTrue(PaymentSourcePolicy.isKnownAggregatorPackage("org.example.chat"));
        assertTrue(PaymentSourcePolicy.isKnownAggregatorPackage("org.example.secure.email"));
        assertFalse(PaymentSourcePolicy.isKnownAggregatorPackage("jp.example.bank"));
        assertFalse(PaymentSourcePolicy.isKnownAggregatorPackage("com.example.mobilewallet"));
        assertTrue(PaymentSourcePolicy.isRelayedNotificationCategory("msg"));
        assertTrue(PaymentSourcePolicy.isRelayedNotificationCategory("email"));
        assertFalse(PaymentSourcePolicy.isRelayedNotificationCategory("status"));
        assertTrue(PaymentSourcePolicy.isHardBlockedApplicationCategory(ApplicationInfo.CATEGORY_SOCIAL));
        assertFalse(PaymentSourcePolicy.isHardBlockedApplicationCategory(ApplicationInfo.CATEGORY_PRODUCTIVITY));
    }

    @Test
    public void aTrustedDirectBankMayUseMessageCategoryButRelaysStayManual() {
        for (String packageName : new String[] {"hr.lunc.client", "kr.example.bank", "com.world.card"}) {
            assertFalse(PaymentSourcePolicy.requiresManualReview(packageName, "msg", false));
            assertFalse(PaymentSourcePolicy.requiresManualReview(packageName, "email", false));
            assertFalse(PaymentSourcePolicy.requiresManualReview(packageName, "msg", true));
            assertFalse(PaymentSourcePolicy.requiresManualReview(packageName, "status", false));
        }
        for (String packageName : new String[] {"com.whatsapp", "com.google.android.gm", "com.samsung.android.messaging", "com.sec.android.app.sbrowser"}) {
            assertTrue(PaymentSourcePolicy.requiresManualReview(packageName, "msg", true));
            assertTrue(PaymentSourcePolicy.requiresManualReview(packageName, "status", true));
        }
    }

    @Test
    public void aNewDirectMessageCategoryAppCanAdvanceFromReviewToTrustedSource() {
        String packageName = "hr.lunc.client";
        JSONObject discovered = PaymentNotificationParser.parse(packageName, "Swile", "Paiement accepté", "1,24 € chez Lidl", "", "", 1L, "swile-msg", false, PaymentSourcePolicy.requiresManualReview(packageName, "msg", false), "EUR");
        assertFalse(discovered.optBoolean("manualOnly"));
        assertTrue("review".equals(discovered.optString("confidence")));
        JSONObject trusted = PaymentNotificationParser.parse(packageName, "Swile", "Paiement accepté", "1,24 € chez Lidl", "", "", 1L, "swile-msg", true, PaymentSourcePolicy.requiresManualReview(packageName, "msg", true), "EUR");
        assertFalse(trusted.optBoolean("manualOnly"));
        assertTrue("high".equals(trusted.optString("confidence")));
    }
}
