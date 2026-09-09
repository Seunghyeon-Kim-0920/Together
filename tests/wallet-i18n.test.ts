import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { generalCategoryLabel, t, travelCategoryLabel, type MessageKey } from "../src/lib/i18n";
import { designText } from "../src/lib/designI18n";
import { GENERAL_CATEGORIES, SUPPORTED_LOCALES, TRAVEL_CATEGORIES } from "../src/lib/types";

const representativeKeys: MessageKey[] = ["newLedger", "travelLedger", "generalLedger", "edit", "editExpense", "saveChanges", "expenseUpdated", "participants", "settlement", "share", "exportPdf", "selectMonth", "selectYear", "selectedMonthSpending", "comparedToPrevious", "comparedToAnnualAverage", "yearlySpending", "yearlyCategorySpending", "categorySpending", "statsFilter", "monthlyLimit", "monthlyLimitNear", "cardAutomation", "automationDisclosure", "registeredSources", "pendingExpenses", "confirmExpense", "storageHelp"];

test("the app exposes exactly Korean, English, and French", () => {
  assert.deepEqual(SUPPORTED_LOCALES, ["ko", "en", "fr"]);
});

test("every supported language covers the product and category vocabulary", () => {
  for (const locale of SUPPORTED_LOCALES) {
    for (const key of representativeKeys) assert.ok(t(locale, key).trim(), `${locale}:${key}`);
    for (const category of TRAVEL_CATEGORIES) assert.ok(travelCategoryLabel(locale, category).trim());
    for (const category of GENERAL_CATEGORIES) assert.ok(generalCategoryLabel(locale, category).trim());
  }
});

test("the new app shell contains no route, trip library, profile, or login feature", () => {
  const source = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  for (const retired of ["RouteMap", "SavedTrips", "Profile", "login", "로그인", "Together"]) assert.equal(source.includes(retired), false, retired);
  assert.match(source, /design\(locale, "brand"\)/);
  assert.equal(designText("ko", "brand"), "지갑의 일기");
  assert.equal(designText("en", "brand"), "Wallet Diary");
  assert.equal(designText("fr", "brand"), "Journal du portefeuille");
});

test("the redesigned navigation and actions are localized in every supported language", () => {
  const keys = ["overview", "entries", "statistics", "people", "settle", "recentEntries", "viewAll", "recordExpense", "dailyPurpose", "travelPurpose", "emptyTitle", "emptyBody", "automationTitle", "selectedMonthBudget", "sharePdf", "savePdf", "mergeEntries"] as const;
  for (const key of keys) {
    const values = SUPPORTED_LOCALES.map((locale) => designText(locale, key));
    assert.ok(values.every((value) => value.trim().length > 0), key);
    assert.ok(!/[가-힣]/u.test(values[1]), `English ${key}`);
    assert.ok(!/[가-힣]/u.test(values[2]), `French ${key}`);
  }
});
