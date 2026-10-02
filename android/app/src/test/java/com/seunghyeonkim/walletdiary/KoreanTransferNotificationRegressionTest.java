package com.seunghyeonkim.walletdiary;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

import org.json.JSONObject;
import org.junit.Test;

/** Synthetic notification layouts, not captured customer or bank messages. */
public class KoreanTransferNotificationRegressionTest {

    private static final long POSTED_AT = 1_790_681_520_000L;

    @Test
    public void debitAlertWithRecipientIsAnOutgoingTransferWithoutTransferVerb() {
        JSONObject event = parse("com.kbstar.kbbank", "KB국민은행", "출금 알림",
            "09/29 15:42\n출금 12,000원\n받는 분: 테스트수취인\n잔액 188,000원", true);
        assertTransfer(event, "outgoing_transfer", "테스트수취인", 12_000L, "high");
    }

    @Test
    public void genericDepositWithdrawalTitleDoesNotCancelExplicitDebitDirection() {
        JSONObject event = parse("com.kbstar.kbbank", "KB국민은행", "입출금 알림",
            "거래구분: 출금\n출금액: 23,400원\n받는 분: 테스트수취인\n잔액: 100,000원", true);
        assertTransfer(event, "outgoing_transfer", "테스트수취인", 23_400L, "high");
    }

    @Test
    public void slashSeparatedDepositWithdrawalServiceTitleDoesNotMeanIncome() {
        JSONObject event = parse("com.kbstar.kbbank", "KB국민은행", "입금/출금 알림",
            "출금액: 23,400원\n받는 분: 테스트수취인\n잔액: 100,000원", true);
        assertTransfer(event, "outgoing_transfer", "테스트수취인", 23_400L, "high");
    }

    @Test
    public void destinationBankAndAccountAreNotAnIncomingDeposit() {
        JSONObject event = parse("com.kebhana.hanapush", "하나은행", "이체 완료",
            "이체금액: 23,400원\n받는 분: 테스트수취인\n입금은행: 테스트은행\n입금계좌: ***-***-0000\n잔액: 100,000원", true);
        assertTransfer(event, "outgoing_transfer", "테스트수취인", 23_400L, "high");
    }

    @Test
    public void inlineDestinationMetadataDoesNotBecomeRecipientName() {
        JSONObject event = parse("com.kebhana.hanapush", "하나은행", "이체 완료",
            "출금액 23,400원 / 받는 분 테스트수취인 / 입금은행 테스트은행 / 입금계좌 ***-***-0000 / 잔액 100,000원", true);
        assertTransfer(event, "outgoing_transfer", "테스트수취인", 23_400L, "high");
    }

    @Test
    public void depositAccountHolderLabelIdentifiesRecipientOfCompletedTransfer() {
        JSONObject event = parse("com.kebhana.hanapush", "하나은행", "송금 완료",
            "송금금액: 35,000원\n입금계좌 예금주: 테스트수취인\n입금은행: 테스트은행", true);
        assertTransfer(event, "outgoing_transfer", "테스트수취인", 35_000L, "high");
    }

    @Test
    public void directDebitRemainsSpecificEvenUnderDepositWithdrawalAlertHeading() {
        JSONObject event = parse("com.kbstar.kbbank", "KB국민은행", "입출금 알림",
            "거래내용: 자동이체 출금 완료\n출금액: 55,000원\n납부처: 테스트통신\n잔액: 145,000원", true);
        assertTransfer(event, "direct_debit", "테스트통신", 55_000L, "high");
    }

    @Test
    public void standingOrderRemainsSpecificWithDestinationDepositLabels() {
        JSONObject event = parse("com.kebhana.hanapush", "하나은행", "정기이체 출금 완료",
            "출금액: 700,000원\n받는 사람: 테스트임대인\n입금은행: 테스트은행\n입금계좌: ***-***-0000", true);
        assertTransfer(event, "standing_order", "테스트임대인", 700_000L, "high");
    }

    @Test
    public void newlyDiscoveredKoreanBankTransferIsAvailableForReview() {
        JSONObject event = parse("kr.example.syntheticbank", "테스트은행", "입출금 알림",
            "출금 12,000원\n수취인: 테스트수취인\n입금은행: 테스트은행", false);
        assertTransfer(event, "outgoing_transfer", "테스트수취인", 12_000L, "review");
    }

    @Test
    public void adjacentWithdrawalAmountAndBalanceRemainSeparate() {
        JSONObject event = parse("com.kbstar.kbbank", "KB국민은행", "입출금 알림",
            "출금12,000원\n받는 분: 테스트수취인\n잔액188,000원", true);
        assertTransfer(event, "outgoing_transfer", "테스트수취인", 12_000L, "high");
    }

    @Test
    public void adjacentTransferAmountUsesCompletionAndRecipientEvidence() {
        JSONObject event = parse("com.kebhana.hanapush", "하나은행", "이체 완료",
            "이체금액12,000원\n받는 분: 테스트수취인\n입금은행: 테스트은행\n잔액188,000원", true);
        assertTransfer(event, "outgoing_transfer", "테스트수취인", 12_000L, "high");
    }

    @Test
    public void adjacentBalanceOnlyIsNotAnOutgoingAmount() {
        assertNull(parse("com.kbstar.kbbank", "KB국민은행", "이체 완료",
            "받는 분: 테스트수취인\n잔액188,000원", true));
    }

