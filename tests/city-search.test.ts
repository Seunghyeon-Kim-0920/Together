import assert from "node:assert/strict";
import test from "node:test";

import {
  CITY_SEARCH_MAX_RESULTS,
  parseCitySearchClientIp,
  parseCitySearchQuery,
  parseOpenMeteoGeocodingResponse,
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
    parseCitySearchQuery(new URLSearchParams({ q: "Reykjavik", locale: "en", translations: "1" })),
    { ok: true, query: "Reykjavik", locale: "en", includeTranslations: true },
  );
  assert.equal(
    parseCitySearchQuery(new URLSearchParams({ q: "P" })).ok,
    false,
  );
  assert.equal(
    parseCitySearchQuery(new URLSearchParams({ q: "Paris", locale: "de" })).ok,
    false,
  );
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
