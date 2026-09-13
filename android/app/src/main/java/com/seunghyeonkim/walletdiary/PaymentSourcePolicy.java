package com.seunghyeonkim.walletdiary;

import android.content.pm.ApplicationInfo;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

final class PaymentSourcePolicy {

    private static final Set<String> KNOWN_AGGREGATORS = new HashSet<>(Arrays.asList(
        "com.google.android.gm",
        "com.google.android.apps.messaging",
        "com.samsung.android.messaging",
        "com.android.mms",
        "com.microsoft.office.outlook",
        "com.microsoft.teams",
        "com.fsck.k9",
        "com.android.chrome",
        "com.chrome.beta",
        "org.mozilla.firefox",
        "org.mozilla.focus",
        "com.microsoft.emmx",
        "com.sec.android.app.sbrowser",
        "com.whatsapp",
        "org.telegram.messenger",
        "com.kakao.talk",
        "com.instagram.android",
        "com.facebook.orca",
        "jp.naver.line.android",
        "com.tencent.mm"
    ));

    /**
     * Bank, card and wallet apps whose package name carries no payment word.
     * The keyword rule below covers the rest, so this list only fills gaps.
     */
    private static final Set<String> KNOWN_PAYMENT_APPS = new HashSet<>(Arrays.asList(
        // Wallets and global providers
        "com.google.android.apps.walletnfcrel", "com.google.android.apps.nbu.paisa.user",
        "com.samsung.android.spay", "com.samsung.android.spaylite", "com.lge.lgpay",
        "com.revolut.revolut", "de.number26.android", "com.transferwise.android",
        "hr.lunc.client", "com.squareup.cash", "co.uk.getmondo", "com.curve.app",
        // France
        "com.boursorama.android.clients", "net.bnpparibas.mescomptes", "com.sg.appli",
        "fr.lcl.android.customerarea", "com.caisse.epargne.android", "fr.creditmutuel.android",
        "com.arkea.android.application.cmb", "fr.hellobank.android", "com.fortuneo.android",
        "com.qonto.app", "fr.lydia.android", "com.shine.android",
        // Korea
        "com.kebhana.hanapush", "nh.smart", "nh.smart.banking", "viva.republica.toss",
        "com.ibk.neobanking", "com.epost.psf.sdsi", "com.kftc.kjbank",
        "kr.co.citibank.citimobile", "com.sc.danb.scbankapp"
    ));

    /**
     * Package-name fragments used by bank, card and payment apps worldwide.
     * Checked only after the relay list above has already rejected a package.
     */
    private static final String[] PAYMENT_KEYWORDS = {
        "bank", "banc", "banq", "bkng", "card", "carte", "pay", "wallet",
        "credit", "debit", "finance", "money", "cash", "visa", "mastercard", "amex"
    };

    private PaymentSourcePolicy() {}

    /**
     * True for a bank, card or payment app. Automatic discovery reads only
     * these: an alert from any other app is the user's mail, chat, shopping or
     * delivery notification, not a payment their own card or account made.
     */
    static boolean isPaymentSourcePackage(String packageName) {
        if (packageName == null) return false;
        String normalized = packageName.toLowerCase(Locale.ROOT);
        if (KNOWN_PAYMENT_APPS.contains(normalized)) return true;
        // A mail or chat app must never qualify through a payment word.
        if (isKnownAggregatorPackage(normalized)) return false;
        for (String keyword : PAYMENT_KEYWORDS) if (normalized.contains(keyword)) return true;
        return false;
    }

    static boolean isKnownAggregatorPackage(String packageName) {
        if (packageName == null) return true;
        String normalized = packageName.toLowerCase(Locale.ROOT);
        if (KNOWN_AGGREGATORS.contains(normalized)) return true;
        return normalized.contains(".messaging")
            || normalized.contains(".message")
            || normalized.contains(".messenger")
            || normalized.contains(".chat")
            || normalized.contains(".conversation")
            || normalized.contains(".communication")
            || normalized.contains(".mms")
            || normalized.contains(".sms")
            || normalized.contains(".email")
            || normalized.contains(".mail")
            || normalized.contains(".browser");
    }

    static boolean isRelayedNotificationCategory(String category) {
        if (category == null) return false;
        return category.equals("msg")
            || category.equals("email")
            || category.equals("social")
            || category.equals("recommendation")
            || category.equals("promo");
    }

    static boolean requiresManualReview(String packageName, String category, boolean explicitlyConfigured) {
        // A bank may use generic msg/email categories for its own payment
        // alerts. Unknown packages already receive review confidence, so these
        // category names must not prevent the user from attesting a direct app.
        // Independently identified relay packages remain permanently manual.
        return isKnownAggregatorPackage(packageName) || "social".equals(category)
            || "recommendation".equals(category) || "promo".equals(category);
    }

    /**
     * Chat, mail, browser and social apps post ordinary messages that can look
     * like a payment, so automatic discovery must never read them. Such an app
     * is used only after the user registered it as a payment source on purpose.
     */
    static boolean isExcludedFromDiscovery(String packageName, boolean relayIdentity, boolean explicitlyConfigured) {
        if (explicitlyConfigured) return false;
        return relayIdentity || isKnownAggregatorPackage(packageName);
    }

    static boolean isHardBlockedApplicationCategory(int category) {
        // PRODUCTIVITY is deliberately not blocked: some official bank/card
        // apps use it, and unknown direct apps already require user attestation.
        return category == ApplicationInfo.CATEGORY_SOCIAL;
    }
}
