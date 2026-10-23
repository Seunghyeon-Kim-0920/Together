package com.seunghyeonkim.walletdiary;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

import org.json.JSONObject;
import org.junit.Test;

/** Synthetic authorization challenges, not captured bank/customer notifications. */
public class PaymentAuthorizationRequestRegressionTest {
    private static final long TIME = 1_792_670_400_000L;

    @Test public void verificationChallengeNeverBecomesAnExpenseOrReviewCandidate() {
        // Same notification structure as the reported problem, synthetic details only.
        for (boolean trusted : new boolean[] {false, true}) {
            for (String title : new String[] {"Verify a payment", "Verify your online card payment", "Card payment"}) {
                assertNull(parse(title, "You’re making an online card payment of €12.34 to Example Charity. Tap to verify",
                    "", "", "EUR", trusted));
            }
            assertNull(parse("Verify a payment", "You're making an online card payment of €12.34 to Example Charity. Tap to …",
                "", "", "EUR", trusted));
        }
        for (String request : new String[] {"Verify a payment", "Please verify", "Verification required",
            "Payment needs verification", "Payment needs to be verified", "Open the app to verify",
            "Tap to verify", "To verify, open the app", "Payment awaiting your verification"}) {
            assertRejected(request, "Merchant: Example Market\nEUR 12.34", "EUR");
        }
    }

    @Test public void verificationInEveryNotificationFieldVetoesSignedAndTrustedPayments() {
        for (String request : new String[] {"Verify a payment", "Tap to verify", "Vérifiez votre paiement"}) {
            for (int placement = 0; placement < 4; placement++) {
                assertNull(parse(placement == 0 ? request : "Card payment",
                    "Merchant: Example Market\n-12.34 EUR" + (placement == 1 ? "\n" + request : ""),
                    placement == 2 ? request : "", placement == 3 ? request : "", "EUR", true));
            }
        }
    }

    @Test public void requestsForPaymentOrMoneyAreNotExecutedTransactions() {
        for (String request : new String[] {
            "Payment request", "New payment request from Alex Example", "Alex Example requested a payment",
            "Payment requested", "Alex Example requests payment", "Zahlungsfreigabe erforderlich", "決済承認のお願い",
            "Request to pay", "Request for payment", "Money request", "Please pay EUR 12.34",
            "You have been asked to pay", "You're about to pay", "You’re making an online card payment",
            "Invoice due", "Payment due tomorrow", "Payment reminder", "Upcoming card payment",
            "결제 요청", "송금 요청", "이체 요청", "결제 요청이 도착했습니다", "납부 안내", "결제 예정",
            "송금해주세요", "이체해 주세요", "결제 청구서", "결제하려면 확인해 주세요",
            "Demande de paiement", "Demande de virement", "Veuillez payer", "Paiement à effectuer",
            "Rappel de paiement", "Facture à payer", "Vous êtes sur le point de payer",
            "Zahlungsanforderung", "Zahlungsaufforderung", "Bitte bezahlen", "Zahlung fällig",
            "Solicitud de pago", "Solicitud de transferencia", "Por favor paga", "Pago pendiente",
            "Solicitação de pagamento", "Pedido de pagamento", "Por favor pague", "Pagamento pendente",
            "Richiesta di pagamento", "Richiesta di bonifico", "Pagamento da effettuare",
            "Betaalverzoek", "Betalingsverzoek", "Betaling in behandeling",
            "支払いリクエスト", "送金リクエスト", "支払いを承認してください", "お支払い予定",
            "付款请求", "转账请求", "请确认付款", "请批准此交易", "支付待确认",
            "付款請求", "轉帳請求", "請確認付款", "請批准此交易", "支付待確認"
        }) assertRejected(request, "Merchant: Example Market\n-12.34 EUR", "EUR");
    }

