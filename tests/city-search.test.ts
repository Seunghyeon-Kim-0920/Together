import assert from "node:assert/strict";
import test from "node:test";

import {
  CITY_SEARCH_MAX_RESULTS,
  GET,
  japaneseCityFallbackQueries,
  parseCitySearchClientIp,
  parseCitySearchQuery,
  parseOpenMeteoCityResponse,
  parseOpenMeteoGeocodingResponse,
  safeLocalizedCityName,
} from "../app/api/cities/search/route.js";

test("city search query validates length and maps the five supported locales", () => {
  assert.deepEqual(
    parseCitySearchQuery(new URLSearchParams({ q: " 서울 ", locale: "ko-KR" })),
    { ok: true, query: "서울", locale: "ko", includeTranslations: false },
  );
  assert.deepEqual(
    parseCitySearchQuery(new URLSearchParams({ q: "Paris", locale: "fr-FR" })),
    { ok: true, query: "Paris", locale: "fr", includeTranslations: false },
  );
  assert.deepEqual(
    parseCitySearchQuery(new URLSearchParams({ q: "東京", locale: "ja-JP" })),
    { ok: true, query: "東京", locale: "ja", includeTranslations: false },
  );
  assert.deepEqual(
    parseCitySearchQuery(new URLSearchParams({ q: "上海", locale: "zh-CN" })),
    { ok: true, query: "上海", locale: "zh", includeTranslations: false },
  );
  assert.deepEqual(
    parseCitySearchQuery(new URLSearchParams({ q: "London", locale: "en-US" })),
    { ok: true, query: "London", locale: "en", includeTranslations: false },
  );
  assert.deepEqual(
    parseCitySearchQuery(new URLSearchParams({ q: "Reykjavik", locale: "en", translations: "1", providerId: "3413829" })),
    { ok: true, query: "Reykjavik", locale: "en", includeTranslations: true, providerId: 3413829 },
  );
  assert.equal(
    parseCitySearchQuery(new URLSearchParams({ q: "P" })).ok,
    false,
  );
  assert.equal(
    parseCitySearchQuery(new URLSearchParams({ q: "Paris", translations: "1" })).ok,
    false,
  );
  assert.equal(
    parseCitySearchQuery(new URLSearchParams({ q: "Paris", locale: "de" })).ok,
    false,
  );
});

test("provider-id city hydration parses direct responses and blocks foreign-script fallbacks", () => {
  const florence = parseOpenMeteoCityResponse({
    id: 3176959,
    name: "피렌체",
    latitude: 43.77925,
    longitude: 11.24626,
    feature_code: "PPLA",
    country_code: "IT",
    timezone: "Europe/Rome",
    country: "이탈리아",
  });
  assert.ok(florence);
  assert.equal(florence.providerId, 3176959);
  assert.equal(safeLocalizedCityName("피렌체", "ko", florence), "피렌체");
  assert.equal(safeLocalizedCityName("フィレンツェ", "ja", florence), "フィレンツェ");
  assert.equal(safeLocalizedCityName("佛罗伦萨", "zh", florence), "佛罗伦萨");
  assert.equal(safeLocalizedCityName("피렌체", "fr", florence), "IT 43.779, 11.246");
  assert.equal(safeLocalizedCityName("Firenze", "ko", florence), "IT 43.779, 11.246");
});

test("Japanese city spelling fallback is restricted to exactly two Han characters", () => {
  assert.deepEqual(japaneseCityFallbackQueries("東京", "ja"), ["東京市", "東京都"]);
  assert.deepEqual(japaneseCityFallbackQueries("京都", "ja"), ["京都市", "京都都"]);
  assert.deepEqual(japaneseCityFallbackQueries("東京", "zh"), []);
  assert.deepEqual(japaneseCityFallbackQueries("とうきょう", "ja"), []);
  assert.deepEqual(japaneseCityFallbackQueries("横浜市", "ja"), []);
});

function providerCity(id: number, name: string) {
  return {
    id,
    name,
    latitude: 35.68,
    longitude: 139.76,
    feature_code: "PPLA",
    country_code: "JP",
    timezone: "Asia/Tokyo",
    country: "日本",
  };
}

