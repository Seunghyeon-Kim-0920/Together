import assert from "node:assert/strict";
import test from "node:test";
import { iosSourcePackageName, normalizeIosTransactionInput, parseIosTransactionInput, type IosTransactionInput } from "../src/lib/iosTransactionInput";
import { applyHighConfidenceCardAutomation, parseNativeCardCandidate } from "../src/lib/cardAutomation";
import { createLedger } from "../src/lib/wallet";
import type { GeneralLedger, WalletState } from "../src/lib/types";

// Entirely invented fixtures. No real messages, account IDs or transactions.
const receivedAt = new Date(2026, 9, 26, 16, 0, 0).getTime();
const base: IosTransactionInput = { id: "ios-synthetic-1", queueToken: "revision-1", kind: "notification", sourceName: "Example Bank", receivedAt };
const parse = (body: string, extra: Partial<IosTransactionInput> = {}) => parseIosTransactionInput({ ...base, body, ...extra });

test("iOS raw envelopes are strictly bounded and cannot inject candidate confidence or package", () => {
  for (const changes of [{ id: "" }, { queueToken: "" }, { kind: "sms" }, { receivedAt: -1 }, { receivedAt: NaN }, { receivedAt: "2026-10-26" }, { receivedAt: 8.64e15 + 1 }, { body: "x".repeat(8001) }, { sourceName: "x".repeat(81) }, { body: "a\0b" }, { amount: 5 }, { currency: "EURO" }]) {
    assert.equal(normalizeIosTransactionInput({ ...base, body: "Paid EUR 5 at Example Cafe", ...changes }), null);
  }
  assert.equal(normalizeIosTransactionInput(base), null);
  const candidate = parseIosTransactionInput({ ...base, body: "Paid EUR 5 at Example Cafe", packageName: "com.bank.real", confidence: "high", categoryHint: "food" });
  assert.ok(candidate); assert.ok(candidate.packageName.startsWith("walletdiary.ios.notification.s"));
  assert.equal(candidate.categoryHint, undefined);
  assert.ok(parseNativeCardCandidate(candidate));
});

test("source identities are stable, separated by channel and cannot impersonate native Android packages", () => {
  assert.equal(iosSourcePackageName("notification", "ＥＸＡＭＰＬＥ Bank"), iosSourcePackageName("notification", "example bank"));
  assert.equal(iosSourcePackageName("notification", " Example\u200b Bank "), iosSourcePackageName("notification", "example bank"));
  assert.notEqual(iosSourcePackageName("message", "Example Bank"), iosSourcePackageName("notification", "Example Bank"));
  assert.notEqual(iosSourcePackageName("message", "예시은행"), iosSourcePackageName("message", "다른은행"));
  assert.match(iosSourcePackageName("message", "예시은행 🍎"), /^walletdiary\.ios\.message\.s[0-9a-f]{32}$/u);
  assert.equal(iosSourcePackageName("notification", "Revolut"), "walletdiary.ios.notification.s400b64a86941f24e0fac06e2c122736e");
  assert.equal(iosSourcePackageName("notification", "예시은행 🍎"), "walletdiary.ios.notification.s7710399480b2eaa2976459e6ccf85652");
  assert.equal(iosSourcePackageName("wallet", "Anything"), "walletdiary.ios.wallet");
});

test("Korean approval receipt keeps merchant, amount and date while ignoring cumulative spend", () => {
  const candidate = parse("[Web발신]\n[재발송]삼성가족1234 승인 이*시\n43,200원 일시불\n10/26 10:48 예시병원\n누적647,944원", { kind: "message", sourceName: "Example Card" });
  assert.ok(candidate); assert.equal(candidate.minorUnits, 43200); assert.equal(candidate.currency, "KRW");
  assert.equal(candidate.merchant, "예시병원"); assert.equal(candidate.confidence, "high"); assert.equal(candidate.eventType, "purchase");
  assert.equal(candidate.occurredOn, "2026-10-26");
});

test("merchant line after Korean approval amount is not replaced by card metadata or balance", () => {
  const candidate = parse("EXAMPLE MARKET\n10/26 15:52 | 예시페이(1234)\n잔액 EUR 1.82", { title: "[승인] EUR 1.39" });
  assert.ok(candidate); assert.equal(candidate.minorUnits, 139); assert.equal(candidate.merchant, "EXAMPLE MARKET");
});

