package com.seunghyeonkim.walletdiary;

import static org.junit.Assert.*;
import org.json.JSONObject;
import org.junit.Test;

/** Entirely synthetic receipts; no real customer or bank account data. */
public class CashWithdrawalNotificationTest {
    private static JSONObject parse(String title, String body, boolean trusted, boolean manual) {
        return PaymentNotificationParser.parse("com.example.bank", "Example Bank", title, body,
            "", "", 1792756800000L, "synthetic-atm", trusted, manual, "EUR");
    }

    @Test public void completedCashReceiptsCoverKoreanEnglishAndEuropeanWording() {
        String[][] cases = {
            {"ATM 현금 인출 완료", "인출금액 50,000원\n거래점: 예시지점\n잔액 120,000원", "KRW", "50000"},
            {"입금/출금", "ATM 출금 50,000원\n잔액 120,000원", "KRW", "50000"},
            {"Cash withdrawal completed", "USD 50.00\nATM: Example Branch\nBalance USD 120.00", "USD", "5000"},
            {"Cash withdrawal", "You withdrew EUR 50.00 at Example Bank ATM\nAvailable balance EUR 120.00", "EUR", "5000"},
            {"Retrait d’espèces effectué", "50,00 EUR\nLieu: Agence Exemple\nSolde 120,00 EUR", "EUR", "5000"},
            {"Retrait au DAB", "50,00 EUR\nDistributeur: Agence Exemple", "EUR", "5000"},
            {"Bargeldabhebung erfolgreich", "50,00 EUR\nATM: Beispiel Filiale", "EUR", "5000"},
            {"Retiro de efectivo realizado", "50,00 EUR\nATM: Sucursal Ejemplo", "EUR", "5000"},
            {"Prelievo contanti effettuato", "50,00 EUR\nATM: Filiale Esempio", "EUR", "5000"},
            {"Geldopname voltooid", "50,00 EUR\nATM: Voorbeeld Bank", "EUR", "5000"},
        };
        for (String[] item : cases) {
            JSONObject result = parse(item[0], item[1], true, false);
            assertNotNull(item[0], result);
            assertEquals(item[0], "cash_withdrawal", result.optString("eventType"));
            assertEquals(item[0], item[2], result.optString("currency"));
            assertEquals(item[0], Long.parseLong(item[3]), result.optLong("minorUnits"));
            assertEquals(item[0], "other", result.optString("categoryHint"));
            assertEquals(item[0], "high", result.optString("confidence"));
            assertFalse(item[0], result.optBoolean("requiresMerchant"));
        }
    }

    @Test public void locationsAreExplicitAndMissingLocationsUseNamedBankNotInventedMerchant() {
        assertEquals("ATM · Example Branch", parse("Cash withdrawal completed", "USD 50.00\nATM: Example Branch", true, false).optString("merchant"));
        assertEquals("ATM · Example Bank", parse("Cash withdrawal completed", "USD 50.00", true, false).optString("merchant"));
        assertEquals("ATM · 예시지점", parse("ATM 현금 인출 완료", "인출 50,000원\n거래점: 예시지점", true, false).optString("merchant"));
    }

