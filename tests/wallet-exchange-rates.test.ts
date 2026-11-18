import assert from "node:assert/strict";
import test from "node:test";
import { loadRates, nextRateRefreshAt, parseCurrencyApi, parseFrankfurterRows, parseRateRequest, RATE_CACHE_KEY, rateKey, requiredRates, serializeRateRequest, type KeyValueStore, type RateDependencies, type RateLoadResult, type RatePoint } from "../src/lib/exchangeRates";
import { watchRateRefresh } from "../src/lib/fxRefresh";
import { defaultFxTarget, FX_SETTINGS_KEY, normalizeManualRate, parseManualRate, readFxSettings, withFxTarget, writeFxSettings } from "../src/lib/fxSettings";
import type { TravelLedger } from "../src/lib/types";

const DAY = 86_400_000;
const HOUR = DAY / 24;

function snapshot(points: RatePoint[], missing = false, failed = false): RateLoadResult {
  return { rates: new Map(points.map((p, i) => [String(i), p])), missing: missing ? [{currency: "EUR", date: "2026-10-12"}] : [], failed };
}
const point = (source: RatePoint["source"], fetchedAt: number, final = false): RatePoint => ({ rateDate: "2026-10-12", rate: 1.21, source, fetchedAt, final });

test("the next check uses actual cache age, earliest provisional expiry, and backs off if a source is still missing", () => {
  const t = Date.UTC(2026, 9, 13);
  assert.equal(nextRateRefreshAt(snapshot([point("frankfurter", t, true)]), t), null);
  assert.equal(nextRateRefreshAt(snapshot([point("currency-api", t - HOUR)]), t), t + 23 * HOUR);
  assert.equal(nextRateRefreshAt(snapshot([point("frankfurter", t - HOUR), point("currency-api", t)]), t), t + 5 * HOUR);
  assert.equal(nextRateRefreshAt(snapshot([point("frankfurter", t - 10 * HOUR)], false, true), t), t + 6 * HOUR);
  assert.equal(nextRateRefreshAt(snapshot([], true), t), t + 6 * HOUR);
});

test("a visible open ledger refreshes at expiry without focus, sleeps while hidden/offline, and does not poll final history", async () => {
  let now = Date.UTC(2026, 9, 13), visible = false, online = true, loads = 0, received = 0, final = false;
  let wake = () => {}, fire = () => {}, delay = -1;
  const stop = watchRateRefresh({
    now: () => now, visible: () => visible, online: () => online,
    schedule: (ms, cb) => { delay = ms; fire = cb; return () => { delay = -1; }; },
    watchWake: (cb) => { wake = cb; return () => { wake = () => {}; }; },
  }, async () => { loads++; return snapshot([point("frankfurter", now, final)]); }, () => { received++; });
  assert.equal(loads, 0);
  visible = true; wake(); wake(); await Promise.resolve();
  assert.deepEqual([loads, received, delay], [1, 1, 6 * HOUR]);
  now += HOUR; wake(); assert.deepEqual([loads, delay], [1, 5 * HOUR]);
  now += 5 * HOUR; fire(); await Promise.resolve();
  assert.deepEqual([loads, received, delay], [2, 2, 6 * HOUR]);
  visible = false; wake(); now += DAY; wake();
  assert.deepEqual([loads, delay], [2, -1]);
  online = false; visible = true; wake(); assert.equal(loads, 2);
  online = true; final = true; wake(); await Promise.resolve();
  assert.deepEqual([loads, received, delay], [3, 3, -1]);
  now += 300 * DAY; wake(); assert.equal(loads, 3);
  stop();
});

