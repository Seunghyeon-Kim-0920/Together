import assert from "node:assert/strict";
import test from "node:test";

import { CITIES, getCity, searchCities } from "../lib/cities.js";
import {
  calculateBalances,
  createEqualSplitExpense,
  createMoney,
  minimumSettlementTransfers,
  settleExpensesByCurrency,
  splitEvenly,
} from "../lib/expenses.js";
import {
  DomainValidationError,
  provenanceLabel,
  type City,
  type DataProvenance,
  type ParticipantBalance,
  type TravelLeg,
} from "../lib/domain.js";
import {
  assertDurationInvariant,
  buildEstimatedFallbackOptions,
  buildEstimatedFallbackOptionsForCities,
  createDurationBreakdown,
  createEstimatedFallbackLeg,
  createEstimatedFallbackLegForCities,
  createTransportSegment,
  createTravelLeg,
  getEstimatedFallbackModes,
  getEstimatedFallbackModesForCities,
  EXACT_OPTIMIZATION_MAX_CITIES,
  optimizeItinerary,
  optimizeVerifiedItinerary,
  isVerifiedTransportLeg,
  selectFastestLeg,
} from "../lib/routing.js";
import {
  parseTransitousPlan,
  parseClientIp,
  POST as schedulePost,
  SCHEDULE_BATCH_DEADLINE_MS,
  SCHEDULE_FUTURE_DATE_HORIZON_DAYS,
  SCHEDULE_MAX_CITIES,
  SCHEDULE_MAX_PAIRS,
  SCHEDULE_MAX_PROVIDER_PAIRS,
  SCHEDULE_MAX_REQUEST_BYTES,
  SCHEDULE_PAST_DATE_HORIZON_DAYS,
  SCHEDULE_PROVIDER_TIMEOUT_MS,
  SCHEDULE_RATE_LIMIT_REQUESTS,
  SCHEDULE_TRANSIT_ENDPOINT_GATE_MAX_RADIUS_METERS,
  SCHEDULE_TRANSIT_STOP_SEARCH_RADIUS_METERS,
  validateDepartureDate,
} from "../app/api/routes/schedule/route.js";

const estimate: DataProvenance = {
  kind: "estimated",
  methodology: "Test fixture only",
};

function utcDateFromToday(dayOffset: number): string {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + dayOffset),
  )
    .toISOString()
    .slice(0, 10);
}

function simpleLeg(
  fromCityId: string,
  toCityId: string,
  minutes: number,
  id = `${fromCityId}:${toCityId}:${minutes}`,
  provenance: DataProvenance = estimate,
  mode: "bus" | "train" = "bus",
): TravelLeg {
  return createTravelLeg({
    id,
    fromCityId,
    toCityId,
    segments: [
      createTransportSegment({
        id: `${id}:segment`,
        mode,
        from: `${fromCityId}:centre`,
        to: `${toCityId}:centre`,
        provenance,
        components: [
          { kind: "in_vehicle", label: "Travel", minutes },
        ],
      }),
    ],
  });
}

function scheduledLeg(fromCityId: string, toCityId: string, minutes: number): TravelLeg {
  const departureTime = "2098-04-05T08:00:00Z";
  const arrivalTime = new Date(Date.parse(departureTime) + minutes * 60_000).toISOString();
  const provenance = { kind: "scheduled" as const, source: "Test public timetable", scheduleVersion: "2098-04-05" };
  return createTravelLeg({
    id: `scheduled:${fromCityId}:${toCityId}`,
    fromCityId,
    toCityId,
    segments: [createTransportSegment({
      id: `scheduled:${fromCityId}:${toCityId}:segment`, mode: "train",
      from: `${fromCityId}:station`, to: `${toCityId}:station`, provenance,
      components: [{ kind: "in_vehicle", label: "Published running time", minutes }],
      scheduledService: { serviceName: "IC 1", departurePlace: `${fromCityId} station`, arrivalPlace: `${toCityId} station`, departureTime, arrivalTime },
    })],
  });
}

test("product optimizer excludes every estimated leg and supports verified routes above ten cities", () => {
  const cityIds = CITIES.slice(0, 11).map((city) => city.id);
  const scheduled = cityIds.flatMap((fromCityId, fromIndex) => cityIds
    .filter((toCityId) => toCityId !== fromCityId)
    .map((toCityId) => scheduledLeg(fromCityId, toCityId, 30 + fromIndex)));
  const route = optimizeVerifiedItinerary(cityIds, [
    ...scheduled,
    ...buildEstimatedFallbackOptions(cityIds),
  ], { startCityId: cityIds[0], endCityId: cityIds.at(-1) });
  assert.equal(route.cityOrder.length, 11);
  assert.equal(new Set(route.cityOrder).size, 11);
  assert.equal(route.cityOrder[0], cityIds[0]);
  assert.equal(route.cityOrder.at(-1), cityIds.at(-1));
  assert.ok(route.legs.every(isVerifiedTransportLeg));
  assert.ok(route.legs.every((leg) => leg.provenance.kind !== "estimated"));
});

interface FixtureCoordinates {
  readonly lat: number;
  readonly lon: number;
}

function transitousPlanFixture(
  fromCoordinates: FixtureCoordinates = { lat: 48.8566, lon: 2.3522 },
  toCoordinates: FixtureCoordinates = { lat: 51.5072, lon: -0.1276 },
) {
  return {
    itineraries: [
      {
        id: "provider-itinerary-fast",
        duration: 12_600,
        startTime: "2098-04-05T08:00:00Z",
        endTime: "2098-04-05T11:30:00Z",
        transfers: 2,
        legs: [
          {
            mode: "WALK",
            duration: 600,
            startTime: "2098-04-05T08:10:00Z",
            endTime: "2098-04-05T08:20:00Z",
            from: { name: "START" },
            to: { name: "Central station" },
          },
          {
            mode: "SUBWAY",
            duration: 1_200,
            startTime: "2098-04-05T08:25:00Z",
            endTime: "2098-04-05T08:45:00Z",
            from: {
              name: "Central station",
              stopId: "test:paris-central",
              ...fromCoordinates,
            },
            to: { name: "Rail terminal" },
            routeShortName: "M1",
          },
          {
            mode: "HIGHSPEED_RAIL",
            duration: 7_200,
            startTime: "2098-04-05T08:50:00Z",
            endTime: "2098-04-05T10:50:00Z",
            from: {
              name: "Rail terminal",
              stopId: "test:origin-intercity",
              ...fromCoordinates,
            },
            to: { name: "Arrival terminal" },
            displayName: "International Express",
          },
          {
            mode: "COACH",
            duration: 1_800,
            startTime: "2098-04-05T10:55:00Z",
            endTime: "2098-04-05T11:25:00Z",
            from: { name: "Arrival terminal" },
            to: {
              name: "City stop",
              stopId: "test:london-city",
              ...toCoordinates,
            },
            routeShortName: "C2",
          },
          {
            mode: "WALK",
            duration: 300,
            startTime: "2098-04-05T11:25:00Z",
            endTime: "2098-04-05T11:30:00Z",
            from: { name: "City stop" },
            to: { name: "END" },
          },
        ],
      },
      {
        id: "provider-itinerary-slower",
        duration: 18_000,
        startTime: "2098-04-05T07:00:00Z",
        endTime: "2098-04-05T12:00:00Z",
        transfers: 0,
        legs: [
          {
            mode: "HIGHSPEED_RAIL",
            duration: 18_000,
            startTime: "2098-04-05T07:00:00Z",
            endTime: "2098-04-05T12:00:00Z",
            from: { name: "Paris", ...fromCoordinates },
            to: { name: "London", ...toCoordinates },
          },
        ],
      },
    ],
  };
}

function transitousPlanFixtureForRequest(input: RequestInfo | URL) {
  const query = new URL(String(input)).searchParams;
  const parsePlace = (value: string | null): FixtureCoordinates => {
    const [lat, lon] = (value ?? "").split(",").map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      throw new Error("Fixture request is missing provider coordinates");
    }
    return { lat, lon };
  };
  return transitousPlanFixture(
    parsePlace(query.get("fromPlace")),
    parsePlace(query.get("toPlace")),
  );
}

