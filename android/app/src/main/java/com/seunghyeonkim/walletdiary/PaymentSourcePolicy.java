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

    private PaymentSourcePolicy() {}

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

    static boolean isHardBlockedApplicationCategory(int category) {
        // PRODUCTIVITY is deliberately not blocked: some official bank/card
        // apps use it, and unknown direct apps already require user attestation.
        return category == ApplicationInfo.CATEGORY_SOCIAL;
    }
}