test("an offline first visit reads the cache, retries on reconnect and ignores an answer after leaving", async () => {
  let online = false, loads = 0, received = 0, wake = () => {};
  const results: ((r: RateLoadResult) => void)[] = [];
  const stop = watchRateRefresh({
    now: () => 0, visible: () => true, online: () => online,
    schedule: () => { throw new Error("no timer while offline or loading"); },
    watchWake: (cb) => { wake = cb; return () => { wake = () => {}; }; },
  }, () => { loads++; return new Promise((resolve) => results.push(resolve)); }, () => { received++; });
  results[0](snapshot([], true)); await Promise.resolve();
  assert.deepEqual([loads, received], [1, 1]);
  wake(); assert.equal(loads, 1);
  online = true; wake(); assert.equal(loads, 2);
  stop(); results[1](snapshot([], true, true)); await Promise.resolve();
  wake(); assert.deepEqual([loads, received], [2, 1]);
});
const at = (date: string, hour = 12) => Date.parse(`${date}T${String(hour).padStart(2, "0")}:00:00Z`);

function memoryStore(initial: Record<string, string> = {}): KeyValueStore & { readonly data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); } };
}

function harness(options: { now: number; online?: boolean; storage?: KeyValueStore | null; respond: (url: string) => unknown }) {
  const calls: string[] = []; let now = options.now;
  const deps: RateDependencies = {
    fetchJson: async (url) => { calls.push(url); const body = options.respond(url); if (body instanceof Error) throw body; return body; },
    storage: options.storage === undefined ? memoryStore() : options.storage, now: () => now, online: options.online ?? true,
  };
  return { deps, calls, advance: (ms: number) => { now += ms; } };
}

const series = (base: string, quote: string, rows: Record<string, number>) => Object.entries(rows).map(([date, rate]) => ({ date, base, quote, rate }));

function ledger(expenses: { currency: string; occurredOn: string; description?: string }[]): TravelLedger {
  return {
    id: "ledger-1", title: "뉴욕 여행", kind: "travel", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z",
    currencies: ["USD", "KRW", "JPY"], defaultCurrency: "USD", participants: [{ id: "a", name: "지민" }, { id: "b", name: "민수" }], selfParticipantId: "a",
    expenses: expenses.map((expense, index) => ({ id: `e${index}`, description: expense.description ?? "저녁 식사", category: "food", currency: expense.currency, minorUnits: 1_000, paidBy: "a", shares: [{ participantId: "a", minorUnits: 500 }, { participantId: "b", minorUnits: 500 }], occurredOn: expense.occurredOn })),
  };
}

test("required rates list each foreign currency's distinct expense dates", () => {
  const needs = requiredRates(ledger([{ currency: "USD", occurredOn: "2026-10-12" }, { currency: "USD", occurredOn: "2026-10-10" }, { currency: "USD", occurredOn: "2026-10-12" }, { currency: "KRW", occurredOn: "2026-10-11" }, { currency: "JPY", occurredOn: "2026-10-09" }]), "KRW");
  assert.deepEqual([...needs], [["JPY", ["2026-10-09"]], ["USD", ["2026-10-10", "2026-10-12"]]]);
  assert.deepEqual([...requiredRates(ledger([{ currency: "USD", occurredOn: "2026-10-12" }, { currency: "JPY", occurredOn: "2026-10-09" }]), "KRW", new Set(["USD"]))], [["JPY", ["2026-10-09"]]]);
  assert.equal(requiredRates(ledger([{ currency: "KRW", occurredOn: "2026-10-11" }]), "KRW").size, 0);
});

test("a rate request serializes to a stable string and rejects malformed input", () => {
  const needs = new Map([["USD", ["2026-10-10", "2026-10-12"]]]);
  const serialized = serializeRateRequest("KRW", needs);
  assert.equal(serialized, serializeRateRequest("KRW", new Map(needs)));
  const parsed = parseRateRequest(serialized);
  assert.equal(parsed?.target, "KRW");
  assert.deepEqual([...(parsed?.needs ?? [])], [["USD", ["2026-10-10", "2026-10-12"]]]);
  for (const invalid of ["", "{}", "[]", '["krw",[]]', '["KRW",[["usd",["2026-10-10"]]]]', '["KRW",[["USD","2026-10-10"]]]', "not json"]) assert.equal(parseRateRequest(invalid), null, invalid);
  assert.deepEqual([...(parseRateRequest('["KRW",[["USD",["2026-02-30","nope"]]]]')?.needs ?? [])], []);
});