    @Test public void verificationRequestsAreRecognizedAcrossLanguagesWithoutAppAllowLists() {
        for (String request : new String[] {
            "Vérifiez votre paiement", "Verifier le paiement", "Vérification requise", "Appuyez pour vérifier",
            "Überprüfen Sie Ihre Zahlung", "Zahlung überprüfen", "Verifica tu pago", "Verifique el pago",
            "Verifique o pagamento", "Verifica il pagamento", "Controleer je betaling",
            "결제를 인증해 주세요", "거래 확인 요청", "お支払いを確認してください", "取引を認証してください",
            "決済の承認が必要です", "请验证付款", "請驗證付款", "付款需要验证", "付款需要驗證"
        }) assertRejected(request, "Merchant: Example Market\nEUR 12.34", "EUR");
    }

    @Test public void realReceiptsWithVerificationWordsOrRequestNamedMerchantsRemainAvailable() {
        for (String merchant : new String[] {"Verify Café", "Verification Studio", "Betaalverzoek Café"}) {
            assertPurchase("Card payment completed", "Merchant: " + merchant + "\nEUR 12.34", merchant, "EUR", 1234L);
        }
        // The existing merchant normalizer trims payment words; this test
        // asserts only that the new request gate does not discard the receipt.
        assertNotNull(parse("Card payment completed", "Merchant: Payment Request Café\nEUR 12.34", "", "", "EUR", true));
        for (String footer : new String[] {"No verification required", "You do not need to verify this payment",
            "Aucune vérification requise", "Aucune vérification nécessaire"}) {
            assertNotNull(parse("Card payment completed", "Merchant: Example Market\nEUR 12.34\n" + footer, "", "", "EUR", true));
            assertNull(parse("Verify a payment", "Merchant: Example Market\nEUR 12.34", footer, "", "EUR", true));
        }
        for (String title : new String[] {"Payment verified", "Invoice paid", "Payment request paid", "Paiement effectué",
            "Pago realizado", "Pagamento efetuado", "Pagamento eseguito", "Betaling uitgevoerd",
            "支払い完了", "支付成功", "付款完成", "결제 완료"}) {
            assertNotNull(title, parse(title, "Merchant: Example Market\n-12.34 EUR", "", "", "EUR", true));
        }
    }

    @Test public void koreanActionRequiredIsNotAPaymentEvenForTrustedSources() {
        for (String request : new String[] {
            "결제를 승인해주세요", "결제를 승인해 주세요", "결제를 승인해야 합니다",
            "결제 승인을 해주세요", "결제 승인 필요", "승인이 필요합니다", "승인해 주세요",
            "앱에서 결제를 확인하세요", "결제를 승인하시겠어요?", "결제를 승인하시겠습니까?",
            "결제를 완료하려면 앱을 열어주세요", "요청된 결제를 확인해 주세요",
            "결제 승인이 필요해요", "카드 결제 확인이 필요합니다", "승인 요청이 도착했습니다",
            "승인하기", "결제에 동의가 필요합니다", "결제를 승인해주셔야 합니다",
            "결제를 진행하시겠습니까?", "승인을 기다리고 있습니다",
            "결제 승인을 위해 앱을 열어주세요", "결제 승인 버튼을 눌러주세요"
        }) {
            assertRejected(request, "가맹점: 예시상점\n12,000원", "KRW");
        }
    }

    @Test public void englishImperativesAndApprovalRequirementsAreNotReceipts() {
        for (String request : new String[] {
            "Approve your payment", "Please approve this card payment", "Confirm this purchase",
            "Authorize your transaction", "Payment approval required", "Approval required",
            "You need to approve this payment", "Payment awaiting your approval", "Tap to approve",
            "Open the app to confirm your purchase", "Confirm payment", "Confirm your €12.34 payment",
            "Please approve", "Do you want to approve this payment?", "Action required: card payment",
            "Payment authorization request", "Complete your payment", "Payment requires confirmation",
            "Awaiting your approval", "Waiting for confirmation", "Payment to approve", "Approve or decline",
            "Open the app to approve", "Open your banking app and confirm",
            "Confirm EUR 12.34 at Example Market", "To approve, open your banking app", "Payment needs to be approved"
        }) {
            assertRejected(request, "Merchant: Example Market\nEUR 12.34", "EUR");
        }
    }

