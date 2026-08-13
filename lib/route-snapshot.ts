import { CITIES, findCity } from "./cities.js";
import {
  DURATION_COMPONENT_KINDS,
  TRANSPORT_MODES,
  type DataProvenance,
  type City,
  type OptimizedItinerary,
  type ScheduledServiceDetails,
  type TransportMode,
  type TransportSegment,
  type TravelLeg,
} from "./domain.js";
import {
  createTransportSegment,
  createTravelLeg,
  optimizeItinerary,
  type DurationComponentInput,
} from "./routing.js";

export const TRUSTED_TIMETABLE_SOURCE =
  "Transitous / MOTIS public timetable";

export const IMPORTED_UNVERIFIED_TIMETABLE_METHOD =
  "Imported route copy; published-timetable claim not independently verified";

const ALLOWED_ESTIMATE_METHODS = new Set([
  "flight fallback derived from great-circle distance; replace with provider data",
  "bus fallback derived from great-circle distance; replace with provider data",
  "Curated corridor-specific door-to-door rail benchmark; replace with provider data",
  "Curated corridor city-to-city train running-time benchmark; replace with provider schedule data",
  "Estimated city-to-city train running time from geographic distance and conservative rail speeds; service existence must be verified with provider data",
  "Estimated city-to-city coach running time from geographic distance and conservative road speeds; service existence must be verified with provider data",
  "Estimated flight door-to-door time from great-circle distance, airport access, processing, baggage and operational allowances; replace with provider data",
  "The journey contains one or more estimated segments",
  IMPORTED_UNVERIFIED_TIMETABLE_METHOD,
]);

const MAX_TEXT_LENGTH = 500;
const MAX_COMPONENT_MINUTES = 14 * 24 * 60;

type RouteSnapshotBase = {
  readonly name: string;
  readonly departureDate: string;
  readonly cityOrder: readonly string[];
  readonly totalMinutes: number;
  readonly createdAt: string;
  readonly provenance: "estimated" | "scheduled" | "observed";
};

export type RouteSnapshot =
  | (RouteSnapshotBase & {
      readonly version: 1;
      readonly selectedCityIds?: undefined;
      readonly fixedStart?: undefined;
      readonly itinerary?: undefined;
      readonly cities?: undefined;
    })
  | (RouteSnapshotBase & {
      readonly version: 2;
      readonly selectedCityIds: readonly string[];
      readonly fixedStart: boolean;
      readonly itinerary: OptimizedItinerary;
      readonly cities?: readonly City[];
    })
  | (RouteSnapshotBase & {
      readonly version: 3;
      readonly selectedCityIds: readonly string[];
      readonly startCityId: string;
      readonly endCityId: string;
      readonly optimizationMethod: "exact" | "heuristic";
      readonly itinerary: OptimizedItinerary;
      readonly cities?: readonly City[];
    });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedText(value: unknown, maximum = MAX_TEXT_LENGTH): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= maximum ? normalized : null;
}

function validTimestamp(value: unknown): string | null {
  const timestamp = boundedText(value, 80);
  return timestamp && !Number.isNaN(Date.parse(timestamp)) ? timestamp : null;
}

function validDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    ? value
    : null;
}

function validCityIds(
  value: unknown,
  knownIds: ReadonlySet<string> | null = new Set(CITIES.map((city) => city.id)),
): readonly string[] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const ids = value.map((candidate) => typeof candidate === "string" ? candidate : "");
  if ((knownIds && ids.some((id) => !knownIds.has(id))) || new Set(ids).size !== ids.length) {
    return null;
  }
  return ids;
}

function parseLocalizedNames(value: unknown): City["names"] | null {
  if (!isRecord(value)) return null;
  const ko = boundedText(value.ko, 200);
  const en = boundedText(value.en, 200);
  const fr = boundedText(value.fr, 200);
  const ja = boundedText(value.ja, 200);
  const zh = boundedText(value.zh, 200);
  return ko && en && fr && ja && zh ? Object.freeze({ ko, en, fr, ja, zh }) : null;
}