test("French status validé never becomes the merchant", () => {
  const candidate = parse("Café Exemple\n6,94 €", { title: "Paiement validé", sourceName: "Example Meal Card" });
  assert.ok(candidate); assert.equal(candidate.merchant, "Café Exemple"); assert.equal(candidate.minorUnits, 694); assert.equal(candidate.confidence, "high");
  const missing = parse("6,94 €", { title: "Paiement validé" });
  assert.ok(missing); assert.equal(missing.merchant, ""); assert.equal(missing.requiresMerchant, true); assert.equal(missing.confidence, "review");
});

test("English and French completed receipts extract their merchant", () => {
  for (const [body, merchant, minorUnits] of [
    ["Paid EUR 12.34 at Example Cafe", "Example Cafe", 1234],
    ["You spent GBP 8.20 at Example Books. Balance GBP 52.00", "Example Books", 820],
    ["Vous avez payé 8,90 € chez Café Exemples", "Café Exemples", 890],
    ["Payment completed\nMerchant: Example Store\nUSD 19.95", "Example Store", 1995],
  ] as const) {
    const candidate = parse(body); assert.ok(candidate, body); assert.equal(candidate.eventType, "purchase", body);
    assert.equal(candidate.merchant, merchant, body); assert.equal(candidate.minorUnits, minorUnits, body); assert.equal(candidate.confidence, "high", body);
  }
});

test("grouped amounts are exact integers and malformed/overflow/ambiguous dollar amounts are not guessed", () => {
  for (const [amount, currency, minorUnits] of [["1,234.56", "EUR", 123456], ["1.234,56", "EUR", 123456], ["1\u202f234,56", "EUR", 123456], ["43,200", "KRW", 43200], ["1.234", "KWD", 1234]] as const) {
    const candidate = parse(`Paid ${currency} ${amount} at Example Cafe`); assert.ok(candidate, amount); assert.equal(candidate.minorUnits, minorUnits, amount);
  }
  for (const body of ["Paid EUR 12,34.56 at Example Cafe", "Paid EUR 1 23 at Example Cafe", "Paid KRW 1.20 at Example Cafe", "Paid EUR 99999999999999999 at Example Cafe", "Paid $20 at Example Cafe", "Paid XYZ 20 at Example Cafe", "Paid EUR 0 at Example Cafe"]) assert.equal(parse(body), null, body);
});

test("negative debit amount is accepted, positive credit does not become purchase", () => {
  assert.equal(parse("Paid EUR -5.25 at Example Cafe")?.minorUnits, 525);
  assert.equal(parse("Paid -5,25 € at Example Cafe")?.minorUnits, 525);
  assert.equal(parse("Paid +5,25 € at Example Cafe"), null);
  assert.equal(parse("Paid + EUR 5.25 at Example Cafe"), null);
});

test("balances and limits are ignored even on the same line as debit amount", () => {
  assert.equal(parse("Paid EUR 10.00 at Example Cafe; balance EUR 90.00")?.minorUnits, 1000);
  const korean = parse("결제 완료\n사용처: 예시카페\n결제 14,000원 잔액 45,205원\n누적 99,000원");
  assert.equal(korean?.minorUnits, 14000); assert.equal(korean?.merchant, "예시카페");
  assert.equal(parse("Balance EUR 50.00"), null);
});

test("approval requests, failed payments and future debits never enter review", () => {
  const rejected = [
    "Verify a payment\nYou're making an online card payment of EUR 5 to Example Club. Tap to verify",
    "Approve your card payment of EUR 5 to Example Club",
    "Confirm this payment\nEUR 5 at Example Club",
    "Payment pending EUR 5 at Example Club", "Payment declined EUR 5 at Example Club",
    "Direct debit scheduled EUR 25 to Example Power", "Standing order due EUR 25 to Example Rent",
    "결제 승인 요청\n예시카페 5,000원 승인해주세요", "인증번호 123456\n예시카페 5,000원",
    "이체 예약 30,000원 받는 사람: 예시", "환불 요청 5,000원 예시카페",
    "출금 예정 30,000원 자동이체", "Paiement en attente de 5,00 € chez Exemple",
    "Validez votre paiement de 5,00 €", "Paiement refusé 5,00 € chez Exemple",
    "Payment not completed EUR 5 at Example", "Payment request EUR 5 from Example",
    "Approval requested\nPayment EUR 5 at Example", "Paiement à valider\n5 € chez Exemple",
    "결제 확인 필요\n사용처: 예시\n5,000원", "Zahlung bestätigen\nPayment EUR 5 at Example",
    "Conferma il pagamento\nPayment EUR 5 at Example", "请确认支付\nPayment EUR 5 at Example",
  ];
  for (const body of rejected) assert.equal(parse(body), null, body);
});

