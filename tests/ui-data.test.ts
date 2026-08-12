import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MAX_DEVICE_EXPENSES, MAX_DEVICE_PARTICIPANTS, MAX_DEVICE_TRIPS, parseDeviceExpenseLedger, parseDeviceProfile, parseDeviceTrips } from "../lib/device-storage";
import { parseRouteSnapshot, type RouteSnapshot } from "../lib/route-snapshot";
import { TRUSTED_TIMETABLE_SOURCE } from "../lib/route-snapshot";
import { getCity } from "../lib/cities";
import { createEqualSplitExpense, parseExpenseLedger } from "../lib/expenses";
import type { City } from "../lib/domain";
import { buildEstimatedFallbackOptions, buildEstimatedFallbackOptionsForCities, optimizeItinerary } from "../lib/routing";
import { constrainRouteView, fitRouteView, projectRouteCities } from "../app/components/RouteMap";

test("new device storage is empty and rejects malformed collections", () => {
  assert.deepEqual(parseDeviceTrips(null), []);
  assert.deepEqual(parseDeviceExpenseLedger(null).participants, []);
  assert.deepEqual(parseDeviceExpenseLedger(null).expenses, []);
  assert.equal(parseDeviceProfile(null).displayName, "");
  assert.deepEqual(parseDeviceTrips(Array.from({ length: MAX_DEVICE_TRIPS + 1 }, () => null)), []);
  assert.deepEqual(parseDeviceExpenseLedger({ version: 1, participants: Array.from({ length: MAX_DEVICE_PARTICIPANTS + 1 }, () => null), expenses: [] }).participants, []);
  assert.deepEqual(parseDeviceExpenseLedger({ version: 1, participants: [], expenses: Array.from({ length: MAX_DEVICE_EXPENSES + 1 }, () => null) }).expenses, []);
});

function estimatedSnapshot(cityIds: readonly string[]): RouteSnapshot {
  const itinerary = optimizeItinerary(cityIds, buildEstimatedFallbackOptions([...cityIds]), { startCityId: cityIds[0], endCityId: cityIds.at(-1) });
  return {
    version: 3,
    name: cityIds.join(" to "),
    departureDate: "2026-09-08",
    cityOrder: itinerary.cityOrder,
    totalMinutes: itinerary.totalMinutes,
    createdAt: "2026-08-09T12:00:00.000Z",
    provenance: "estimated",
    selectedCityIds: cityIds,
    startCityId: cityIds[0],
    endCityId: cityIds.at(-1) as string,
    optimizationMethod: cityIds.length <= 10 ? "exact" : "heuristic",
    itinerary,
  };
}

test("version 3 route snapshots preserve chosen endpoints and exact itinerary", () => {
  const snapshot = estimatedSnapshot(["paris", "brussels"]);
  const parsed = parseRouteSnapshot(snapshot);
  assert.equal(parsed?.version, 3);
  assert.equal(parsed?.cityOrder[0], "paris");
  assert.equal(parsed?.cityOrder.at(-1), "brussels");
  const tampered = structuredClone(snapshot) as RouteSnapshot & { itinerary: { legs: Array<{ toCityId: string }> } };
  tampered.itinerary.legs[0].toCityId = "berlin";
  assert.equal(parseRouteSnapshot(tampered), null);
});

test("legacy route snapshots remain readable", () => {
  const legacy: RouteSnapshot = { version: 1, name: "Paris to Brussels", departureDate: "2026-09-08", cityOrder: ["paris", "brussels"], totalMinutes: 160, createdAt: "2026-08-09T12:00:00.000Z", provenance: "estimated" };
  assert.deepEqual(parseRouteSnapshot(legacy), legacy);
});

test("route snapshots reject forged totals and timetable sources", () => {
  const snapshot = estimatedSnapshot(["paris", "brussels"]);
  const forgedTotal = structuredClone(snapshot);
  (forgedTotal.itinerary as unknown as { totalMinutes: number }).totalMinutes += 1;
  assert.equal(parseRouteSnapshot(forgedTotal), null);
  const forgedSource = structuredClone(snapshot) as Extract<RouteSnapshot, { version: 3 }>;
  (forgedSource.itinerary.legs[0].segments[0].provenance as unknown as { kind: string; source: string }).kind = "scheduled";
  (forgedSource.itinerary.legs[0].segments[0].provenance as unknown as { kind: string; source: string }).source = "User supplied timetable";
  assert.equal(parseRouteSnapshot(forgedSource), null);
});

test("unsigned imported timetable claims restore only as estimates", () => {
  const snapshot = structuredClone(estimatedSnapshot(["paris", "brussels"])) as Extract<RouteSnapshot, { version: 3 }>;
  (snapshot as { provenance: "estimated" | "scheduled" | "observed" }).provenance = "scheduled";
  const scheduled = { kind: "scheduled" as const, source: TRUSTED_TIMETABLE_SOURCE };
  (snapshot.itinerary as unknown as { provenance: unknown }).provenance = scheduled;
  (snapshot.itinerary.legs[0] as unknown as { provenance: unknown }).provenance = scheduled;
  snapshot.itinerary.legs[0].segments.forEach((segment) => { (segment as unknown as { provenance: unknown }).provenance = scheduled; });
  const restored = parseRouteSnapshot(snapshot);
  assert.equal(restored?.provenance, "estimated");
});

