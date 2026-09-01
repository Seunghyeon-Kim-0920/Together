package com.seunghyeonkim.walletdiary;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import java.math.BigDecimal;
import java.text.NumberFormat;
import java.text.SimpleDateFormat;
import java.util.Currency;
import java.util.Date;
import java.util.Locale;
import java.util.Set;
import java.util.HashSet;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

final class CardAutomationStore {

    private static final String PREFERENCES = "wallet_diary_card_automation";
    private static final String KEY_PENDING = "pending_events";
    private static final String KEY_CONFIGURATION = "configuration";
    private static final String KEY_LAST_CAPTURED = "last_captured_at";
    private static final String CHANNEL_ID = "wallet_diary_budget";
    private static final int MAX_PENDING = 5_000;
    private CardAutomationStore() {}

    static synchronized boolean isAllowedPackage(Context context, String packageName) {
        if (packageName == null || packageName.equals(context.getPackageName())) return false;
        JSONObject configuration = configuration(context);
        if (configuration.optBoolean("detectAllApps", false)) return true;
        return isConfiguredSourcePackage(configuration, packageName);
    }

    static synchronized boolean isConfiguredSourcePackage(Context context, String packageName) {
        return isConfiguredSourcePackage(configuration(context), packageName);
    }

    private static boolean isConfiguredSourcePackage(JSONObject configuration, String packageName) {
        JSONArray sources = configuration.optJSONArray("sources");
        if (sources == null) return false;
        for (int index = 0; index < sources.length(); index++) {
            if (packageName.equals(sources.optJSONObject(index) == null ? null : sources.optJSONObject(index).optString("packageName"))) return true;
        }
        return false;
    }

    static synchronized String currencyHint(Context context, String packageName) {
        JSONObject configuration = configuration(context);
        JSONArray ledgers = configuration.optJSONArray("ledgers");
        if (ledgers == null) return "";
        Set<String> sourceLedgerIds = new HashSet<>();
        Set<String> sourceCurrencies = new HashSet<>();
        JSONArray sources = configuration.optJSONArray("sources");
        if (sources != null) {
            for (int index = 0; index < sources.length(); index++) {
                JSONObject source = sources.optJSONObject(index);
                if (source != null && packageName.equals(source.optString("packageName"))) {
                    String configuredCurrency = source.optString("currency");
                    if (!configuredCurrency.isEmpty()) sourceCurrencies.add(configuredCurrency);
                    String ledgerId = source.optString("ledgerId");
                    if (!ledgerId.isEmpty()) sourceLedgerIds.add(ledgerId);
                }
            }
        }
        if (sourceCurrencies.size() > 1) return "";
        if (sourceCurrencies.size() == 1) return sourceCurrencies.iterator().next();
        Set<String> currencies = new HashSet<>();
        for (int index = 0; index < ledgers.length(); index++) {
            JSONObject ledger = ledgers.optJSONObject(index);
            if (ledger == null) continue;
            String currency = ledger.optString("currency");
            if (sourceLedgerIds.contains(ledger.optString("ledgerId")) && !currency.isEmpty()) sourceCurrencies.add(currency);
            if (configuration.optBoolean("detectAllApps", false) && ledger.optBoolean("automationAllApps", false) && !currency.isEmpty()) currencies.add(currency);
        }
        if (!sourceLedgerIds.isEmpty()) return sourceCurrencies.size() == 1 ? sourceCurrencies.iterator().next() : "";
        return currencies.size() == 1 ? currencies.iterator().next() : "";
    }

    static synchronized boolean addPending(Context context, JSONObject candidate) {
        String id = candidate.optString("id");
        if (id.isEmpty()) return false;
        JSONArray pending = pending(context);
        JSONArray next = new JSONArray();
        boolean exists = false;
        for (int index = 0; index < pending.length(); index++) {
            JSONObject item = pending.optJSONObject(index);
            if (item == null) continue;
            if (id.equals(item.optString("id"))) {
                next.put(candidate);
                exists = true;
            } else {
                next.put(item);
            }
        }
        if (!exists) {
            if (next.length() >= MAX_PENDING) return false;
            next.put(candidate);
        }
        preferences(context).edit().putString(KEY_PENDING, next.toString()).putLong(KEY_LAST_CAPTURED, System.currentTimeMillis()).commit();
        return !exists;
    }

    static synchronized boolean addPendingIfAllowed(Context context, String packageName, JSONObject candidate) {
        return isAllowedPackage(context, packageName) && addPending(context, candidate);
    }

