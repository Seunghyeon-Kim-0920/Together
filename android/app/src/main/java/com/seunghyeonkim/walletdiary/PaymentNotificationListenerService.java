package com.seunghyeonkim.walletdiary;

import android.app.Notification;
import android.content.Intent;
import android.content.ComponentName;
import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Telephony;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import androidx.core.app.NotificationCompat;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.lang.ref.WeakReference;
import java.util.List;
import java.util.ArrayList;
import org.json.JSONObject;

public final class PaymentNotificationListenerService extends NotificationListenerService {

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private static volatile WeakReference<PaymentNotificationListenerService> connected = new WeakReference<>(null);
    private static final Handler mainHandler = new Handler(Looper.getMainLooper());
    private static final List<PendingRecheck> pendingRechecks = new ArrayList<>();

    @Override
    public void onListenerConnected() {
        super.onListenerConnected(); connected = new WeakReference<>(this);
        final List<PendingRecheck> waiting;
        synchronized (pendingRechecks) { waiting = new ArrayList<>(pendingRechecks); }
        // Android may reconnect after an app update or a period of suspension.
        // Reconcile only notifications still present and already consented to.
        captureActive(() -> { for (PendingRecheck request : waiting) request.finish(true); },
            () -> { for (PendingRecheck request : waiting) request.finish(false); });
    }

    @Override
    public void onListenerDisconnected() {
        if (connected.get() == this) connected.clear();
        super.onListenerDisconnected();
    }

    static boolean isListenerConnected() { return connected.get() != null; }

    /** Recover still-visible missed alerts after resume or consent expansion. */
    static void recover(Context context) {
        PaymentNotificationListenerService service = connected.get();
        if (service != null) { service.captureActive(() -> {}, () -> {}); return; }
        try { requestRebind(new ComponentName(context, PaymentNotificationListenerService.class)); }
        catch (Exception ignored) { /* Status UI reports the disconnected listener. */ }
    }

    static void recheck(Context context, Runnable complete, Runnable failure) {
        PendingRecheck request = new PendingRecheck(complete, failure);
        synchronized (pendingRechecks) { pendingRechecks.add(request); }
        mainHandler.postDelayed(request.timeout, 15_000L);
        PaymentNotificationListenerService service = connected.get();
        if (service == null) {
            // Requesting a bind is not a completed scan. Resolve when Android
            // actually reconnects and its queued capture has finished.
            try { requestRebind(new ComponentName(context, PaymentNotificationListenerService.class)); }
            catch (Exception exception) { request.finish(false); }
            return;
        }
        service.captureActive(() -> request.finish(true), () -> request.finish(false));
    }

    private void captureActive(Runnable complete, Runnable failure) {
        try {
            StatusBarNotification[] active = getActiveNotifications();
            if (active != null) for (int index = 0; index < Math.min(active.length, 500); index++) onNotificationPosted(active[index]);
            // Resolve only after all of the requested capture tasks, so the UI
            // refresh reads the completed queue, not a race with the executor.
            executor.execute(complete);
        } catch (Exception exception) { failure.run(); }
    }

    private static final class PendingRecheck {
        final Runnable complete;
        final Runnable failure;
        final Runnable timeout;
        PendingRecheck(Runnable complete, Runnable failure) {
            this.complete = complete; this.failure = failure;
            this.timeout = () -> finish(false);
        }
        void finish(boolean succeeded) {
            synchronized (pendingRechecks) { if (!pendingRechecks.remove(this)) return; }
            mainHandler.removeCallbacks(timeout);
            if (succeeded) complete.run(); else failure.run();
        }
    }

