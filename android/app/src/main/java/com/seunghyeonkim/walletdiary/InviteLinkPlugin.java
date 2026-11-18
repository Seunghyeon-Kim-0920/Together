package com.seunghyeonkim.walletdiary;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import com.android.installreferrer.api.InstallReferrerClient;
import com.android.installreferrer.api.InstallReferrerStateListener;
import com.android.installreferrer.api.ReferrerDetails;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Hands shared-trip invitation links to the web layer.
 *
 * Two sources exist: a link that opens the installed app (App Link or the
 * walletdiary:// scheme), and the Play install referrer that carries an
 * invitation through a fresh installation. Nothing is parsed here. The web
 * layer accepts only the exact invitation-code format; this class stores only
 * the fact that the referrer was already delivered.
 */
@CapacitorPlugin(name = "InviteLink")
public final class InviteLinkPlugin extends Plugin {
    private static final String PREFERENCES = "invite_link";
    private static final String REFERRER_CONSUMED = "install_referrer_consumed";
    private static final int MAX_LENGTH = 2000;
    private static final long REFERRER_TIMEOUT_MS = 8000L;
    private static volatile boolean restoredLaunch = false;

    /** MainActivity calls this before the bridge replays the launch intent. */
    static void markRestoredLaunch(boolean restored) {
        restoredLaunch = restored;
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        boolean replayedLaunch = restoredLaunch;
        restoredLaunch = false;
        if (intent == null || !Intent.ACTION_VIEW.equals(intent.getAction())) return;
        // A recreated activity, or a task reopened from Recents, repeats the
        // original intent although nobody tapped the link again.
        if (replayedLaunch || (intent.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) return;
        Uri data = intent.getData();
        if (data == null) return;
        String url = data.toString();
        if (url.isEmpty() || url.length() > MAX_LENGTH) return;
        JSObject event = new JSObject();
        event.put("url", url);
        // Retained until the web layer subscribes, which happens after a cold start.
        notifyListeners("inviteLink", event, true);
    }

    /**
     * Resolves {"referrer": "..."} once per installation and an empty string
     * afterwards or when Google Play cannot answer.
     */
    @PluginMethod
    public void consumeInstallReferrer(final PluginCall call) {
        final Context context = getContext().getApplicationContext();
        final SharedPreferences preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
        if (preferences.getBoolean(REFERRER_CONSUMED, false)) {
            resolveReferrer(call, "");
            return;
        }
        final AtomicBoolean finished = new AtomicBoolean(false);
        final Handler timeoutHandler = new Handler(Looper.getMainLooper());
        final InstallReferrerClient client;
        try {
            client = InstallReferrerClient.newBuilder(context).build();
        } catch (RuntimeException error) {
            resolveReferrer(call, "");
            return;
        }
        // Bound the connection at the source. A timeout is not a definitive
        // response: never mark it consumed, and ignore any late callback.
        final Runnable timeout = () -> {
            if (!finished.compareAndSet(false, true)) return;
            closeClient(client);
            resolveReferrer(call, "");
        };
        timeoutHandler.postDelayed(timeout, REFERRER_TIMEOUT_MS);
        try {
            client.startConnection(new InstallReferrerStateListener() {
                @Override
                public void onInstallReferrerSetupFinished(int responseCode) {
                    if (!finished.compareAndSet(false, true)) return;
                    timeoutHandler.removeCallbacks(timeout);
                    String referrer = "";
                    // Only a definitive answer is remembered; a temporary failure is retried on the next launch.
                    boolean definitive = responseCode == InstallReferrerClient.InstallReferrerResponse.OK
                        || responseCode == InstallReferrerClient.InstallReferrerResponse.FEATURE_NOT_SUPPORTED;
                    try {
                        if (responseCode == InstallReferrerClient.InstallReferrerResponse.OK) {
                            ReferrerDetails details = client.getInstallReferrer();
                            String value = details == null ? null : details.getInstallReferrer();
                            if (value != null && value.length() <= MAX_LENGTH) referrer = value;
                        }
                    } catch (Exception error) {
                        definitive = false;
                    } finally {
                        closeClient(client);
                    }
                    if (definitive) preferences.edit().putBoolean(REFERRER_CONSUMED, true).apply();
                    resolveReferrer(call, referrer);
                }

                @Override
                public void onInstallReferrerServiceDisconnected() {
                    if (!finished.compareAndSet(false, true)) return;
                    timeoutHandler.removeCallbacks(timeout);
                    closeClient(client);
                    resolveReferrer(call, "");
                }
            });
        } catch (RuntimeException error) {
            if (!finished.compareAndSet(false, true)) return;
            timeoutHandler.removeCallbacks(timeout);
            closeClient(client);
            resolveReferrer(call, "");
        }
    }

    private static void closeClient(InstallReferrerClient client) {
        try { client.endConnection(); }
        catch (RuntimeException ignored) { /* The connection is already closed. */ }
    }

    private static void resolveReferrer(PluginCall call, String referrer) {
        JSObject result = new JSObject();
        result.put("referrer", referrer);
        call.resolve(result);
    }
}
