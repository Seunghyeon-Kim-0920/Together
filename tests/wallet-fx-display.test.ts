import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CompactFxSettings, type CompactFxState } from "../src/components/CompactFxSettings";
import { settleInCurrency } from "../src/lib/convertedSettlement";
import { rateKey, type RatePoint } from "../src/lib/exchangeRates";
import { fxText } from "../src/lib/fxI18n";
import { convertExpenseAmounts, rateSummaryLine, summarizeRates } from "../src/lib/fxSummary";
import { SUPPORTED_LOCALES, type TravelLedger } from "../src/lib/types";

const ledger: TravelLedger = {
  selfParticipantId: "a",
  id: "synthetic-fx-trip", title: "Example trip", kind: "travel", defaultCurrency: "USD", currencies: ["USD", "KRW", "JPY"],
  createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z", participants: [{ id: "a", name: "A" }, { id: "b", name: "B" }],
  expenses: [
    { id: "usd", description: "Example meal", category: "food", currency: "USD", minorUnits: 1050, occurredOn: "2026-10-10", paidBy: "a", shares: [{ participantId: "a", minorUnits: 525 }, { participantId: "b", minorUnits: 525 }] },
    { id: "krw", description: "Example ticket", category: "transport", currency: "KRW", minorUnits: 5000, occurredOn: "2026-10-10", paidBy: "b", shares: [{ participantId: "a", minorUnits: 2500 }, { participantId: "b", minorUnits: 2500 }] },
    { id: "jpy", description: "Example shop", category: "shopping", currency: "JPY", minorUnits: 3000, occurredOn: "2026-10-11", paidBy: "a", shares: [{ participantId: "a", minorUnits: 1500 }, { participantId: "b", minorUnits: 1500 }] },
  ],
};

test("displayed entry conversions add up to the exact converted settlement total without mutating the ledger", () => {
  const before = JSON.stringify(ledger);
  const resolve = (currency: string) => currency === "USD" ? 1380.5 : currency === "JPY" ? 9.1234 : null;
  const amounts = convertExpenseAmounts(ledger.expenses, "KRW", resolve);
  const settlement = settleInCurrency(ledger, "KRW", resolve);
  assert.deepEqual([...amounts], [["usd", 14495], ["krw", 5000], ["jpy", 27370]]);
  assert.equal([...amounts.values()].reduce<number>((total, value) => total + (value ?? 0), 0), settlement.totalMinor);
  assert.equal(JSON.stringify(ledger), before);
});

test("missing and invalid display rates remain null, never zero, while same-currency amounts need no rate", () => {
  for (const rate of [null, -1, 0, Number.NaN, Number.POSITIVE_INFINITY]) {
    const amounts = convertExpenseAmounts(ledger.expenses, "KRW", () => rate);
    assert.equal(amounts.get("usd"), null);
    assert.equal(amounts.get("jpy"), null);
    assert.equal(amounts.get("krw"), 5000);
  }
  assert.equal(convertExpenseAmounts(ledger.expenses, "KRW", () => { throw new Error("unavailable"); }).get("usd"), null);
});

test("rate summaries show the actual publication date for weekend transactions", () => {
  const point: RatePoint = { rate: 1380, rateDate: "2026-10-09", source: "frankfurter", final: true, fetchedAt: 1 };
  const rates = new Map([[rateKey("USD", "2026-10-10"), point]]);
  const summaries = summarizeRates(ledger, "KRW", {}, rates);
  assert.equal(summaries[0].firstDate, "2026-10-09");
  assert.equal(summaries[0].lastDate, "2026-10-09");
  for (const locale of SUPPORTED_LOCALES) {
    const label = rateSummaryLine(summaries[0], "KRW", locale);
    assert.ok(label.includes("2026-10-09"));
    assert.ok(!label.includes("2026-10-10"));
  }
});

test("manual rates take precedence and all display text is available in supported languages", () => {
  const summaries = summarizeRates(ledger, "KRW", { USD: 1400 }, new Map());
  assert.equal(summaries[0].manual, true);
  assert.equal(summaries[0].minRate, 1400);
  for (const locale of SUPPORTED_LOCALES) for (const key of ["referenceTotal", "unavailable", "target", "title", "settings", "off", "manualDevice", "settlementIn"] as const) {
    assert.ok(fxText(locale, key).length > 0);
    if (locale !== "ko") assert.doesNotMatch(fxText(locale, key), /[가-힣]/);
  }
});

test("rate controls occupy one closed row in each language, even with missing rates or a saved configuration", () => {
  for (const enabled of [false, true]) for (const locale of SUPPORTED_LOCALES) {
    const fx: CompactFxState = {
      settings: { enabled, target: "CAD", manualRates: { USD: "1.4" } },
      ready: true, online: false, rates: new Map(), summaries: [], foreign: ["USD"],
      save: () => assert.fail("rendering must not change the currency preference"), retry: () => assert.fail("no network on render"),
    };
    const output = renderToStaticMarkup(createElement(CompactFxSettings, { locale, fx, missingCurrencies: ["USD"], onNotify: () => {} }));
    assert.match(output, /aria-expanded="false"/);
    assert.equal((output.match(/<button\b/g) ?? []).length, 1);
    assert.doesNotMatch(output, /<select\b|<option\b|<input\b|Frankfurter/);
    assert.ok(output.includes(fxText(locale, "settings")));
    assert.ok(output.includes(enabled ? "CAD" : fxText(locale, "off")));
  }
});

test("the travel screen shares one FX state across entries, summary and settlement", () => {
  const screen = readFileSync(new URL("../src/components/TravelLedgerView.tsx", import.meta.url), "utf8");
  const panel = readFileSync(new URL("../src/components/ConvertedSettlement.tsx", import.meta.url), "utf8");
  assert.equal((screen.match(/useTravelFx\(ledger, locale\)/g) ?? []).length, 1);
  assert.ok(screen.includes("fx.settlement?.complete"));
  assert.ok(screen.includes("<TravelExpenseAmount"));
  assert.ok(screen.includes("fx={fx} showSettlement="));
  assert.ok(screen.includes("onImport ? <button"));
  assert.doesNotMatch(panel, /loadRates\(/);
  const controls = readFileSync(new URL("../src/components/CompactFxSettings.tsx", import.meta.url), "utf8");
  assert.ok(panel.includes("<CompactFxSettings"));
  assert.ok(controls.includes("save(withFxTarget(settings, event.target.value))"));
});
