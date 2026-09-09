package com.seunghyeonkim.walletdiary;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import android.provider.Settings;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

@CapacitorPlugin(
    name = "CardAutomation",
    permissions = {
        @Permission(alias = "alerts", strings = { Manifest.permission.POST_NOTIFICATIONS })
    }
)
public final class CardAutomationPlugin extends Plugin {

    @Override
    public void load() {
        PaymentNotificationListenerService.recover(getContext());
    }

    @Override
    protected void handleOnResume() {
        if (NotificationManagerCompat.getEnabledListenerPackages(getContext()).contains(getContext().getPackageName())) {
            PaymentNotificationListenerService.recover(getContext());
        }
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        // Polling status must not restart an exhausted reconnection loop.
        // Lifecycle, configuration changes and explicit recheck trigger recovery.
        call.resolve(status());
    }

    @PluginMethod
    public void openAccessSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
            getActivity().startActivity(intent);
            call.resolve();
        } catch (Exception exception) {
            call.reject("Unable to open notification access settings.", exception);
        }
    }

    @PluginMethod
    public void requestAlertPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || getPermissionState("alerts") == PermissionState.GRANTED) {
            call.resolve(status());
            return;
        }
        requestPermissionForAlias("alerts", call, "alertPermissionCallback");
    }

    @PermissionCallback
    private void alertPermissionCallback(PluginCall call) {
        call.resolve(status());
    }

    @PluginMethod
    public void peekPendingEvents(PluginCall call) {
        JSObject result = new JSObject();
        result.put("events", CardAutomationStore.pending(getContext()));
        call.resolve(result);
    }

    @PluginMethod
    public void recheckActiveNotifications(PluginCall call) {
        if (!NotificationManagerCompat.getEnabledListenerPackages(getContext()).contains(getContext().getPackageName())) {
            call.reject("Notification access is not granted."); return;
        }
        getActivity().runOnUiThread(() -> PaymentNotificationListenerService.recheck(getContext(), () -> call.resolve(status()), () -> call.reject("Could not recheck current notifications.")));
    }

    @PluginMethod
    public void acknowledgeEvents(PluginCall call) {
        JSArray events = call.getArray("events", new JSArray());
        CardAutomationStore.acknowledge(getContext(), events);
        call.resolve();
    }

    @PluginMethod
    public void configure(PluginCall call) {
        JSONArray ledgers = call.getArray("ledgers", new JSArray());
        JSONArray sources = call.getArray("sources", new JSArray());
        boolean detectAllApps = Boolean.TRUE.equals(call.getBoolean("detectAllApps", false));
        JSONObject configuration = new JSONObject();
        try {
            configuration.put("ledgers", ledgers);
            configuration.put("sources", sources);
            configuration.put("detectAllApps", detectAllApps);
        } catch (JSONException exception) {
            call.reject("Invalid automation configuration.", exception);
            return;
        }
        JSONObject previous = CardAutomationStore.configuration(getContext());
        CardAutomationStore.configure(getContext(), configuration);
        if (CardAutomationStore.captureScopeChanged(previous, configuration)
            && NotificationManagerCompat.getEnabledListenerPackages(getContext()).contains(getContext().getPackageName())) {
            // Queue synchronization must not wait up to 15 seconds for Android
            // to reconnect. Configuration is durable; reconciliation is separate.
            getActivity().runOnUiThread(() -> PaymentNotificationListenerService.recover(getContext()));
        }
        call.resolve();
    }

    @PluginMethod
    public void clearPendingEvents(PluginCall call) {
        CardAutomationStore.clear(getContext());
        call.resolve();
    }

    private JSObject status() {
        JSObject result = new JSObject();
        result.put("supported", true);
        result.put("listenerConnected", PaymentNotificationListenerService.isListenerConnected());
        result.put(
            "accessGranted",
            NotificationManagerCompat.getEnabledListenerPackages(getContext()).contains(getContext().getPackageName())
        );
        result.put(
            "alertPermissionGranted",
            Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || getPermissionState("alerts") == PermissionState.GRANTED
        );
        result.put("pendingCount", CardAutomationStore.pending(getContext()).length());
        result.put("recentChecks", CardAutomationStore.recentChecks(getContext()));
        JSONObject diagnostics = CardAutomationStore.listenerDiagnostics(getContext());
        String[] timestamps = {"lastListenerConnectedAt", "lastListenerDisconnectedAt", "lastRecoveryRequestedAt", "lastProcessingFailureAt"};
        for (String key : timestamps) if (diagnostics.optLong(key, 0L) > 0L) result.put(key, diagnostics.optLong(key));
        if (diagnostics.has("lastRecoveryError")) result.put("lastRecoveryError", diagnostics.optString("lastRecoveryError"));
        long lastCapturedAt = CardAutomationStore.lastCapturedAt(getContext());
        if (lastCapturedAt > 0L) result.put("lastCapturedAt", lastCapturedAt);
        return result;
    }
}