    @Test
    public void actualDepositDirectionWinsOverDestinationAndWithdrawalAccountLabels() {
        assertNull(parse("com.kebhana.hanapush", "하나은행", "이체 완료",
            "거래구분: 입금\n이체금액12,000원\n출금계좌: ***-***-0000\n받는 분: 테스트예금주\n입금은행: 테스트은행\n입금계좌: ***-***-1111\n잔액212,000원", true));
    }

    @Test
    public void withdrawalAccountMetadataAloneDoesNotProveExecution() {
        assertNull(parse("com.kebhana.hanapush", "하나은행", "이체 안내",
            "이체금액12,000원\n출금계좌: ***-***-0000\n받는 분: 테스트수취인\n입금은행: 테스트은행\n입금계좌: ***-***-1111", true));
    }

    @Test
    public void destinationLabelsDoNotMaskActualIncomingTransactions() {
        String[][] fixtures = {
            {"입출금 알림", "입금 12,000원\n보낸 분: 테스트송금인\n잔액 212,000원"},
            {"이체 완료", "거래구분: 입금\n입금금액: 12,000원\n받는 분: 테스트예금주\n입금은행: 테스트은행"},
            {"송금 받음", "테스트송금인에게서 12,000원을 받았습니다\n입금계좌: ***-***-0000"},
        };
        for (String[] fixture : fixtures) {
            assertNull(fixture[0] + " / " + fixture[1], parse("com.kbstar.kbbank", "KB국민은행", fixture[0], fixture[1], true));
        }
    }

    @Test
    public void excludesInternalPlannedFailedAndReturnedTransfers() {
        String[][] fixtures = {
            {"이체 완료", "내 계좌 간 이체\n출금 12,000원\n받는 분: 테스트예금주\n입금은행: 테스트은행"},
            {"예약이체 등록", "출금 예정금액: 12,000원\n받는 분: 테스트수취인\n입금은행: 테스트은행"},
            {"자동이체 출금 예정", "내일 출금 12,000원\n납부처: 테스트통신"},
            {"이체 실패", "출금 요청금액: 12,000원\n받는 분: 테스트수취인\n입금은행: 테스트은행"},
            {"자동이체 출금 거절", "출금액: 12,000원\n납부처: 테스트통신"},
            {"정기이체 반환", "출금액: 12,000원\n받는 분: 테스트수취인"},
        };
        for (String[] fixture : fixtures) {
            assertNull(fixture[0], parse("com.kebhana.hanapush", "하나은행", fixture[0], fixture[1], true));
        }
    }

    @Test
    public void excludesBalancesAndWithdrawalWithoutTransferEvidence() {
        String[][] fixtures = {
            {"잔액 알림", "출금 가능 잔액 188,000원"},
            {"출금 알림", "출금 12,000원\n잔액 188,000원"},
            {"출금 알림", "ATM 현금출금 12,000원\n잔액 188,000원"},
            {"출금 알림", "출금 12,000원\n적요: CD현금\n잔액 188,000원"},
            {"이체 안내", "이체금액: 12,000원\n출금계좌: ***-***-0000\n받는 분: 테스트수취인"},
        };
        for (String[] fixture : fixtures) {
            assertNull(fixture[0] + " / " + fixture[1], parse("com.kbstar.kbbank", "KB국민은행", fixture[0], fixture[1], true));
        }
    }

    private static JSONObject parse(String packageName, String sourceName, String title, String body, boolean configured) {
        return PaymentNotificationParser.parse(packageName, sourceName, title, body, "", "", POSTED_AT,
            "synthetic-transfer-regression", configured, false, "KRW");
    }

    @Test
    public void withdrawalRequestAndWaitingAreNotPostedDebits() {
        for (String title : new String[] {"출금 요청", "출금 대기", "이체 요청", "송금 대기"}) {
            assertNull(title, parse("com.kbstar.kbbank", "KB국민은행", title,
                "출금액: 12,000원\n받는 분: 테스트수취인", true));
        }
    }

    @Test
    public void withdrawingAccountOwnerDoesNotProveAnOutgoingTransfer() {
        assertNull(parse("com.kbstar.kbbank", "KB국민은행", "출금 알림",
            "출금 12,000원\n예금주: 테스트예금주\n잔액 188,000원", true));
    }

    @Test
    public void cardPurchaseWithWithdrawalMetadataRemainsPurchase() {
        for (String title : new String[] {"체크카드 결제 승인", "결제 승인", "사용 승인"}) {
            JSONObject event = parse("com.synthetic.card", "신한카드", title,
                "가맹점명: 카페 봄\n출금금액: 12,000원\n잔액: 188,000원", true);
            assertNotNull(title, event);
            assertEquals(title, "purchase", event.optString("eventType"));
            assertEquals(title, "카페 봄", event.optString("merchant"));
            assertEquals(title, 12_000L, event.optLong("minorUnits"));
            assertEquals(title, "high", event.optString("confidence"));
        }
    }

    private static void assertTransfer(JSONObject event, String type, String counterparty, long amount, String confidence) {
        assertNotNull("The explicit outgoing transfer must produce a candidate", event);
        assertEquals(type, event.optString("eventType"));
        assertEquals(counterparty, event.optString("merchant"));
        assertEquals(amount, event.optLong("minorUnits"));
        assertEquals("KRW", event.optString("currency"));
        assertEquals(confidence, event.optString("confidence"));
        assertFalse(event.optBoolean("requiresMerchant"));
        assertFalse(event.has("text"));
        assertFalse(event.has("notificationKey"));
    }
}