    static synchronized JSONArray pending(Context context) {
        try {
            JSONArray stored = new JSONArray(preferences(context).getString(KEY_PENDING, "[]"));
            JSONArray current = retainCurrentParserEvents(stored);
            if (current.length() != stored.length()) preferences(context).edit().putString(KEY_PENDING, current.toString()).commit();
            return current;
        } catch (JSONException ignored) {
            return new JSONArray();
        }
    }

    static JSONArray retainCurrentParserEvents(JSONArray events) {
        JSONArray current = new JSONArray();
        for (int index = 0; index < events.length(); index++) {
            JSONObject item = events.optJSONObject(index);
            if (item != null && item.optInt("parserVersion", 0) == PaymentNotificationParser.PARSER_VERSION) current.put(item);
        }
        return current;
    }

    static synchronized void acknowledge(Context context, JSONArray events) {
        JSONArray next = removeAcknowledged(pending(context), events);
        preferences(context).edit().putString(KEY_PENDING, next.toString()).commit();
    }

    static JSONArray removeAcknowledged(JSONArray current, JSONArray events) {
        Set<String> acknowledged = new HashSet<>();
        for (int index = 0; index < events.length(); index++) {
            JSONObject event = events.optJSONObject(index);
            if (event == null) continue;
            String id = event.optString("id", "");
            String queueToken = event.isNull("queueToken") ? "" : event.optString("queueToken", "");
            if (!id.isEmpty()) acknowledged.add(id + "\u0000" + queueToken);
        }
        JSONArray next = new JSONArray();
        for (int index = 0; index < current.length(); index++) {
            JSONObject item = current.optJSONObject(index);
            if (item == null) continue;
            String queueToken = item.isNull("queueToken") || !item.has("queueToken") ? "" : item.optString("queueToken", "");
            if (!acknowledged.contains(item.optString("id") + "\u0000" + queueToken)) next.put(item);
        }
        return next;
    }

    static synchronized void clear(Context context) {
        preferences(context).edit().remove(KEY_PENDING).remove(KEY_LAST_CAPTURED).commit();
    }

    static synchronized void configure(Context context, JSONObject value) {
        JSONObject previous = configuration(context);
        JSONObject safe = new JSONObject();
        try {
            safe.put("ledgers", value.optJSONArray("ledgers") == null ? new JSONArray() : value.optJSONArray("ledgers"));
            safe.put("sources", value.optJSONArray("sources") == null ? new JSONArray() : value.optJSONArray("sources"));
            safe.put("detectAllApps", value.optBoolean("detectAllApps", false));
        } catch (JSONException ignored) {}
        preferences(context).edit().putString(KEY_CONFIGURATION, safe.toString()).commit();
        JSONArray ledgers = safe.optJSONArray("ledgers");
        if (ledgers == null) return;
        for (int index = 0; index < ledgers.length(); index++) {
            JSONObject ledger = ledgers.optJSONObject(index);
            if (ledger == null) continue;
            String month = monthKey(System.currentTimeMillis());
            String ledgerId = ledger.optString("ledgerId");
            long monthlyLimit = ledger.optLong("monthlyLimitMinor", 0L);
            if (monthlyLimit != limitForLedger(previous, ledgerId)) {
                preferences(context).edit().remove("budget_alert::" + ledgerId + "::" + month).commit();
            }
            long spent = ledger.optLong("spentMinor", 0L);
            // Only the canonical amount that the React app has durably saved is
            // eligible for a limit alert. Captured candidates may still be a
            // duplicate, require review, or fail to save.
            maybeNotifyBudget(context, ledger, month, spent);
        }
    }

    static synchronized JSONObject configuration(Context context) {
        try {
            return new JSONObject(preferences(context).getString(KEY_CONFIGURATION, "{}"));
        } catch (JSONException ignored) {
            return new JSONObject();
        }
    }

    static long lastCapturedAt(Context context) {
        return preferences(context).getLong(KEY_LAST_CAPTURED, 0L);
    }

    private static void maybeNotifyBudget(Context context, JSONObject ledger, String month, long spent) {
        long limit = ledger.optLong("monthlyLimitMinor", 0L);
        String ledgerId = ledger.optString("ledgerId");
        if (limit <= 0 || ledgerId.isEmpty() || spent < 0) return;
        int level = budgetLevel(spent, limit);
        if (level == 0) return;
        String alertKey = "budget_alert::" + ledgerId + "::" + month;
        int prior = preferences(context).getInt(alertKey, 0);
        if (prior >= level) return;
        preferences(context).edit().putInt(alertKey, level).commit();
        showBudgetNotification(context, ledger, spent, limit, level);
    }