test("city catalogue has unique global city ids and valid location metadata", () => {
  assert.ok(CITIES.length >= 12);
  assert.equal(new Set(CITIES.map((city) => city.id)).size, CITIES.length);
  for (const city of CITIES) {
    assert.match(city.country.code, /^[A-Z]{2}$/);
    assert.ok(city.coordinates.latitude >= -90);
    assert.ok(city.coordinates.latitude <= 90);
    assert.ok(city.coordinates.longitude >= -180);
    assert.ok(city.coordinates.longitude <= 180);
    assert.doesNotThrow(() =>
      new Intl.DateTimeFormat("en", { timeZone: city.timeZone }).format(0),
    );
  }
  assert.equal(getCity("paris").names.fr, "Paris");
  assert.equal(getCity("barcelona").timeZone, "Europe/Madrid");
  assert.equal(getCity("busan").country.code, "KR");
  assert.equal(getCity("osaka").country.code, "JP");
  assert.equal(getCity("paris-texas").timeZone, "America/Chicago");
  assert.equal(searchCities("Séoul")[0]?.id, "seoul");
  assert.equal(searchCities("日本")[0]?.country.code, "JP");
  assert.deepEqual(
    searchCities("Paris").map((city) => city.id),
    ["paris", "paris-texas"],
  );
});

test("new corridor cities keep exact names in all five supported languages", () => {
  const expected = {
    lyon: {
      names: { ko: "리옹", en: "Lyon", fr: "Lyon", ja: "リヨン", zh: "里昂" },
      countryCode: "FR",
    },
    milan: {
      names: { ko: "밀라노", en: "Milan", fr: "Milan", ja: "ミラノ", zh: "米兰" },
      countryCode: "IT",
    },
    brussels: {
      names: { ko: "브뤼셀", en: "Brussels", fr: "Bruxelles", ja: "ブリュッセル", zh: "布鲁塞尔" },
      countryCode: "BE",
    },
    amsterdam: {
      names: { ko: "암스테르담", en: "Amsterdam", fr: "Amsterdam", ja: "アムステルダム", zh: "阿姆斯特丹" },
      countryCode: "NL",
    },
    prague: {
      names: { ko: "프라하", en: "Prague", fr: "Prague", ja: "プラハ", zh: "布拉格" },
      countryCode: "CZ",
    },
    vienna: {
      names: { ko: "빈", en: "Vienna", fr: "Vienne", ja: "ウィーン", zh: "维也纳" },
      countryCode: "AT",
    },
    budapest: {
      names: { ko: "부다페스트", en: "Budapest", fr: "Budapest", ja: "ブダペスト", zh: "布达佩斯" },
      countryCode: "HU",
    },
    tallinn: {
      names: { ko: "탈린", en: "Tallinn", fr: "Tallinn", ja: "タリン", zh: "塔林" },
      countryCode: "EE",
    },
    riga: {
      names: { ko: "리가", en: "Riga", fr: "Riga", ja: "リガ", zh: "里加" },
      countryCode: "LV",
    },
    dublin: {
      names: { ko: "더블린", en: "Dublin", fr: "Dublin", ja: "ダブリン", zh: "都柏林" },
      countryCode: "IE",
    },
  } as const;

  for (const [cityId, metadata] of Object.entries(expected)) {
    const city = getCity(cityId);
    assert.deepEqual(city.names, metadata.names);
    assert.equal(city.country.code, metadata.countryCode);
  }
});

test("duration totals are derived from components and forged totals fail", () => {
  const duration = createDurationBreakdown([
    { kind: "waiting", label: "Wait", minutes: 15 },
    { kind: "in_vehicle", label: "Ride", minutes: 85 },
  ]);
  assert.equal(duration.totalMinutes, 100);
  assert.doesNotThrow(() => assertDurationInvariant(duration));
  assert.throws(
    () =>
      assertDurationInvariant({
        components: duration.components,
        totalMinutes: 99,
      }),
    DomainValidationError,
  );
});

test("mixed flight legs include complete door-to-door time and provenance", () => {
  const access = createTransportSegment({
    id: "access",
    mode: "taxi",
    from: "paris:centre",
    to: "paris:airport",
    provenance: estimate,
    components: [
      { kind: "city_to_terminal", label: "City to airport", minutes: 45 },
    ],
  });
  const flight = createTransportSegment({
    id: "flight",
    mode: "flight",
    from: "paris:airport",
    to: "london:airport",
    provenance: {
      kind: "scheduled",
      source: "Published test timetable",
    },
    components: [
      { kind: "check_in_security", label: "Check-in", minutes: 90 },
      { kind: "in_vehicle", label: "Flight", minutes: 70 },
      { kind: "buffer", label: "Buffer", minutes: 20 },
    ],
  });
  const egress = createTransportSegment({
    id: "egress",
    mode: "train",
    from: "london:airport",
    to: "london:centre",
    provenance: {
      kind: "observed",
      source: "Measured test journeys",
      observedAt: "2026-08-01T00:00:00Z",
    },
    components: [
      { kind: "terminal_to_city", label: "Airport to city", minutes: 35 },
    ],
  });
  const leg = createTravelLeg({
    id: "paris-london-flight",
    fromCityId: "paris",
    toCityId: "london",
    segments: [access, flight, egress],
  });

  assert.equal(leg.totalMinutes, 260);
  assert.equal(leg.isMixedTransport, true);
  assert.deepEqual(leg.modes, ["taxi", "flight", "train"]);
  assert.equal(leg.provenance.kind, "estimated");
  assert.equal(provenanceLabel(leg.provenance), "Estimate");
  assert.doesNotMatch(provenanceLabel(leg.provenance), /actual/i);
});

test("flight legs reject missing access, processing, egress, or buffer time", () => {
  const incompleteFlight = createTransportSegment({
    id: "incomplete",
    mode: "flight",
    from: "paris:airport",
    to: "london:airport",
    provenance: estimate,
    components: [
      { kind: "in_vehicle", label: "Flight", minutes: 60 },
    ],
  });
  assert.throws(
    () =>
      createTravelLeg({
        id: "bad-flight",
        fromCityId: "paris",
        toCityId: "london",
        segments: [incompleteFlight],
      }),
    /complete door-to-door time/,
  );
});

test("unavailable segments never expose a numeric travel total", () => {
  const segment = createTransportSegment({
    id: "no-data",
    mode: "train",
    from: "paris:centre",
    to: "berlin:centre",
    provenance: { kind: "unavailable", reason: "Provider did not return data" },
  });
  const leg = createTravelLeg({
    id: "no-data-leg",
    fromCityId: "paris",
    toCityId: "berlin",
    segments: [segment],
  });
  assert.equal(leg.totalMinutes, null);
  assert.equal(leg.provenance.kind, "unavailable");
  assert.throws(
    () =>
      createTransportSegment({
        id: "invalid-no-data",
        mode: "bus",
        from: "a",
        to: "b",
        provenance: { kind: "unavailable", reason: "No data" },
        components: [{ kind: "in_vehicle", label: "Unknown", minutes: 1 }],
      }),
    /cannot contain a duration/,
  );
});

test("fastest-leg selection replaces same-mode estimates but compares modes by duration", () => {
  const scheduled = simpleLeg("paris", "london", 100, "scheduled", {
    kind: "scheduled",
    source: "Timetable",
  });
  const fasterEstimated = simpleLeg("paris", "london", 80, "estimated");
  const slowerObserved = simpleLeg("paris", "london", 101, "observed", {
    kind: "observed",
    source: "Measured trips",
    observedAt: "2026-08-01T00:00:00Z",
  });
  assert.equal(
    selectFastestLeg(
      [fasterEstimated, slowerObserved, scheduled],
      "paris",
      "london",
    )?.id,
    "observed",
  );

  const fasterScheduled = simpleLeg("paris", "london", 95, "scheduled-fast", {
    kind: "scheduled",
    source: "Timetable",
  });
  assert.equal(
    selectFastestLeg([scheduled, fasterScheduled], "paris", "london")?.id,
    "scheduled-fast",
  );

  const scheduledTrain = simpleLeg("paris", "london", 100, "scheduled-train", {
    kind: "scheduled",
    source: "Rail timetable",
  }, "train");
  const estimatedBus = simpleLeg("paris", "london", 80, "estimated-bus");
  assert.equal(
    selectFastestLeg([scheduledTrain, estimatedBus], "paris", "london")?.id,
    "estimated-bus",
  );
});