test("advertisements, loan offers, promotional points and statements never enter review", () => {
  for (const body of [
    "(광고) 결제 승인\n예시쇼핑 10,000원\n무료수신거부", "[AD] Paid EUR 10 at Example Shop",
    "Loan approved EUR 5000", "대출 승인 5,000,000원", "쿠폰 지급 5,000원 결제 혜택",
    "Points credited EUR 10", "결제하면 5,000원 적립", "Spend EUR 50 to earn EUR 5",
    "Monthly statement\nPaid EUR 200 at Example", "Paiement EUR 5\nOffre promotionnelle",
    "Payment EUR 5\nUnsubscribe", "[Publicité] Paiement de 5 € chez Exemple",
    "Pre-approved loan of EUR 5000", "Special offer\nPayment EUR 10 at Example",
    "Card payment benefits\nCashback up to EUR 10 available", "결제 혜택\n예시카페 5,000원",
  ]) assert.equal(parse(body), null, body);
  assert.equal(parse("Paid EUR 10 at Discount Pharmacy")?.merchant, "Discount Pharmacy");
  assert.equal(parse("Paid EUR 10 at Point Cafe")?.merchant, "Point Cafe");
});

test("negated completion and authorization requests never become expenses or review candidates", () => {
  for (const body of [
    "Paiement invalidé de 5 € chez Exemple Café",
    "Paiement non validé de 5 € chez Exemple Café",
    "Paiement non accepté de 5 € chez Exemple Café",
    "Le paiement n’a pas été validé de 5 € chez Exemple Café",
    "Le paiement n'est pas effectué de 5 € chez Exemple Café",
    "Paiement à approuver de 5 € chez Exemple Café",
    "Paiement à autoriser de 5 € chez Exemple Café",
    "Approuvez votre paiement de 5 € chez Exemple Café",
    "Payment not authorized EUR 5 at Example Cafe",
    "Payment hasn't been completed EUR 5 at Example Cafe",
    "Payment wasn't successful EUR 5 at Example Cafe",
    "Payment needs your approval EUR 5 at Example Cafe",
    "결제 미완료\n사용처: 예시카페\n5,000원",
    "승인이 되지 않았습니다\n사용처: 예시카페\n5,000원",
    "결제가 안됐습니다\n사용처: 예시카페\n5,000원",
    "결제를 승인하셔야 합니다\n사용처: 예시카페\n5,000원",
  ]) assert.equal(parse(body), null, body);
  for (const body of [
    "Paiement validé de 5 € chez Exemple Café",
    "Paiement accepté de 5 € chez Exemple Café",
    "Payment approved EUR 5 at Example Cafe",
    "결제 승인\n사용처: 예시카페\n5,000원",
  ]) {
    const candidate = parse(body);
    assert.ok(candidate, body);
    assert.equal(candidate.eventType, "purchase", body);
    assert.equal(candidate.confidence, "high", body);
  }
});

test("incoming transfers, salaries and topups do not become outgoing expenses", () => {
  for (const body of ["You received EUR 20 from Example", "Incoming transfer EUR 20", "입금 완료 50,000원 예시", "Virement reçu de 20 €", "Top-up completed EUR 30", "충전 완료 30,000원", "Transfer completed EUR 20 between your accounts", "Salary credited EUR 2000", "Example Person sent EUR 20 to you", "Example Person sent you EUR 20", "Transfer from Example Person completed EUR 20", "Example Person transferred EUR 20 to your account"]) assert.equal(parse(body), null, body);
});