    private static void showBudgetNotification(Context context, JSONObject ledger, long spent, long limit, int level) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        NotificationManagerCompat manager = NotificationManagerCompat.from(context);
        if (!manager.areNotificationsEnabled()) return;
        String locale = ledger.optString("locale", "ko");
        createChannel(context, locale);
        String currency = ledger.optString("currency", "EUR");
        long remaining = Math.max(0L, limit - spent);
        String title;
        String body;
        if ("fr".equals(locale)) {
            title = level >= 100 ? "Plafond mensuel dépassé" : "Vous approchez de votre plafond mensuel";
            body = level >= 100 ? "Vous avez dépassé le plafond de " + formatMoney(spent - limit, currency, Locale.FRANCE) + "." : "Il vous reste " + formatMoney(remaining, currency, Locale.FRANCE) + ".";
        } else if ("en".equals(locale)) {
            title = level >= 100 ? "Monthly limit exceeded" : "You are nearing your monthly limit";
            body = level >= 100 ? "You are over by " + formatMoney(spent - limit, currency, Locale.US) + "." : formatMoney(remaining, currency, Locale.US) + " remains.";
        } else {
            title = level >= 100 ? "월 소비 한도를 넘었어요" : "월 소비 한도에 가까워졌어요";
            body = level >= 100 ? formatMoney(spent - limit, currency, Locale.KOREA) + " 초과했어요." : formatMoney(remaining, currency, Locale.KOREA) + " 남았어요.";
        }
        Intent intent = new Intent(context, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(context, ledger.optString("ledgerId").hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true);
        manager.notify((ledger.optString("ledgerId") + monthKey(System.currentTimeMillis())).hashCode(), builder.build());
    }

    private static void createChannel(Context context, String locale) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        String name = "ko".equals(locale) ? "월 소비 한도" : "fr".equals(locale) ? "Plafond mensuel" : "Monthly spending limit";
        String description = "ko".equals(locale)
            ? "월 소비 한도에 가까워지거나 초과했을 때 알려줍니다."
            : "fr".equals(locale)
                ? "Alertes lorsque vous approchez ou dépassez votre plafond mensuel."
                : "Alerts when you approach or exceed your monthly spending limit.";
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, name, NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription(description);
        channel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PRIVATE);
        manager.createNotificationChannel(channel);
    }

    private static String formatMoney(long minorUnits, String currencyCode, Locale locale) {
        try {
            Currency currency = Currency.getInstance(currencyCode);
            NumberFormat format = NumberFormat.getCurrencyInstance(locale);
            format.setCurrency(currency);
            int digits = currency.getDefaultFractionDigits();
            return format.format(BigDecimal.valueOf(minorUnits, Math.max(0, digits)));
        } catch (Exception ignored) {
            return currencyCode + " " + minorUnits;
        }
    }

    private static String monthKey(long time) {
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM", Locale.US);
        return format.format(new Date(time));
    }

    private static long limitForLedger(JSONObject configuration, String ledgerId) {
        JSONArray ledgers = configuration.optJSONArray("ledgers");
        if (ledgers == null || ledgerId == null || ledgerId.isEmpty()) return 0L;
        for (int index = 0; index < ledgers.length(); index++) {
            JSONObject ledger = ledgers.optJSONObject(index);
            if (ledger != null && ledgerId.equals(ledger.optString("ledgerId"))) {
                return ledger.optLong("monthlyLimitMinor", 0L);
            }
        }
        return 0L;
    }

    static int budgetLevel(long spent, long limit) {
        if (spent < 0L || limit <= 0L) return 0;
        if (spent >= limit) return 100;
        BigDecimal spentPercent = BigDecimal.valueOf(spent).multiply(BigDecimal.valueOf(100L));
        BigDecimal limitValue = BigDecimal.valueOf(limit);
        if (spentPercent.compareTo(limitValue.multiply(BigDecimal.valueOf(90L))) >= 0) return 90;
        return spentPercent.compareTo(limitValue.multiply(BigDecimal.valueOf(80L))) >= 0 ? 80 : 0;
    }

    private static SharedPreferences preferences(Context context) { return context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE); }
}