test("Held-Karp optimization finds the exact directed visit order", () => {
  const cityIds = ["seoul", "tokyo", "beijing", "singapore"];
  const preferred = new Map([
    ["seoul:tokyo", 2],
    ["tokyo:beijing", 3],
    ["beijing:singapore", 4],
  ]);
  const legs: TravelLeg[] = [];
  for (const from of cityIds) {
    for (const to of cityIds) {
      if (from === to) continue;
      legs.push(simpleLeg(from, to, preferred.get(`${from}:${to}`) ?? 30));
    }
  }

  const result = optimizeItinerary(cityIds, legs, {
    startCityId: "seoul",
    endCityId: "singapore",
  });
  assert.deepEqual(result.cityOrder, [
    "seoul",
    "tokyo",
    "beijing",
    "singapore",
  ]);
  assert.equal(result.totalMinutes, 9);
  assert.equal(
    result.legs.reduce((sum, leg) => sum + (leg.totalMinutes ?? 0), 0),
    result.totalMinutes,
  );

  const fixedStartOnly = optimizeItinerary(cityIds, legs, {
    startCityId: "seoul",
  });
  assert.equal(fixedStartOnly.cityOrder[0], "seoul");
  const fixedEndOnly = optimizeItinerary(cityIds, legs, {
    endCityId: "singapore",
  });
  assert.equal(fixedEndOnly.cityOrder.at(-1), "singapore");
  assert.throws(
    () =>
      optimizeItinerary(cityIds, legs, {
        startCityId: "paris",
      }),
    /fixed start city is not in the route/,
  );
  assert.throws(
    () =>
      optimizeItinerary(cityIds, legs, {
        startCityId: "seoul",
        endCityId: "seoul",
      }),
    /Start and end cities must differ/,
  );
});

test("Held-Karp totals match exhaustive permutation search", () => {
  const cityIds = ["seoul", "tokyo", "beijing", "singapore", "paris", "barcelona"];
  let seed = 0xc0ffee;
  const randomWeight = () => {
    seed = (Math.imul(seed, 1_103_515_245) + 12_345) >>> 0;
    return (seed % 90) + 10;
  };
  const permutations = (values: readonly string[]): string[][] => {
    if (values.length === 0) return [[]];
    return values.flatMap((value, index) =>
      permutations([...values.slice(0, index), ...values.slice(index + 1)]).map(
        (suffix) => [value, ...suffix],
      ),
    );
  };

  for (let iteration = 0; iteration < 8; iteration += 1) {
    const weights = new Map<string, number>();
    const legs: TravelLeg[] = [];
    for (const from of cityIds) {
      for (const to of cityIds) {
        if (from === to) continue;
        const weight = randomWeight();
        weights.set(`${from}:${to}`, weight);
        legs.push(simpleLeg(from, to, weight, `${iteration}:${from}:${to}`));
      }
    }
    const bruteForceTotal = Math.min(
      ...permutations(cityIds.slice(1)).map((suffix) => {
        const order = [cityIds[0], ...suffix];
        return order.slice(1).reduce((total, to, index) => {
          return total + (weights.get(`${order[index]}:${to}`) ?? Infinity);
        }, 0);
      }),
    );
    assert.equal(
      optimizeItinerary(cityIds, legs, { startCityId: cityIds[0] })
        .totalMinutes,
      bruteForceTotal,
    );
  }
});

test("large-route heuristic has no city cap and preserves deterministic endpoints", () => {
  assert.equal(EXACT_OPTIMIZATION_MAX_CITIES, 10);
  const cityIds = CITIES.slice(0, 24).map((city) => city.id);
  const legs: TravelLeg[] = [];
  for (let from = 0; from < cityIds.length; from += 1) {
    for (let to = 0; to < cityIds.length; to += 1) {
      if (from === to) continue;
      legs.push(
        simpleLeg(
          cityIds[from],
          cityIds[to],
          to === from + 1 ? 1 : 100 + Math.abs(to - from),
          `large:${from}:${to}`,
        ),
      );
    }
  }
  const options = {
    startCityId: cityIds[0],
    endCityId: cityIds.at(-1),
  };
  const first = optimizeItinerary(cityIds, legs, options);
  const second = optimizeItinerary(cityIds, legs, options);
  assert.equal(first.cityOrder.length, cityIds.length);
  assert.equal(new Set(first.cityOrder).size, cityIds.length);
  assert.equal(first.cityOrder[0], cityIds[0]);
  assert.equal(first.cityOrder.at(-1), cityIds.at(-1));
  assert.equal(first.totalMinutes, cityIds.length - 1);
  assert.deepEqual(second, first);
  assert.equal(
    first.legs.reduce((total, leg) => total + (leg.totalMinutes ?? 0), 0),
    first.totalMinutes,
  );
});

test("route optimization still rejects disconnected inputs", () => {
  assert.throws(
    () =>
      optimizeItinerary(
        ["paris", "london", "berlin"],
        [simpleLeg("paris", "london", 60)],
      ),
    /No complete route/,
  );
});

test("fallback routes are always disclosed as estimates", () => {
  const flight = createEstimatedFallbackLeg("paris", "london", "flight");
  assert.equal(flight.provenance.kind, "estimated");
  assert.equal(flight.isMixedTransport, true);
  assert.ok((flight.totalMinutes ?? 0) > 0);
  const options = buildEstimatedFallbackOptions(["paris", "london"]);
  assert.equal(options.length, 6);
  assert.ok(options.every((leg) => leg.provenance.kind === "estimated"));
});

test("surface fallbacks exist only on verified or explicitly modelled corridors", () => {
  const railAndCoachCorridors = [
    ["seoul", "busan"],
    ["tokyo", "osaka"],
    ["paris", "lyon"],
    ["paris", "brussels"],
    ["paris", "london"],
    ["brussels", "amsterdam"],
    ["madrid", "barcelona"],
    ["rome", "milan"],
    ["berlin", "prague"],
    ["vienna", "budapest"],
  ] as const;
  for (const [fromCityId, toCityId] of railAndCoachCorridors) {
    assert.deepEqual(getEstimatedFallbackModes(fromCityId, toCityId), [
      "flight",
      "train",
      "bus",
    ]);
    assert.deepEqual(getEstimatedFallbackModes(toCityId, fromCityId), [
      "flight",
      "train",
      "bus",
    ]);
  }

  assert.deepEqual(getEstimatedFallbackModes("tallinn", "riga"), [
    "flight",
    "bus",
  ]);
  assert.deepEqual(getEstimatedFallbackModes("london", "dublin"), [
    "flight",
  ]);
  assert.deepEqual(getEstimatedFallbackModes("seoul", "paris"), [
    "flight",
  ]);
  assert.throws(
    () => createEstimatedFallbackLeg("london", "dublin", "train"),
    /No conservative train fallback/,
  );
  assert.throws(
    () => createEstimatedFallbackLeg("seoul", "paris", "bus"),
    /No conservative bus fallback/,
  );
});

test("surface modes expose only intercity running time and beat door-to-door flights", () => {
  const fasterRailPairs = [
    ["seoul", "busan"],
    ["tokyo", "osaka"],
    ["paris", "lyon"],
    ["madrid", "barcelona"],
    ["rome", "milan"],
  ] as const;
  for (const [fromCityId, toCityId] of fasterRailPairs) {
    const train = createEstimatedFallbackLeg(fromCityId, toCityId, "train");
    const flight = createEstimatedFallbackLeg(fromCityId, toCityId, "flight");
    assert.ok(
      (train.totalMinutes ?? Infinity) < (flight.totalMinutes ?? -Infinity),
      `${fromCityId}-${toCityId} rail should beat its door-to-door flight fallback`,
    );
  }

  const crossChannel = createEstimatedFallbackLeg("paris", "london", "train");
  const componentKinds = crossChannel.segments.flatMap(
    (segment) => segment.duration?.components.map((component) => component.kind) ?? [],
  );
  assert.deepEqual(componentKinds, ["in_vehicle"]);
  assert.equal(crossChannel.totalMinutes, 140);
});

test("Venice to Florence selects a two-hour train model instead of a flight", () => {
  const localized = (value: string) => ({
    ko: value,
    en: value,
    fr: value,
    ja: value,
    zh: value,
  });
  const italy = { code: "IT", names: localized("Italy") };
  const venice: City = {
    id: "open-meteo:venice-test",
    names: localized("Venice"),
    country: italy,
    coordinates: { latitude: 45.4408, longitude: 12.3155 },
    timeZone: "Europe/Rome",
  };
  const florence: City = {
    id: "open-meteo:florence-test",
    names: localized("Florence"),
    country: italy,
    coordinates: { latitude: 43.7696, longitude: 11.2558 },
    timeZone: "Europe/Rome",
  };
  assert.deepEqual(getEstimatedFallbackModesForCities(venice, florence), [
    "flight",
    "train",
    "bus",
  ]);
  const candidates = buildEstimatedFallbackOptionsForCities([
    venice,
    florence,
  ]);
  const train = createEstimatedFallbackLegForCities(
    venice,
    florence,
    "train",
  );
  const flight = createEstimatedFallbackLegForCities(
    venice,
    florence,
    "flight",
  );
  assert.equal(train.totalMinutes, 125);
  assert.deepEqual(
    train.segments.flatMap(
      (segment) =>
        segment.duration?.components.map((component) => component.kind) ?? [],
    ),
    ["in_vehicle"],
  );
  assert.ok((flight.totalMinutes ?? 0) > (train.totalMinutes ?? Infinity));
  assert.equal(
    selectFastestLeg(candidates, venice.id, florence.id)?.id,
    train.id,
  );
});

