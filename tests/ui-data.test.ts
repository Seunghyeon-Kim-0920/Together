import assert from "node:assert/strict";
import test from "node:test";
import { initialExpensesForAccount } from "../app/components/ExpensesPanel";
import { parseRouteSnapshot, type RouteSnapshot } from "../app/components/RoutePlanner";
import { TRUSTED_TIMETABLE_SOURCE } from "../lib/route-snapshot";
import { getCity } from "../lib/cities";
import { createEqualSplitExpense, parseExpenseLedger } from "../lib/expenses";
import type { City } from "../lib/domain";
import { buildEstimatedFallbackOptions, buildEstimatedFallbackOptionsForCities, optimizeItinerary } from "../lib/routing";

test("authenticated accounts never inherit the guest demonstration ledger", () => {
  assert.deepEqual(initialExpensesForAccount(true), []);
  assert.ok(initialExpensesForAccount(false).length > 0);
});

test("version 2 route snapshots preserve the exact selected itinerary", () => {
  const selectedCityIds = ["paris", "brussels"];
  const itinerary = optimizeItinerary(
    selectedCityIds,
    buildEstimatedFallbackOptions(selectedCityIds),
    { startCityId: "paris" },
  );
  const snapshot: RouteSnapshot = {
    version: 2,
    name: "Paris → Bruxelles",
    departureDate: "2026-09-08",
    cityOrder: [...itinerary.cityOrder],
    totalMinutes: itinerary.totalMinutes,
    createdAt: "2026-08-09T12:00:00.000Z",
    provenance: "estimated",
    selectedCityIds,
    fixedStart: true,
    itinerary,
  };

  const parsed = parseRouteSnapshot(snapshot);
  assert.ok(parsed?.itinerary);
  assert.deepEqual(parsed.itinerary.legs, itinerary.legs);

  const tampered = structuredClone(snapshot) as RouteSnapshot & {
    itinerary: { legs: Array<{ toCityId: string }> };
  };
  tampered.itinerary.legs[0].toCityId = "berlin";
  assert.equal(parseRouteSnapshot(tampered), null);
});

test("legacy route snapshots remain readable without claiming exact reproduction", () => {
  const legacy: RouteSnapshot = {
    version: 1,
    name: "Paris → Bruxelles",
    departureDate: "2026-09-08",
    cityOrder: ["paris", "brussels"],
    totalMinutes: 160,
    createdAt: "2026-08-09T12:00:00.000Z",
    provenance: "estimated",
  };
  assert.deepEqual(parseRouteSnapshot(legacy), legacy);
});

test("route snapshots reject forged totals, component kinds, city sets, and timetable sources", () => {
  const selectedCityIds = ["paris", "brussels"];
  const itinerary = optimizeItinerary(
    selectedCityIds,
    buildEstimatedFallbackOptions(selectedCityIds),
    { startCityId: "paris" },
  );
  const snapshot: RouteSnapshot = {
    version: 2,
    name: "Paris → Bruxelles",
    departureDate: "2026-09-08",
    cityOrder: [...itinerary.cityOrder],
    totalMinutes: itinerary.totalMinutes,
    createdAt: "2026-08-09T12:00:00.000Z",
    provenance: "estimated",
    selectedCityIds,
    fixedStart: true,
    itinerary,
  };

  const forgedTotal = structuredClone(snapshot);
  (forgedTotal.itinerary as unknown as { totalMinutes: number }).totalMinutes += 1;
  assert.equal(parseRouteSnapshot(forgedTotal), null);

  const forgedKind = structuredClone(snapshot);
  (forgedKind.itinerary.legs[0].segments[0].duration?.components[0] as { kind: string }).kind = "script";
  assert.equal(parseRouteSnapshot(forgedKind), null);

  const forgedCities = structuredClone(snapshot);
  (forgedCities as unknown as { selectedCityIds: string[] }).selectedCityIds = ["paris", "berlin"];
  assert.equal(parseRouteSnapshot(forgedCities), null);

  const forgedSource = structuredClone(snapshot);
  (forgedSource.itinerary.legs[0].segments[0].provenance as unknown as { kind: string; source: string }).kind = "scheduled";
  (forgedSource.itinerary.legs[0].segments[0].provenance as unknown as { kind: string; source: string }).source = "User supplied timetable";
  assert.equal(parseRouteSnapshot(forgedSource), null);
});

