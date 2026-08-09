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
  type DataProvenance,
  type ParticipantBalance,
  type TravelLeg,
} from "../lib/domain.js";
import {
  assertDurationInvariant,
  buildEstimatedFallbackOptions,
  createDurationBreakdown,
  createEstimatedFallbackLeg,
  createTransportSegment,
  createTravelLeg,
  optimizeItinerary,
  selectFastestLeg,
} from "../lib/routing.js";

const estimate: DataProvenance = {
  kind: "estimated",
  methodology: "Test fixture only",
};

function simpleLeg(
  fromCityId: string,
  toCityId: string,
  minutes: number,
  id = `${fromCityId}:${toCityId}:${minutes}`,
  provenance: DataProvenance = estimate,
): TravelLeg {
  return createTravelLeg({
    id,
    fromCityId,
    toCityId,
    segments: [
      createTransportSegment({
        id: `${id}:segment`,
        mode: "bus",
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

test("fastest-leg selection uses duration then stronger provenance", () => {
  const scheduled = simpleLeg("paris", "london", 100, "scheduled", {
    kind: "scheduled",
    source: "Timetable",
  });
  const estimated = simpleLeg("paris", "london", 100, "estimated");
  const slowerObserved = simpleLeg("paris", "london", 101, "observed", {
    kind: "observed",
    source: "Measured trips",
    observedAt: "2026-08-01T00:00:00Z",
  });
  assert.equal(
    selectFastestLeg(
      [estimated, slowerObserved, scheduled],
      "paris",
      "london",
    )?.id,
    "scheduled",
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

test("exact optimization rejects oversized or disconnected inputs", () => {
  assert.throws(
    () =>
      optimizeItinerary(
        [
          "seoul",
          "tokyo",
          "beijing",
          "singapore",
          "sydney",
          "paris",
          "london",
          "berlin",
          "rome",
          "madrid",
          "dubai",
        ],
        [],
      ),
    /at most 10 cities/,
  );
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

test("minimum settlement preserves independent zero-sum groups", () => {
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

test("minimum settlement count matches exhaustive zero-sum partitioning", () => {
  let seed = 0x5eed1234;
  const random = () => {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
    return seed;
  };
  const exhaustiveMinimum = (valuesInput: readonly number[]) => {
    const values = valuesInput.filter((value) => value !== 0);
    const size = 1 << values.length;
    const sums = Array<number>(size).fill(0);
    const groups = Array<number>(size).fill(Number.NEGATIVE_INFINITY);
    groups[0] = 0;
    for (let mask = 1; mask < size; mask += 1) {
      const bit = mask & -mask;
      const index = 31 - Math.clz32(bit);
      sums[mask] = sums[mask ^ bit] + values[index];
      if (sums[mask] !== 0) continue;
      groups[mask] = 1;
      for (
        let subset = (mask - 1) & mask;
        subset > 0;
        subset = (subset - 1) & mask
      ) {
        const remainder = mask ^ subset;
        if (groups[subset] >= 0 && groups[remainder] >= 0) {
          groups[mask] = Math.max(
            groups[mask],
            groups[subset] + groups[remainder],
          );
        }
      }
    }
    return values.length - groups[size - 1];
  };

  for (let iteration = 0; iteration < 80; iteration += 1) {
    const values = Array.from(
      { length: 6 },
      () => (random() % 17) - 8,
    );
    values.push(-values.reduce((sum, value) => sum + value, 0));
    const balances = values.map((minorUnits, index) => ({
      participantId: `p${index}`,
      amount: createMoney("EUR", minorUnits),
    }));
    assert.equal(
      minimumSettlementTransfers(balances).length,
      exhaustiveMinimum(values),
    );
  }
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
