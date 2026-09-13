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
    public void chatMailBrowserAndSocialAppsAreNeverDiscoveredWithoutRegistration() {
        for (String packageName : new String[] {
            "com.kakao.talk", "com.instagram.android", "com.google.android.gm",
            "com.sec.android.app.sbrowser", "com.android.chrome", "com.whatsapp",
            "jp.naver.line.android", "com.facebook.orca", "org.example.secure.email",
        }) {
            assertTrue(packageName, PaymentSourcePolicy.isExcludedFromDiscovery(packageName, false, false));
            assertFalse(packageName, PaymentSourcePolicy.isExcludedFromDiscovery(packageName, false, true));
        }
        // A default SMS app, default browser or self-declared social app is
        // recognized at runtime even when its package name looks like a bank.
        assertTrue(PaymentSourcePolicy.isExcludedFromDiscovery("kr.example.bank", true, false));
        assertFalse(PaymentSourcePolicy.isExcludedFromDiscovery("kr.example.bank", true, true));
        for (String packageName : new String[] {"hr.lunc.client", "kr.example.bank", "com.world.card", "com.example.mobilewallet"}) {
            assertFalse(packageName, PaymentSourcePolicy.isExcludedFromDiscovery(packageName, false, false));
        }
    }

    @Test
    public void onlyBankCardAndPaymentAppsAreReadWithoutRegistration() {
        for (String packageName : new String[] {
            // wallets
            "com.google.android.apps.walletnfcrel", "com.samsung.android.spay", "com.paypal.android.p2pmobile",
            "com.revolut.revolut", "hr.lunc.client", "com.transferwise.android",
            // Korea
            "com.kbstar.kbbank", "com.shinhan.sbanking", "com.wooribank.smart.npib",
            "com.kebhana.hanapush", "nh.smart", "viva.republica.toss", "com.kakaobank.channel",
            "com.kakaopay.app", "com.hyundaicard.appcard", "kr.co.samsungcard.mpocket",
            // France
            "fr.creditagricole.androidapp", "fr.labanquepostale.accountaccess",
            "net.bnpparibas.mescomptes", "com.boursorama.android.clients", "fr.lcl.android.customerarea",
        }) assertTrue(packageName, PaymentSourcePolicy.isPaymentSourcePackage(packageName));

        for (String packageName : new String[] {
            // the apps the user reported
            "com.kakao.talk", "com.instagram.android", "com.google.android.gm",
            "com.sec.android.app.sbrowser", "com.android.chrome",
            // ordinary apps that post amounts but are not a payment source
            "com.coupang.mobile", "com.ubercab.eats", "com.spotify.music",
            "com.netflix.mediaclient", "com.example.somegame", null,
        }) assertFalse(String.valueOf(packageName), PaymentSourcePolicy.isPaymentSourcePackage(packageName));

        // The relay rule wins: a mail or chat app never qualifies through a
        // payment word in its own package name.
        assertFalse(PaymentSourcePolicy.isPaymentSourcePackage("com.example.pay.mail"));
        assertFalse(PaymentSourcePolicy.isPaymentSourcePackage("com.example.card.chat"));
        assertFalse(PaymentSourcePolicy.isPaymentSourcePackage("com.example.bank.messenger"));
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
