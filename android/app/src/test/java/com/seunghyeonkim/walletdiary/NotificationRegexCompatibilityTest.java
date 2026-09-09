package com.seunghyeonkim.walletdiary;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import java.lang.reflect.Field;
import java.util.regex.Pattern;
import org.json.JSONObject;
import org.junit.Test;

public class NotificationRegexCompatibilityTest {
    @Test public void everyParserExpressionAvoidsTheAndroidUnsupportedUnicodeClassFlag() throws Exception {
        int checked = 0;
        for (Field field : PaymentNotificationParser.class.getDeclaredFields()) {
            if (field.getType() != Pattern.class) continue;
            field.setAccessible(true);
            Pattern expression = (Pattern) field.get(null);
            assertEquals(field.getName(), 0, expression.flags() & Pattern.UNICODE_CHARACTER_CLASS);
            checked++;
        }
        assertTrue("Include cleanup expressions in the native ICU inventory", checked >= 52);
    }

    @Test public void unicodePaymentAndDebitCasesStillWorkWithoutTheUnsupportedFlag() {
        JSONObject swile = parse("Lidl", "− 12,34 €\nSolde disponible 180,00 €", "EUR");
        assertNotNull(swile);
        assertEquals(1234L, swile.optLong("minorUnits"));
        assertEquals("Lidl", swile.optString("merchant"));
        JSONObject french = parse("Prélèvement effectué", "50,00 € vers Électricité", "EUR");
        assertNotNull(french);
        assertEquals("direct_debit", french.optString("eventType"));
        JSONObject korean = parse("카드 결제", "가맹점 스타벅스 −12,000원\n잔액 120,000원", "KRW");
        assertNotNull(korean);
        assertEquals(12000L, korean.optLong("minorUnits"));
        assertNull(parse("Paiement reçu", "12,34 € de Alice", "EUR"));
        assertNull(parse("Solde disponible", "−12,34 €", "EUR"));
        assertNull(parse("Prélèvement prévu", "50,00 € vers Électricité", "EUR"));
        JSONObject cancelled = parse("Paiement annulé", "12,34 € chez Lidl", "EUR");
        assertNotNull(cancelled);
        assertEquals("reversal", cancelled.optString("eventType"));
    }

    private static JSONObject parse(String title, String text, String currency) {
        return PaymentNotificationParser.parse("com.example.bank", "Bank", title, text,
            "", "", 1000L, "icu-regression", true, false, currency);
    }
}