test("provider payloads are parsed defensively", () => {
  assert.deepEqual(parseFrankfurterRows([{ date: "2026-10-09", base: "usd", quote: "krw", rate: 1375.5 }, { date: "2026-10-08", base: "USD", quote: "KRW", rate: 1370 }, { date: "2026-10-10", base: "USD", quote: "EUR", rate: 0.9 }, { date: "bad", base: "USD", quote: "KRW", rate: 1 }, { date: "2026-10-07", base: "USD", quote: "KRW", rate: -1 }, { date: "2026-10-06", base: "USD", quote: "KRW", rate: "1380" }, null, 5], "USD", "KRW").map((row) => row.rate), [1370, 1375.5]);
  assert.deepEqual(parseFrankfurterRows({ rates: {} }, "USD", "KRW"), []);
  assert.deepEqual(parseCurrencyApi({ date: "2026-10-09", usd: { krw: 1376.25, eur: 0.9 } }, "USD", "KRW"), { date: "2026-10-09", rate: 1376.25 });
  assert.equal(parseCurrencyApi({ date: "soon", usd: { krw: 1376.25 } }, "USD", "KRW"), null);
  for (const invalid of [null, [], { usd: null }, { usd: { krw: 0 } }, { usd: { krw: "1376" } }, { eur: { krw: 1500 } }]) assert.equal(parseCurrencyApi(invalid, "USD", "KRW"), null);
});

test("settled days come from one Frankfurter time-series request and are cached permanently", async () => {
  const run = harness({ now: at("2026-10-20"), respond: (url) => {
    assert.equal(url, "https://api.frankfurter.dev/v2/rates?base=USD&quotes=KRW&from=2026-09-30&to=2026-10-12");
    return series("USD", "KRW", { "2026-10-08": 1370.1, "2026-10-09": 1375.5, "2026-10-12": 1381.25 });
  } });
  const needs = new Map([["USD", ["2026-10-10", "2026-10-12", "2026-10-11"]]]);
  const first = await loadRates("KRW", needs, run.deps);
  assert.equal(first.failed, false); assert.deepEqual(first.missing, []);
  // Saturday and Sunday use Friday's publication.
  assert.deepEqual([first.rates.get(rateKey("USD", "2026-10-10")), first.rates.get(rateKey("USD", "2026-10-11")), first.rates.get(rateKey("USD", "2026-10-12"))].map((point) => [point?.rateDate, point?.rate, point?.source, point?.final]), [["2026-10-09", 1375.5, "frankfurter", true], ["2026-10-09", 1375.5, "frankfurter", true], ["2026-10-12", 1381.25, "frankfurter", true]]);
  assert.equal(run.calls.length, 1);
  run.advance(400 * DAY);
  const second = await loadRates("KRW", needs, run.deps);
  assert.equal(run.calls.length, 1);
  assert.deepEqual([...second.rates].map(([key, point]) => [key, point.rate]), [...first.rates].map(([key, point]) => [key, point.rate]));
});

test("recent days stay provisional and are refreshed after the retry window", async () => {
  let rate = 1380;
  const run = harness({ now: at("2026-10-12", 9), respond: () => series("USD", "KRW", { "2026-10-09": 1375.5, "2026-10-12": rate }) });
  const needs = new Map([["USD", ["2026-10-12"]]]);
  assert.equal((await loadRates("KRW", needs, run.deps)).rates.get(rateKey("USD", "2026-10-12"))?.final, false);
  run.advance(3 * 3_600_000); rate = 1384;
  assert.equal((await loadRates("KRW", needs, run.deps)).rates.get(rateKey("USD", "2026-10-12"))?.rate, 1380);
  assert.equal(run.calls.length, 1);
  run.advance(4 * 3_600_000);
  assert.equal((await loadRates("KRW", needs, run.deps)).rates.get(rateKey("USD", "2026-10-12"))?.rate, 1384);
  assert.equal(run.calls.length, 2);
  run.advance(3 * DAY); rate = 1385.5;
  const settled = (await loadRates("KRW", needs, run.deps)).rates.get(rateKey("USD", "2026-10-12"));
  assert.deepEqual([settled?.rate, settled?.final], [1385.5, true]);
  run.advance(30 * DAY);
  await loadRates("KRW", needs, run.deps);
  assert.equal(run.calls.length, 3);
});

