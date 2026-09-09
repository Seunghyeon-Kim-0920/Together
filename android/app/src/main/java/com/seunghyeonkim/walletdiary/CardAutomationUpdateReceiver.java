package com.seunghyeonkim.walletdiary;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Restore an already-consented listener after replacing this APK, never grant access. */
public final class CardAutomationUpdateReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent != null && Intent.ACTION_MY_PACKAGE_REPLACED.equals(intent.getAction())) {
            PaymentNotificationListenerService.recover(context);
        }
    }
}