    @Test public void requestsLimitsFailuresDepositsAndBalancesAreNotCandidates() {
        String[] titles = {
            "Cash withdrawal requested", "Verify cash withdrawal", "Please confirm your ATM withdrawal",
            "Cash withdrawal approval required", "Cash withdrawal pending", "Cash withdrawal failed",
            "Cash withdrawal denied", "Cash withdrawal unsuccessful", "Cash withdrawal aborted", "Cash withdrawal attempted",
            "Cash withdrawal declined", "Cash withdrawal reversed", "Cash withdrawal refunded",
            "Withdrawal limit", "Cash withdrawal limit", "How to withdraw cash", "Available to withdraw cash",
            "Demande de retrait d’espèces", "Veuillez confirmer le retrait d’espèces", "Retrait d’espèces à valider",
            "Plafond de retrait d’espèces", "Retrait d’espèces refusé", "Retrait d’espèces en attente",
            "Bargeldabhebung beantragt", "Bargeldabhebung fehlgeschlagen", "Bestätigen Sie die Bargeldabhebung",
            "Solicitud de retiro de efectivo", "Retiro de efectivo pendiente", "Richiesta di prelievo contanti",
            "Prelievo contanti in attesa", "Bevestig geldopname", "ATM 현금 인출 요청", "ATM 출금 한도",
            "ATM 출금 취소", "현금 인출 실패", "ATM 입금 완료", "현금 입금 완료", "Cash deposit completed",
            "Cash withdrawal deposit", "입금/출금", "Available balance", "잔액 안내"
        };
        for (String title : titles) assertNull(title, parse(title, "EUR 50.00", true, false));
        assertNull(parse("Cash withdrawal completed", "Remaining balance EUR 50.00", true, false));
        assertNull(parse("ATM 현금 인출", "입금액 50,000원", true, false));
        for (String body : new String[] {
            "Your withdrawal has been requested. EUR 50.00",
            "A cash withdrawal of EUR 50.00 requires your approval",
            "Your withdrawal of EUR 50.00 is scheduled for tomorrow",
            "EUR 50.00\nNo cash was dispensed", "EUR 50.00\nCash was not dispensed",
            "EUR 50.00\nUnable to dispense cash", "Cash withdrawal ready to collect. USD 50.00",
            "Collect your cash at any ATM. USD 50.00", "Cash withdrawal fee EUR 2.00",
            "현금 인출이 요청되었습니다. 50,000원", "현금 인출 50,000원 미지급", "현금 미지급 50,000원",
            "Retrait d’espèces de 50,00 EUR demandé", "Espèces non distribuées. 50,00 EUR"
        }) assertNull(body, parse("ATM withdrawal", body, true, false));
    }

    @Test public void completedReceiptMayContainUnrelatedHelpWithoutBecomingRequest() {
        assertNotNull(parse("Cash withdrawal completed", "USD 50.00\nATM: Example Branch\nPlease check your statement", true, false));
        assertNotNull(parse("Retrait d’espèces effectué", "50,00 EUR\nVeuillez conserver ce reçu", true, false));
        assertNotNull(parse("Cash withdrawal completed", "USD 50.00\nPlease contact support if you need help", true, false));
        assertNotNull(parse("Cash withdrawal completed", "USD 50.00\nYou do not need to confirm", true, false));
    }

    @Test public void discoveredAndForwardedCashReceiptsStayReviewOnly() {
        assertEquals("review", parse("Cash withdrawal completed", "USD 50.00", false, false).optString("confidence"));
        assertEquals("review", parse("Cash withdrawal completed", "USD 50.00", true, true).optString("confidence"));
    }

    @Test public void optedInSmsReceiptGateRecognizesCashButNeverBypassesParserSafety() {
        for (String body : new String[] {
            "Cash withdrawal completed. USD 50.00\nATM: Example Branch", "You withdrew USD 50.00",
            "ATM 현금 인출 완료. 50,000원", "Retrait d’espèces effectué. 50,00 EUR",
            "Bargeldabhebung erfolgreich. 50,00 EUR", "Retiro de efectivo realizado. 50,00 EUR",
            "Prelievo contanti effettuato. 50,00 EUR", "Geldopname voltooid. 50,00 EUR"
        }) {
            assertTrue(body, SmsPaymentPolicy.hasFinancialReceiptEvidence(body));
            assertNotNull(body, parse("", body, true, false));
        }
        for (String body : new String[] {
            "Please approve your cash withdrawal of USD 50.00", "Cash withdrawal limit USD 50.00",
            "Demande de retrait d’espèces de 50,00 EUR", "ATM 현금 인출 요청 50,000원"
        }) assertFalse(body, SmsPaymentPolicy.hasFinancialReceiptEvidence(body));
        assertNull(parse("", "Cash withdrawal completed? Tap to verify your withdrawal of USD 50.00", true, false));
    }
}