test("a future-dated expense borrows the latest published rate without becoming final", async () => {
  const run = harness({ now: at("2026-10-12"), respond: (url) => {
    assert.equal(url, "https://api.frankfurter.dev/v2/rates?base=USD&quotes=KRW&from=2026-10-02&to=2026-10-12");
    return series("USD", "KRW", { "2026-10-09": 1375.5, "2026-10-12": 1381 });
  } });
  const point = (await loadRates("KRW", new Map([["USD", ["2026-12-24"]]]), run.deps)).rates.get(rateKey("USD", "2026-12-24"));
  assert.deepEqual([point?.rateDate, point?.rate, point?.final], ["2026-10-12", 1381, false]);
});

test("the currency-api mirror answers when Frankfurter fails, but never becomes permanent", async () => {
  let primaryDown = true;
  const run = harness({ now: at("2026-10-20"), respond: (url) => {
    if (url.startsWith("https://api.frankfurter.dev/")) return primaryDown ? new Error("503") : series("VND", "KRW", { "2026-10-09": 0.0551 });
    if (url === "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@2026-10-09/v1/currencies/vnd.min.json") return new Error("blocked");
    if (url === "https://2026-10-09.currency-api.pages.dev/v1/currencies/vnd.min.json") return { date: "2026-10-09", vnd: { krw: 0.0553 } };
    return new Error(`unexpected ${url}`);
  } });
  const needs = new Map([["VND", ["2026-10-09"]]]);
  const first = await loadRates("KRW", needs, run.deps);
  assert.deepEqual([first.failed, first.missing.length], [false, 0]);
  const fallback = first.rates.get(rateKey("VND", "2026-10-09"));
  assert.deepEqual([fallback?.rate, fallback?.source, fallback?.final, fallback?.rateDate], [0.0553, "currency-api", false, "2026-10-09"]);
  assert.equal(run.calls.length, 3);
  run.advance(2 * 3_600_000);
  await loadRates("KRW", needs, run.deps);
  assert.equal(run.calls.length, 3);
  run.advance(23 * 3_600_000); primaryDown = false;
  const recovered = (await loadRates("KRW", needs, run.deps)).rates.get(rateKey("VND", "2026-10-09"));
  assert.deepEqual([recovered?.rate, recovered?.source, recovered?.final], [0.0551, "frankfurter", true]);
});

test("a rate older than ten days is not accepted and a missing rate is reported", async () => {
  const run = harness({ now: at("2026-10-20"), respond: (url) => url.startsWith("https://api.frankfurter.dev/") ? series("USD", "KRW", { "2026-09-25": 1300 }) : new Error("down") });
  const result = await loadRates("KRW", new Map([["USD", ["2026-10-12"]]]), run.deps);
  assert.deepEqual(result.missing, [{ currency: "USD", date: "2026-10-12" }]);
  assert.equal(result.failed, true);
  assert.equal(result.rates.size, 0);
  assert.equal(run.deps.storage?.getItem(RATE_CACHE_KEY), null);
});

test("fallback responses with missing, invalid or future publication dates are never relabeled", async () => {
  for (const date of [undefined, "", "2026-02-30", "2026-10-11"]) {
    const run = harness({ now: at("2026-10-20"), respond: (url) => url.startsWith("https://api.frankfurter.dev/") ? new Error("down") : { date, usd: { krw: 1376.25 } } });
    const result = await loadRates("KRW", new Map([["USD", ["2026-10-10"]]]), run.deps);
    assert.deepEqual(result.missing, [{ currency: "USD", date: "2026-10-10" }]);
    assert.equal(result.rates.size, 0);
    assert.equal(result.failed, true);
    assert.equal(run.deps.storage?.getItem(RATE_CACHE_KEY), null);
  }
});