test("Japanese Tokyo and Kyoto searches use bounded suffix fallbacks", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    const query = url.searchParams.get("name") ?? "";
    calls.push(query);
    if (query === "東京都") return Response.json({ results: [providerCity(1850147, "東京都")] });
    if (query === "京都市") return Response.json({ results: [providerCity(1857910, "京都市")] });
    return Response.json({});
  };
  try {
    const tokyoResponse = await GET(new Request("https://example.test/api/cities/search?q=%E6%9D%B1%E4%BA%AC&locale=ja", {
      headers: { "cf-connecting-ip": "203.0.113.31" },
    }));
    const tokyo = await tokyoResponse.json() as { results: Array<{ providerId: number }>; meta: { requestCost: number; fallbackQueriesTried: string[] } };
    assert.equal(tokyo.results[0].providerId, 1850147);
    assert.equal(tokyo.meta.requestCost, 3);
    assert.deepEqual(tokyo.meta.fallbackQueriesTried, ["東京市", "東京都"]);
    assert.deepEqual(calls, ["東京", "東京市", "東京都"]);

    calls.length = 0;
    const kyotoResponse = await GET(new Request("https://example.test/api/cities/search?q=%E4%BA%AC%E9%83%BD&locale=ja", {
      headers: { "cf-connecting-ip": "203.0.113.32" },
    }));
    const kyoto = await kyotoResponse.json() as { results: Array<{ providerId: number }>; meta: { requestCost: number } };
    assert.equal(kyoto.results[0].providerId, 1857910);
    assert.equal(kyoto.meta.requestCost, 2);
    assert.deepEqual(calls, ["京都", "京都市"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Japanese fallback performs no retry after a hit and never runs for other locales", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    const query = url.searchParams.get("name") ?? "";
    calls.push(query);
    return query === "横浜"
      ? Response.json({ results: [providerCity(1848354, "横浜")] })
      : Response.json({});
  };
  try {
    const hitResponse = await GET(new Request("https://example.test/api/cities/search?q=%E6%A8%AA%E6%B5%9C&locale=ja", {
      headers: { "cf-connecting-ip": "203.0.113.33" },
    }));
    const hit = await hitResponse.json() as { meta: { requestCost: number; fallbackQueriesTried: string[] } };
    assert.equal(hit.meta.requestCost, 1);
    assert.deepEqual(hit.meta.fallbackQueriesTried, []);
    assert.deepEqual(calls, ["横浜"]);

    calls.length = 0;
    const otherLocaleResponse = await GET(new Request("https://example.test/api/cities/search?q=%E6%9D%B1%E4%BA%AC&locale=zh", {
      headers: { "cf-connecting-ip": "203.0.113.34" },
    }));
    const otherLocale = await otherLocaleResponse.json() as { meta: { requestCost: number; fallbackQueriesTried: string[] } };
    assert.equal(otherLocale.meta.requestCost, 1);
    assert.deepEqual(otherLocale.meta.fallbackQueriesTried, []);
    assert.deepEqual(calls, ["東京"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("translation hydration calls the stable provider id endpoint once per locale", async () => {
  const originalFetch = globalThis.fetch;
  const calls: URL[] = [];
  const localized = {
    ko: { name: "피렌체", country: "이탈리아" },
    en: { name: "Florence", country: "Italy" },
    fr: { name: "Florence", country: "Italie" },
    ja: { name: "フィレンツェ", country: "イタリア" },
    zh: { name: "佛罗伦萨", country: "意大利" },
  } as const;
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    calls.push(url);
    const locale = url.searchParams.get("language") as keyof typeof localized;
    return Response.json({
      id: 3176959,
      ...localized[locale],
      latitude: 43.77925,
      longitude: 11.24626,
      feature_code: "PPLA",
      country_code: "IT",
      timezone: "Europe/Rome",
    });
  };
  try {
    const response = await GET(new Request("https://example.test/api/cities/search?q=%ED%94%BC%EB%A0%8C%EC%B2%B4&locale=ko&translations=1&providerId=3176959", {
      headers: { "cf-connecting-ip": "203.0.113.21" },
    }));
    assert.equal(response.status, 200);
    const payload = await response.json() as { results: Array<{ providerId: number; names: Record<string, string> }> };
    assert.equal(payload.results[0].providerId, 3176959);
    assert.deepEqual(payload.results[0].names, {
      ko: "피렌체",
      en: "Florence",
      fr: "Florence",
      ja: "フィレンツェ",
      zh: "佛罗伦萨",
    });
    assert.equal(calls.length, 5);
    assert.ok(calls.every((url) => url.pathname === "/v1/get"));
    assert.ok(calls.every((url) => url.searchParams.get("id") === "3176959"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Open-Meteo parser returns only valid populated places with stable ids", () => {
  const fixtureResults = Array.from({ length: 10 }, (_, index) => ({
    id: 1_000 + index,
    name: `City ${index}`,
    latitude: 40 + index / 10,
    longitude: 2 + index / 10,
    feature_code: index === 2 ? "AIRP" : index === 3 ? "AADM1" : "PPLA",
    country_code: "FR",
    timezone: "Europe/Paris",
    country: "France",
    admin1: "Île-de-France",
    population: 1_000_000 - index,
  }));
  fixtureResults.push({
    ...fixtureResults[0],
    name: "Duplicate provider id",
  });

  const parsed = parseOpenMeteoGeocodingResponse({ results: fixtureResults });
  assert.ok(parsed);
  assert.equal(parsed.length, CITY_SEARCH_MAX_RESULTS);
  assert.equal(parsed.some((result) => result.providerId === 1_002), false);
  assert.equal(parsed.some((result) => result.providerId === 1_003), false);
  assert.equal(parsed.filter((result) => result.providerId === 1_000).length, 1);
  assert.deepEqual(parsed[0], {
    id: "open-meteo:1000",
    providerId: 1000,
    name: "City 0",
    country: "France",
    countryCode: "FR",
    admin1: "Île-de-France",
    latitude: 40,
    longitude: 2,
    timeZone: "Europe/Paris",
    population: 1_000_000,
  });
});

test("Open-Meteo parser rejects invalid envelopes and skips malformed cities", () => {
  assert.equal(parseOpenMeteoGeocodingResponse(null), null);
  assert.equal(parseOpenMeteoGeocodingResponse({ results: "bad" }), null);
  assert.deepEqual(parseOpenMeteoGeocodingResponse({}), []);
  assert.deepEqual(
    parseOpenMeteoGeocodingResponse({
      results: [
        {
          id: 1,
          name: "Invalid latitude",
          latitude: 91,
          longitude: 0,
          feature_code: "PPL",
          country_code: "FR",
          timezone: "Europe/Paris",
          country: "France",
        },
      ],
    }),
    [],
  );
});

test("city search client IP trusts only valid proxy header addresses", () => {
  assert.equal(
    parseCitySearchClientIp(
      new Request("https://example.test", {
        headers: { "cf-connecting-ip": "203.0.113.10" },
      }),
    ),
    "203.0.113.10",
  );
  assert.equal(
    parseCitySearchClientIp(
      new Request("https://example.test", {
        headers: {
          "cf-connecting-ip": "attacker-value",
          "x-forwarded-for": "2001:db8::8, 10.0.0.1",
        },
      }),
    ),
    "2001:db8::8",
  );
});