    @Test public void frenchImperativesAreDifferentFromValideCompletion() {
        for (String request : new String[] {
            "Validez votre paiement", "Veuillez confirmer ce paiement", "Autorisez votre achat",
            "Paiement à valider", "Paiement à confirmer", "Validation requise", "Confirmation nécessaire",
            "Ouvrez l'application pour valider votre paiement", "Merci de valider", "Confirmez votre achat",
            "Vous devez valider ce paiement", "Valider le paiement", "Autorisation demandée",
            "Validez votre paiement de 12,34 €", "Pour finaliser votre paiement, confirmez dans l'application",
            "Appuyez pour confirmer", "Cliquez ici pour valider"
        }) {
            assertRejected(request, "Commerçant : Marché Exemple\n12,34 €", "EUR");
        }
    }

    @Test public void europeanRequestGrammarIsRejectedWithoutPackageAllowLists() {
        for (String request : new String[] {
            "Bitte bestätigen Sie diese Zahlung", "Zahlung freigeben", "Freigabe erforderlich",
            "Bestätigen Sie Ihre Kartenzahlung", "Confirma este pago", "Autoriza tu compra",
            "Autorización requerida", "Confirme o pagamento", "Autorize esta compra",
            "Autorização necessária", "Conferma il pagamento", "Autorizza questo acquisto",
            "Autorizzazione richiesta", "Bevestig je betaling", "Bevestiging vereist"
        }) assertRejected(request, "Merchant: Example Market\nEUR 12.34", "EUR");
    }

    @Test public void signedAmountOrApprovalReceiptHeadingCannotOverrideChallengeBody() {
        for (String request : new String[] {"승인해 주세요", "Tap to approve", "Validez votre paiement"}) {
            assertRejected("[승인] EUR 12.34", "Example Market\n-12.34 EUR\n" + request, "EUR");
            assertRejected("Card payment", "Example Market\n-12.34 EUR\n" + request, "EUR");
        }
    }

    @Test public void requestWithoutMerchantStillProducesNoReviewCandidate() {
        assertRejected("Approve your payment", "EUR 12.34", "EUR");
        assertRejected("결제 알림", "12,000원 결제를 승인해야 합니다", "KRW");
        assertRejected("Paiement", "12,34 €\nVeuillez confirmer", "EUR");
    }

    @Test public void collapsedExpandedSubtextAndLineBreaksAllHonorRequestVeto() {
        for (String request : new String[] {"Approve\nyour payment", "결제를\n승인해 주세요", "Validez\nvotre paiement"}) {
            for (int placement = 0; placement < 4; placement++) {
                String title = placement == 0 ? request : "Card payment";
                String text = "Merchant: Example Market\nEUR 12.34" + (placement == 1 ? "\n" + request : "");
                assertNull(request + " field " + placement, parse(title, text,
                    placement == 2 ? request : "", placement == 3 ? request : "", "EUR", true));
            }
        }
    }

    @Test public void requestIsExcludedRegardlessOfWhetherSourceIsTrusted() {
        for (boolean trusted : new boolean[] {false, true}) {
            assertNull(parse("Approve your payment", "Example Market\nEUR 12.34", "", "", "EUR", trusted));
        }
        for (String source : new String[] {"Swile", "travel Wallet", "하나카드", "KB국민카드", "신한카드", "Samsung Pay", "Google Wallet", "Synthetic Bank"}) {
            assertNull(source, PaymentNotificationParser.parse("com.example.synthetic", source,
                "Card payment", "Example Market\nEUR 12.34\nPlease approve this payment",
                "", "", TIME, "synthetic-request", true, false, "EUR"));
        }
    }