test("a future primary fallback response is skipped in favor of a dated mirror", async () => {
  const run = harness({ now: at("2026-10-20"), respond: (url) => {
    if (url.startsWith("https://api.frankfurter.dev/")) return new Error("down");
    return { date: url.startsWith("https://cdn.jsdelivr.net/") ? "2026-10-11" : "2026-10-09", usd: { krw: 1376.25 } };
  } });
  const result = await loadRates("KRW", new Map([["USD", ["2026-10-10"]]]), run.deps);
  assert.equal(result.rates.get(rateKey("USD", "2026-10-10"))?.rateDate, "2026-10-09");
  assert.deepEqual(result.missing, []);
  assert.equal(run.calls.length, 3);
});

test("a cache entry published after its expense date is ignored", async () => {
  const storage = memoryStore({ [RATE_CACHE_KEY]: JSON.stringify({ v: 1, pairs: { "USD>KRW": { "2026-10-09": ["2026-10-10", 1, 0, at("2026-10-20"), 1] } } }) });
  const run = harness({ now: at("2026-10-20"), storage, respond: () => series("USD", "KRW", { "2026-10-09": 1375.5 }) });
  const result = await loadRates("KRW", new Map([["USD", ["2026-10-09"]]]), run.deps);
  assert.equal(result.rates.get(rateKey("USD", "2026-10-09"))?.rate, 1375.5);
  assert.equal(run.calls.length, 1);
});

test("cache entries cannot claim future timestamps or impossible publication windows", async () => {
  const now = at("2026-10-20");
  for (const [date, point] of [
    ["2026-10-09", ["2026-10-09", 1, 0, now + DAY, 1]],
    ["2026-10-09", ["2026-09-01", 1, 0, now, 1]],
    ["2026-12-24", ["2026-11-01", 1, 0, now, 1]],
    ["2026-10-09", ["2026-10-09", 1, 0, -1, 1]],
  ] as const) {
    const storage = memoryStore({ [RATE_CACHE_KEY]: JSON.stringify({ v: 1, pairs: { "USD>KRW": { [date]: point } } }) });
    const run = harness({ now, storage, online: false, respond: () => new Error("must not be called") });
    const result = await loadRates("KRW", new Map([["USD", [date]]]), run.deps);
    assert.equal(result.rates.size, 0);
    assert.deepEqual(result.missing, [{ currency: "USD", date }]);
    assert.equal(run.calls.length, 0);
  }
});

test("fallback and prematurely finalized cache entries remain refreshable", async () => {
  const now = at("2026-10-20");
  for (const [date, point] of [
    ["2026-10-09", ["2026-10-09", 1, 1, at("2026-10-15"), 1]],
    ["2026-10-19", ["2026-10-19", 1, 0, at("2026-10-19"), 1]],
  ] as const) {
    const storage = memoryStore({ [RATE_CACHE_KEY]: JSON.stringify({ v: 1, pairs: { "USD>KRW": { [date]: point } } }) });
    const run = harness({ now, storage, respond: () => series("USD", "KRW", { [date]: 1380 }) });
    const result = await loadRates("KRW", new Map([["USD", [date]]]), run.deps);
    assert.equal(result.rates.get(rateKey("USD", date))?.rate, 1380);
    assert.equal(run.calls.length, 1);
  }
});

test("days before the fallback's first publication do not trigger fallback requests", async () => {
  const run = harness({ now: at("2026-10-20"), respond: () => new Error("down") });
  const result = await loadRates("KRW", new Map([["USD", ["2023-05-01"]]]), run.deps);
  assert.deepEqual(result.missing, [{ currency: "USD", date: "2023-05-01" }]);
  assert.deepEqual(run.calls, ["https://api.frankfurter.dev/v2/rates?base=USD&quotes=KRW&from=2023-04-21&to=2023-05-01"]);
});

