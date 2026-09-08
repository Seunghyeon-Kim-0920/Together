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
    @Test public void expandedTransactionLinesAreNotLostWhenBigTextIsAlsoPresent() {
        assertEquals("Lidl\n1,24 €\nVotre carte a été utilisée\nEUR", NotificationTextContent.expandedBody(
            "Votre carte a été utilisée", new CharSequence[] {"Lidl", "1,24 €"}, "EUR"));
        assertEquals("Lidl\n1,24 €", NotificationTextContent.expandedBody("x".repeat(2500), new CharSequence[] {"Lidl", "1,24 €"}, null));
        assertEquals("1,24 €", NotificationTextContent.expandedBody(null, null, "1,24 €"));
    }
    @Test public void expandedMerchantTitleIsRetainedWithoutDuplicatingTheTitle() {
        assertEquals("Swile\nLidl", NotificationTextContent.title("Swile", "Lidl"));
        assertEquals("Lidl", NotificationTextContent.title("Lidl", "Lidl"));
    }
}