test("unsigned imported timetable claims are restored only as estimates", () => {
  const selectedCityIds = ["paris", "brussels"];
  const itinerary = optimizeItinerary(
    selectedCityIds,
    buildEstimatedFallbackOptions(selectedCityIds),
    { startCityId: "paris" },
  );
  const snapshot = structuredClone({
    version: 2,
    name: "Paris to Brussels",
    departureDate: "2026-09-08",
    cityOrder: [...itinerary.cityOrder],
    totalMinutes: itinerary.totalMinutes,
    createdAt: "2026-08-09T12:00:00.000Z",
    provenance: "scheduled",
    selectedCityIds,
    fixedStart: true,
    itinerary,
  }) as unknown as RouteSnapshot;
  const mutableSnapshot = snapshot as unknown as {
    itinerary: {
      provenance: unknown;
      legs: Array<{ provenance: unknown; segments: Array<{ provenance: unknown }> }>;
    };
  };
  const scheduled = { kind: "scheduled" as const, source: TRUSTED_TIMETABLE_SOURCE };
  mutableSnapshot.itinerary.provenance = scheduled;
  mutableSnapshot.itinerary.legs[0].provenance = scheduled;
  mutableSnapshot.itinerary.legs[0].segments.forEach((segment) => { segment.provenance = scheduled; });

  const restored = parseRouteSnapshot(snapshot);
  assert.equal(restored?.provenance, "estimated");
  assert.ok(restored?.version === 2 && restored.itinerary.legs.every((leg) =>
    leg.segments.every((segment) => segment.provenance.kind !== "scheduled"),
  ));
});

test("expense ledger parser rejects malformed persistent data", () => {
  const expense = createEqualSplitExpense({
    id: "expense-1",
    tripId: "trip-1",
    paidBy: "me",
    category: "food",
    description: "Dinner",
    currency: "EUR",
    totalMinorUnits: 10_00,
    participantIds: ["me", "friend"],
    occurredAt: "2026-08-09T12:00:00.000Z",
  });
  assert.ok(parseExpenseLedger({ version: 1, expenses: [expense] }));
  assert.equal(parseExpenseLedger({ version: 1, expenses: [{ id: "x" }] }), null);
  assert.equal(parseExpenseLedger({
    version: 1,
    expenses: [{ ...expense, shares: [{ participantId: "me", minorUnits: 1 }] }],
  }), null);
});

test("dynamic GeoNames cities survive route optimization and snapshot restoration", () => {
  const reykjavik: City = {
    id: "open-meteo:3413829",
    names: { ko: "레이캬비크", en: "Reykjavík", fr: "Reykjavik", ja: "レイキャビク", zh: "雷克雅未克" },
    country: {
      code: "IS",
      names: { ko: "아이슬란드", en: "Iceland", fr: "Islande", ja: "アイスランド", zh: "冰岛" },
    },
    coordinates: { latitude: 64.1466, longitude: -21.9426 },
    timeZone: "Atlantic/Reykjavik",
  };
  const staticParis = getCity("paris");
  const cities = [staticParis, reykjavik];
  const itinerary = optimizeItinerary(
    cities.map((city) => city.id),
    buildEstimatedFallbackOptionsForCities(cities),
    { startCityId: "paris", cities },
  );
  const snapshot: RouteSnapshot = {
    version: 2,
    name: "Paris → Reykjavík",
    departureDate: "2026-09-08",
    cityOrder: itinerary.cityOrder,
    totalMinutes: itinerary.totalMinutes,
    createdAt: "2026-08-09T12:00:00.000Z",
    provenance: "estimated",
    selectedCityIds: cities.map((city) => city.id),
    fixedStart: true,
    itinerary,
    cities,
  };
  const restored = parseRouteSnapshot(snapshot);
  assert.equal(restored?.version, 2);
  assert.equal(restored?.cities?.find((city) => city.id === reykjavik.id)?.names.en, "Reykjavík");
});
