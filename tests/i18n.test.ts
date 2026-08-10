import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { join } from "node:path";
import { SUPPORTED_LOCALES } from "../lib/domain";
import { LANGUAGE_TAGS, LOCALE_NAMES, MESSAGES } from "../lib/i18n";

test("all five locale dictionaries have the same complete key set", () => {
  const expected = Object.keys(MESSAGES.en).sort();
  for (const locale of SUPPORTED_LOCALES) {
    assert.deepEqual(Object.keys(MESSAGES[locale]).sort(), expected, `${locale} key set`);
    assert.ok(LANGUAGE_TAGS[locale]);
    for (const value of Object.values(MESSAGES[locale])) {
      assert.ok(value.trim().length > 0, `${locale} has an empty translation`);
      assert.equal(value.includes("�"), false, `${locale} has a replacement character`);
    }
    for (const option of SUPPORTED_LOCALES) assert.ok(LOCALE_NAMES[locale][option].trim());
  }
});

test("visible component source contains none of the known language leaks", () => {
  const files = [
    "app/TogetherApp.tsx",
    "app/components/Header.tsx",
    "app/components/BottomNav.tsx",
    "app/components/RoutePlanner.tsx",
    "app/components/ExpensesPanel.tsx",
  ];
  const source = files.map((file) => readFileSync(join(process.cwd(), file), "utf8")).join("\n");
  for (const leak of [
    'aria-label="Primary navigation"',
    'aria-label="Mobile navigation"',
    'aria-label="Move up"',
    'aria-label="Move down"',
    'aria-label="Close"',
    '"Paris apartment"',
    '"TGV tickets"',
    '"Dinner together"',
    '"Louvre tickets"',
    '"Groceries"',
    ">EUR<",
    "N =",
    "> UTC<",
  ]) assert.equal(source.includes(leak), false, `found untranslated text: ${leak}`);
});