function parseSnapshotCity(value: unknown): City | null {
  if (!isRecord(value) || typeof value.id !== "string") return null;
  const staticCity = findCity(value.id);
  if (staticCity) return staticCity;
  if (!/^open-meteo:[1-9]\d{0,15}$/.test(value.id) || !isRecord(value.country) || !isRecord(value.coordinates)) return null;
  const names = parseLocalizedNames(value.names);
  const countryNames = parseLocalizedNames(value.country.names);
  const countryCode = typeof value.country.code === "string" ? value.country.code : "";
  const latitude = value.coordinates.latitude;
  const longitude = value.coordinates.longitude;
  const timeZone = boundedText(value.timeZone, 100);
  if (!names || !countryNames || !/^[A-Z]{2}$/.test(countryCode) || typeof latitude !== "number" || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 || typeof longitude !== "number" || !Number.isFinite(longitude) || longitude < -180 || longitude > 180 || !timeZone) return null;
  try {
    new Intl.DateTimeFormat("en", { timeZone }).format(0);
  } catch {
    return null;
  }
  return Object.freeze({
    id: value.id,
    names,
    country: Object.freeze({ code: countryCode, names: countryNames }),
    coordinates: Object.freeze({ latitude, longitude }),
    timeZone,
  });
}

function parseSnapshotCities(value: unknown, cityOrder: readonly string[]): readonly City[] | null {
  if (value === undefined) {
    const staticCities = cityOrder.map(findCity);
    return staticCities.every((city): city is City => Boolean(city))
      ? Object.freeze(staticCities)
      : null;
  }
  if (!Array.isArray(value) || value.length !== cityOrder.length) return null;
  const cities = value.map(parseSnapshotCity);
  if (cities.some((city) => city === null)) return null;
  const validCities = cities as readonly City[];
  if (new Set(validCities.map((city) => city.id)).size !== validCities.length || !sameSet(validCities.map((city) => city.id), cityOrder)) return null;
  return Object.freeze([...validCities]);
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function parseProvenance(value: unknown): DataProvenance | null {
  if (!isRecord(value)) return null;
  if (value.kind === "scheduled") {
    if (value.source !== TRUSTED_TIMETABLE_SOURCE) return null;
    if (value.scheduleVersion !== undefined && !validDate(value.scheduleVersion)) return null;
    return {
      kind: "scheduled",
      source: TRUSTED_TIMETABLE_SOURCE,
      ...(typeof value.scheduleVersion === "string"
        ? { scheduleVersion: value.scheduleVersion }
        : {}),
    };
  }
  if (value.kind === "estimated") {
    const methodology = boundedText(value.methodology);
    if (!methodology || !ALLOWED_ESTIMATE_METHODS.has(methodology)) return null;
    if (value.source !== undefined && value.source !== TRUSTED_TIMETABLE_SOURCE) {
      return null;
    }
    if (value.calculatedAt !== undefined && !validTimestamp(value.calculatedAt)) {
      return null;
    }
    return {
      kind: "estimated",
      methodology,
      ...(value.source === TRUSTED_TIMETABLE_SOURCE
        ? { source: TRUSTED_TIMETABLE_SOURCE }
        : {}),
      ...(typeof value.calculatedAt === "string"
        ? { calculatedAt: value.calculatedAt }
        : {}),
    };
  }
  // Together has no measured-average provider yet. Accepting arbitrary
  // "observed" claims from an unsigned URL would mislabel user-supplied data.
  return null;
}

function sameProvenance(left: unknown, right: DataProvenance): boolean {
  const parsed = parseProvenance(left);
  if (!parsed || parsed.kind !== right.kind) return false;
  if (parsed.kind === "scheduled" && right.kind === "scheduled") {
    return parsed.source === right.source && parsed.scheduleVersion === right.scheduleVersion;
  }
  if (parsed.kind === "estimated" && right.kind === "estimated") {
    return parsed.methodology === right.methodology && parsed.source === right.source && parsed.calculatedAt === right.calculatedAt;
  }
  return false;
}

function parseSegment(value: unknown): TransportSegment | null {
  if (!isRecord(value)) return null;
  const id = boundedText(value.id);
  const from = boundedText(value.from);
  const to = boundedText(value.to);
  const mode = typeof value.mode === "string" &&
    (TRANSPORT_MODES as readonly string[]).includes(value.mode)
    ? value.mode as TransportMode
    : null;
  const provenance = parseProvenance(value.provenance);
  if (!id || !from || !to || !mode || !provenance || !isRecord(value.duration)) {
    return null;
  }
  if (!Array.isArray(value.duration.components) || value.duration.components.length < 1 || value.duration.components.length > 30) {
    return null;
  }
  const components: DurationComponentInput[] = [];
  for (const candidate of value.duration.components) {
    if (!isRecord(candidate)) return null;
    if (typeof candidate.kind !== "string" || !(DURATION_COMPONENT_KINDS as readonly string[]).includes(candidate.kind)) return null;
    const label = boundedText(candidate.label);
    if (!label || !Number.isInteger(candidate.minutes) || (candidate.minutes as number) < 0 || (candidate.minutes as number) > MAX_COMPONENT_MINUTES) return null;
    components.push({
      kind: candidate.kind as DurationComponentInput["kind"],
      label,
      minutes: candidate.minutes as number,
    });
  }
  let scheduledService: ScheduledServiceDetails | undefined;
  if (value.scheduledService !== undefined) {
    if (!isRecord(value.scheduledService)) return null;
    const serviceName = boundedText(value.scheduledService.serviceName, 200);
    const departurePlace = boundedText(value.scheduledService.departurePlace, 300);
    const arrivalPlace = boundedText(value.scheduledService.arrivalPlace, 300);
    const departureTime = validTimestamp(value.scheduledService.departureTime);
    const arrivalTime = validTimestamp(value.scheduledService.arrivalTime);
    if (!serviceName || !departurePlace || !arrivalPlace || !departureTime || !arrivalTime) return null;
    scheduledService = {
      serviceName,
      departurePlace,
      arrivalPlace,
      departureTime,
      arrivalTime,
    };
  }
  try {
    const segment = createTransportSegment({
      id,
      mode,
      from,
      to,
      provenance,
      components,
      ...(scheduledService ? { scheduledService } : {}),
    });
    if (value.duration.totalMinutes !== segment.duration?.totalMinutes) return null;
    return segment;
  } catch {
    return null;
  }
}

function parseLeg(value: unknown, fromCityId: string, toCityId: string): TravelLeg | null {
  if (!isRecord(value) || value.fromCityId !== fromCityId || value.toCityId !== toCityId) {
    return null;
  }
  const id = boundedText(value.id);
  if (!id || !Array.isArray(value.segments) || value.segments.length < 1 || value.segments.length > 30) return null;
  const segments = value.segments.map(parseSegment);
  if (segments.some((segment) => segment === null)) return null;
  try {
    const leg = createTravelLeg({
      id,
      fromCityId,
      toCityId,
      segments: segments as readonly TransportSegment[],
    });
    if (leg.totalMinutes === null || value.totalMinutes !== leg.totalMinutes || value.isMixedTransport !== leg.isMixedTransport) return null;
    if (!Array.isArray(value.modes) || value.modes.length !== leg.modes.length || value.modes.some((mode, index) => mode !== leg.modes[index])) return null;
    if (!sameProvenance(value.provenance, leg.provenance)) return null;
    return leg;
  } catch {
    return null;
  }
}

function parseItinerary(value: unknown, cityOrder: readonly string[], cities: readonly City[]): OptimizedItinerary | null {
  if (!isRecord(value) || !Array.isArray(value.cityOrder) || value.cityOrder.join("|") !== cityOrder.join("|")) return null;
  if (!Array.isArray(value.legs) || value.legs.length !== cityOrder.length - 1) return null;
  const legs = value.legs.map((candidate, index) => parseLeg(candidate, cityOrder[index], cityOrder[index + 1]));
  if (legs.some((leg) => leg === null)) return null;
  try {
    const canonical = optimizeItinerary(cityOrder, legs as readonly TravelLeg[], {
      startCityId: cityOrder[0],
      endCityId: cityOrder.at(-1),
      cities,
    });
    if (canonical.cityOrder.join("|") !== cityOrder.join("|") || value.totalMinutes !== canonical.totalMinutes) return null;
    if (!sameProvenance(value.provenance, canonical.provenance)) return null;
    return canonical;
  } catch {
    return null;
  }
}

function downgradeImportedTimetableClaims(
  itinerary: OptimizedItinerary,
  cityOrder: readonly string[],
  cities: readonly City[],
): OptimizedItinerary {
  if (!itinerary.legs.some((leg) => leg.segments.some((segment) => segment.provenance.kind === "scheduled"))) {
    return itinerary;
  }

  const legs = itinerary.legs.map((leg) => createTravelLeg({
    id: leg.id,
    fromCityId: leg.fromCityId,
    toCityId: leg.toCityId,
    segments: leg.segments.map((segment) => segment.provenance.kind === "scheduled"
      ? createTransportSegment({
          id: segment.id,
          mode: segment.mode,
          from: segment.from,
          to: segment.to,
          provenance: {
            kind: "estimated",
            methodology: IMPORTED_UNVERIFIED_TIMETABLE_METHOD,
          },
          components: segment.duration?.components.map((component) => ({
            kind: component.kind,
            label: component.label,
            minutes: component.minutes,
          })) ?? [],
        })
      : segment),
  }));

  return optimizeItinerary(cityOrder, legs, {
    startCityId: cityOrder[0],
    endCityId: cityOrder.at(-1),
    cities,
  });
}

export function parseRouteSnapshot(value: unknown): RouteSnapshot | null {
  if (!isRecord(value) || (value.version !== 1 && value.version !== 2 && value.version !== 3)) return null;
  const cityOrder = validCityIds(value.cityOrder, value.version === 1 ? undefined : null);
  const name = boundedText(value.name, 100);
  const departureDate = validDate(value.departureDate);
  const createdAt = validTimestamp(value.createdAt);
  if (!cityOrder || !name || !departureDate || !createdAt || !Number.isSafeInteger(value.totalMinutes) || (value.totalMinutes as number) <= 0 || (value.totalMinutes as number) > MAX_COMPONENT_MINUTES * cityOrder.length) return null;

  if (value.version === 1) {
    // Legacy snapshots do not carry enough evidence to restore published or
    // measured claims, so only legacy estimates remain loadable.
    if (value.provenance !== "estimated") return null;
    return {
      version: 1,
      name,
      departureDate,
      cityOrder,
      totalMinutes: value.totalMinutes as number,
      createdAt,
      provenance: "estimated",
    };
  }

  const cities = parseSnapshotCities(value.cities, cityOrder);
  if (!cities) return null;
  const knownIds = new Set(cities.map((city) => city.id));
  const selectedCityIds = validCityIds(value.selectedCityIds, knownIds);
  if (!selectedCityIds || !sameSet(selectedCityIds, cityOrder)) return null;
  if (value.version === 2 && typeof value.fixedStart !== "boolean") return null;
  if (value.version === 2 && value.fixedStart && selectedCityIds[0] !== cityOrder[0]) return null;
  const startCityId = value.version === 3 ? boundedText(value.startCityId, 100) : cityOrder[0];
  const endCityId = value.version === 3 ? boundedText(value.endCityId, 100) : cityOrder.at(-1) ?? null;
  if (!startCityId || !endCityId || startCityId === endCityId || !selectedCityIds.includes(startCityId) || !selectedCityIds.includes(endCityId) || cityOrder[0] !== startCityId || cityOrder.at(-1) !== endCityId) return null;
  const optimizationMethod = value.version === 3 && (value.optimizationMethod === "exact" || value.optimizationMethod === "heuristic") ? value.optimizationMethod : null;
  if (
    value.version === 3 &&
    (!optimizationMethod ||
      (optimizationMethod === "exact" && cityOrder.length > 10))
  ) return null;
  const parsedItinerary = parseItinerary(value.itinerary, cityOrder, cities);
  if (!parsedItinerary || value.totalMinutes !== parsedItinerary.totalMinutes || value.provenance !== parsedItinerary.provenance.kind) return null;
  // Shared URLs and persisted client payloads are unsigned user input. Preserve
  // their exact route and duration, but never restore an unauthenticated claim
  // as a provider-published timetable. Fresh API results remain scheduled in
  // the live planner; imported copies are deliberately labelled as estimates.
  const itinerary = downgradeImportedTimetableClaims(parsedItinerary, cityOrder, cities);
  if (value.version === 3) return {
    version: 3,
    name,
    departureDate,
    cityOrder,
    totalMinutes: itinerary.totalMinutes,
    createdAt,
    provenance: itinerary.provenance.kind as "estimated" | "scheduled" | "observed",
    selectedCityIds,
    startCityId,
    endCityId,
    optimizationMethod: optimizationMethod as "exact" | "heuristic",
    itinerary,
    cities,
  };
  return {
    version: 2,
    name,
    departureDate,
    cityOrder,
    totalMinutes: itinerary.totalMinutes,
    createdAt,
    provenance: itinerary.provenance.kind as "estimated" | "scheduled" | "observed",
    selectedCityIds,
    fixedStart: value.fixedStart as boolean,
    itinerary,
    cities,
  };
}