    @Test public void requestThenCompletionWithSameNotificationIdentityStillRecordsCompletion() {
        assertNull(parse("Verify a payment", "You’re making an online card payment of €12.34 to Example Market. Tap to verify", "", "", "EUR", true));
        assertPurchase("Payment completed", "Merchant: Example Market\nEUR 12.34", "Example Market", "EUR", 1234L);
        assertNull(parse("Approve your payment", "Merchant: Example Market\nEUR 12.34", "", "", "EUR", true));
        assertPurchase("Payment approved", "Merchant: Example Market\nEUR 12.34", "Example Market", "EUR", 1234L);
        assertNull(parse("Validez votre paiement", "Commerçant : Marché Exemple\n12,34 €", "", "", "EUR", true));
        assertPurchase("Paiement validé", "Commerçant : Marché Exemple\n12,34 €", "Marché Exemple", "EUR", 1234L);
    }

    @Test public void completedReceiptsStillKeepMerchantAndAmount() {
        for (String title : new String[] {"Payment approved", "Payment confirmed", "Payment authorized", "Card payment completed",
            "Paiement validé", "Paiement confirme", "Paiement autorisé", "Paiement valide",
            "Zahlung bestätigt", "Pago confirmado", "Pagamento confermato"}) {
            assertPurchase(title, "Merchant: Example Market\nEUR 12.34", "Example Market", "EUR", 1234L);
        }
        assertPurchase("[승인] 12,000원", "예시상점\n10/22 12:34 | 예시카드(0000)", "예시상점", "KRW", 12000L);
        assertPurchase("카드 결제 승인", "가맹점: 예시상점\n12,000원", "예시상점", "KRW", 12000L);
        // A compact completed card alert does not have to contain a payment verb.
        assertPurchase("Example Market", "-12.34 EUR", "Example Market", "EUR", 1234L);
    }

    @Test public void merchantNamesContainingActionWordsAreNotRequests() {
        for (String merchant : new String[] {"Confirm Café", "Approve Studio", "Valider Boutique", "Café Validé"}) {
            assertPurchase("Card payment completed", "Merchant: " + merchant + "\nEUR 12.34", merchant, "EUR", 1234L);
        }
    }

    @Test public void completedSentTransfersAndReversalsRemainSupported() {
        JSONObject transfer = parse("Transfer completed", "You sent EUR 12.34 to Alex Example", "", "", "EUR", true);
        assertNotNull(transfer);
        assertEquals("outgoing_transfer", transfer.optString("eventType"));
        JSONObject reversal = parse("Payment refunded", "Merchant: Example Market\nEUR 12.34", "", "", "EUR", true);
        assertNotNull(reversal);
        assertEquals("reversal", reversal.optString("eventType"));
    }

    @Test public void completedCancellationWithAmountInTitleKeepsTheBodyMerchant() {
        for (String title : new String[] {"[취소] EUR 12.34", "Card payment reversed EUR 12.34",
            "Paiement annulé 12,34 €", "Pago cancelado EUR 12.34"}) {
            JSONObject reversal = parse(title, "Example Market\n10/22 12:34 | 예시카드(0000)", "", "", "EUR", true);
            assertNotNull(title, reversal);
            assertEquals(title, "reversal", reversal.optString("eventType"));
            assertEquals(title, "Example Market", reversal.optString("merchant"));
            assertEquals(title, "high", reversal.optString("confidence"));
        }
        assertNull(parse("Refund requested", "Merchant: Example Market\nEUR 12.34", "", "", "EUR", true));
        assertNull(parse("결제 취소 요청", "Example Market\nEUR 12.34", "", "", "EUR", true));
    }

    @Test public void aRequestedPaymentThenReceiptAndSeparateCancellationHaveCorrectStates() {
        String packageName = "com.example.syntheticbank";
        assertNull(PaymentNotificationParser.parse(packageName, "Synthetic Bank", "Verify a payment",
            "You’re making an online card payment of €12.34 to Example Market. Tap to verify",
            "", "", TIME, "request-id", true, false, "EUR"));
        JSONObject paid = PaymentNotificationParser.parse(packageName, "Synthetic Bank", "Card payment",
            "You paid EUR 12.34 at Example Market", "", "", TIME + 60_000, "payment-id", true, false, "EUR");
        JSONObject cancelled = PaymentNotificationParser.parse(packageName, "Synthetic Bank", "Card payment reversed",
            "EUR 12.34 at Example Market", "", "", TIME + 120_000, "cancellation-id", true, false, "EUR");
        assertNotNull(paid);
        assertNotNull(cancelled);
        assertEquals("purchase", paid.optString("eventType"));
        assertEquals("reversal", cancelled.optString("eventType"));
        assertEquals("high", paid.optString("confidence"));
        assertEquals("high", cancelled.optString("confidence"));
        assertEquals(paid.optString("merchant"), cancelled.optString("merchant"));
        assertEquals(paid.optLong("minorUnits"), cancelled.optLong("minorUnits"));
    }

