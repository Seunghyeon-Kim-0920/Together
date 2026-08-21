import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { join } from "node:path";
import { SUPPORTED_LOCALES } from "../lib/domain";
import { LANGUAGE_TAGS, LOCALE_NAMES, MESSAGES } from "../lib/i18n";

const visibleComponentFiles = [
  "app/TogetherApp.tsx",
  "app/components/Header.tsx",
  "app/components/BottomNav.tsx",
  "app/components/RoutePlanner.tsx",
  "app/components/RouteMap.tsx",
  "app/components/ExpensesPanel.tsx",
  "app/components/ProfilePanel.tsx",
  "app/components/TripsPanel.tsx",
];

const visibleComponentSource = () => visibleComponentFiles
  .map((file) => readFileSync(join(process.cwd(), file), "utf8"))
  .join("\n");

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

test("route hero uses one localized efficiency headline without the retired subtitle", () => {
  assert.deepEqual(
    SUPPORTED_LOCALES.map((locale) => MESSAGES[locale].routeTitle),
    [
      "가장 효율적인 여행 동선",
      "The most efficient travel route",
      "L’itinéraire de voyage le plus efficace",
      "最も効率的な旅行ルート",
      "最高效的旅行路线",
    ],
  );
  for (const locale of SUPPORTED_LOCALES) {
    assert.equal("routeDescription" in MESSAGES[locale], false, `${locale} still has the retired route subtitle`);
  }
  assert.doesNotMatch(
    JSON.stringify(MESSAGES),
    /모든 후보 구간의 공개 출발·도착 시간이 확인되어야 결과를 표시합니다|현재 항공 운행표 공급자가 연결되지 않아 항공 구간은 만들지 않습니다/,
  );
});

test("new route, map, device-storage, and empty-state messages exist in every locale", () => {
  const requiredKeys = [
    "startCity", "endCity", "fastApproximation",
    "routeMap", "mapControls", "zoomIn", "zoomOut", "fitMap", "mapHelp", "mapAttribution",
    "deviceOnly", "deviceStorageHelp", "deviceSaveError", "storageLimit",
    "people", "personName", "addPerson", "chooseYourself", "duplicatePerson", "personInUse",
    "addPeopleFirst", "membersCount", "noExpenses", "noSettlement",
  ];
  for (const locale of SUPPORTED_LOCALES) {
    for (const key of requiredKeys) {
      assert.ok(key in MESSAGES[locale], `${locale} is missing ${key}`);
    }
  }
});

test("retired login, city-cap, and demonstration-copy keys cannot reappear", () => {
  const retiredKeys = [
    "signIn", "signOut", "signInToSave", "noAccountData", "fixedStart", "scheduleLimit",
    "tripName", "members", "sampleStay", "sampleRail", "sampleDinner", "sampleMuseum",
    "sampleGroceries", "euro",
  ];
  for (const locale of SUPPORTED_LOCALES) {
    for (const key of retiredKeys) assert.equal(key in MESSAGES[locale], false, `${locale} still has retired key ${key}`);
  }
});

test("login wording is absent from every locale dictionary", () => {
  const forbiddenByLocale = {
    ko: ["로그인", "로그아웃"],
    en: ["Sign in", "sign in", "sign-in", "signed-in", "Log in", "log in", "logout"],
    fr: ["Se connecter", "Connectez-vous", "déconnecter"],
    ja: ["ログイン", "ログアウト"],
    zh: ["登录", "登入", "退出登录"],
  } as const;
  for (const locale of SUPPORTED_LOCALES) {
    const copy = Object.values(MESSAGES[locale]).join("\n");
    for (const forbidden of forbiddenByLocale[locale]) {
      assert.equal(copy.includes(forbidden), false, `${locale} still contains login wording: ${forbidden}`);
    }
  }
});

test("interpolation placeholders match across every locale", () => {
  const placeholders = (value: string) => [...value.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map((match) => match[1]).sort();
  for (const key of Object.keys(MESSAGES.en) as Array<keyof typeof MESSAGES.en>) {
    const expected = placeholders(MESSAGES.en[key]);
    for (const locale of SUPPORTED_LOCALES) {
      assert.deepEqual(placeholders(MESSAGES[locale][key]), expected, `${locale}.${key} placeholders`);
    }
  }
});

test("locale dictionaries do not contain text from an unrelated writing system", () => {
  const combined = (locale: keyof typeof MESSAGES) => [
    ...Object.values(MESSAGES[locale]),
    ...Object.values(LOCALE_NAMES[locale]),
  ].join("\n");
  assert.doesNotMatch(combined("ko"), /[\u3040-\u30ff\u3400-\u9fff]/u, "Korean copy contains Japanese or Han text");
  assert.doesNotMatch(combined("en"), /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/u, "English copy contains CJK text");
  assert.doesNotMatch(combined("fr"), /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/u, "French copy contains CJK text");
  assert.doesNotMatch(combined("ja"), /[\uac00-\ud7af]/u, "Japanese copy contains Korean text");
  assert.doesNotMatch(combined("zh"), /[\u3040-\u30ff\uac00-\ud7af]/u, "Chinese copy contains Japanese or Korean text");
});

test("visible component source contains no known language leaks or literal accessibility copy", () => {
  const source = visibleComponentSource();
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

  for (const match of source.matchAll(/(?:aria-label|title|placeholder|alt)\s*=\s*["']([^"']+)["']/g)) {
    assert.fail(`found literal user-facing attribute: ${match[0]}`);
  }
});

test("every literal translate key used by visible components exists", () => {
  const source = visibleComponentSource();
  for (const call of source.matchAll(/translate\(locale,\s*([^)]*)\)/g)) {
    for (const literal of call[1].matchAll(/["']([A-Za-z][A-Za-z0-9_]*)["']/g)) {
      assert.ok(literal[1] in MESSAGES.en, `component references missing translation key ${literal[1]}`);
    }
  }
});
