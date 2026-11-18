import assert from "node:assert/strict";
import test from "node:test";
import { allocateProportionally, convertMinorUnits, settleInCurrency, type RateResolver } from "../src/lib/convertedSettlement";
import type { TravelExpense, TravelLedger } from "../src/lib/types";
import { settleTravelExpenses, splitEvenly } from "../src/lib/wallet";

const people = [{ id: "a", name: "지민" }, { id: "b", name: "민수" }, { id: "c", name: "서연" }];
let sequence = 0;
function expense(currency: string, minorUnits: number, paidBy: string, sharers: readonly string[], occurredOn = "2026-10-10"): TravelExpense {
  sequence += 1;
  return { id: `e${sequence}`, description: `지출 ${sequence}`, category: "food", currency, minorUnits, paidBy, shares: splitEvenly(minorUnits, sharers), occurredOn };
}
function ledger(expenses: readonly TravelExpense[], currencies = ["USD", "KRW", "JPY"]): TravelLedger {
  return { id: "trip", title: "뉴욕 여행", kind: "travel", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", currencies, defaultCurrency: currencies[0], participants: people, selfParticipantId: "a", expenses };
}
const fixed = (rates: Record<string, number>): RateResolver => (currency) => rates[currency] ?? null;

test("amounts convert between currencies with different decimal places", () => {
  assert.equal(convertMinorUnits(1_050, "USD", "KRW", 1_380.5), 14_495);
  assert.equal(convertMinorUnits(10_000, "KRW", "USD", 0.000725), 725);
  assert.equal(convertMinorUnits(3_000, "JPY", "KRW", 9.1234), 27_370);
  assert.equal(convertMinorUnits(1, "USD", "KRW", 1_380), 14);
  assert.equal(convertMinorUnits(0, "USD", "KRW", 1_380), 0);
  assert.equal(convertMinorUnits(12_345, "USD", "EUR", 0.9), 11_111);
  for (const [amount, rate] of [[-1, 1], [1.5, 1], [10, 0], [10, -2], [10, Number.NaN], [10, Number.POSITIVE_INFINITY]] as const) assert.throws(() => convertMinorUnits(amount, "USD", "KRW", rate));
  assert.throws(() => convertMinorUnits(Number.MAX_SAFE_INTEGER, "USD", "KRW", 1_000_000));
});

test("decimal half-unit conversions round exactly without binary floating-point drift", () => {
  assert.equal(convertMinorUnits(100, "USD", "EUR", 1.005), 101);
  assert.equal(convertMinorUnits(100, "USD", "EUR", 1.015), 102);
  assert.equal(convertMinorUnits(2_675, "USD", "EUR", 0.1), 268);
  assert.equal(convertMinorUnits(100, "KRW", "USD", 0.01005), 101);
  assert.equal(convertMinorUnits(100, "USD", "JPY", 1.5), 2);
  assert.equal(convertMinorUnits(15_000_000, "USD", "EUR", 1e-7), 2);
  assert.equal(convertMinorUnits(1, "USD", "EUR", 1e15), 1e15);
  assert.equal(convertMinorUnits(Number.MAX_SAFE_INTEGER, "USD", "EUR", 1), Number.MAX_SAFE_INTEGER);
  assert.equal(convertMinorUnits(Number.MAX_SAFE_INTEGER, "USD", "EUR", 0.1), 900_719_925_474_099);
  assert.equal(convertMinorUnits(100, "USD", "EUR", Number.MIN_VALUE), 0);
  assert.throws(() => convertMinorUnits(Number.MAX_SAFE_INTEGER, "USD", "EUR", 1.0000000000000002), /overflow/);
});

test("a proportional split always adds up and breaks ties by participant id", () => {
  assert.deepEqual([...allocateProportionally(100, [{ id: "b", weight: 1 }, { id: "a", weight: 1 }, { id: "c", weight: 1 }])], [["b", 33], ["a", 34], ["c", 33]]);
  assert.deepEqual([...allocateProportionally(14_495, [{ id: "a", weight: 350 }, { id: "b", weight: 350 }, { id: "c", weight: 350 }])], [["a", 4_832], ["b", 4_832], ["c", 4_831]]);
  assert.deepEqual([...allocateProportionally(1_000, [{ id: "a", weight: 700 }, { id: "b", weight: 300 }, { id: "c", weight: 0 }])], [["a", 700], ["b", 300], ["c", 0]]);
  assert.deepEqual([...allocateProportionally(0, [{ id: "a", weight: 5 }, { id: "b", weight: 5 }])], [["a", 0], ["b", 0]]);
  const huge = allocateProportionally(900_000_000_000_001, [{ id: "a", weight: 333_333_333_333 }, { id: "b", weight: 666_666_666_667 }]);
  assert.equal((huge.get("a") ?? 0) + (huge.get("b") ?? 0), 900_000_000_000_001);
  assert.deepEqual([huge.get("a"), huge.get("b")], [299_999_999_999_700, 600_000_000_000_301]);
  for (const invalid of [[], [{ id: "a", weight: 0 }], [{ id: "a", weight: 1 }, { id: "a", weight: 2 }], [{ id: "a", weight: -1 }], [{ id: "a", weight: 1.5 }]]) assert.throws(() => allocateProportionally(10, invalid));
  assert.throws(() => allocateProportionally(-1, [{ id: "a", weight: 1 }]));
});

test("a mixed-currency trip settles in one currency with balances that cancel out", () => {
  const trip = ledger([
    expense("USD", 30_000, "a", ["a", "b", "c"]),   // $300.00 → ₩414,000, ₩138,000 each
    expense("USD", 1_050, "b", ["a", "b"]),         // $10.50 → ₩14,490, ₩7,245 each
    expense("KRW", 90_000, "c", ["a", "b", "c"]),   // already in the settlement currency
    expense("JPY", 3_000, "a", ["b", "c"]),         // ¥3,000 → ₩27,300, ₩13,650 each
  ]);
  const result = settleInCurrency(trip, "KRW", fixed({ USD: 1_380, JPY: 9.1 }));
  assert.equal(result.complete, true);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.convertedCurrencies, ["JPY", "USD"]);
  assert.equal(result.totalMinor, 414_000 + 14_490 + 90_000 + 27_300);
  assert.deepEqual([...result.balances], [["a", 414_000 - 138_000 - 7_245 - 30_000 + 27_300], ["b", -138_000 + 14_490 - 7_245 - 30_000 - 13_650], ["c", -138_000 + 90_000 - 30_000 - 13_650]]);
  assert.equal([...result.balances.values()].reduce((sum, amount) => sum + amount, 0), 0);
  assert.deepEqual(result.transfers, [{ from: "b", to: "a", currency: "KRW", minorUnits: 174_405 }, { from: "c", to: "a", currency: "KRW", minorUnits: 91_650 }]);
});

