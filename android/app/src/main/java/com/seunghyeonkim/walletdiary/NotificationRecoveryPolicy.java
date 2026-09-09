package com.seunghyeonkim.walletdiary;

/** Pure, bounded policy shared by lifecycle and update recovery. */
final class NotificationRecoveryPolicy {
    private static final long[] RETRY_DELAYS_MS = {0L, 1_000L, 5_000L, 15_000L};

    private NotificationRecoveryPolicy() {}

    static boolean shouldRecover(boolean accessGranted, boolean captureEnabled, boolean connected) {
        return accessGranted && captureEnabled && !connected;
    }

    static long delayForAttempt(int attempt) {
        return attempt >= 0 && attempt < RETRY_DELAYS_MS.length ? RETRY_DELAYS_MS[attempt] : -1L;
    }
}
