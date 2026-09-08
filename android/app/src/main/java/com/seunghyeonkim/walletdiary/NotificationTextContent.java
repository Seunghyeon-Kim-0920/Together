package com.seunghyeonkim.walletdiary;

import java.util.LinkedHashSet;
import java.util.Set;

/** Bounded, in-memory extraction. Notification content is never stored here. */
final class NotificationTextContent {
    private NotificationTextContent() {}

    static String joinLines(CharSequence[] lines) {
        if (lines == null) return "";
        Set<String> distinct = new LinkedHashSet<>();
        int length = 0;
        for (int index = 0; index < Math.min(lines.length, 20); index++) {
            if (lines[index] == null) continue;
            String line = lines[index].toString().trim();
            if (line.isEmpty() || distinct.contains(line)) continue;
            if (length + line.length() + 1 > 2000) continue;
            distinct.add(line); length += line.length() + 1;
        }
        return String.join("\n", distinct);
    }

    static String expandedBody(CharSequence bigText, CharSequence[] lines, CharSequence infoText) {
        // Some banks put a generic sentence in BIG_TEXT and the transaction in
        // TEXT_LINES. Both are present in the same notification; neither is a
        // reliable replacement for the other. Keep the payment lines first so
        // a long explanatory paragraph cannot consume the extraction budget.
        String lineText = joinLines(lines);
        return joinLines(new CharSequence[] {lineText, bigText, infoText});
    }

    static String title(CharSequence collapsedTitle, CharSequence expandedTitle) {
        // Expanded titles commonly contain the merchant when the collapsed
        // title is just the app label. Preserve both for payment classification.
        return joinLines(new CharSequence[] {collapsedTitle, expandedTitle});
    }
}