test("offline loads use whatever is stored and never touch the network", async () => {
  const storage = memoryStore();
  const online = harness({ now: at("2026-10-12", 9), storage, respond: () => series("USD", "KRW", { "2026-10-12": 1380 }) });
  await loadRates("KRW", new Map([["USD", ["2026-10-12"]]]), online.deps);
  const offline = harness({ now: at("2026-10-14"), online: false, storage, respond: () => new Error("must not be called") });
  const result = await loadRates("KRW", new Map([["USD", ["2026-10-12", "2026-10-13"]]]), offline.deps);
  assert.equal(offline.calls.length, 0);
  assert.equal(result.rates.get(rateKey("USD", "2026-10-12"))?.rate, 1380);
  assert.deepEqual(result.missing, [{ currency: "USD", date: "2026-10-13" }]);
  assert.equal(result.failed, false);
});

test("an unreadable or tampered cache is ignored and rebuilt", async () => {
  for (const stored of ["{broken", JSON.stringify({ v: 2, pairs: {} }), JSON.stringify({ v: 1, pairs: { "USD>KRW": { "2026-10-09": ["2026-10-09", -5, 0, 1, 1], "nope": ["2026-10-09", 1, 0, 1, 1] }, "usd>krw": { "2026-10-09": ["2026-10-09", 1, 0, 1, 1] } } })]) {
    const storage = memoryStore({ [RATE_CACHE_KEY]: stored });
    const run = harness({ now: at("2026-10-20"), storage, respond: () => series("USD", "KRW", { "2026-10-09": 1375.5 }) });
    const result = await loadRates("KRW", new Map([["USD", ["2026-10-09"]]]), run.deps);
    assert.equal(result.rates.get(rateKey("USD", "2026-10-09"))?.rate, 1375.5);
    assert.equal(run.calls.length, 1);
    assert.deepEqual(JSON.parse(storage.data.get(RATE_CACHE_KEY) ?? "null"), { v: 1, pairs: { "USD>KRW": { "2026-10-09": ["2026-10-09", 1375.5, 0, at("2026-10-20"), 1] } } });
  }
});

test("requests carry only currency codes and dates, never ledger contents", async () => {
  const source = ledger([{ currency: "USD", occurredOn: "2026-10-09", description: "비밀 선물 가게" }, { currency: "JPY", occurredOn: "2023-01-05", description: "료칸" }, { currency: "USD", occurredOn: "2026-10-18" }]);
  const run = harness({ now: at("2026-10-19"), storage: null, respond: () => new Error("offline service") });
  const result = await loadRates("KRW", requiredRates(source, "KRW"), run.deps);
  assert.equal(result.failed, true);
  assert.ok(run.calls.length >= 4);
  const allowed = /^https:\/\/(?:api\.frankfurter\.dev\/v2\/rates\?base=[A-Z]{3}&quotes=[A-Z]{3}&from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}|cdn\.jsdelivr\.net\/npm\/@fawazahmed0\/currency-api@(?:\d{4}-\d{2}-\d{2}|latest)\/v1\/currencies\/[a-z]{3}\.min\.json|(?:\d{4}-\d{2}-\d{2}|latest)\.currency-api\.pages\.dev\/v1\/currencies\/[a-z]{3}\.min\.json)$/;
  for (const url of run.calls) {
    assert.match(url, allowed);
    for (const secret of ["비밀", "료칸", "지민", "민수", "ledger-1", "1000", encodeURIComponent("뉴욕")]) assert.equal(url.includes(secret), false, url);
  }
  assert.ok(run.calls.some((url) => url.includes("@latest/")), "a day that is not settled yet may use the latest file");
});

test("manual rates accept one decimal separator and refuse ambiguous thousands", () => {
  for (const [input, expected] of [["1380", "1380"], ["1380.50", "1380.5"], [" 1 380,5 ", "1380.5"], ["0,925", "0.925"], ["0.0007", "0.0007"], ["007.10", "7.1"], ["12,5", "12.5"], ["1380.000", "1380"]] as const) assert.equal(normalizeManualRate(input), expected, input);
  for (const invalid of ["", "0", "0.0", "-3", "1,380", "12,345", "1,380.5", "1.380,5", "abc", "1e3", "1.2.3", "1234567890", "1.123456789"]) assert.equal(normalizeManualRate(invalid), null, invalid);
  assert.equal(parseManualRate("1380.5"), 1380.5);
  assert.equal(parseManualRate("1,380"), null);
});

