package com.seunghyeonkim.walletdiary;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

import org.json.JSONObject;
import org.junit.Test;

/** Synthetic language/layout examples; these are not captured bank messages. */
public class InternationalOutgoingTransferRegressionTest {
    private static final long POSTED_AT = 1_790_681_520_000L;

    @Test
    public void europeanTransfersUseExplicitRecipientAndExecutedDirection() {
        String[][] rows = {
            {"Bank transfer completed", "25.50 EUR\nRecipient: Alex Example"},
            {"Virement effectué", "25,50 EUR\nBénéficiaire: Alex Example"},
            {"Virement", "Vous avez envoyé 25,50 EUR à Alex Example"},
            {"Virement effectué", "25,50 EUR au profit de Alex Example"},
            {"Überweisung ausgeführt", "25,50 EUR\nEmpfänger: Alex Example"},
            {"Transferencia realizada", "25,50 EUR\nBeneficiario: Alex Example"},
            {"Transferência efetuada", "25,50 EUR\nBeneficiário: Alex Example"},
            {"Bonifico eseguito", "25,50 EUR\nBeneficiario: Alex Example"},
            {"Overboeking uitgevoerd", "25,50 EUR\nOntvanger: Alex Example"},
        };
        for (String[] row : rows) assertTransfer(row, "outgoing_transfer", "EUR", 2550);
    }

    @Test
    public void unitedStatesSentWireAndPostedAchTransfersAreOutgoing() {
        String[][] rows = {
            {"Money sent", "You sent $25.50 to Alex Example"},
            {"Zelle payment sent", "You sent USD 25.50 to Alex Example"},
            {"Wire transfer sent", "$25.50\nBeneficiary: Alex Example"},
            {"ACH transfer posted", "$25.50\nRecipient: Alex Example"},
        };
        for (String[] row : rows) assertTransfer(row, "outgoing_transfer", "USD", 2550);
    }

    @Test
    public void executedEuropeanAndUnitedStatesAutomaticDebitsKeepTheirType() {
        String[][] rows = {
            {"Direct debit collected", "25.50 EUR\nCreditor: Alex Example"},
            {"Prélèvement SEPA effectué", "25,50 EUR\nCréancier: Alex Example"},
            {"Lastschrift abgebucht", "25,50 EUR\nGläubiger: Alex Example"},
            {"Adeudo domiciliado realizado", "25,50 EUR\nAcreedor: Alex Example"},
            {"Débito direto efetuado", "25,50 EUR\nCredor: Alex Example"},
            {"Addebito diretto eseguito", "25,50 EUR\nCreditore: Alex Example"},
            {"Automatische incasso uitgevoerd", "25,50 EUR\nIncassant: Alex Example"},
        };
        for (String[] row : rows) assertTransfer(row, "direct_debit", "EUR", 2550);
        assertTransfer(new String[] {"ACH debit posted", "$25.50\nPayee: Alex Example"}, "direct_debit", "USD", 2550);
    }

    @Test
    public void executedStandingOrdersKeepTheirSpecificType() {
        String[][] rows = {
            {"Standing order executed", "25.50 EUR to Alex Example"},
            {"Virement permanent exécuté", "25,50 EUR vers Alex Example"},
            {"Dauerauftrag ausgeführt", "25,50 EUR\nEmpfänger: Alex Example"},
            {"Orden permanente realizada", "25,50 EUR\nBeneficiario: Alex Example"},
            {"Transferência periódica efetuada", "25,50 EUR\nBeneficiário: Alex Example"},
            {"Bonifico periodico eseguito", "25,50 EUR\nBeneficiario: Alex Example"},
            {"Periodieke overboeking uitgevoerd", "25,50 EUR\nOntvanger: Alex Example"},
        };
        for (String[] row : rows) assertTransfer(row, "standing_order", "EUR", 2550);
    }

    @Test
    public void receivedMoneyIsNotConsumptionEvenWithRecipientOrNegativeAmount() {
        String[][] rows = {
            {"Transfer completed", "Alex has sent you USD 25.50"},
            {"ACH transfer posted", "Alex transferred USD 25.50 to your account"},
            {"ACH credit posted", "+$25.50 from employer"},
            {"Zelle payment", "Alex sent you $25.50"},
            {"Virement effectué", "Alex vous a envoyé 25,50 EUR"},
            {"Virement reçu", "-25,50 EUR\nBénéficiaire: Alex Example"},
            {"Überweisung eingegangen", "-25,50 EUR\nEmpfänger: Alex Example"},
            {"Transferencia recibida", "-25,50 EUR\nBeneficiario: Alex Example"},
            {"Transferência recebida", "-25,50 EUR\nBeneficiário: Alex Example"},
            {"Bonifico ricevuto", "-25,50 EUR\nBeneficiario: Alex Example"},
            {"Overboeking ontvangen", "-25,50 EUR\nOntvanger: Alex Example"},
            {"Transfer completed", "+25.50 EUR to Alex Example"},
        };
        for (String[] row : rows) assertNull(row[0] + " / " + row[1], parse(row, "USD", true));
    }