test("nearby mainland Italian cities retain rail fallbacks when timetable lookups are partial", () => {
  const localized = (value: string) => ({
    ko: value,
    en: value,
    fr: value,
    ja: value,
    zh: value,
  });
  const italy = { code: "IT", names: localized("Italy") };
  const florence: City = {
    id: "open-meteo:florence-partial-test",
    names: localized("Florence"),
    country: italy,
    coordinates: { latitude: 43.7696, longitude: 11.2558 },
    timeZone: "Europe/Rome",
  };
  const rome: City = {
    id: "open-meteo:rome-partial-test",
    names: localized("Rome"),
    country: italy,
    coordinates: { latitude: 41.9028, longitude: 12.4964 },
    timeZone: "Europe/Rome",
  };
  const palermo: City = {
    id: "open-meteo:palermo-island-test",
    names: localized("Palermo"),
    country: italy,
    coordinates: { latitude: 38.1157, longitude: 13.3615 },
    timeZone: "Europe/Rome",
  };

  assert.deepEqual(getEstimatedFallbackModesForCities(florence, rome), [
    "flight",
    "train",
    "bus",
  ]);
  const candidates = buildEstimatedFallbackOptionsForCities([florence, rome]);
  const fastest = selectFastestLeg(candidates, florence.id, rome.id);
  assert.ok(fastest?.modes.includes("train"));
  assert.equal(fastest?.totalMinutes, 95);
  assert.deepEqual(getEstimatedFallbackModesForCities(palermo, florence), [
    "flight",
  ]);
});

test("Transitous parser selects the fastest valid public-transit itinerary", () => {
  const parsed = parseTransitousPlan(
    transitousPlanFixture(),
    "paris",
    "london",
  );
  assert.ok(parsed);
  assert.equal(parsed.leg.fromCityId, "paris");
  assert.equal(parsed.leg.toCityId, "london");
  assert.deepEqual(parsed.leg.modes, ["train", "bus"]);
  assert.equal(parsed.leg.provenance.kind, "scheduled");
  assert.equal(parsed.leg.totalMinutes, 155);
  assert.equal(parsed.schedule.providerItineraryId, "provider-itinerary-fast");
  assert.equal(parsed.schedule.providerDurationSeconds, 12_600);
  assert.equal(parsed.schedule.intercityDurationSeconds, 9_300);
  assert.equal(parsed.schedule.elapsedFromQuerySeconds, 9_300);
  assert.equal(parsed.schedule.departureTime, "2098-04-05T08:50:00Z");
  assert.equal(parsed.schedule.arrivalTime, "2098-04-05T11:25:00Z");
  assert.equal(
    parsed.schedule.stopSnapping.radiusMeters,
    SCHEDULE_TRANSIT_ENDPOINT_GATE_MAX_RADIUS_METERS,
  );
  assert.deepEqual(parsed.schedule.stopSnapping.origin, {
    cityCenter: { latitude: 48.8566, longitude: 2.3522 },
    providerStop: {
      name: "Rail terminal",
      stopId: "test:origin-intercity",
      coordinates: { latitude: 48.8566, longitude: 2.3522 },
    },
    distanceMeters: 0,
  });
  assert.equal(
    parsed.schedule.stopSnapping.destination.providerStop.stopId,
    "test:london-city",
  );
  assert.equal(parsed.leg.segments[0].scheduledService?.departurePlace, "Rail terminal");
  assert.equal(parsed.leg.segments.at(-1)?.scheduledService?.arrivalPlace, "City stop");

  const withPreDepartureWait = parseTransitousPlan(
    transitousPlanFixture(),
    "paris",
    "london",
    "2098-04-05T07:50:00Z",
  );
  assert.equal(withPreDepartureWait?.leg.totalMinutes, 155);
  assert.equal(withPreDepartureWait?.schedule.elapsedFromQuerySeconds, 9_300);
});

test("Transitous endpoint gate accepts major metropolitan stations outside the provider search radius", () => {
  const directRailPlan = (
    id: string,
    fromName: string,
    fromCoordinates: FixtureCoordinates,
    toName: string,
    toCoordinates: FixtureCoordinates,
  ) => ({
    itineraries: [
      {
        id,
        duration: 7_200,
        startTime: "2098-04-05T08:00:00Z",
        endTime: "2098-04-05T10:00:00Z",
        transfers: 0,
        legs: [
          {
            mode: "LONG_DISTANCE",
            duration: 7_200,
            startTime: "2098-04-05T08:00:00Z",
            endTime: "2098-04-05T10:00:00Z",
            from: { name: fromName, ...fromCoordinates },
            to: { name: toName, ...toCoordinates },
          },
        ],
      },
    ],
  });

  const milanToVienna = parseTransitousPlan(
    directRailPlan(
      "milan-vienna-main-stations",
      "Milano Centrale",
      { lat: 45.4863, lon: 9.2045 },
      "Wien Hauptbahnhof",
      { lat: 48.185257, lon: 16.372524 },
    ),
    "milan",
    "vienna",
  );
  assert.ok(milanToVienna);
  assert.ok(
    milanToVienna.schedule.stopSnapping.origin.distanceMeters >
      SCHEDULE_TRANSIT_STOP_SEARCH_RADIUS_METERS,
  );
  assert.ok(
    milanToVienna.schedule.stopSnapping.destination.distanceMeters >
      SCHEDULE_TRANSIT_STOP_SEARCH_RADIUS_METERS,
  );
  assert.equal(milanToVienna.leg.totalMinutes, 120);
  assert.equal(
    milanToVienna.schedule.intercityDurationSeconds,
    7_200,
    "published departure and arrival timestamps remain the displayed duration",
  );

  const viennaToBudapest = parseTransitousPlan(
    directRailPlan(
      "vienna-budapest-main-stations",
      "Wien Hauptbahnhof",
      { lat: 48.185974, lon: 16.378326 },
      "Budapest-Keleti",
      { lat: 47.5003, lon: 19.0839 },
    ),
    "vienna",
    "budapest",
  );
  assert.ok(viennaToBudapest);
  assert.ok(
    viennaToBudapest.schedule.stopSnapping.destination.distanceMeters >
      SCHEDULE_TRANSIT_STOP_SEARCH_RADIUS_METERS,
  );
  assert.ok(
    viennaToBudapest.schedule.stopSnapping.destination.distanceMeters <=
      viennaToBudapest.schedule.stopSnapping.radiusMeters,
  );
});

test("Transitous endpoint gate retains Venice-Mestre rail and rejects a stop nearer another selected city", () => {
  const veniceId = "open-meteo:venice-endpoint-gate";
  const florenceId = "open-meteo:florence-endpoint-gate";
  const venice = {
    id: veniceId,
    coordinates: { latitude: 45.4408, longitude: 12.3155 },
    timeZone: "Europe/Rome",
  };
  const florence = {
    id: florenceId,
    coordinates: { latitude: 43.7696, longitude: 11.2558 },
    timeZone: "Europe/Rome",
  };
  const cityById = new Map([
    [venice.id, venice],
    [florence.id, florence],
  ]);
  const veniceToFlorencePlan = {
    itineraries: [
      {
        id: "venice-mestre-florence-smn",
        duration: 7_200,
        startTime: "2098-04-05T08:00:00Z",
        endTime: "2098-04-05T10:00:00Z",
        transfers: 0,
        legs: [
          {
            mode: "HIGHSPEED_RAIL",
            duration: 7_200,
            startTime: "2098-04-05T08:00:00Z",
            endTime: "2098-04-05T10:00:00Z",
            from: {
              name: "Venezia Mestre",
              lat: 45.482031,
              lon: 12.23208,
            },
            to: {
              name: "Firenze Santa Maria Novella",
              lat: 43.7762,
              lon: 11.2488,
            },
          },
        ],
      },
    ],
  };
  const veniceToFlorence = parseTransitousPlan(
    veniceToFlorencePlan,
    veniceId,
    florenceId,
    undefined,
    cityById,
  );
  assert.ok(veniceToFlorence);
  assert.ok(
    veniceToFlorence.schedule.stopSnapping.origin.distanceMeters >
      SCHEDULE_TRANSIT_STOP_SEARCH_RADIUS_METERS,
  );
  assert.equal(veniceToFlorence.leg.totalMinutes, 120);

  const neighbourId = "open-meteo:selected-neighbour";
  const neighbour = {
    id: neighbourId,
    coordinates: { latitude: 45.482031, longitude: 12.23208 },
    timeZone: "Europe/Rome",
  };
  const citiesWithNeighbour = new Map([
    ...cityById,
    [neighbour.id, neighbour] as const,
  ]);
  assert.equal(
    parseTransitousPlan(
      veniceToFlorencePlan,
      veniceId,
      florenceId,
      undefined,
      citiesWithNeighbour,
    ),
    null,
    "a stop inside the metropolitan cap is still rejected when it belongs more closely to another selected city",
  );
});

