import assert from "node:assert/strict";
import test from "node:test";

import {
  CITY_SEARCH_MAX_PROVIDER_RESPONSE_BYTES,
  CITY_SEARCH_MAX_RESULTS,
  GET,
  cityProviderSearchLocales,
  japaneseCityFallbackQueries,
  knownCityProviderIds,
  parseCitySearchClientIp,
  parseCitySearchQuery,
  parseOpenMeteoCityResponse,
  parseOpenMeteoGeocodingResponse,
  providerCityNameMatchesQuery,
  safeLocalizedCityName,
  wikidataSearchLocales,
} from "../app/api/cities/search/route.js";

test("city providers are rejected before or during oversized JSON reads", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => new Response("{}", {
      headers: {
        "content-type": "application/json",
        "content-length": String(CITY_SEARCH_MAX_PROVIDER_RESPONSE_BYTES + 1),
      },
    })) as typeof fetch;
    const declared = await GET(new Request(
      "https://example.test/api/cities/search?q=OversizedDeclaredCity&locale=en",
      { headers: { "cf-connecting-ip": "203.0.113.220" } },
    ));
    assert.equal(declared.status, 502);
    assert.equal(
      (await declared.json() as { error: { code: string } }).error.code,
      "invalid_geocoding_provider_response",
    );

    globalThis.fetch = (async () => {
      const chunk = new Uint8Array(300_000).fill(0x20);
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(chunk);
          controller.enqueue(chunk);
          controller.close();
        },
      }), { headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const streamed = await GET(new Request(
      "https://example.test/api/cities/search?q=OversizedStreamedCity&locale=en",
      { headers: { "cf-connecting-ip": "203.0.113.221" } },
    ));
    assert.equal(streamed.status, 502);
    assert.equal(
      (await streamed.json() as { error: { code: string } }).error.code,
      "invalid_geocoding_provider_response",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

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
  assert.deepEqual(
    parseCitySearchQuery(new URLSearchParams({ q: "빈", locale: "ko" })),
    { ok: true, query: "빈", locale: "ko", includeTranslations: false },
  );
  assert.equal(parseCitySearchQuery(new URLSearchParams({ q: "" })).ok, false);
  assert.equal(
    parseCitySearchQuery(new URLSearchParams({ q: "Paris", translations: "1" })).ok,
    false,
  );
  assert.equal(
    parseCitySearchQuery(new URLSearchParams({ q: "Paris", locale: "de" })).ok,
    false,
  );
});

test("multilingual Porto and Vienna aliases resolve to one populated-place id", () => {
  for (const alias of ["Porto", "porto", "포르투", "ポルト", "波尔图", "波爾圖"]) {
    assert.deepEqual(knownCityProviderIds(alias), [2735943], alias);
  }
  for (const alias of ["빈", "Vienna", "Wien", "Vienne", "ウィーン", "维也纳", "維也納"]) {
    assert.deepEqual(knownCityProviderIds(alias), [2761369], alias);
  }
  assert.deepEqual(knownCityProviderIds("P"), [], "one-character Latin searches must not be biased to a curated prefix");
});

test("Wikidata alias search language follows input script, not interface language", () => {
  assert.deepEqual(wikidataSearchLocales("피렌체", "en"), ["ko"]);
  assert.deepEqual(wikidataSearchLocales("ウィーン", "fr"), ["ja"]);
  assert.deepEqual(wikidataSearchLocales("京都", "en"), ["ja", "zh"]);
  assert.deepEqual(wikidataSearchLocales("維也納", "ko"), ["ja", "zh"]);
  assert.deepEqual(wikidataSearchLocales("Firenze", "ko"), ["en", "fr"]);
  assert.deepEqual(wikidataSearchLocales("Αθήνα", "ko"), ["el"]);
  assert.deepEqual(wikidataSearchLocales("Афины", "fr"), ["ru", "uk"]);
  assert.deepEqual(wikidataSearchLocales("أثينا", "ja"), ["ar"]);
  assert.deepEqual(cityProviderSearchLocales("아테네", "en"), ["ko"]);
  assert.deepEqual(cityProviderSearchLocales("Athens", "ko"), ["en", "fr"]);
  assert.equal(providerCityNameMatchesQuery("Athènes", "Athenes"), true);
  assert.equal(providerCityNameMatchesQuery("Firenze", "Firenze Nova"), false);
});