test("each expense uses the rate of its own day", () => {
  const trip = ledger([expense("USD", 10_000, "a", ["a", "b"], "2026-10-09"), expense("USD", 10_000, "b", ["a", "b"], "2026-10-12")]);
  const byDay: RateResolver = (currency, date) => currency === "USD" ? (date === "2026-10-09" ? 1_370 : 1_390) : null;
  const result = settleInCurrency(trip, "KRW", byDay);
  assert.equal(result.totalMinor, 137_000 + 139_000);
  assert.deepEqual(result.transfers, [{ from: "a", to: "b", currency: "KRW", minorUnits: 1_000 }]);
});

test("a trip already in the settlement currency matches the per-currency settlement", () => {
  const trip = ledger([expense("KRW", 100_001, "a", ["a", "b", "c"]), expense("KRW", 45_000, "b", ["b", "c"]), expense("KRW", 9_999, "c", ["a"])], ["KRW"]);
  const never: RateResolver = () => { throw new Error("no rate is needed"); };
  const result = settleInCurrency(trip, "KRW", never);
  assert.deepEqual(result.convertedCurrencies, []);
  assert.deepEqual(result.transfers, settleTravelExpenses(trip)[0].transfers);
  assert.deepEqual([...result.balances], [...settleTravelExpenses(trip)[0].balances]);
});

test("no partial settlement is offered while a rate is missing", () => {
  const trip = ledger([expense("USD", 10_000, "a", ["a", "b"], "2026-10-12"), expense("USD", 5_000, "a", ["a", "b"], "2026-10-09"), expense("JPY", 3_000, "b", ["a", "b"], "2026-10-09"), expense("USD", 100, "b", ["a"], "2026-10-12"), expense("KRW", 20_000, "c", ["a", "c"])]);
  const result = settleInCurrency(trip, "KRW", fixed({ JPY: 9.1 }));
  assert.equal(result.complete, false);
  assert.deepEqual(result.missing, [{ currency: "USD", date: "2026-10-09" }, { currency: "USD", date: "2026-10-12" }]);
  assert.deepEqual(result.transfers, []);
  assert.equal([...result.balances.values()].reduce((sum, amount) => sum + amount, 0), 0);
});

test("the result does not depend on expense or participant order", () => {
  const expenses = [expense("USD", 9_999, "a", ["a", "b", "c"]), expense("USD", 3_333, "c", ["a", "c"]), expense("JPY", 77_777, "b", ["a", "b", "c"]), expense("KRW", 12_345, "b", ["c"])];
  const rates = fixed({ USD: 1_381.37, JPY: 9.1234 });
  const forward = settleInCurrency(ledger(expenses), "KRW", rates);
  const reversed = settleInCurrency({ ...ledger([...expenses].reverse()), participants: [...people].reverse() }, "KRW", rates);
  assert.deepEqual(forward.transfers, reversed.transfers);
  assert.equal(forward.totalMinor, reversed.totalMinor);
  for (const person of people) assert.equal(forward.balances.get(person.id), reversed.balances.get(person.id));
});

test("people with no expenses stay at zero and an empty trip has nothing to settle", () => {
  const empty = settleInCurrency(ledger([]), "KRW", fixed({}));
  assert.deepEqual([empty.complete, empty.totalMinor, empty.transfers.length], [true, 0, 0]);
  const solo = settleInCurrency(ledger([expense("USD", 2_000, "a", ["a"])]), "KRW", fixed({ USD: 1_380 }));
  assert.deepEqual([...solo.balances], [["a", 0], ["b", 0], ["c", 0]]);
  assert.deepEqual(solo.transfers, []);
  assert.equal(solo.totalMinor, 27_600);
});
