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

    @PluginMethod
    public void getStatus(PluginCall call) {
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
    public void acknowledgeEvents(PluginCall call) {
        JSArray ids = call.getArray("ids", new JSArray());
        CardAutomationStore.acknowledge(getContext(), ids);
        call.resolve();
    }

    @PluginMethod
    public void configure(PluginCall call) {
        JSONArray ledgers = call.getArray("ledgers", new JSArray());
        JSONArray sources = call.getArray("sources", new JSArray());
        JSONObject configuration = new JSONObject();
        try {
            configuration.put("ledgers", ledgers);
            configuration.put("sources", sources);
        } catch (JSONException exception) {
            call.reject("Invalid automation configuration.", exception);
            return;
        }
        CardAutomationStore.configure(getContext(), configuration);
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
        result.put(
            "accessGranted",
            NotificationManagerCompat.getEnabledListenerPackages(getContext()).contains(getContext().getPackageName())
        );
        result.put(
            "alertPermissionGranted",
            Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || getPermissionState("alerts") == PermissionState.GRANTED
        );
        result.put("pendingCount", CardAutomationStore.pending(getContext()).length());
        long lastCapturedAt = CardAutomationStore.lastCapturedAt(getContext());
        if (lastCapturedAt > 0L) result.put("lastCapturedAt", lastCapturedAt);
        return result;
    }
}