test("one-character and translated aliases return locale labels without broad search", async () => {
  const originalFetch = globalThis.fetch;
  const calls: URL[] = [];
  const records = {
    2735943: { latitude: 41.1485, longitude: -8.61097, country_code: "PT", timezone: "Europe/Lisbon" },
    2761369: { latitude: 48.20849, longitude: 16.37208, country_code: "AT", timezone: "Europe/Vienna" },
  } as const;
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    calls.push(url);
    const id = Number(url.searchParams.get("id")) as keyof typeof records;
    const record = records[id];
    return Response.json({
      id,
      name: id === 2735943 ? "Porto" : "Vienna",
      ...record,
      feature_code: id === 2735943 ? "PPLA" : "PPLC",
      country: id === 2735943 ? "Portugal" : "Austria",
    });
  };
  try {
    const cases = [
      { query: "Porto", locale: "en", id: 2735943, name: "Porto" },
      { query: "포르투", locale: "ko", id: 2735943, name: "포르투" },
      { query: "ポルト", locale: "ja", id: 2735943, name: "ポルト" },
      { query: "波尔图", locale: "zh", id: 2735943, name: "波尔图" },
      { query: "빈", locale: "ko", id: 2761369, name: "빈" },
    ] as const;
    for (const [index, item] of cases.entries()) {
      const response = await GET(new Request(`https://example.test/api/cities/search?q=${encodeURIComponent(item.query)}&locale=${item.locale}`, {
        headers: { "cf-connecting-ip": `203.0.113.${80 + index}` },
      }));
      assert.equal(response.status, 200);
      const payload = await response.json() as { results: Array<{ id: string; providerId: number; name: string; latitude: number; longitude: number }> };
      assert.equal(payload.results[0].id, `open-meteo:${item.id}`);
      assert.equal(payload.results[0].providerId, item.id);
      assert.equal(payload.results[0].name, item.name);
    }
    assert.ok(calls.some((url) => url.pathname === "/v1/get"));
    assert.equal(calls.filter((url) => url.pathname === "/v1/search" && url.searchParams.get("name") === "빈").length, 0, "one-character curated aliases must skip broad search");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("canonical aliases rank first without hiding provider homonyms", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    if (url.pathname === "/v1/get") {
      return url.searchParams.get("id") === "2735943"
        ? Response.json({ id: 2735943, name: "Porto", latitude: 41.1485, longitude: -8.61097, feature_code: "PPLA", country_code: "PT", timezone: "Europe/Lisbon", country: "Portugal" })
        : Response.json({ id: 2761369, name: "Vienne", latitude: 48.20849, longitude: 16.37208, feature_code: "PPLC", country_code: "AT", timezone: "Europe/Vienna", country: "Autriche" });
    }
    return url.searchParams.get("name") === "Porto"
      ? Response.json({ results: [
          { id: 2735943, name: "Porto", latitude: 41.1485, longitude: -8.61097, feature_code: "PPLA", country_code: "PT", timezone: "Europe/Lisbon", country: "Portugal", population: 252687 },
          { id: 3113104, name: "Porto", latitude: 42.16737, longitude: -6.89934, feature_code: "PPLA3", country_code: "ES", timezone: "Europe/Madrid", country: "Espagne" },
        ] })
      : Response.json({ results: [
          { id: 2761369, name: "Vienne", latitude: 48.20849, longitude: 16.37208, feature_code: "PPLC", country_code: "AT", timezone: "Europe/Vienna", country: "Autriche", population: 1691468 },
          { id: 2969284, name: "Vienne", latitude: 45.52473, longitude: 4.87869, feature_code: "PPLA3", country_code: "FR", timezone: "Europe/Paris", country: "France", population: 32293 },
        ] });
  };
  try {
    const response = await GET(new Request("https://example.test/api/cities/search?q=Vienne&locale=fr", {
      headers: { "cf-connecting-ip": "203.0.113.110" },
    }));
    const payload = await response.json() as { results: Array<{ providerId: number; countryCode: string }> };
    assert.deepEqual(payload.results.slice(0, 2).map((city) => city.providerId), [2761369, 2969284]);
    assert.deepEqual(payload.results.slice(0, 2).map((city) => city.countryCode), ["AT", "FR"]);

    const portoResponse = await GET(new Request("https://example.test/api/cities/search?q=Porto&locale=fr", {
      headers: { "cf-connecting-ip": "203.0.113.111" },
    }));
    const porto = await portoResponse.json() as { results: Array<{ providerId: number; countryCode: string }> };
    assert.deepEqual(porto.results.slice(0, 2).map((city) => city.providerId), [2735943, 3113104]);
    assert.deepEqual(porto.results.slice(0, 2).map((city) => city.countryCode), ["PT", "ES"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("input-script search localizes Athens without spending a Wikidata fallback", async () => {
  const originalFetch = globalThis.fetch;
  const calls: URL[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    calls.push(url);
    if (url.hostname === "www.wikidata.org") throw new Error("unexpected Wikidata fallback");
    if (url.pathname === "/v1/search") {
      assert.equal(url.searchParams.get("name"), "아테네");
      return url.searchParams.get("language") === "ko" ? Response.json({ results: [{
        id: 264371, name: "아테네", latitude: 37.98376, longitude: 23.72784,
        feature_code: "PPLC", country_code: "GR", timezone: "Europe/Athens", country: "그리스",
      }] }) : Response.json({});
    }
    return Response.json({
      id: 264371, name: "Athens", latitude: 37.98376, longitude: 23.72784,
      feature_code: "PPLC", country_code: "GR", timezone: "Europe/Athens", country: "Greece",
    });
  };
  try {
    const response = await GET(new Request("https://example.test/api/cities/search?q=%EC%95%84%ED%85%8C%EB%84%A4&locale=en", {
      headers: { "cf-connecting-ip": "203.0.113.130" },
    }));
    assert.equal(response.status, 200);
    const payload = await response.json() as {
      results: Array<{ providerId: number; name: string; countryCode: string }>;
      meta: { requestCost: number; wikidataFallbackUsed: boolean; providerSearchLanguagesTried: string[] };
    };
    assert.equal(payload.results[0].providerId, 264371);
    assert.equal(payload.results[0].name, "Athens");
    assert.equal(payload.results[0].countryCode, "GR");
    assert.equal(payload.meta.requestCost, 3);
    assert.equal(payload.meta.wikidataFallbackUsed, false);
    assert.deepEqual(payload.meta.providerSearchLanguagesTried, ["en", "ko"]);
    assert.equal(calls.filter((url) => url.pathname === "/v1/get").length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("cross-language canonical ordering preserves localized Athens and Florence homonyms", async () => {
  const originalFetch = globalThis.fetch;
  const calls: URL[] = [];
  const cities = {
    athens: [
      { id: 264371, en: "Athens", ko: "아테네", country_code: "GR", latitude: 37.98376, longitude: 23.72784, feature_code: "PPLC" },
      { id: 4180386, en: "Athens", ko: "애선스", country_code: "US", latitude: 33.96095, longitude: -83.37794, feature_code: "PPLA2" },
      { id: 4505542, en: "Athens", ko: "애선스", country_code: "US", latitude: 39.32924, longitude: -82.10126, feature_code: "PPLA2" },
    ],
    florence: [
      { id: 3176959, en: "Florence", ko: "피렌체", country_code: "IT", latitude: 43.77925, longitude: 11.24626, feature_code: "PPLA" },
      { id: 4062577, en: "Florence", ko: "플로렌스", country_code: "US", latitude: 34.79981, longitude: -87.67725, feature_code: "PPLA2" },
      { id: 4578737, en: "Florence", ko: "플로렌스", country_code: "US", latitude: 34.19543, longitude: -79.76256, feature_code: "PPLA2" },
    ],
  } as const;
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    calls.push(url);
    if (url.hostname === "www.wikidata.org") throw new Error("exact provider result must not use Wikidata");
    const query = (url.searchParams.get("name") ?? "").toLocaleLowerCase() as keyof typeof cities;
    const language = url.searchParams.get("language") === "ko" ? "ko" : "en";
    return Response.json({ results: cities[query].map((city) => ({
      id: city.id,
      name: city[language],
      latitude: city.latitude,
      longitude: city.longitude,
      feature_code: city.feature_code,
      country_code: city.country_code,
      timezone: city.country_code === "GR" ? "Europe/Athens" : city.country_code === "IT" ? "Europe/Rome" : "America/New_York",
      country: city.country_code,
    })) });
  };
  try {
    for (const [index, expected] of [
      { query: "athens", ids: [264371, 4180386, 4505542] },
      { query: "florence", ids: [3176959, 4062577, 4578737] },
    ].entries()) {
      const response = await GET(new Request(`https://example.test/api/cities/search?q=${expected.query}&locale=ko`, {
        headers: { "cf-connecting-ip": `203.0.113.${150 + index}` },
      }));
      assert.equal(response.status, 200);
      const payload = await response.json() as {
        results: Array<{ providerId: number; countryCode: string }>;
        meta: { requestCost: number; wikidataFallbackUsed: boolean };
      };
      assert.deepEqual(payload.results.map((city) => city.providerId), expected.ids);
      assert.equal(payload.results[0].countryCode, index === 0 ? "GR" : "IT");
      assert.equal(payload.results[1].countryCode, "US");
      assert.equal(payload.meta.requestCost, 2);
      assert.equal(payload.meta.wikidataFallbackUsed, false);
    }
    assert.equal(calls.filter((url) => url.pathname === "/v1/get").length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("major-city Wikidata fallback requests only bounded labels and city claims", async () => {
  const originalFetch = globalThis.fetch;
  const calls: URL[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    calls.push(url);
    if (url.hostname === "www.wikidata.org") {
      const action = url.searchParams.get("action");
      if (action === "wbsearchentities") return Response.json({ search: [{ id: "Q1524" }] });
      if (action === "wbgetentities") {
        assert.equal(url.searchParams.get("props"), "labels", "large unrelated claims must never be requested");
        return Response.json({ entities: { Q1524: { labels: {
          ko: { value: "아테네" }, en: { value: "Athens" }, fr: { value: "Athènes" },
          ja: { value: "アテネ" }, zh: { value: "雅典" },
        } } } });
      }
      assert.equal(action, "wbgetclaims");
      assert.equal(url.searchParams.get("property"), "P1566");
      return Response.json({ claims: {
        P1566: [{ mainsnak: { datavalue: { value: "264371" } } }],
      } });
    }
    if (url.pathname === "/v1/search") return Response.json({});
    return Response.json({
      id: 264371, name: "Athènes", latitude: 37.98376, longitude: 23.72784,
      feature_code: "PPLC", country_code: "GR", timezone: "Europe/Athens", country: "Grèce",
    });
  };
  try {
    const response = await GET(new Request("https://example.test/api/cities/search?q=%CE%91%CE%B8%CE%AE%CE%BD%CE%B1&locale=fr", {
      headers: { "cf-connecting-ip": "203.0.113.131" },
    }));
    assert.equal(response.status, 200);
    const payload = await response.json() as { results: Array<{ providerId: number; name: string }> };
    assert.equal(payload.results[0].providerId, 264371);
    assert.equal(payload.results[0].name, "Athènes");
    assert.ok(calls.some((url) => url.searchParams.get("action") === "wbgetclaims"));
    assert.equal(calls.some((url) => url.searchParams.get("props")?.includes("claims")), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("an empty provider search uses one bounded Wikidata city fallback", async () => {
  const originalFetch = globalThis.fetch;
  const calls: URL[] = [];
  const userAgents: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    calls.push(url);
    if (url.hostname === "www.wikidata.org") {
      userAgents.push(new Headers(init?.headers).get("Api-User-Agent") ?? "");
      if (url.searchParams.get("action") === "wbsearchentities") {
        return Response.json({ search: [{ id: "Q1764" }] });
      }
      if (url.searchParams.get("action") === "wbgetclaims") {
        return Response.json({
          claims: { P1566: [{ mainsnak: { datavalue: { value: "3413829" } } }] },
        });
      }
      return Response.json({ entities: { Q1764: {
        labels: {
          ko: { value: "레이캬비크" }, en: { value: "Reykjavik" }, fr: { value: "Reykjavík" },
          ja: { value: "レイキャヴィーク" }, zh: { value: "雷克雅未克" },
        },
      } } });
    }
    if (url.pathname === "/v1/search") return Response.json({ results: [{
      id: 999001, name: "Unrelated provider prefix", latitude: 63, longitude: -20,
      feature_code: "PPL", country_code: "IS", timezone: "Atlantic/Reykjavik", country: "Iceland",
    }] });
    return Response.json({
      id: 3413829, name: "레이캬비크", latitude: 64.13548, longitude: -21.89541,
      feature_code: "PPLC", country_code: "IS", timezone: "Atlantic/Reykjavik", country: "아이슬란드",
    });
  };
  try {
    const response = await GET(new Request("https://example.test/api/cities/search?q=%EB%A0%88%EC%9D%B4%EC%BA%AC%EB%B9%84%ED%81%AC&locale=en", {
      headers: { "cf-connecting-ip": "203.0.113.101" },
    }));
    const payload = await response.json() as { results: Array<{ providerId: number; name: string }>; meta: { requestCost: number; wikidataFallbackUsed: boolean } };
    assert.equal(payload.results[0].providerId, 3413829);
    assert.equal(payload.results[0].name, "Reykjavik");
    assert.equal(payload.meta.wikidataFallbackUsed, true);
    assert.equal(payload.meta.requestCost, 14);
    assert.equal(calls.filter((url) => url.hostname === "www.wikidata.org").length, 3);
    assert.ok(calls.some((url) => url.searchParams.get("action") === "wbgetclaims" && url.searchParams.get("property") === "P1566"));
    assert.ok(calls.some((url) => url.searchParams.get("action") === "wbgetentities" && url.searchParams.get("props") === "labels"));
    assert.equal(calls.find((url) => url.searchParams.get("action") === "wbsearchentities")?.searchParams.get("language"), "ko");
    assert.ok(calls.some((url) => url.pathname === "/v1/search"), "a misleading provider hit must still allow the script-aware fallback");
    assert.ok(userAgents.every((value) => value.includes("github.com/Seunghyeon-Kim-0920/Together")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Wikidata ADM GeoNames claims rematch to the nearby populated place", async () => {
  const originalFetch = globalThis.fetch;
  const calls: URL[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    calls.push(url);
    if (url.hostname === "www.wikidata.org") {
      if (url.searchParams.get("action") === "wbsearchentities") return Response.json({ search: [{ id: "Q36433" }] });
      if (url.searchParams.get("action") === "wbgetclaims") {
        return url.searchParams.get("property") === "P1566"
          ? Response.json({ claims: { P1566: [{ mainsnak: { datavalue: { value: "6458924" } } }] } })
          : Response.json({ claims: { P625: [{ mainsnak: { datavalue: { value: { latitude: 41.15, longitude: -8.610833333 } } } }] } });
      }
      return Response.json({ entities: { Q36433: {
        labels: {
          ko: { value: "포르투" }, en: { value: "Porto" }, fr: { value: "Porto" },
          ja: { value: "ポルト" }, zh: { value: "波尔图" },
        },
      } } });
    }
    if (url.pathname === "/v1/search") {
      if (url.searchParams.get("name") !== "Porto") return Response.json({});
      return Response.json({ results: [{
        id: 2735943, name: "Porto", latitude: 41.1485, longitude: -8.61097,
        feature_code: "PPLA", country_code: "PT", timezone: "Europe/Lisbon", country: "Portugal",
      }] });
    }
    if (url.searchParams.get("id") === "6458924") {
      return Response.json({
        id: 6458924, name: "Porto", latitude: 41.22852, longitude: -8.32691,
        feature_code: "ADM2", country_code: "PT", timezone: "Europe/Lisbon", country: "Portugal",
      });
    }
    return Response.json({
      id: 2735943, name: "Porto", latitude: 41.1485, longitude: -8.61097,
      feature_code: "PPLA", country_code: "PT", timezone: "Europe/Lisbon", country: "Portugal",
    });
  };
  try {
    const response = await GET(new Request("https://example.test/api/cities/search?q=%ED%8F%AC%EB%A5%B4%ED%88%AC%EB%8F%84%EC%8B%9C%EA%B2%80%EC%83%89&locale=ko", {
      headers: { "cf-connecting-ip": "203.0.113.102" },
    }));
    const payload = await response.json() as { results: Array<{ providerId: number; name: string; latitude: number; longitude: number }> };
    assert.equal(payload.results[0].providerId, 2735943);
    assert.equal(payload.results[0].name, "포르투");
    assert.ok(Math.abs(payload.results[0].latitude - 41.1485) < 1e-9);
    assert.ok(calls.some((url) => url.pathname === "/v1/search" && url.searchParams.get("name") === "Porto"));
  } finally {
    globalThis.fetch = originalFetch;
  }
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
    const otherLocale = await otherLocaleResponse.json() as { meta: { requestCost: number; fallbackQueriesTried: string[]; wikidataFallbackUsed: boolean } };
    assert.equal(otherLocale.meta.requestCost, 13);
    assert.deepEqual(otherLocale.meta.fallbackQueriesTried, []);
    assert.equal(otherLocale.meta.wikidataFallbackUsed, true);
    assert.deepEqual(calls.filter(Boolean), ["東京"], "Japanese suffix retries must remain disabled for zh");
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

test("known-city hydration keeps canonical names even when provider labels are incomplete", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    const locale = url.searchParams.get("language") ?? "en";
    return Response.json({
      id: 2735943, name: locale === "ja" ? "ポルト" : "Porto", latitude: 41.1485, longitude: -8.61097,
      feature_code: "PPLA", country_code: "PT", timezone: "Europe/Lisbon", country: "Portugal",
    });
  };
  try {
    const response = await GET(new Request("https://example.test/api/cities/search?q=Porto&locale=ko&translations=1&providerId=2735943", {
      headers: { "cf-connecting-ip": "203.0.113.121" },
    }));
    const payload = await response.json() as { results: Array<{ name: string; names: Record<string, string> }> };
    assert.equal(payload.results[0].name, "포르투");
    assert.deepEqual(payload.results[0].names, {
      ko: "포르투", en: "Porto", fr: "Porto", ja: "ポルト", zh: "波尔图",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("debounced Firenze typing keeps quota and canonicalizes Florence before hydration", async () => {
  const originalFetch = globalThis.fetch;
  const calls: URL[] = [];
  const prefixCities: Record<string, { id: number; name: string }> = {
    fi: { id: 990001, name: "Fiji City" },
    fir: { id: 990002, name: "Fir" },
    fire: { id: 990003, name: "Firenze Nova" },
    firenze: { id: 990003, name: "Firenze Nova" },
  };
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    calls.push(url);
    if (url.hostname === "www.wikidata.org") {
      const action = url.searchParams.get("action");
      if (action === "wbsearchentities") return Response.json({ search: [{ id: "Q2044" }] });
      if (action === "wbgetclaims") {
        return Response.json({ claims: {
          P1566: [{ mainsnak: { datavalue: { value: "3176959" } } }],
        } });
      }
      return Response.json({ entities: { Q2044: { labels: {
        ko: { value: "피렌체" }, en: { value: "Florence" }, fr: { value: "Florence" },
        ja: { value: "フィレンツェ" }, zh: { value: "佛罗伦萨" },
      } } } });
    }
    if (url.pathname === "/v1/search") {
      const query = (url.searchParams.get("name") ?? "").toLocaleLowerCase();
      const candidate = prefixCities[query];
      return candidate ? Response.json({ results: [{
        id: candidate.id, name: candidate.name, latitude: 43.9, longitude: 11.3,
        feature_code: "PPL", country_code: "IT", timezone: "Europe/Rome", country: "Italy",
      }] }) : Response.json({});
    }
    const id = Number(url.searchParams.get("id"));
    const candidate = Object.values(prefixCities).find((city) => city.id === id);
    if (!candidate) throw new Error(`unexpected uncached city ${id}`);
    return Response.json({
      id, name: `한국어 ${candidate.name}`, latitude: 43.9, longitude: 11.3,
      feature_code: "PPL", country_code: "IT", timezone: "Europe/Rome", country: "이탈리아",
    });
  };
  try {
    const clientIp = "203.0.113.140";
    for (const query of ["f", "fi", "fir", "fire"]) {
      const response = await GET(new Request(`https://example.test/api/cities/search?q=${query}&locale=ko`, {
        headers: { "cf-connecting-ip": clientIp },
      }));
      assert.equal(response.status, 200, query);
    }

    const finalResponse = await GET(new Request("https://example.test/api/cities/search?q=firenze&locale=ko", {
      headers: { "cf-connecting-ip": clientIp },
    }));
    assert.equal(finalResponse.status, 200);
    const finalPayload = await finalResponse.json() as {
      results: Array<{ providerId: number; name: string }>;
      meta: { requestCost: number; wikidataFallbackUsed: boolean };
    };
    assert.equal(finalPayload.results[0].providerId, 3176959);
    assert.equal(finalPayload.results[0].name, "피렌체");
    assert.equal(finalPayload.meta.requestCost, 14);
    assert.equal(finalPayload.meta.wikidataFallbackUsed, true);

    const hydrationResponse = await GET(new Request("https://example.test/api/cities/search?q=firenze&locale=ko&translations=1&providerId=3176959", {
      headers: { "cf-connecting-ip": clientIp },
    }));
    assert.equal(hydrationResponse.status, 200, "selecting the final result must remain within the same 30-unit window");
    const hydrated = await hydrationResponse.json() as { results: Array<{ names: Record<string, string> }> };
    assert.equal(hydrated.results[0].names.en, "Florence");
    assert.ok(calls.some((url) => url.searchParams.get("action") === "wbgetclaims"));
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
