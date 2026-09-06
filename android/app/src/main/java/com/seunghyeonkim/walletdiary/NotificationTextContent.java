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
            if (length + line.length() + 1 > 2000) break;
            distinct.add(line); length += line.length() + 1;
        }
        return String.join("\n", distinct);
    }
}