    @Test public void explicitNonApprovalCannotBecomeAReceipt() {
        for (String title : new String[] {"Payment not approved", "Payment not yet authorized", "Your payment has not been confirmed",
            "Paiement non validé", "Paiement pas encore confirmé", "결제가 승인되지 않았습니다"}) {
            assertRejected(title, "Merchant: Example Market\n-12.34 EUR", "EUR");
        }
    }

    @Test public void aNegatedActionRequirementIsNotAChallenge() {
        for (String footer : new String[] {"No action required", "No approval required", "No further confirmation is needed",
            "You do not need to approve this payment", "Aucune confirmation nécessaire", "Keine Freigabe erforderlich",
            "Nessuna autorizzazione richiesta", "Geen bevestiging vereist", "추가 승인이 필요하지 않습니다"}) {
            JSONObject receipt = parse("Card payment completed", "Merchant: Example Market\nEUR 12.34\n" + footer,
                "", "", "EUR", true);
            assertNotNull(footer, receipt);
            assertEquals(footer, "purchase", receipt.optString("eventType"));
            assertEquals(footer, 1234L, receipt.optLong("minorUnits"));
            // An innocuous footer must not suppress a challenge in another field.
            assertNull(footer, parse("Approve your payment", "Merchant: Example Market\nEUR 12.34",
                footer, "", "EUR", true));
        }
    }

    @Test public void viewingOrReportingACompletedTransactionDoesNotRequireApproval() {
        for (String footer : new String[] {"Tap to view details", "Verify receipt details in the app", "Vérifiez les détails dans l’application",
            "If you do not recognize this payment, please verify it with the merchant.", "Please verify receipt details in the app",
            "Veuillez vérifier les détails dans l’application",
            "If you don't recognize this payment, contact support.",
            "결제 상세 내역은 앱에서 확인할 수 있습니다.", "Consultez les détails dans l'application.",
            "자세한 이용 내역은 앱에서 확인하세요.", "상세 내역을 확인해 주세요.",
            "이용 내역 확인하기", "결제 내역을 앱에서 확인하세요."}) {
            // Existing merchant ambiguity rules may still request review; a
            // viewing/help footer itself is not an authorization challenge.
            JSONObject result = parse("Card payment completed", "Merchant: Example Market\nEUR 12.34\n" + footer,
                "", "", "EUR", true);
            assertNotNull(footer, result);
            assertEquals(footer, "purchase", result.optString("eventType"));
            assertEquals(footer, 1234L, result.optLong("minorUnits"));
        }
    }

    private static void assertRejected(String title, String text, String currency) {
        assertNull(title, parse(title, text, "", "", currency, true));
    }

    private static void assertPurchase(String title, String text, String merchant, String currency, long amount) {
        JSONObject result = parse(title, text, "", "", currency, true);
        assertNotNull(title, result);
        assertEquals(title, "purchase", result.optString("eventType"));
        assertEquals(title, "high", result.optString("confidence"));
        assertEquals(title, merchant, result.optString("merchant"));
        assertEquals(title, currency, result.optString("currency"));
        assertEquals(title, amount, result.optLong("minorUnits"));
        assertEquals(title, "2026-10-22T12:00:00.000Z", result.optString("occurredAt"));
    }

    private static JSONObject parse(String title, String text, String bigText, String subText, String currency, boolean trusted) {
        return PaymentNotificationParser.parse("com.example.synthetic", "Synthetic Card", title, text, bigText, subText,
            TIME, "synthetic-authorization", trusted, false, currency);
    }
}
