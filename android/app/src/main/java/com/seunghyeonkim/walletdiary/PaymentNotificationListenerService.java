package com.seunghyeonkim.walletdiary;

import android.app.Notification;
import android.os.Bundle;
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
        // Check the package before reading any notification content. The user
        // must explicitly enable a supported source inside Wallet Diary.
        if (!CardAutomationStore.isAllowedPackage(this, packageName)) return;

        Notification notification = statusBarNotification.getNotification();
        if (notification == null || (notification.flags & Notification.FLAG_GROUP_SUMMARY) != 0) return;
        final long postedAt = statusBarNotification.getPostTime();
        final String notificationKey = statusBarNotification.getKey();

        executor.execute(() -> {
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
                notificationKey
            );
            if (candidate != null) CardAutomationStore.addPending(getApplicationContext(), candidate);
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

    private static String text(CharSequence value) {
        return value == null ? "" : value.toString();
    }
}