test("changing the target clears rates belonging to the old currency pair", () => {
  const original = Object.freeze({ enabled: true, target: "KRW", manualRates: Object.freeze({ USD: "1380.50", JPY: "9.2" }) });
  assert.deepEqual(withFxTarget(original, "KRW"), { enabled: true, target: "KRW", manualRates: { USD: "1380.5", JPY: "9.2" } });
  const changed = withFxTarget(original, "EUR");
  assert.deepEqual(changed, { enabled: true, target: "EUR", manualRates: {} });
  assert.deepEqual(withFxTarget(changed, "KRW").manualRates, {});
  assert.deepEqual(original.manualRates, { USD: "1380.50", JPY: "9.2" });
  assert.throws(() => withFxTarget(original, "eur"), /target currency/);
  const storage = memoryStore();
  writeFxSettings(storage, "trip", changed);
  assert.deepEqual(readFxSettings(storage, "trip", "USD"), changed);
});

test("converted-settlement preferences stay per ledger and survive bad stored data", () => {
  assert.deepEqual([defaultFxTarget("ko"), defaultFxTarget("en"), defaultFxTarget("fr")], ["KRW", "USD", "EUR"]);
  const storage = memoryStore();
  assert.deepEqual(readFxSettings(storage, "ledger-1", "KRW"), { enabled: false, target: "KRW", manualRates: {} });
  writeFxSettings(storage, "ledger-1", { enabled: true, target: "KRW", manualRates: { USD: "1380.50", KRW: "1", jpy: "9", EUR: "abc" } }, 10);
  writeFxSettings(storage, "ledger-2", { enabled: false, target: "EUR", manualRates: {} }, 20);
  assert.deepEqual(readFxSettings(storage, "ledger-1", "USD"), { enabled: true, target: "KRW", manualRates: { USD: "1380.5" } });
  assert.deepEqual(readFxSettings(storage, "ledger-2", "USD"), { enabled: false, target: "EUR", manualRates: {} });
  assert.deepEqual(readFxSettings(storage, "__proto__", "USD"), { enabled: false, target: "USD", manualRates: {} });
  writeFxSettings(storage, "bad id!", { enabled: true, target: "KRW", manualRates: {} });
  writeFxSettings(storage, "ledger-3", { enabled: true, target: "krw", manualRates: {} });
  assert.deepEqual(Object.keys(JSON.parse(storage.data.get(FX_SETTINGS_KEY) ?? "{}").ledgers).sort(), ["ledger-1", "ledger-2"]);
  for (let index = 0; index < 130; index += 1) writeFxSettings(storage, `trip-${index}`, { enabled: true, target: "KRW", manualRates: {} }, 100 + index);
  const kept = Object.keys(JSON.parse(storage.data.get(FX_SETTINGS_KEY) ?? "{}").ledgers);
  assert.equal(kept.length, 100);
  assert.ok(kept.includes("trip-129") && !kept.includes("trip-0") && !kept.includes("ledger-1"));
  for (const broken of ["{oops", JSON.stringify({ v: 1, ledgers: { a: { e: 1, t: "won", m: {} }, b: 5, c: { e: 1, t: "KRW", m: { USD: "1,380" } } } })]) {
    const damaged = memoryStore({ [FX_SETTINGS_KEY]: broken });
    assert.deepEqual(readFxSettings(damaged, "a", "USD"), { enabled: false, target: "USD", manualRates: {} });
    assert.deepEqual(readFxSettings(damaged, "c", "USD"), broken.startsWith("{oops") ? { enabled: false, target: "USD", manualRates: {} } : { enabled: true, target: "KRW", manualRates: {} });
  }
  assert.doesNotThrow(() => writeFxSettings(null, "ledger-1", { enabled: true, target: "KRW", manualRates: {} }));
  assert.deepEqual(readFxSettings(null, "ledger-1", "EUR"), { enabled: false, target: "EUR", manualRates: {} });
});