test("expense ledger parser rejects malformed persistent data", () => {
  const expense = createEqualSplitExpense({ id: "expense-1", tripId: "trip-1", paidBy: "me", category: "food", description: "Dinner", currency: "EUR", totalMinorUnits: 1_000, participantIds: ["me", "friend"], occurredAt: "2026-08-09T12:00:00.000Z" });
  assert.ok(parseExpenseLedger({ version: 1, expenses: [expense] }));
  assert.equal(parseExpenseLedger({ version: 1, expenses: [{ id: "x" }] }), null);
  const deviceLedger = parseDeviceExpenseLedger({ version: 1, participants: [{ id: "me", name: "Me" }, { id: "friend", name: "Friend" }], selfParticipantId: "me", expenses: [expense] });
  assert.equal(deviceLedger.expenses.length, 1);
});

test("dynamic cities survive route optimization, device storage and snapshot restoration", () => {
  const reykjavik: City = {
    id: "open-meteo:3413829",
    names: { ko: "레이캬비크", en: "Reykjavik", fr: "Reykjavik", ja: "レイキャビク", zh: "雷克雅未克" },
    country: { code: "IS", names: { ko: "아이슬란드", en: "Iceland", fr: "Islande", ja: "アイスランド", zh: "冰岛" } },
    coordinates: { latitude: 64.1466, longitude: -21.9426 },
    timeZone: "Atlantic/Reykjavik",
  };
  const cities = [getCity("paris"), reykjavik];
  const itinerary = optimizeItinerary(cities.map((city) => city.id), buildEstimatedFallbackOptionsForCities(cities), { startCityId: "paris", endCityId: reykjavik.id, cities });
  const snapshot: RouteSnapshot = { version: 3, name: "Paris to Reykjavik", departureDate: "2026-09-08", cityOrder: itinerary.cityOrder, totalMinutes: itinerary.totalMinutes, createdAt: "2026-08-09T12:00:00.000Z", provenance: "estimated", selectedCityIds: cities.map((city) => city.id), startCityId: "paris", endCityId: reykjavik.id, optimizationMethod: "exact", itinerary, cities };
  const trips = parseDeviceTrips([{ id: "trip-1", name: snapshot.name, updatedAt: snapshot.createdAt, payload: snapshot }]);
  assert.equal(trips.length, 1);
  assert.equal(parseRouteSnapshot(trips[0].payload)?.cities?.find((city) => city.id === reykjavik.id)?.names.en, "Reykjavik");
});

test("route map projects exact coordinates, fits every selected city and crosses the date line minimally", () => {
  const paris = getCity("paris");
  const tokyo = getCity("tokyo");
  const points = projectRouteCities([paris, tokyo]);
  assert.equal(points.length, 2);
  assert.equal(points[0].latitude, paris.coordinates.latitude);
  assert.equal(points[0].longitude, paris.coordinates.longitude);
  assert.ok(Math.abs(points[0].x - ((paris.coordinates.longitude + 180) / 360) * 1_000) < 1e-9);
  assert.ok(Math.abs(points[0].y - ((90 - paris.coordinates.latitude) / 180) * 500) < 1e-9);
  const view = fitRouteView(points);
  for (const point of points) {
    assert.ok(point.x >= view.x && point.x <= view.x + view.width);
    assert.ok(point.y >= view.y && point.y <= view.y + view.height);
  }

  const datelineCities: City[] = [
    { ...paris, id: "west", coordinates: { latitude: 10, longitude: 179 } },
    { ...tokyo, id: "east", coordinates: { latitude: 11, longitude: -179 } },
  ];
  const datelinePoints = projectRouteCities(datelineCities);
  assert.ok(Math.abs(datelinePoints[1].x - datelinePoints[0].x) < 10, "date-line cities should stay adjacent");
});

test("route map tightly frames nearby cities and constrains every zoom path", () => {
  const paris = getCity("paris");
  const venice: City = { ...paris, id: "venice-map", coordinates: { latitude: 45.4408, longitude: 12.3155 } };
  const florence: City = { ...paris, id: "florence-map", coordinates: { latitude: 43.7696, longitude: 11.2558 } };
  const points = projectRouteCities([venice, florence]);
  const fitted = fitRouteView(points);

  assert.ok(fitted.width < 30, `nearby Italian cities should not use a continent-scale view (${fitted.width})`);
  assert.ok(Math.abs(fitted.width / fitted.height - 16 / 9) < 1e-9);
  for (const point of points) {
    assert.ok(point.x > fitted.x && point.x < fitted.x + fitted.width);
    assert.ok(point.y > fitted.y && point.y < fitted.y + fitted.height);
  }

  const overZoomed = constrainRouteView({ x: fitted.x, y: fitted.y, width: 0.01, height: 0.01 }, fitted);
  const overZoomedOut = constrainRouteView({ x: -10_000, y: -10_000, width: 10_000, height: 10_000 }, fitted);
  assert.ok(overZoomed.width >= 3);
  assert.ok(overZoomedOut.width <= fitted.width * 2.2 + Number.EPSILON);
  assert.ok(overZoomed.y >= 0);
  assert.ok(overZoomedOut.y >= 0);
  assert.ok(overZoomedOut.y + overZoomedOut.height <= 500);

  const empty = fitRouteView([]);
  assert.ok(Number.isFinite(empty.x) && Number.isFinite(empty.y));
  assert.equal(empty.width, 1_000);
});

test("route map bundles an attribution-noticed Natural Earth layer in the marker projection", () => {
  const landSvg = readFileSync(new URL("../public/assets/natural-earth-land-50m.svg", import.meta.url), "utf8");
  const notice = readFileSync(new URL("../public/assets/natural-earth-NOTICE.txt", import.meta.url), "utf8");
  assert.match(landSvg, /viewBox="0 0 1000 500"/);
  assert.match(landSvg, /Public-domain Natural Earth 1:50m land polygons projected equirectangularly/);
  assert.match(landSvg, /<path fill="#f6f1df" fill-rule="evenodd" d="M/);
  assert.match(notice, /public domain/i);
  assert.match(notice, /terms-of-use/);
});