test("Transitous parser rejects oversized provider structures and uses timestamps for segment time", () => {
  const fixture = transitousPlanFixture();
  assert.equal(parseTransitousPlan({ itineraries: Array.from({ length: 21 }, () => fixture.itineraries[0]) }, "paris", "london"), null);
  const tooManyLegs = structuredClone(fixture);
  tooManyLegs.itineraries = [tooManyLegs.itineraries[0]];
  tooManyLegs.itineraries[0].legs = Array.from({ length: 31 }, () => fixture.itineraries[0].legs[1]);
  assert.equal(parseTransitousPlan(tooManyLegs, "paris", "london"), null);
  const hugeStation = structuredClone(fixture);
  hugeStation.itineraries = [hugeStation.itineraries[0]];
  hugeStation.itineraries[0].legs[2].from.name = "x".repeat(301);
  assert.equal(parseTransitousPlan(hugeStation, "paris", "london"), null);
  const inconsistentDuration = structuredClone(fixture);
  inconsistentDuration.itineraries = [inconsistentDuration.itineraries[0]];
  inconsistentDuration.itineraries[0].legs[2].duration = 1;
  const parsed = parseTransitousPlan(inconsistentDuration, "paris", "london");
  assert.equal(parsed?.leg.segments[0].duration?.totalMinutes, 120, "timestamps, not the malformed duration field, drive displayed minutes");
  const farAwayEndpoint = structuredClone(fixture);
  farAwayEndpoint.itineraries = [farAwayEndpoint.itineraries[0]];
  Object.assign(farAwayEndpoint.itineraries[0].legs[2].from, {
    lat: 45,
    lon: 12,
  });
  assert.equal(
    parseTransitousPlan(farAwayEndpoint, "paris", "london"),
    null,
    "provider stops outside the bounded city radius are rejected",
  );
});

test("Transitous ranks by the same trimmed intercity duration shown to users", () => {
  const plan = {
    itineraries: [
      {
        id: "short-provider-total-slower-train",
        duration: 8_100,
        startTime: "2098-04-05T08:00:00Z",
        endTime: "2098-04-05T10:15:00Z",
        transfers: 0,
        legs: [
          {
            mode: "WALK",
            duration: 900,
            startTime: "2098-04-05T08:00:00Z",
            endTime: "2098-04-05T08:15:00Z",
            from: { name: "START" },
            to: { name: "Station" },
          },
          {
            mode: "RAIL",
            duration: 7_200,
            startTime: "2098-04-05T08:15:00Z",
            endTime: "2098-04-05T10:15:00Z",
            from: { name: "Station", lat: 48.8566, lon: 2.3522 },
            to: { name: "Destination", lat: 51.5072, lon: -0.1276 },
          },
        ],
      },
      {
        id: "long-provider-total-faster-train",
        duration: 14_400,
        startTime: "2098-04-05T06:00:00Z",
        endTime: "2098-04-05T10:00:00Z",
        transfers: 0,
        legs: [
          {
            mode: "WALK",
            duration: 10_800,
            startTime: "2098-04-05T06:00:00Z",
            endTime: "2098-04-05T09:00:00Z",
            from: { name: "START" },
            to: { name: "Station" },
          },
          {
            mode: "RAIL",
            duration: 3_600,
            startTime: "2098-04-05T09:00:00Z",
            endTime: "2098-04-05T10:00:00Z",
            from: { name: "Station", lat: 48.8566, lon: 2.3522 },
            to: { name: "Destination", lat: 51.5072, lon: -0.1276 },
          },
        ],
      },
    ],
  };
  const parsed = parseTransitousPlan(plan, "paris", "london");
  assert.equal(
    parsed?.schedule.providerItineraryId,
    "long-provider-total-faster-train",
  );
  assert.equal(parsed?.leg.totalMinutes, 60);
  assert.equal(parsed?.schedule.intercityDurationSeconds, 3_600);
});

test("Transitous excludes local access modes but retains intercity connection elapsed time", () => {
  const parsed = parseTransitousPlan(
    {
      itineraries: [
        {
          id: "rail-local-transfer-coach",
          duration: 10_800,
          startTime: "2098-04-05T08:00:00Z",
          endTime: "2098-04-05T11:00:00Z",
          transfers: 2,
          legs: [
            {
              mode: "RAIL",
              duration: 3_600,
              startTime: "2098-04-05T08:00:00Z",
              endTime: "2098-04-05T09:00:00Z",
              from: {
                name: "Origin station",
                lat: 48.8566,
                lon: 2.3522,
              },
              to: { name: "Transfer station" },
            },
            {
              mode: "SUBWAY",
              duration: 1_200,
              startTime: "2098-04-05T09:05:00Z",
              endTime: "2098-04-05T09:25:00Z",
              from: { name: "Transfer station" },
              to: { name: "Coach station" },
            },
            {
              mode: "WALK",
              duration: 600,
              startTime: "2098-04-05T09:25:00Z",
              endTime: "2098-04-05T09:35:00Z",
              from: { name: "Metro" },
              to: { name: "Coach bay" },
            },
            {
              mode: "COACH",
              duration: 4_800,
              startTime: "2098-04-05T09:40:00Z",
              endTime: "2098-04-05T11:00:00Z",
              from: { name: "Coach bay" },
              to: {
                name: "Destination",
                lat: 51.5072,
                lon: -0.1276,
              },
            },
          ],
        },
      ],
    },
    "paris",
    "london",
  );
  assert.ok(parsed);
  assert.deepEqual(parsed.leg.modes, ["train", "bus"]);
  assert.equal(parsed.leg.totalMinutes, 180);
  assert.equal(parsed.schedule.intercityDurationSeconds, 10_800);
  assert.deepEqual(
    parsed.leg.segments.flatMap(
      (segment) =>
        segment.duration?.components.map((component) => component.kind) ?? [],
    ),
    ["in_vehicle", "waiting", "in_vehicle"],
  );
});