test("Korean completed authorization is distinct from a request with a completed-looking title", () => {
  for (const status of ["결제 승인", "결제 승인 완료", "결제가 승인되었습니다", "카드 승인됐습니다"]) {
    const candidate = parse(`${status}\n사용처: 예시카페\n5,000원`);
    assert.ok(candidate, status);
    assert.equal(candidate.eventType, "purchase", status);
    assert.equal(candidate.confidence, "high", status);
    assert.equal(candidate.merchant, "예시카페", status);
    assert.equal(candidate.minorUnits, 5000, status);
  }
  for (const instruction of ["결제를 승인해 주세요", "결제 승인하기", "결제 승인 바랍니다", "승인을 완료해 주세요", "결제 승인을 부탁드립니다", "승인 필요"]) {
    assert.equal(parse(`${instruction}\n사용처: 예시카페\n5,000원`, { title: "결제 승인" }), null, instruction);
  }
});

test("outgoing destination account label does not hide separate incoming deposit status", () => {
  for (const status of ["이체 완료", "송금 완료", "출금"]) {
    const candidate = parse(`${status}\n입금계좌 예금주: 예시수취인\n30,000원\n잔액 90,000원`);
    assert.ok(candidate, status);
    assert.equal(candidate.eventType, "outgoing_transfer", status);
    assert.equal(candidate.merchant, "예시수취인", status);
    assert.equal(candidate.minorUnits, 30000, status);
    assert.equal(candidate.confidence, "high", status);
  }
  assert.equal(parse("입금 완료\n입금계좌 예금주: 예시수취인\n30,000원"), null);
  assert.equal(parse("입금 완료\n이체 완료\n입금계좌 예금주: 예시수취인\n30,000원"), null);
  assert.equal(parse("이체 요청\n입금계좌 예금주: 예시수취인\n30,000원"), null);
});

test("ATM and card completion cannot override explicit incoming or future instruction", () => {
  for (const body of [
    "Cash withdrawal request\nExample ATM\nEUR 20",
    "Cash withdrawal scheduled\nExample ATM\nEUR 20",
    "현금 출금 예정\n예시ATM\n50,000원",
    "Incoming transfer completed\nRecipient: Example Person\nEUR 20",
  ]) assert.equal(parse(body), null, body);
});

test("outgoing transfers use recipient as merchant", () => {
  for (const [body, merchant] of [
    ["Transfer completed\nRecipient: Example Person\nEUR 25.00", "Example Person"],
    ["You sent EUR 25.00 to Example Person", "Example Person"],
    ["이체 완료\n받는 사람: 예시사람\n30,000원\n잔액 90,000원", "예시사람"],
    ["출금 30,000원\n수취인: 예시사람\n잔액 90,000원", "예시사람"],
    ["예시사람님에게 30,000원 보냈습니다", "예시사람"],
    ["Virement effectué\nBénéficiaire: Personne Exemple\n25,00 €", "Personne Exemple"],
  ] as const) {
    const candidate = parse(body); assert.ok(candidate, body); assert.equal(candidate.eventType, "outgoing_transfer", body); assert.equal(candidate.merchant, merchant, body); assert.equal(candidate.confidence, "high", body);
  }
});

test("direct debit, standing order and ATM stay distinct from card purchase", () => {
  for (const [body, type] of [
    ["Direct debit completed\nRecipient: Example Power\nEUR 25", "direct_debit"],
    ["Prélèvement effectué\nBénéficiaire: Exemple Énergie\n25,00 €", "direct_debit"],
    ["정기이체 완료\n받는 사람: 예시집주인\n300,000원", "standing_order"],
    ["Standing order executed\nRecipient: Example Rent\nEUR 300", "standing_order"],
    ["Cash withdrawal completed\nExample ATM\nEUR 20", "cash_withdrawal"],
    ["현금 인출\n예시ATM\n50,000원", "cash_withdrawal"],
  ] as const) { const candidate = parse(body); assert.ok(candidate, body); assert.equal(candidate.eventType, type, body); }
});

test("completed refunds and cancellations become reversals, not new spending", () => {
  for (const body of ["Payment cancelled\nMerchant: Example Cafe\nEUR 5", "Refund received\nMerchant: Example Cafe\n+5.00 EUR", "승인 취소\n사용처: 예시카페\n5,000원", "Remboursement effectué\nCommerçant: Café Exemple\n5,00 €"]) {
    const candidate = parse(body); assert.ok(candidate, body); assert.equal(candidate.eventType, "reversal");
  }
});

