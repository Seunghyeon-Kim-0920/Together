import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { generalCategoryLabel, t, travelCategoryLabel, type MessageKey } from "../src/lib/i18n";
import { GENERAL_CATEGORIES, SUPPORTED_LOCALES, TRAVEL_CATEGORIES } from "../src/lib/types";

const representativeKeys: MessageKey[] = ["newLedger", "travelLedger", "generalLedger", "participants", "settlement", "share", "exportPdf", "currentMonth", "comparedToPrevious", "yearlySpending", "categorySpending", "storageHelp"];

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
  assert.match(source, /지갑의 일기/);
});
