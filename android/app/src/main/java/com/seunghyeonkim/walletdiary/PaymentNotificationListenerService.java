package com.seunghyeonkim.walletdiary;

import android.app.Notification;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Telephony;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

public final class PaymentNotificationListenerService extends NotificationListenerService {

    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    @Override
    public void onNotificationPosted(StatusBarNotification statusBarNotification) {
        if (statusBarNotification == null) return;
        String packageName = statusBarNotification.getPackageName();
        // Check consent before reading any notification content. A package is
        // eligible either because the user registered it or explicitly turned
        // on global payment-app discovery.
        if (!CardAutomationStore.isAllowedPackage(this, packageName)) return;
        Notification notification = statusBarNotification.getNotification();
        if (notification == null || (notification.flags & Notification.FLAG_GROUP_SUMMARY) != 0) return;
        final boolean explicitlyConfigured = CardAutomationStore.isConfiguredSourcePackage(this, packageName);
        final String currencyHint = CardAutomationStore.currencyHint(this, packageName);
        final boolean manualOnly = requiresManualReview(packageName, notification);
        final long postedAt = stableEventTime(notification, statusBarNotification.getPostTime());
        final String notificationKey = statusBarNotification.getKey();

        executor.execute(() -> {
            // Consent may have been revoked while this task was waiting.
            if (!CardAutomationStore.isAllowedPackage(getApplicationContext(), packageName)) return;
            Bundle extras = notification.extras;
            if (extras == null) return;
            String title = text(extras.getCharSequence(Notification.EXTRA_TITLE));
            String message = text(extras.getCharSequence(Notification.EXTRA_TEXT));
            String bigText = text(extras.getCharSequence(Notification.EXTRA_BIG_TEXT));
            String subText = text(extras.getCharSequence(Notification.EXTRA_SUB_TEXT));
            JSONObject candidate = PaymentNotificationParser.parse(
                packageName,
                applicationLabel(packageName),
                title,
                message,
                bigText,
                subText,
                postedAt,
                notificationKey,
                explicitlyConfigured,
                manualOnly,
                currencyHint
            );
            // The atomic store-side check closes a final race with opt-out,
            // source removal, or ledger deletion after parsing.
            if (candidate != null) CardAutomationStore.addPendingIfAllowed(getApplicationContext(), packageName, candidate);
        });
    }

    @Override
    public void onDestroy() {
        executor.shutdown();
        super.onDestroy();
    }

    @SuppressWarnings("deprecation")
    private String applicationLabel(String packageName) {
        try {
            return getPackageManager().getApplicationLabel(getPackageManager().getApplicationInfo(packageName, 0)).toString();
        } catch (Exception ignored) {
            return packageName;
        }
    }

    private boolean requiresManualReview(String packageName, Notification notification) {
        try {
            if (packageName.equals(Telephony.Sms.getDefaultSmsPackage(this))) return true;
            Intent browserIntent = new Intent(Intent.ACTION_VIEW, Uri.parse("https://wallet-diary.invalid"));
            browserIntent.addCategory(Intent.CATEGORY_BROWSABLE);
            ResolveInfo defaultBrowser = getPackageManager().resolveActivity(browserIntent, PackageManager.MATCH_DEFAULT_ONLY);
            if (defaultBrowser != null && defaultBrowser.activityInfo != null && packageName.equals(defaultBrowser.activityInfo.packageName)) return true;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ApplicationInfo info = getPackageManager().getApplicationInfo(packageName, 0);
                if (PaymentSourcePolicy.isHardBlockedApplicationCategory(info.category)) return true;
            }
        } catch (Exception ignored) {}
        return PaymentSourcePolicy.isKnownAggregatorPackage(packageName) || PaymentSourcePolicy.isRelayedNotificationCategory(notification.category);
    }

    private static long stableEventTime(Notification notification, long postedAt) {
        long when = notification.when;
        long maximumFutureSkew = 5L * 60L * 1_000L;
        long maximumAge = 366L * 24L * 60L * 60L * 1_000L;
        return when > 0L && when <= postedAt + maximumFutureSkew && when >= postedAt - maximumAge ? when : postedAt;
    }

    private static String text(CharSequence value) {
        return value == null ? "" : value.toString();
    }
}