    @Test
    public void scheduledFailedAndReturnedInstructionsDoNotBecomeExpenses() {
        String[][] rows = {
            {"ACH transfer pending", "$25.50 to Alex Example"},
            {"Zelle payment request from Alex", "Pay $25.50 to Alex Example"},
            {"Wire transfer scheduled for tomorrow", "-$25.50 to Alex Example"},
            {"Wire transfer failed", "$25.50 to Alex Example"},
            {"ACH debit returned", "$25.50\nPayee: Alex Example"},
            {"Virement prévu", "25,50 EUR\nBénéficiaire: Alex Example"},
            {"Überweisung vorgemerkt", "-25,50 EUR\nEmpfänger: Alex Example"},
            {"Transferencia pendiente", "25,50 EUR\nBeneficiario: Alex Example"},
            {"Transferencia programada", "-25,50 EUR\nBeneficiario: Alex Example"},
            {"Transferência agendada", "-25,50 EUR\nBeneficiário: Alex Example"},
            {"Bonifico in attesa", "-25,50 EUR\nBeneficiario: Alex Example"},
            {"Bonifico da eseguire domani", "-25,50 EUR\nBeneficiario: Alex Example"},
            {"Overboeking gepland", "-25,50 EUR\nOntvanger: Alex Example"},
            {"Overboeking geweigerd", "-25,50 EUR\nOntvanger: Alex Example"},
        };
        for (String[] row : rows) assertNull(row[0], parse(row, "USD", true));
    }

    @Test
    public void unknownBankStillNeedsTrustAndAmountStillUsesTheReceipt() {
        JSONObject candidate = parse(new String[] {"Transfer completed", "USD 25.50 to Alex Example\nBalance USD 100.00"}, "USD", false);
        assertNotNull(candidate);
        assertEquals("review", candidate.optString("confidence"));
        assertEquals(2550, candidate.optLong("minorUnits"));
        assertEquals("Alex Example", candidate.optString("merchant"));
        assertEquals("outgoing_transfer", candidate.optString("eventType"));
        assertEquals("2026-09-29T11:32:00.000Z", candidate.optString("occurredAt"));
        assertEquals(candidate.optString("occurredAt"), candidate.optString("deliveredAt"));
    }

    @Test
    public void negatedCompletionIsNeverAnExecutedDebit() {
        String[] statuses = {
            "Transfer not completed", "Transfer has not been completed", "Transfer could not be sent",
            "ACH debit not posted", "Zelle payment was not successful", "Standing order not yet executed",
            "Virement non effectué", "Virement n'a pas été effectué", "Prélèvement pas encore débité",
            "Überweisung nicht ausgeführt", "Lastschrift noch nicht abgebucht",
            "Transferencia no realizada", "Transferencia no se ha realizado",
            "Transferência não efetuada", "Transferência não foi efetuada",
            "Bonifico non eseguito", "Bonifico non è stato eseguito",
            "Overboeking niet uitgevoerd", "Overboeking nog niet voltooid",
            "이체가 완료되지 않았습니다", "송금이 완료되지 않았어요", "자동이체가 출금되지 않았습니다",
        };
        for (String status : statuses) {
            for (String amount : new String[] {"25.50 EUR", "-25.50 EUR"}) {
                assertNull(status, parse(new String[] {status, amount + "\nRecipient: Alex Example"}, "EUR", true));
                assertNull(status, parse(new String[] {"Transfer update", status + "\n" + amount + "\nRecipient: Alex Example"}, "EUR", true));
            }
        }
        assertNull(parse(new String[] {"Transfer completed", "USD 25.50 to Alex Example\nStatus: not completed"}, "USD", true));
        assertNull(parse(new String[] {"Transfer completed", "Recipient: Alex Example - transfer not completed\nUSD 25.50"}, "USD", true));
    }

    @Test
    public void negationWordsInsideAnExplicitRecipientNameDoNotBlockACompletedTransfer() {
        for (String name : new String[] {"Not Executed Studio", "Non Eseguito Atelier", "Niet Uitgevoerd Studio"}) {
            JSONObject candidate = parse(new String[] {"Transfer completed", "25.50 EUR\nRecipient: " + name}, "EUR", true);
            assertNotNull(name, candidate);
            assertEquals(name, candidate.optString("merchant"));
            assertEquals("outgoing_transfer", candidate.optString("eventType"));
        }
    }

    private static JSONObject parse(String[] row, String currency, boolean trusted) {
        return PaymentNotificationParser.parse("com.example.syntheticbank", "Example Bank", row[0], row[1], "", "",
            POSTED_AT, "synthetic-international-transfer", trusted, false, currency);
    }

    private static void assertTransfer(String[] row, String type, String currency, long minorUnits) {
        JSONObject candidate = parse(row, currency, true);
        assertNotNull(row[0] + " / " + row[1], candidate);
        assertEquals(row[0], type, candidate.optString("eventType"));
        assertEquals(row[0], "Alex Example", candidate.optString("merchant"));
        assertEquals(row[0], "high", candidate.optString("confidence"));
        assertEquals(row[0], currency, candidate.optString("currency"));
        assertEquals(row[0], minorUnits, candidate.optLong("minorUnits"));
        assertFalse(candidate.optBoolean("requiresMerchant"));
    }
}