    @Override
    public void onNotificationPosted(StatusBarNotification statusBarNotification) {
        if (statusBarNotification == null) return;
        String packageName = statusBarNotification.getPackageName();
        // Check consent before reading any notification content. A package is
        // eligible either because the user registered it or explicitly turned
        // on global payment-app discovery.
        if (!CardAutomationStore.isAllowedPackage(this, packageName)) return;
        Notification notification = statusBarNotification.getNotification();
        if (notification == null) return;
        final boolean groupSummary = (notification.flags & Notification.FLAG_GROUP_SUMMARY) != 0;
        // A few apps post only a summary. Preserve a single parseable payment
        // for review when there is no child alert to use instead. The parser
        // still rejects summaries containing several different amounts.
        if (groupSummary && hasVisibleChild(statusBarNotification)) return;
        final boolean explicitlyConfigured = CardAutomationStore.isConfiguredSourcePackage(this, packageName);
        final String currencyHint = CardAutomationStore.currencyHint(this, packageName);
        final boolean manualOnly = requiresManualReview(packageName, notification, explicitlyConfigured);
        final long postedAt = stableEventTime(notification, statusBarNotification.getPostTime());
        final String notificationKey = statusBarNotification.getKey();

        try { executor.execute(() -> {
            // Consent may have been revoked while this task was waiting.
            if (!CardAutomationStore.isAllowedPackage(getApplicationContext(), packageName)) return;
            try {
            Bundle extras = notification.extras;
            if (extras == null) return;
            String title = NotificationTextContent.title(extras.getCharSequence(Notification.EXTRA_TITLE), extras.getCharSequence(Notification.EXTRA_TITLE_BIG));
            String message = text(extras.getCharSequence(Notification.EXTRA_TEXT));
            String subText = text(extras.getCharSequence(Notification.EXTRA_SUB_TEXT));
            CharSequence[] lines = extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES);
            boolean expandedLines = lines != null && lines.length > 1;
            String bigText = NotificationTextContent.expandedBody(extras.getCharSequence(Notification.EXTRA_BIG_TEXT), lines, extras.getCharSequence(Notification.EXTRA_INFO_TEXT));
            String eventKey = notificationKey;
            long eventTime = postedAt;
            // A MessagingStyle notification can contain a conversation history.
            // Read only its latest current message, never historic messages or
            // sender metadata. Relayed applications remain manual-only.
            NotificationCompat.MessagingStyle style = NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(notification);
            if (style != null) {
                // Conversation titles usually identify the sender, not the merchant.
                title = "";
                List<NotificationCompat.MessagingStyle.Message> messages = style.getMessages();
                if (messages != null && !messages.isEmpty()) {
                    NotificationCompat.MessagingStyle.Message latest = messages.get(messages.size() - 1);
                    message = text(latest.getText()); bigText = ""; subText = "";
                    long timestamp = latest.getTimestamp();
                    if (timestamp > 0L && timestamp <= statusBarNotification.getPostTime() + 300_000L) {
                        eventTime = timestamp; eventKey += ":message:" + timestamp;
                    }
                }
            }
            String sourceName = applicationLabel(packageName);
            JSONObject candidate = PaymentNotificationParser.parse(
                packageName,
                sourceName,
                title,
                message,
                bigText,
                subText,
                eventTime,
                eventKey,
                explicitlyConfigured && !expandedLines && !groupSummary,
                manualOnly,
                currencyHint
            );
            CardAutomationStore.recordCheck(getApplicationContext(), packageName, sourceName, candidate != null);
            // The atomic store-side check closes a final race with opt-out,
            // source removal, or ledger deletion after parsing.
            if (candidate != null) CardAutomationStore.addPendingIfAllowed(getApplicationContext(), packageName, candidate);
            } catch (RuntimeException ignored) { /* Malformed third-party extras must not stop subsequent notifications. */ }
        }); } catch (RejectedExecutionException ignored) { /* Service is shutting down; do not crash Android's callback. */ }
    }

    private boolean hasVisibleChild(StatusBarNotification summary) {
        try {
            StatusBarNotification[] active = getActiveNotifications();
            if (active == null) return false;
            for (int index = 0; index < Math.min(active.length, 500); index++) {
                StatusBarNotification item = active[index];
                if (item == null || item.getNotification() == null) continue;
                if (summary.getPackageName().equals(item.getPackageName()) && summary.getGroupKey().equals(item.getGroupKey())
                    && (item.getNotification().flags & Notification.FLAG_GROUP_SUMMARY) == 0) return true;
            }
        } catch (RuntimeException ignored) {}
        return false;
    }

    @Override
    public void onDestroy() {
        if (connected.get() == this) connected.clear();
        executor.shutdown();
        super.onDestroy();
    }

    @SuppressWarnings("deprecation")
    private String applicationLabel(String packageName) {
        try {
            String label = getPackageManager().getApplicationLabel(getPackageManager().getApplicationInfo(packageName, 0)).toString();
            return label.length() <= 80 ? label : label.substring(0, 80);
        } catch (Exception ignored) {
            return packageName;
        }
    }

    private boolean requiresManualReview(String packageName, Notification notification, boolean explicitlyConfigured) {
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
        return PaymentSourcePolicy.requiresManualReview(packageName, notification.category, explicitlyConfigured);
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