test("schedule endpoint queries every ordered pair and keeps failures directional", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{
    url: string;
    userAgent: string | null;
    fromPlace: string | null;
    toPlace: string | null;
  }> = [];
  globalThis.fetch = (async (input, init) => {
    const url = new URL(String(input));
    calls.push({
      url: url.toString(),
      userAgent: new Headers(init?.headers).get("User-Agent"),
      fromPlace: url.searchParams.get("fromPlace"),
      toPlace: url.searchParams.get("toPlace"),
    });
    if (
      url.searchParams.get("fromPlace") === "51.5072,-0.1276" &&
      url.searchParams.get("toPlace") === "48.8566,2.3522"
    ) {
      return Response.json({ itineraries: [] });
    }
    return Response.json(transitousPlanFixtureForRequest(url));
  }) as typeof fetch;

  try {
    assert.equal(SCHEDULE_MAX_CITIES, null);
    assert.equal(SCHEDULE_MAX_PROVIDER_PAIRS, 12);
    assert.equal(SCHEDULE_MAX_PAIRS, 12);
    const response = await schedulePost(
      new Request("https://together.example/api/routes/schedule", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "CF-Connecting-IP": "203.0.113.10",
        },
        body: JSON.stringify({
          cityIds: ["paris", "london", "brussels"],
          departureDate: utcDateFromToday(30),
        }),
      }),
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      source: string;
      calculatedAt: string;
      legs: TravelLeg[];
      schedules: unknown[];
      partial: boolean;
      missingPairs: Array<{
        fromCityId: string;
        toCityId: string;
        reason: string;
      }>;
      requestSummary: {
        requestedPairCount: number;
        providerRequestCount: number;
        actualCoverage: boolean;
        optimalityGuaranteed: boolean;
      };
      requestPolicy: {
        batchDeadlineMs: number;
        rateLimit: string;
        transitStopSearch: {
          strategy: string;
          radiusMeters: number;
          endpointCoordinateGate: boolean;
          endpointGateMaximumRadiusMeters: number;
          nearestRequestedCityGuard: boolean;
        };
        departureDateHorizon: {
          basis: string;
          pastDays: number;
          futureDays: number;
        };
      };
    };
    assert.equal(body.source, "transitous");
    assert.doesNotThrow(() => new Date(body.calculatedAt).toISOString());
    assert.equal(body.partial, true);
    assert.equal(body.legs.length, 5);
    assert.equal(body.schedules.length, 5);
    assert.deepEqual(
      body.missingPairs.map(({ fromCityId, toCityId, reason }) => ({
        fromCityId,
        toCityId,
        reason,
      })),
      [
        {
          fromCityId: "london",
          toCityId: "paris",
          reason: "no_itinerary",
        },
      ],
    );
    assert.equal(body.requestSummary.requestedPairCount, 6);
    assert.equal(body.requestSummary.providerRequestCount, 6);
    assert.equal(body.requestSummary.actualCoverage, true, "confirmed no-itinerary edges count as resolved coverage");
    assert.equal(body.requestSummary.optimalityGuaranteed, true);
    assert.equal(body.requestPolicy.batchDeadlineMs, SCHEDULE_BATCH_DEADLINE_MS);
    assert.deepEqual(body.requestPolicy.transitStopSearch, {
      strategy: "provider_radius",
      radiusMeters: SCHEDULE_TRANSIT_STOP_SEARCH_RADIUS_METERS,
      endpointCoordinateGate: true,
      endpointGateMaximumRadiusMeters:
        SCHEDULE_TRANSIT_ENDPOINT_GATE_MAX_RADIUS_METERS,
      nearestRequestedCityGuard: true,
    });
    assert.match(body.requestPolicy.rateLimit, /instance-local/i);
    assert.deepEqual(body.requestPolicy.departureDateHorizon, {
      basis: "UTC calendar date, inclusive",
      pastDays: SCHEDULE_PAST_DATE_HORIZON_DAYS,
      futureDays: SCHEDULE_FUTURE_DATE_HORIZON_DAYS,
    });
    assert.equal(calls.length, 6);
    assert.equal(response.headers.get("X-RateLimit-Limit"), "4");
    assert.equal(response.headers.get("X-RateLimit-Remaining"), "3");
    assert.ok(
      calls.every(
        (call) =>
          call.userAgent ===
          "Together/0.6 (https://together-travel-0920.ocvi-85.chatgpt.site)",
      ),
    );
    assert.deepEqual(
      calls.map((call) => `${call.fromPlace}->${call.toPlace}`).sort(),
      [
        "48.8566,2.3522->50.8503,4.3517",
        "48.8566,2.3522->51.5072,-0.1276",
        "50.8503,4.3517->48.8566,2.3522",
        "50.8503,4.3517->51.5072,-0.1276",
        "51.5072,-0.1276->48.8566,2.3522",
        "51.5072,-0.1276->50.8503,4.3517",
      ],
    );
    assert.ok(
      calls.every((call) =>
        call.url.includes("transitModes=RAIL%2CBUS%2CCOACH"),
      ),
    );
    for (const call of calls) {
      const query = new URL(call.url).searchParams;
      assert.equal(query.get("timetableView"), "false");
      assert.equal(query.get("arriveBy"), "false");
      assert.equal(query.get("maxTransfers"), "8");
      assert.equal(query.get("minTransferTime"), "5");
      assert.equal(query.get("additionalTransferTime"), "5");
      assert.equal(query.get("useRoutedTransfers"), "true");
      assert.equal(
        query.get("radius"),
        String(SCHEDULE_TRANSIT_STOP_SEARCH_RADIUS_METERS),
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("schedule endpoint accepts larger routes and bounds provider work", async () => {
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = (async (input) => {
    providerCalls += 1;
    return Response.json(transitousPlanFixtureForRequest(input));
  }) as typeof fetch;
  try {
    const response = await schedulePost(
      new Request("https://together.example/api/routes/schedule", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "CF-Connecting-IP": "203.0.113.201",
        },
        body: JSON.stringify({
          cityIds: [
            "paris",
            "london",
            "brussels",
            "lyon",
            "milan",
          ],
          departureDate: utcDateFromToday(31),
        }),
      }),
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      partial: boolean;
      requestSummary: {
        requestedPairCount: number;
        eligiblePairCount: number;
        candidatePairCount: number;
        candidateStrategy: string;
        providerPairLimitApplied: boolean;
      };
    };
    assert.equal(body.partial, true);
    assert.equal(
      body.requestSummary.requestedPairCount,
      body.requestSummary.candidatePairCount,
    );
    assert.ok(body.requestSummary.candidatePairCount >= 4);
    assert.ok(
      body.requestSummary.candidatePairCount <= SCHEDULE_MAX_PROVIDER_PAIRS,
    );
    assert.equal(body.requestSummary.eligiblePairCount, 20);
    assert.equal(
      body.requestSummary.candidateStrategy,
      "geographic_path_candidates",
    );
    assert.equal(body.requestSummary.providerPairLimitApplied, true);
    assert.equal(providerCalls, body.requestSummary.candidatePairCount);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sparse candidate construction stops promptly at the public-provider budget", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => Response.json({ itineraries: [] })) as typeof fetch;
  const cities = Array.from({ length: 140 }, (_, index) => ({
    id: `open-meteo:${8_000_000 + index}`,
    latitude: -60 + (index % 100) * 1.1,
    longitude: -170 + (index * 37) % 340,
    timeZone: "UTC",
  }));
  const startedAt = performance.now();
  try {
    const response = await schedulePost(new Request("https://together.example/api/routes/schedule", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "CF-Connecting-IP": "203.0.113.206",
      },
      body: JSON.stringify({
        cityIds: cities.map((city) => city.id),
        cities,
        startCityId: cities[0].id,
        endCityId: cities.at(-1)?.id,
        departureDate: utcDateFromToday(35),
      }),
    }));
    const elapsedMilliseconds = performance.now() - startedAt;
    assert.equal(response.status, 200);
    const body = await response.json() as { requestSummary: { candidatePairCount: number } };
    assert.equal(body.requestSummary.candidatePairCount, SCHEDULE_MAX_PROVIDER_PAIRS);
    assert.ok(elapsedMilliseconds < 2_000, `candidate generation took ${elapsedMilliseconds}ms`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("five fixed-endpoint cities use only scheduled sparse candidates and disclose approximate optimality", async () => {
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = (async (input) => {
    providerCalls += 1;
    return Response.json(transitousPlanFixtureForRequest(input));
  }) as typeof fetch;
  const cityIds = ["paris", "london", "brussels", "lyon", "milan"];
  try {
    const response = await schedulePost(
      new Request("https://together.example/api/routes/schedule", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "CF-Connecting-IP": "203.0.113.205",
        },
        body: JSON.stringify({
          cityIds,
          startCityId: "paris",
          endCityId: "milan",
          departureDate: utcDateFromToday(34),
        }),
      }),
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      legs: TravelLeg[];
      requestSummary: {
        eligiblePairCount: number;
        candidatePairCount: number;
        candidateStrategy: string;
        verifiedCandidateSetComplete: boolean;
        actualCoverage: boolean;
        optimalityGuaranteed: boolean;
      };
    };
    assert.equal(body.requestSummary.eligiblePairCount, 13);
    assert.ok(body.requestSummary.candidatePairCount <= 12);
    assert.equal(providerCalls, body.requestSummary.candidatePairCount);
    assert.equal(body.requestSummary.candidateStrategy, "geographic_path_candidates");
    assert.equal(body.requestSummary.verifiedCandidateSetComplete, true);
    assert.equal(body.requestSummary.actualCoverage, false);
    assert.equal(body.requestSummary.optimalityGuaranteed, false);
    const itinerary = optimizeVerifiedItinerary(cityIds, body.legs, {
      startCityId: "paris",
      endCityId: "milan",
      cities: cityIds.map(getCity),
    });
    assert.equal(itinerary.cityOrder.length, cityIds.length);
    assert.equal(new Set(itinerary.cityOrder).size, cityIds.length);
    assert.equal(itinerary.cityOrder[0], "paris");
    assert.equal(itinerary.cityOrder.at(-1), "milan");
    assert.ok(itinerary.legs.every(isVerifiedTransportLeg));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("schedule endpoint validates and applies fixed start/end constraints", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ from: string | null; to: string | null }> = [];
  globalThis.fetch = (async (input) => {
    const query = new URL(String(input)).searchParams;
    calls.push({ from: query.get("fromPlace"), to: query.get("toPlace") });
    return Response.json(transitousPlanFixtureForRequest(input));
  }) as typeof fetch;
  try {
    const response = await schedulePost(
      new Request("https://together.example/api/routes/schedule", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "CF-Connecting-IP": "203.0.113.202",
        },
        body: JSON.stringify({
          cityIds: ["paris", "london", "brussels", "lyon"],
          startCityId: "paris",
          endCityId: "lyon",
          departureDate: utcDateFromToday(32),
        }),
      }),
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      routeConstraints: {
        startCityId: string | null;
        endCityId: string | null;
      };
      requestSummary: { requestedPairCount: number; eligiblePairCount: number };
    };
    assert.deepEqual(body.routeConstraints, {
      startCityId: "paris",
      endCityId: "lyon",
    });
    assert.equal(body.requestSummary.requestedPairCount, 7);
    assert.equal(body.requestSummary.eligiblePairCount, 7);
    assert.equal(calls.length, 7);
    const paris = "48.8566,2.3522";
    const lyon = "45.764,4.8357";
    assert.ok(calls.every((call) => call.to !== paris));
    assert.ok(calls.every((call) => call.from !== lyon));

    for (const invalidConstraints of [
      { startCityId: "berlin" },
      { endCityId: "berlin" },
      { startCityId: "paris", endCityId: "paris" },
    ]) {
      const invalid = await schedulePost(
        new Request("https://together.example/api/routes/schedule", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cityIds: ["paris", "london"],
            departureDate: utcDateFromToday(33),
            ...invalidConstraints,
          }),
        }),
      );
      assert.equal(invalid.status, 400);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("schedule endpoint routes validated Open-Meteo cities by request coordinates", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input) => {
    calls.push(String(input));
    return Response.json(transitousPlanFixtureForRequest(input));
  }) as typeof fetch;

  try {
    const response = await schedulePost(
      new Request("https://together.example/api/routes/schedule", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "CF-Connecting-IP": "203.0.113.120",
        },
        body: JSON.stringify({
          cities: [
            {
              id: "open-meteo:2988507",
              latitude: 48.8566,
              longitude: 2.3522,
              timeZone: "Europe/Paris",
            },
            {
              id: "open-meteo:2643743",
              latitude: 51.5072,
              longitude: -0.1276,
              timeZone: "Europe/London",
            },
          ],
          departureDate: utcDateFromToday(70),
        }),
      }),
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      legs: TravelLeg[];
      requestSummary: { dynamicCityCount: number };
    };
    assert.equal(body.requestSummary.dynamicCityCount, 2);
    assert.deepEqual(
      body.legs.map(({ fromCityId, toCityId }) => `${fromCityId}->${toCityId}`).sort(),
      [
        "open-meteo:2643743->open-meteo:2988507",
        "open-meteo:2988507->open-meteo:2643743",
      ],
    );
    assert.deepEqual(
      calls
        .map((call) => {
          const query = new URL(call).searchParams;
          return `${query.get("fromPlace")}->${query.get("toPlace")}`;
        })
        .sort(),
      ["48.8566,2.3522->51.5072,-0.1276", "51.5072,-0.1276->48.8566,2.3522"],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("dynamic schedule city validation rejects forged ids and location metadata", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("Invalid city requests must not reach the provider");
  }) as typeof fetch;
  const validDynamicCity = {
    id: "open-meteo:1234",
    latitude: 45,
    longitude: 5,
    timeZone: "Europe/Paris",
  };
  const invalidCityLists = [
    [validDynamicCity, { ...validDynamicCity, id: "open-meteo:0" }],
    [validDynamicCity, { ...validDynamicCity, id: "open-meteo:01" }],
    [validDynamicCity, { ...validDynamicCity, id: "open-meteo:9007199254740992" }],
    [validDynamicCity, { ...validDynamicCity, id: "custom:55" }],
    [validDynamicCity, { ...validDynamicCity, id: "open-meteo:2", latitude: 91 }],
    [validDynamicCity, { ...validDynamicCity, id: "open-meteo:2", longitude: -181 }],
    [validDynamicCity, { ...validDynamicCity, id: "open-meteo:2", timeZone: "Mars/Base" }],
    [validDynamicCity, { ...validDynamicCity }],
    [
      {
        id: "paris",
        latitude: 0,
        longitude: 0,
        timeZone: "Europe/Paris",
      },
      validDynamicCity,
    ],
  ];

  try {
    for (const cities of invalidCityLists) {
      const response = await schedulePost(
        new Request("https://together.example/api/routes/schedule", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cities,
            departureDate: utcDateFromToday(71),
          }),
        }),
      );
      assert.equal(response.status, 400);
      const body = (await response.json()) as { error?: { code?: string } };
      assert.equal(body.error?.code, "invalid_schedule_request");
    }

    const mismatch = await schedulePost(
      new Request("https://together.example/api/routes/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cityIds: ["open-meteo:2", "open-meteo:1234"],
          cities: [validDynamicCity, { ...validDynamicCity, id: "open-meteo:2" }],
          departureDate: utcDateFromToday(71),
        }),
      }),
    );
    assert.equal(mismatch.status, 400);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("dynamic schedule cache keys include coordinates and time zones", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input) => {
    calls.push(String(input));
    return Response.json({ itineraries: [] });
  }) as typeof fetch;
  const postCities = (cities: unknown[], clientIp: string) =>
    schedulePost(
      new Request("https://together.example/api/routes/schedule", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "CF-Connecting-IP": clientIp,
        },
        body: JSON.stringify({
          cities,
          departureDate: utcDateFromToday(72),
        }),
      }),
    );

  try {
    const first = await postCities(
      [
        { id: "open-meteo:9101", latitude: 40, longitude: 2, timeZone: "Europe/Paris" },
        { id: "open-meteo:9102", latitude: 41, longitude: 3, timeZone: "Europe/Paris" },
      ],
      "203.0.113.121",
    );
    const second = await postCities(
      [
        { id: "open-meteo:9101", latitude: 50, longitude: 12, timeZone: "Europe/Berlin" },
        { id: "open-meteo:9102", latitude: 51, longitude: 13, timeZone: "Europe/Berlin" },
      ],
      "203.0.113.122",
    );
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(calls.length, 4);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("concurrent identical schedule requests share provider work", async () => {
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = (async (input) => {
    providerCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 15));
    return Response.json(transitousPlanFixtureForRequest(input));
  }) as typeof fetch;
  const body = JSON.stringify({
    cities: [
      { id: "open-meteo:9201", latitude: 43, longitude: 4, timeZone: "Europe/Paris" },
      { id: "open-meteo:9202", latitude: 44, longitude: 5, timeZone: "Europe/Paris" },
    ],
    departureDate: utcDateFromToday(74),
  });

  try {
    const [first, second] = await Promise.all([
      schedulePost(new Request("https://together.example/api/routes/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.130" },
        body,
      })),
      schedulePost(new Request("https://together.example/api/routes/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.131" },
        body,
      })),
    ]);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(providerCalls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("schedule endpoint enforces its byte payload limit before validation", async () => {
  const response = await schedulePost(
    new Request("https://together.example/api/routes/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ padding: "x".repeat(SCHEDULE_MAX_REQUEST_BYTES) }),
    }),
  );
  assert.equal(response.status, 413);
  const body = (await response.json()) as { error?: { code?: string } };
  assert.equal(body.error?.code, "schedule_request_too_large");
});

