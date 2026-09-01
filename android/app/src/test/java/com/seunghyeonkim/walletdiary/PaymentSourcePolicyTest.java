package com.seunghyeonkim.walletdiary;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.content.pm.ApplicationInfo;
import org.junit.Test;

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
}
