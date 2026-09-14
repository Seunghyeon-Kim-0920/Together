package com.seunghyeonkim.walletdiary;

import static org.junit.Assert.*;
import org.json.JSONObject;
import org.junit.Test;

public class PaymentCategoryHintsTest {
    @Test public void specificMerchantWins() {
        assertEquals("food", PaymentCategoryHints.infer("Uber Eats", "", ""));
        assertEquals("transport", PaymentCategoryHints.infer("Uber", "", ""));
        assertEquals("subscriptions", PaymentCategoryHints.infer("Amazon Prime", "", ""));
    }
    @Test public void readsBodyWhenMerchantUnknown() {
        assertEquals("food", PaymentCategoryHints.infer("Example ABC", "Card payment", "Restaurant -12.50 EUR"));
        assertEquals("housing", PaymentCategoryHints.infer("Jean Exemple", "Virement émis", "Loyer appartement -500 EUR"));
    }
    @Test public void merchantWinsOverUnrelatedBodyWords() {
        assertEquals("health", PaymentCategoryHints.infer("Pharmacie Test", "Paid", "restaurant offer"));
    }
    @Test public void koreanAndAccentsWork() {
        assertEquals("housing", PaymentCategoryHints.infer("월세", "", ""));
        assertEquals("food", PaymentCategoryHints.infer("스타벅스 강남", "", ""));
        assertEquals("education", PaymentCategoryHints.infer("Université Test", "", ""));
        assertEquals("food", PaymentCategoryHints.infer("Cafe\u0301", "", ""));
    }
    @Test public void unknownAndNullHaveNoHint() {
        assertNull(PaymentCategoryHints.infer(null, null, null));
        assertNull(PaymentCategoryHints.infer("XYZ", "Example", "-10 EUR"));
        assertNull(PaymentCategoryHints.infer("Buster Example", "", ""));
    }
    @Test public void hintIsNotPartOfIdentityOrRawText() throws Exception {
        JSONObject event = PaymentNotificationParser.parse("com.example.bank", "Bank", "Card payment", "€12.34 at Lidl", "", "", 1_700_000_000_000L, "category-test", true, false, "EUR");
        assertNotNull(event);
        assertEquals("food", event.optString("categoryHint"));
        String token = PaymentNotificationParser.contentToken(event);
        event.put("categoryHint", "shopping");
        assertEquals(token, PaymentNotificationParser.contentToken(event));
        assertFalse(event.has("body")); assertFalse(event.has("title")); assertFalse(event.has("text"));
    }
}