test("real cashback is benefit metadata and never a purchase of that amount", () => {
  const standalone = parse("인센티브 지급\n1,400원"); assert.ok(standalone); assert.equal(standalone.eventType, "cashback"); assert.equal(standalone.requiresMerchant, true);
  const combined = parse("결제 완료\n사용처: 예시김밥\n14,000원\n캐시 지급 1,400원\n잔액 45,205원");
  assert.ok(combined); assert.equal(combined.eventType, "purchase"); assert.equal(combined.minorUnits, 14000); assert.equal(combined.cashbackMinorUnits, 1400);
});

test("multiple unlabelled monetary amounts are rejected instead of selecting a random debit", () => {
  assert.equal(parse("Paid EUR 10 at Example Cafe and EUR 12 at Example Market"), null);
  assert.equal(parse("Paid EUR 10 at Example Cafe\nUSD 11"), null);
  const repeated = parse("Paid EUR 10 at Example Cafe", { title: "Payment completed EUR 10" });
  assert.equal(repeated?.minorUnits, 1000);
});

test("wallet input requires explicit decimal amount/currency/merchant and honors rejection text", () => {
  const wallet: IosTransactionInput = { ...base, kind: "wallet", sourceName: "Apple Wallet", amount: "8.90", currency: "EUR", merchant: "Example Cafe" };
  const candidate = parseIosTransactionInput(wallet); assert.ok(candidate); assert.equal(candidate.minorUnits, 890); assert.equal(candidate.confidence, "high"); assert.equal(candidate.packageName, "walletdiary.ios.wallet");
  for (const changes of [{ amount: undefined }, { currency: undefined }, { currency: "BAD" }, { amount: "-8.90" }, { amount: "0" }, { body: "Payment declined EUR 8.90" }, { body: "Paid EUR 9.90 at Example Cafe" }]) assert.equal(parseIosTransactionInput({ ...wallet, ...changes }), null);
  const missing = parseIosTransactionInput({ ...wallet, merchant: "validé" }); assert.ok(missing); assert.equal(missing.requiresMerchant, true);
});

test("invalid and ambiguous receipt dates force review without date rollover", () => {
  const invalid = parse("Payment completed\nMerchant: Example Cafe\nEUR 5\n2026-02-30 12:00"); assert.ok(invalid); assert.equal(invalid.confidence, "review"); assert.notEqual(invalid.occurredOn, "2026-03-02");
  const ambiguous = parse("Paid EUR 5 at Example Cafe\n10/11 12:00"); assert.ok(ambiguous); assert.equal(ambiguous.confidence, "review");
  const valid = parse("Paid EUR 5 at Example Cafe\n2026-10-26 15:30"); assert.ok(valid); assert.equal(valid.confidence, "high"); assert.equal(valid.occurredOn, "2026-10-26");
});

test("ids/tokens are preserved and equal split payments remain distinct parser outputs", () => {
  const first = parse("Paid EUR 10 at Example Cafe", { id: "first", queueToken: "one" });
  const second = parse("Paid EUR 10 at Example Cafe", { id: "second", queueToken: "two" });
  assert.ok(first && second); assert.notEqual(first.id, second.id); assert.equal(first.queueToken, "one"); assert.equal(second.queueToken, "two");
  assert.deepEqual(parse("Paid EUR 10 at Example Cafe", { id: "first", queueToken: "one" }), first);
});

test("existing ledger engine keeps unknown iOS source for review then records only after user trust", () => {
  const candidate = parse("Paid EUR 5 at Example Cafe"); assert.ok(candidate);
  const ledger = createLedger("general", "Synthetic", "EUR");
  const state: WalletState = { version: 2, locale: "en", activeLedgerId: ledger.id, ledgers: [ledger] };
  const untrusted = applyHighConfidenceCardAutomation(state, [candidate]); assert.equal((untrusted.state.ledgers[0] as GeneralLedger).expenses.length, 0); assert.equal(untrusted.pending.length, 1);
  const trusted = { ...state, ledgers: [{ ...ledger, automationSources: [{ packageName: candidate.packageName, displayName: candidate.sourceName, trustedDirectApp: true as const }] }] };
  const recorded = applyHighConfidenceCardAutomation(trusted, [candidate]); assert.equal((recorded.state.ledgers[0] as GeneralLedger).expenses.length, 1);
  assert.equal(applyHighConfidenceCardAutomation(recorded.state, [candidate]).state, recorded.state);
});