test("schedule departure dates use an inclusive UTC -1/+365 day horizon", () => {
  const fixedNow = Date.UTC(2026, 7, 9, 23, 59, 59);
  assert.equal(validateDepartureDate("2026-08-08", fixedNow), "2026-08-08");
  assert.equal(validateDepartureDate("2026-08-09", fixedNow), "2026-08-09");
  assert.equal(validateDepartureDate("2027-08-09", fixedNow), "2027-08-09");
  assert.equal(validateDepartureDate("2026-08-07", fixedNow), null);
  assert.equal(validateDepartureDate("2027-08-10", fixedNow), null);
  assert.equal(validateDepartureDate("2026-02-30", fixedNow), null);
});

test("schedule batch deadline is at most fifteen seconds", () => {
  assert.ok(SCHEDULE_BATCH_DEADLINE_MS > 0);
  assert.ok(SCHEDULE_BATCH_DEADLINE_MS <= 15_000);
  assert.ok(
    SCHEDULE_PROVIDER_TIMEOUT_MS > 7_000,
    "the client must not abort before MOTIS' requested seven-second timeout",
  );
});

test("request cancellation aborts active pairs and clears queued provider work", async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  const providerSignals: AbortSignal[] = [];
  globalThis.fetch = (async (_input, init) => {
    assert.ok(init?.signal);
    providerSignals.push(init.signal);
    return await new Promise<Response>(() => undefined);
  }) as typeof fetch;

  try {
    const startedAt = Date.now();
    const pending = schedulePost(
      new Request("https://together.example/api/routes/schedule", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "CF-Connecting-IP": "203.0.113.88",
        },
        body: JSON.stringify({
          cityIds: ["paris", "london", "brussels"],
          departureDate: utcDateFromToday(60),
        }),
        signal: controller.signal,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();
    const response = await pending;
    const body = (await response.json()) as {
      missingPairs: Array<{ reason: string }>;
    };
    assert.equal(response.status, 200);
    assert.equal(providerSignals.length, 4);
    assert.ok(providerSignals.every((signal) => signal.aborted));
    assert.equal(body.missingPairs.length, 6);
    assert.ok(
      body.missingPairs.every(({ reason }) => reason === "provider_timeout"),
    );
    assert.ok(Date.now() - startedAt < 1_000);

    let followUpCalls = 0;
    globalThis.fetch = (async (input) => {
      followUpCalls += 1;
      return Response.json(transitousPlanFixtureForRequest(input));
    }) as typeof fetch;
    const followUp = await schedulePost(
      new Request("https://together.example/api/routes/schedule", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "CF-Connecting-IP": "203.0.113.89",
        },
        body: JSON.stringify({
          cityIds: ["paris", "london", "brussels"],
          departureDate: utcDateFromToday(60),
        }),
      }),
    );
    assert.equal(followUp.status, 200);
    assert.equal(followUpCalls, 6);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("client IP parsing uses only the first safe proxy address", () => {
  assert.equal(
    parseClientIp(
      new Request("https://together.example", {
        headers: {
          "CF-Connecting-IP": "203.0.113.8, 10.0.0.1",
          "X-Forwarded-For": "198.51.100.5",
        },
      }),
    ),
    "203.0.113.8",
  );
  assert.equal(
    parseClientIp(
      new Request("https://together.example", {
        headers: {
          "CF-Connecting-IP": "not-an-ip",
          "X-Forwarded-For": "2001:DB8::1, 198.51.100.5",
        },
      }),
    ),
    "2001:db8::1",
  );
  assert.equal(
    parseClientIp(
      new Request("https://together.example", {
        headers: { "X-Forwarded-For": "invalid, 198.51.100.5" },
      }),
    ),
    "unknown",
  );
});

test("schedule endpoint rate-limits calculations per client IP", async () => {
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = (async (input) => {
    providerCalls += 1;
    return Response.json(transitousPlanFixtureForRequest(input));
  }) as typeof fetch;

  const makeRequest = () =>
    schedulePost(
      new Request("https://together.example/api/routes/schedule", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Forwarded-For": "198.51.100.77, 10.0.0.1",
        },
        body: JSON.stringify({
          cityIds: ["seoul", "busan"],
          departureDate: utcDateFromToday(30),
        }),
      }),
    );

  try {
    assert.equal(SCHEDULE_RATE_LIMIT_REQUESTS, 4);
    for (let index = 0; index < SCHEDULE_RATE_LIMIT_REQUESTS; index += 1) {
      const response = await makeRequest();
      assert.equal(response.status, 200);
      assert.equal(
        response.headers.get("X-RateLimit-Remaining"),
        String(SCHEDULE_RATE_LIMIT_REQUESTS - index - 1),
      );
    }

    const limited = await makeRequest();
    assert.equal(limited.status, 429);
    assert.match(limited.headers.get("Retry-After") ?? "", /^\d+$/);
    const retryAfter = Number(limited.headers.get("Retry-After"));
    assert.ok(retryAfter >= 1 && retryAfter <= 60);
    const body = (await limited.json()) as { error?: { code?: string } };
    assert.equal(body.error?.code, "rate_limit_exceeded");
    assert.equal(providerCalls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("equal splitting is integer-only, deterministic, and sum preserving", () => {
  assert.deepEqual(splitEvenly(100, ["c", "a", "b"]), [
    { participantId: "a", minorUnits: 34 },
    { participantId: "b", minorUnits: 33 },
    { participantId: "c", minorUnits: 33 },
  ]);
  assert.throws(() => createMoney("EUR", 1.5), /integer/);
  assert.throws(() => splitEvenly(100, ["a", "a"]), /unique/);
});

test("expense balances settle exactly with deterministic transfers", () => {
  const expense = createEqualSplitExpense({
    id: "expense-1",
    tripId: "trip-1",
    paidBy: "a",
    category: "food",
    description: "Dinner",
    currency: "eur",
    totalMinorUnits: 100,
    participantIds: ["c", "a", "b"],
    occurredAt: "2026-08-09T19:30:00Z",
  });
  const balances = calculateBalances([expense]);
  assert.deepEqual(
    balances.map((balance) => [
      balance.participantId,
      balance.amount.minorUnits,
    ]),
    [
      ["a", 66],
      ["b", -33],
      ["c", -33],
    ],
  );
  assert.deepEqual(minimumSettlementTransfers(balances), [
    {
      fromParticipantId: "b",
      toParticipantId: "a",
      amount: { currency: "EUR", minorUnits: 33 },
    },
    {
      fromParticipantId: "c",
      toParticipantId: "a",
      amount: { currency: "EUR", minorUnits: 33 },
    },
  ]);
});

test("greedy settlement is deterministic for independent zero-sum groups", () => {
  const balances: ParticipantBalance[] = [
    { participantId: "a", amount: createMoney("USD", 500) },
    { participantId: "b", amount: createMoney("USD", -500) },
    { participantId: "c", amount: createMoney("USD", 300) },
    { participantId: "d", amount: createMoney("USD", -300) },
  ];
  const transfers = minimumSettlementTransfers(balances);
  assert.equal(transfers.length, 2);
  assert.deepEqual(transfers, [
    {
      fromParticipantId: "b",
      toParticipantId: "a",
      amount: { currency: "USD", minorUnits: 500 },
    },
    {
      fromParticipantId: "d",
      toParticipantId: "c",
      amount: { currency: "USD", minorUnits: 300 },
    },
  ]);
});

test("greedy settlement handles 100 participants within bounded time and preserves every balance", () => {
  const balances: ParticipantBalance[] = [
    ...Array.from({ length: 50 }, (_, index) => ({
      participantId: `debtor-${String(index).padStart(2, "0")}`,
      amount: createMoney("EUR", -(index + 1)),
    })),
    ...Array.from({ length: 50 }, (_, index) => ({
      participantId: `creditor-${String(index).padStart(2, "0")}`,
      amount: createMoney("EUR", index + 1),
    })),
  ];

  const startedAt = performance.now();
  const transfers = minimumSettlementTransfers(balances);
  const elapsedMilliseconds = performance.now() - startedAt;
  const repeated = minimumSettlementTransfers([...balances].reverse());

  assert.ok(elapsedMilliseconds < 5_000);
  assert.deepEqual(repeated, transfers);
  assert.ok(transfers.length <= 99);
  assert.ok(
    transfers.every(
      (transfer) =>
        transfer.amount.currency === "EUR" &&
        transfer.amount.minorUnits > 0 &&
        transfer.fromParticipantId !== transfer.toParticipantId,
    ),
  );

  const residuals = new Map(
    balances.map((balance) => [
      balance.participantId,
      balance.amount.minorUnits,
    ]),
  );
  for (const transfer of transfers) {
    residuals.set(
      transfer.fromParticipantId,
      (residuals.get(transfer.fromParticipantId) ?? 0) +
        transfer.amount.minorUnits,
    );
    residuals.set(
      transfer.toParticipantId,
      (residuals.get(transfer.toParticipantId) ?? 0) -
        transfer.amount.minorUnits,
    );
  }
  assert.ok([...residuals.values()].every((balance) => balance === 0));
});

test("multi-currency expenses produce separate settlement ledgers", () => {
  const shared = {
    tripId: "trip-1",
    paidBy: "a",
    category: "transport" as const,
    description: "Tickets",
    totalMinorUnits: 100,
    participantIds: ["a", "b"],
    occurredAt: "2026-08-09T10:00:00Z",
  };
  const settlements = settleExpensesByCurrency([
    createEqualSplitExpense({ ...shared, id: "eur", currency: "EUR" }),
    createEqualSplitExpense({ ...shared, id: "jpy", currency: "JPY" }),
  ]);
  assert.deepEqual(
    settlements.map((settlement) => settlement.currency),
    ["EUR", "JPY"],
  );
  assert.ok(settlements.every((settlement) => settlement.transfers.length === 1));
});
