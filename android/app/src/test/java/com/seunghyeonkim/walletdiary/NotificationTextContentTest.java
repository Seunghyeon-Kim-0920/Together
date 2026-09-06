package com.seunghyeonkim.walletdiary;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import org.junit.Test;

public class NotificationTextContentTest {
    @Test public void expandedLinesPreserveMerchantAndAmountWithoutRepeatingLines() {
        assertEquals("Lidl\n-1,24 €\nSolde 180 €", NotificationTextContent.joinLines(new CharSequence[] {"Lidl", "-1,24 €", "Lidl", null, "", "Solde 180 €"}));
    }
    @Test public void contentIsBoundedAndNullSafe() {
        assertEquals("", NotificationTextContent.joinLines(null));
        assertEquals("", NotificationTextContent.joinLines(new CharSequence[] {"x".repeat(2500)}));
        assertTrue(NotificationTextContent.joinLines(new CharSequence[] {"x".repeat(1999), "overflow"}).length() <= 2000);
    }
}
