import { findCity, getCity } from "../../../../lib/cities";
import type {
  TransportMode,
  TravelLeg,
} from "../../../../lib/domain";
import {
  createTransportSegment,
  createTravelLeg,
  type DurationComponentInput,
} from "../../../../lib/routing";

const TRANSITOUS_PLAN_URL = "https://api.transitous.org/api/v6/plan";
const TRANSITOUS_USER_AGENT =
  "Together/0.5 (https://together-travel-0920.ocvi-85.chatgpt.site)";
const TRANSITOUS_SOURCE = "Transitous / MOTIS public timetable";
const TRANSITOUS_ATTRIBUTION = "https://transitous.org/sources/";
const TRANSITOUS_TRANSIT_MODES = "RAIL,BUS,COACH";

// There is no city-count product limit. Provider work is paged so the client
// can assemble a verified matrix without ever filling missing pairs with
// modelled durations.
export const SCHEDULE_MAX_CITIES: null = null;
export const SCHEDULE_MAX_PROVIDER_PAIRS = 12;
export const SCHEDULE_MAX_PAIRS = SCHEDULE_MAX_PROVIDER_PAIRS;
// Transitous asks clients to coordinate expensive routing workloads. Together
// therefore performs one bounded page only; larger matrices stay unavailable.
export const SCHEDULE_MAX_CLIENT_BATCHES = 1;
export const SCHEDULE_CACHE_TTL_SECONDS = 15 * 60;
export const SCHEDULE_PROVIDER_TIMEOUT_MS = 7_500;
export const SCHEDULE_BATCH_DEADLINE_MS = 12_000;
export const SCHEDULE_PAST_DATE_HORIZON_DAYS = 1;
export const SCHEDULE_FUTURE_DATE_HORIZON_DAYS = 365;
export const SCHEDULE_RATE_LIMIT_REQUESTS = 4;
export const SCHEDULE_RATE_LIMIT_WINDOW_SECONDS = 60;
export const SCHEDULE_MAX_REQUEST_BYTES = 65_536;
export const SCHEDULE_MAX_PROVIDER_RESPONSE_BYTES = 1_000_000;
// MOTIS' provider-side radius search snaps each city coordinate only to stops
// inside this bounded circle. It avoids brittle city-centre street matching
// without ever substituting a station in a different city.
export const SCHEDULE_TRANSIT_STOP_SEARCH_RADIUS_METERS = 2_500;

const MAX_CACHE_ENTRIES = 256;
const MAX_PROVIDER_CONCURRENCY = 4;
const MAX_RATE_LIMIT_ENTRIES = 4_096;

const TRAIN_MODES = new Set([
  "RAIL",
  "HIGHSPEED_RAIL",
  "LONG_DISTANCE",
  "NIGHT_RAIL",
  "REGIONAL_FAST_RAIL",
  "REGIONAL_RAIL",
  "SUBURBAN",
]);

interface CityPair {
  readonly fromCityId: string;
  readonly toCityId: string;
}

interface ScheduleCity {
  readonly id: string;
  readonly coordinates: {
    readonly latitude: number;
    readonly longitude: number;
  };
  readonly timeZone: string;
}

export interface ScheduleCoordinates {
  readonly latitude: number;
  readonly longitude: number;
}

interface ValidScheduleRequest {
  readonly cityIds: readonly string[];
  readonly cityById: ReadonlyMap<string, ScheduleCity>;
  readonly dynamicCityCount: number;
  readonly departureDate: string;
  readonly startCityId?: string;
  readonly endCityId?: string;
  readonly pairOffset: number;
}

interface TransitousLeg {
  readonly mode: string;
  readonly duration: number;
  readonly startTime: string;
  readonly endTime: string;
  readonly fromName: string;
  readonly toName: string;
  readonly fromCoordinates: ScheduleCoordinates | null;
  readonly toCoordinates: ScheduleCoordinates | null;
  readonly fromStopId: string | null;
  readonly toStopId: string | null;
  readonly serviceName: string;
}

interface TransitousItinerary {
  readonly id: string;
  readonly duration: number;
  readonly startTime: string;
  readonly endTime: string;
  readonly transfers: number;
  readonly legs: readonly TransitousLeg[];
}

export interface TransitousScheduleMetadata {
  readonly travelLegId: string;
  readonly providerItineraryId: string;
  readonly departureTime: string;
  readonly arrivalTime: string;
  readonly providerDurationSeconds: number;
  readonly intercityDurationSeconds: number;
  readonly elapsedFromQuerySeconds: number;
  readonly transfers: number;
  readonly stopSnapping: {
    readonly radiusMeters: number;
    readonly origin: TransitStopSnapEndpoint;
    readonly destination: TransitStopSnapEndpoint;
  };
}

export interface TransitStopSnapEndpoint {
  readonly cityCenter: ScheduleCoordinates;
  readonly providerStop: {
    readonly name: string;
    readonly stopId: string | null;
    readonly coordinates: ScheduleCoordinates;
  };
  readonly distanceMeters: number;
}

export interface ParsedTransitousPlan {
  readonly leg: TravelLeg;
  readonly schedule: TransitousScheduleMetadata;
}

type PairFailureReason =
  | "no_itinerary"
  | "provider_error"
  | "provider_timeout"
  | "invalid_provider_response";

type PairLookupResult =
  | {
      readonly ok: true;
      readonly pair: CityPair;
      readonly leg: TravelLeg;
      readonly schedule: TransitousScheduleMetadata;
      readonly queryDepartureTime: string;
      readonly cacheHit: boolean;
    }
  | {
      readonly ok: false;
      readonly pair: CityPair;
      readonly reason: PairFailureReason;
      readonly queryDepartureTime: string;
      readonly cacheHit: boolean;
    };

interface CacheEntry {
  expiresAt: number;
  readonly result: PairLookupResult;
}

interface InflightPairEntry {
  readonly controller: AbortController;
  readonly scope: AbortScope;
  readonly promise: Promise<PairLookupResult>;
  waiters: number;
  settled: boolean;
}

interface RateLimitEntry {
  count: number;
  windowStartedAt: number;
}

interface RateLimitResult {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly resetAt: number;
  readonly retryAfterSeconds: number;
}

interface ProviderWaiter {
  readonly signal: AbortSignal;
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
  readonly onAbort: () => void;
}

interface AbortScope {
  readonly signal: AbortSignal;
  readonly cleanup: () => void;
}

const pairCache = new Map<string, CacheEntry>();
const inflightPairLookups = new Map<string, InflightPairEntry>();
const rateLimits = new Map<string, RateLimitEntry>();
const providerWaiters: ProviderWaiter[] = [];
let activeProviderRequests = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidIpv4(value: string): boolean {
  const parts = value.split(".");
  return (
    parts.length === 4 &&
    parts.every(
      (part) =>
        /^(?:0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255,
    )
  );
}

function isValidIpv6(value: string): boolean {
  if (
    value.length < 2 ||
    value.length > 45 ||
    !/^[0-9a-fA-F:.]+$/.test(value) ||
    value.includes(":::")
  ) {
    return false;
  }

  let normalized = value;
  if (normalized.includes(".")) {
    const lastColon = normalized.lastIndexOf(":");
    if (lastColon < 0 || !isValidIpv4(normalized.slice(lastColon + 1))) {
      return false;
    }
    normalized = `${normalized.slice(0, lastColon)}:0:0`;
  }

  const firstCompression = normalized.indexOf("::");
  if (
    firstCompression >= 0 &&
    firstCompression !== normalized.lastIndexOf("::")
  ) {
    return false;
  }
  const validGroup = (group: string) => /^[0-9a-fA-F]{1,4}$/.test(group);
  if (firstCompression >= 0) {
    const [left = "", right = ""] = normalized.split("::");
    const leftGroups = left ? left.split(":") : [];
    const rightGroups = right ? right.split(":") : [];
    return (
      leftGroups.every(validGroup) &&
      rightGroups.every(validGroup) &&
      leftGroups.length + rightGroups.length < 8
    );
  }
  const groups = normalized.split(":");
  return groups.length === 8 && groups.every(validGroup);
}

function firstValidHeaderIp(value: string | null): string | null {
  if (!value) return null;
  const candidate = value.split(",", 1)[0]?.trim() ?? "";
  if (!candidate || (!isValidIpv4(candidate) && !isValidIpv6(candidate))) {
    return null;
  }
  return candidate.toLowerCase();
}

export function parseClientIp(request: Request): string {
  return (
    firstValidHeaderIp(request.headers.get("cf-connecting-ip")) ??
    firstValidHeaderIp(request.headers.get("x-forwarded-for")) ??
    "unknown"
  );
}

function pruneRateLimits(now: number): void {
  const windowMs = SCHEDULE_RATE_LIMIT_WINDOW_SECONDS * 1_000;
  for (const [clientIp, entry] of rateLimits) {
    if (now - entry.windowStartedAt >= windowMs) rateLimits.delete(clientIp);
  }
  while (rateLimits.size >= MAX_RATE_LIMIT_ENTRIES) {
    const oldestClientIp = rateLimits.keys().next().value as
      | string
      | undefined;
    if (!oldestClientIp) break;
    rateLimits.delete(oldestClientIp);
  }
}

function consumeRateLimit(clientIp: string, now = Date.now()): RateLimitResult {
  const windowMs = SCHEDULE_RATE_LIMIT_WINDOW_SECONDS * 1_000;
  let entry = rateLimits.get(clientIp);
  if (
    !entry ||
    now < entry.windowStartedAt ||
    now - entry.windowStartedAt >= windowMs
  ) {
    pruneRateLimits(now);
    entry = { count: 0, windowStartedAt: now };
    rateLimits.set(clientIp, entry);
  }
  const resetAt = entry.windowStartedAt + windowMs;
  const retryAfterSeconds = Math.max(1, Math.ceil((resetAt - now) / 1_000));
  if (entry.count >= SCHEDULE_RATE_LIMIT_REQUESTS) {
    return { allowed: false, remaining: 0, resetAt, retryAfterSeconds };
  }
  entry.count += 1;
  return {
    allowed: true,
    remaining: SCHEDULE_RATE_LIMIT_REQUESTS - entry.count,
    resetAt,
    retryAfterSeconds,
  };
}

function validIsoTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  return Number.isNaN(Date.parse(value)) ? null : value;
}

function nonNegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function nonNegativeInteger(value: unknown): number | null {
  return Number.isInteger(value) && (value as number) >= 0
    ? (value as number)
    : null;
}

function nestedText(
  record: Record<string, unknown>,
  key: string,
  nestedKey: string,
): string {
  const nested = record[key];
  if (!isRecord(nested)) return "";
  const value = nested[nestedKey];
  return typeof value === "string" ? value.trim() : "";
}

function nestedCoordinates(
  record: Record<string, unknown>,
  key: string,
): ScheduleCoordinates | null {
  const nested = record[key];
  if (!isRecord(nested)) return null;
  const latitude = nested.lat;
  const longitude = nested.lon;
  if (
    typeof latitude !== "number" ||
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    typeof longitude !== "number" ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }
  return { latitude, longitude };
}

function firstText(
  record: Record<string, unknown>,
  keys: readonly string[],
): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim() && value.trim().length <= 300) return value.trim();
  }
  return "";
}

function parseTransitousLeg(value: unknown): TransitousLeg | null {
  if (!isRecord(value)) return null;
  const mode = firstText(value, ["mode"]);
  // Radius searches can mark synthetic access/egress WALK vertices as
  // cancelled even when the intercity service itself is operating. Those
  // access legs are omitted from product timings; cancelled transit services
  // remain strictly rejected.
  if (value.cancelled === true && mode !== "WALK") return null;
  const duration = nonNegativeNumber(value.duration);
  const startTime = validIsoTimestamp(value.startTime);
  const endTime = validIsoTimestamp(value.endTime);
  if (!mode || mode.length > 80 || duration === null || duration > 14 * 24 * 60 * 60 || !startTime || !endTime) return null;
  const timestampDuration = (Date.parse(endTime) - Date.parse(startTime)) / 1_000;
  if (!Number.isFinite(timestampDuration) || timestampDuration <= 0) return null;

  const fromName = nestedText(value, "from", "name") || "Origin";
  const toName = nestedText(value, "to", "name") || "Destination";
  const fromStopId = nestedText(value, "from", "stopId") || null;
  const toStopId = nestedText(value, "to", "stopId") || null;
  if (
    fromName.length > 300 ||
    toName.length > 300 ||
    (fromStopId?.length ?? 0) > 300 ||
    (toStopId?.length ?? 0) > 300
  ) {
    return null;
  }
  const category = isRecord(value.category)
    ? firstText(value.category, ["shortName", "name"])
    : "";
  const serviceName =
    firstText(value, ["displayName", "routeShortName", "routeLongName"]) ||
    category ||
    mode.replaceAll("_", " ");

  return {
    mode,
    // Published timestamps are authoritative. Provider duration is parsed only
    // to reject malformed extremes and never drives the displayed total.
    duration: timestampDuration,
    startTime,
    endTime,
    fromName,
    toName,
    fromCoordinates: nestedCoordinates(value, "from"),
    toCoordinates: nestedCoordinates(value, "to"),
    fromStopId,
    toStopId,
    serviceName,
  };
}

function parseTransitousItinerary(value: unknown): TransitousItinerary | null {
  if (!isRecord(value) || !Array.isArray(value.legs) || value.legs.length === 0 || value.legs.length > 30) {
    return null;
  }
  const duration = nonNegativeNumber(value.duration);
  const transfers = nonNegativeInteger(value.transfers);
  const startTime = validIsoTimestamp(value.startTime);
  const endTime = validIsoTimestamp(value.endTime);
  if (
    duration === null ||
    duration <= 0 ||
    transfers === null ||
    !startTime ||
    !endTime
  ) {
    return null;
  }

  const legs = value.legs.map(parseTransitousLeg);
  if (legs.some((leg) => leg === null)) return null;
  const id = firstText(value, ["id"]) || `${startTime}/${endTime}`;
  return {
    id,
    duration,
    transfers,
    startTime,
    endTime,
    legs: legs as readonly TransitousLeg[],
  };
}

function mapTransitousMode(mode: string): TransportMode | null {
  if (mode === "WALK") return "walk";
  if (mode === "SUBWAY") return "metro";
  if (mode === "BUS" || mode === "COACH") return "bus";
  if (TRAIN_MODES.has(mode)) return "train";
  return null;
}

function transitStopSnapEndpoint(
  city: ScheduleCity,
  providerLeg: TransitousLeg,
  endpoint: "from" | "to",
): TransitStopSnapEndpoint | null {
  const coordinates =
    endpoint === "from"
      ? providerLeg.fromCoordinates
      : providerLeg.toCoordinates;
  if (!coordinates) return null;
  const distanceMeters = scheduleCoordinateDistanceMeters(
    city.coordinates,
    coordinates,
  );
  if (distanceMeters > SCHEDULE_TRANSIT_STOP_SEARCH_RADIUS_METERS) {
    return null;
  }
  return {
    cityCenter: { ...city.coordinates },
    providerStop: {
      name: endpoint === "from" ? providerLeg.fromName : providerLeg.toName,
      stopId:
        endpoint === "from" ? providerLeg.fromStopId : providerLeg.toStopId,
      coordinates,
    },
    distanceMeters: Math.round(distanceMeters),
  };
}

function stopSnappingMetadata(
  surfaceLegs: readonly IntercitySurfaceLeg[],
  fromCity: ScheduleCity,
  toCity: ScheduleCity,
): TransitousScheduleMetadata["stopSnapping"] | null {
  const firstIntercityLeg = surfaceLegs[0]?.providerLeg;
  const lastIntercityLeg = surfaceLegs.at(-1)?.providerLeg;
  if (!firstIntercityLeg || !lastIntercityLeg) return null;
  const origin = transitStopSnapEndpoint(fromCity, firstIntercityLeg, "from");
  const destination = transitStopSnapEndpoint(toCity, lastIntercityLeg, "to");
  if (!origin || !destination) return null;
  return {
    radiusMeters: SCHEDULE_TRANSIT_STOP_SEARCH_RADIUS_METERS,
    origin,
    destination,
  };
}

interface IntercitySurfaceLeg {
  readonly providerLeg: TransitousLeg;
  readonly mode: TransportMode;
  readonly providerIndex: number;
}

function selectIntercitySurfaceLegs(
  itinerary: TransitousItinerary,
): readonly IntercitySurfaceLeg[] | null {
  const primaryIndexes = itinerary.legs
    .map((leg, index) => ({ leg, index }))
    .filter(({ leg }) => TRAIN_MODES.has(leg.mode) || leg.mode === "COACH")
    .map(({ index }) => index);
  const busIndexes = itinerary.legs
    .map((leg, index) => ({ leg, index }))
    .filter(({ leg }) => leg.mode === "BUS")
    .map(({ index }) => index);
  const anchors = primaryIndexes.length > 0 ? primaryIndexes : busIndexes;
  if (anchors.length === 0) return null;

  const firstIndex = anchors[0];
  const lastIndex = anchors.at(-1) as number;
  const selected = itinerary.legs
    .slice(firstIndex, lastIndex + 1)
    .map((providerLeg, offset) => ({
      providerLeg,
      mode: mapTransitousMode(providerLeg.mode),
      providerIndex: firstIndex + offset,
    }))
    .filter(
      (
        candidate,
      ): candidate is IntercitySurfaceLeg & {
        readonly mode: "train" | "bus";
      } => candidate.mode === "train" || candidate.mode === "bus",
    );
  // Local walking/metro access and egress are deliberately excluded. If a
  // transfer happens between two intercity vehicles, the elapsed gap is added
  // as connection time below, so the displayed total remains first intercity
  // departure through final intercity arrival.
  return selected.length > 0 ? selected : null;
}

function intercityDurationSeconds(
  legs: readonly IntercitySurfaceLeg[],
): number {
  return Math.max(
    0,
    (Date.parse(legs.at(-1)?.providerLeg.endTime ?? "") -
      Date.parse(legs[0]?.providerLeg.startTime ?? "")) /
      1_000,
  );
}

function buildTravelLeg(
  itinerary: TransitousItinerary,
  fromCityId: string,
  toCityId: string,
  _requestedDepartureTime?: string,
  cityById?: ReadonlyMap<string, ScheduleCity>,
): ParsedTransitousPlan | null {
  const fromCity = resolveScheduleCity(fromCityId, cityById);
  const toCity = resolveScheduleCity(toCityId, cityById);
  const surfaceLegs = selectIntercitySurfaceLegs(itinerary);
  if (!surfaceLegs) return null;
  const stopSnapping = stopSnappingMetadata(surfaceLegs, fromCity, toCity);
  if (!stopSnapping) return null;

  const provenance = {
    kind: "scheduled" as const,
    source: TRANSITOUS_SOURCE,
    scheduleVersion: itinerary.startTime.slice(0, 10),
  };
  const segments = [];
  let previousEndpoint = `${fromCityId}:city-centre`;
  let previousEndMs = Date.parse(surfaceLegs[0].providerLeg.startTime);
  let elapsedSeconds = 0;
  let allocatedMinutes = 0;
  const allocateIntervalMinutes = (seconds: number): number => {
    elapsedSeconds += seconds;
    const nextTotal = Math.round(elapsedSeconds / 60);
    const minutes = nextTotal - allocatedMinutes;
    allocatedMinutes = nextTotal;
    return minutes;
  };

  for (let index = 0; index < surfaceLegs.length; index += 1) {
    const { providerLeg, mode } = surfaceLegs[index];
    const isLast = index === surfaceLegs.length - 1;
    const nextEndpoint = isLast
      ? `${toCityId}:city-centre`
      : `transitous:${fromCityId}:${toCityId}:${surfaceLegs[index].providerIndex}:${providerLeg.toName}`;
    const components: DurationComponentInput[] = [];
    const currentStartMs = Date.parse(providerLeg.startTime);
    if (currentStartMs < previousEndMs) return null;
    const waitSeconds = (currentStartMs - previousEndMs) / 1_000;
    if (waitSeconds > 0) {
      components.push({
        kind: "waiting",
        label: `Scheduled wait before ${providerLeg.serviceName}`,
        minutes: allocateIntervalMinutes(waitSeconds),
      });
    }
    const inVehicleMinutes = allocateIntervalMinutes(providerLeg.duration);
    if (
      inVehicleMinutes +
        components.reduce((sum, component) => sum + component.minutes, 0) <=
      0
    ) return null;
    components.push({
      kind: "in_vehicle",
      label: `${providerLeg.serviceName}: ${providerLeg.fromName} → ${providerLeg.toName}`,
      minutes: inVehicleMinutes,
    });

    segments.push(
      createTransportSegment({
        id: `transitous:${fromCityId}:${toCityId}:${surfaceLegs[index].providerIndex}`,
        mode,
        from: previousEndpoint,
        to: nextEndpoint,
        provenance,
        components,
        scheduledService: {
          serviceName: providerLeg.serviceName,
          departurePlace: providerLeg.fromName,
          arrivalPlace: providerLeg.toName,
          departureTime: providerLeg.startTime,
          arrivalTime: providerLeg.endTime,
        },
      }),
    );
    previousEndpoint = nextEndpoint;
    previousEndMs = Date.parse(providerLeg.endTime);
  }

  const leg = createTravelLeg({
    id: `transitous:${fromCityId}:${toCityId}:${itinerary.startTime}`,
    fromCityId,
    toCityId,
    segments,
  });
  const firstDepartureTime = surfaceLegs[0].providerLeg.startTime;
  const lastArrivalTime = surfaceLegs.at(-1)?.providerLeg.endTime as string;
  if (
    leg.totalMinutes !==
    Math.max(1, Math.round(intercityDurationSeconds(surfaceLegs) / 60))
  ) return null;
  return {
    leg,
    schedule: {
      travelLegId: leg.id,
      providerItineraryId: itinerary.id,
      departureTime: firstDepartureTime,
      arrivalTime: lastArrivalTime,
      providerDurationSeconds: itinerary.duration,
      intercityDurationSeconds: intercityDurationSeconds(surfaceLegs),
      // Retained for response compatibility, but intentionally excludes the
      // artificial wait between the morning query time and first departure.
      elapsedFromQuerySeconds: intercityDurationSeconds(surfaceLegs),
      transfers: itinerary.transfers,
      stopSnapping,
    },
  };
}

export function parseTransitousPlan(
  value: unknown,
  fromCityId: string,
  toCityId: string,
  requestedDepartureTime?: string,
  cityById?: ReadonlyMap<string, ScheduleCity>,
): ParsedTransitousPlan | null {
  resolveScheduleCity(fromCityId, cityById);
  resolveScheduleCity(toCityId, cityById);
  if (!isRecord(value) || !Array.isArray(value.itineraries) || value.itineraries.length > 20) return null;

  const itineraries = value.itineraries
    .map(parseTransitousItinerary)
    .filter(
      (itinerary): itinerary is TransitousItinerary => itinerary !== null,
    )
    .map((itinerary) => ({
      itinerary,
      surfaceLegs: selectIntercitySurfaceLegs(itinerary),
    }))
    .filter(
      (candidate): candidate is {
        itinerary: TransitousItinerary;
        surfaceLegs: readonly IntercitySurfaceLeg[];
      } => candidate.surfaceLegs !== null,
    )
    .sort(
      (left, right) =>
        intercityDurationSeconds(left.surfaceLegs) -
          intercityDurationSeconds(right.surfaceLegs) ||
        left.surfaceLegs[0].providerLeg.startTime.localeCompare(
          right.surfaceLegs[0].providerLeg.startTime,
        ) ||
        left.itinerary.id.localeCompare(right.itinerary.id),
    );

  for (const { itinerary } of itineraries) {
    const parsed = buildTravelLeg(
      itinerary,
      fromCityId,
      toCityId,
      requestedDepartureTime,
      cityById,
    );
    if (parsed) return parsed;
  }
  return null;
}

export function validateDepartureDate(
  value: unknown,
  now = Date.now(),
): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    return null;
  }
  const current = new Date(now);
  if (Number.isNaN(current.getTime())) return null;
  const todayUtc = Date.UTC(
    current.getUTCFullYear(),
    current.getUTCMonth(),
    current.getUTCDate(),
  );
  const earliest =
    todayUtc - SCHEDULE_PAST_DATE_HORIZON_DAYS * 24 * 60 * 60 * 1_000;
  const latest =
    todayUtc + SCHEDULE_FUTURE_DATE_HORIZON_DAYS * 24 * 60 * 60 * 1_000;
  return date.getTime() >= earliest && date.getTime() <= latest ? value : null;
}

function validCoordinate(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function isValidIanaTimeZone(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 100 ||
    value.trim() !== value
  ) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

function isDynamicCityId(value: string): boolean {
  const match = /^open-meteo:([1-9]\d*)$/.exec(value);
  if (!match) return false;
  const providerId = Number(match[1]);
  return Number.isSafeInteger(providerId) && providerId > 0;
}

function parseScheduleCity(value: unknown):
  | {
      readonly ok: true;
      readonly city: ScheduleCity;
      readonly dynamic: boolean;
    }
  | { readonly ok: false; readonly message: string } {
  if (!isRecord(value)) {
    return { ok: false, message: "Each cities entry must be an object." };
  }
  const id = typeof value.id === "string" ? value.id.trim() : "";
  if (!id || id.length > 80) {
    return { ok: false, message: "Each city id must contain 1 to 80 characters." };
  }
  if (!validCoordinate(value.latitude, -90, 90)) {
    return { ok: false, message: `City ${id} has an invalid latitude.` };
  }
  if (!validCoordinate(value.longitude, -180, 180)) {
    return { ok: false, message: `City ${id} has an invalid longitude.` };
  }
  if (!isValidIanaTimeZone(value.timeZone)) {
    return { ok: false, message: `City ${id} has an invalid IANA timeZone.` };
  }

  const catalogueCity = findCity(id);
  if (catalogueCity) {
    if (
      value.latitude !== catalogueCity.coordinates.latitude ||
      value.longitude !== catalogueCity.coordinates.longitude ||
      value.timeZone !== catalogueCity.timeZone
    ) {
      return {
        ok: false,
        message: `Static catalogue city ${id} must use its catalogue coordinates and timeZone.`,
      };
    }
    return { ok: true, city: catalogueCity, dynamic: false };
  }
  if (!isDynamicCityId(id)) {
    return {
      ok: false,
      message:
        "Dynamic city ids must use open-meteo:<positive integer> provider ids.",
    };
  }
  return {
    ok: true,
    city: {
      id,
      coordinates: {
        latitude: value.latitude,
        longitude: value.longitude,
      },
      timeZone: value.timeZone,
    },
    dynamic: true,
  };
}

function parseRequestedCities(value: Record<string, unknown>):
  | {
      readonly ok: true;
      readonly cityIds: readonly string[];
      readonly cityById: ReadonlyMap<string, ScheduleCity>;
      readonly dynamicCityCount: number;
    }
  | { readonly ok: false; readonly message: string } {
  const hasCities = value.cities !== undefined;
  const hasCityIds = value.cityIds !== undefined;
  if (!hasCities && !hasCityIds) {
    return { ok: false, message: "cityIds or cities must be provided." };
  }

  if (hasCities) {
    if (!Array.isArray(value.cities)) {
      return { ok: false, message: "cities must be an array." };
    }
    if (value.cities.length < 2) {
      return {
        ok: false,
        message: "cities must contain at least 2 cities.",
      };
    }
    const parsedCities = value.cities.map(parseScheduleCity);
    const failure = parsedCities.find(
      (parsed): parsed is Extract<typeof parsed, { readonly ok: false }> =>
        !parsed.ok,
    );
    if (failure) return failure;
    const validCities = parsedCities as Array<
      Extract<(typeof parsedCities)[number], { readonly ok: true }>
    >;
    const cityIds = validCities.map(({ city }) => city.id);
    if (new Set(cityIds).size !== cityIds.length) {
      return { ok: false, message: "cities ids must be unique." };
    }
    if (hasCityIds) {
      if (!Array.isArray(value.cityIds)) {
        return { ok: false, message: "cityIds must be an array." };
      }
      const suppliedIds = value.cityIds.map((cityId) =>
        typeof cityId === "string" ? cityId.trim() : "",
      );
      if (
        suppliedIds.length !== cityIds.length ||
        suppliedIds.some((cityId, index) => cityId !== cityIds[index])
      ) {
        return {
          ok: false,
          message: "When both are provided, cityIds must match cities in order.",
        };
      }
    }
    return {
      ok: true,
      cityIds,
      cityById: new Map(validCities.map(({ city }) => [city.id, city])),
      dynamicCityCount: validCities.filter(({ dynamic }) => dynamic).length,
    };
  }

  if (!Array.isArray(value.cityIds)) {
    return { ok: false, message: "cityIds must be an array." };
  }
  if (value.cityIds.length < 2) {
    return {
      ok: false,
      message: "cityIds must contain at least 2 cities.",
    };
  }
  const cityIds = value.cityIds.map((cityId) =>
    typeof cityId === "string" ? cityId.trim() : "",
  );
  if (cityIds.some((cityId) => !cityId || !findCity(cityId))) {
    return { ok: false, message: "cityIds contains an unknown city id." };
  }
  if (new Set(cityIds).size !== cityIds.length) {
    return { ok: false, message: "cityIds must be unique." };
  }
  return {
    ok: true,
    cityIds,
    cityById: new Map(cityIds.map((cityId) => [cityId, getCity(cityId)])),
    dynamicCityCount: 0,
  };
}

function parseScheduleRequest(value: unknown):
  | { readonly ok: true; readonly request: ValidScheduleRequest }
  | { readonly ok: false; readonly message: string } {
  if (!isRecord(value)) {
    return { ok: false, message: "The request body must be a JSON object." };
  }
  const cities = parseRequestedCities(value);
  if (!cities.ok) return cities;
  const departureDate = validateDepartureDate(value.departureDate);
  if (!departureDate) {
    return {
      ok: false,
      message:
        `departureDate must be a valid UTC calendar date from ${SCHEDULE_PAST_DATE_HORIZON_DAYS} day before today through ${SCHEDULE_FUTURE_DATE_HORIZON_DAYS} days after today.`,
    };
  }
  const parseConstraint = (fieldName: "startCityId" | "endCityId") => {
    const fieldValue = value[fieldName];
    if (fieldValue === undefined || fieldValue === null || fieldValue === "") {
      return { ok: true as const, cityId: undefined };
    }
    if (typeof fieldValue !== "string" || fieldValue.trim() !== fieldValue) {
      return {
        ok: false as const,
        message: `${fieldName} must be a route city id without surrounding whitespace.`,
      };
    }
    if (!cities.cityIds.includes(fieldValue)) {
      return {
        ok: false as const,
        message: `${fieldName} must identify one of the requested cities.`,
      };
    }
    return { ok: true as const, cityId: fieldValue };
  };
  const start = parseConstraint("startCityId");
  if (!start.ok) return start;
  const end = parseConstraint("endCityId");
  if (!end.ok) return end;
  if (start.cityId && start.cityId === end.cityId) {
    return {
      ok: false,
      message: "startCityId and endCityId must identify different cities.",
    };
  }
  const pairOffset = value.pairOffset === undefined ? 0 : value.pairOffset;
  if (!Number.isSafeInteger(pairOffset) || (pairOffset as number) < 0) {
    return {
      ok: false,
      message: "pairOffset must be a non-negative safe integer.",
    };
  }
  return {
    ok: true,
    request: {
      cityIds: cities.cityIds,
      cityById: cities.cityById,
      dynamicCityCount: cities.dynamicCityCount,
      departureDate,
      pairOffset: pairOffset as number,
      ...(start.cityId ? { startCityId: start.cityId } : {}),
      ...(end.cityId ? { endCityId: end.cityId } : {}),
    },
  };
}

function scheduleCoordinateDistanceMeters(
  from: ScheduleCoordinates,
  to: ScheduleCoordinates,
): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = radians(
    to.latitude - from.latitude,
  );
  const longitudeDelta = radians(
    to.longitude - from.longitude,
  );
  const fromLatitude = radians(from.latitude);
  const toLatitude = radians(to.latitude);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLatitude) *
      Math.cos(toLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function scheduleDistanceKm(from: ScheduleCity, to: ScheduleCity): number {
  return scheduleCoordinateDistanceMeters(from.coordinates, to.coordinates) / 1_000;
}

function eligiblePairCount(
  cityIds: readonly string[],
  startCityId?: string,
  endCityId?: string,
): number {
  const originCount = cityIds.length - (endCityId ? 1 : 0);
  const pairsIntoStart = startCityId ? originCount - 1 : 0;
  return originCount * (cityIds.length - 1) - pairsIntoStart;
}

function selectScheduleOrigins(
  cityIds: readonly string[],
  cityById: ReadonlyMap<string, ScheduleCity>,
  startCityId?: string,
  endCityId?: string,
): readonly string[] {
  const candidates = [...cityIds]
    .filter((cityId) => cityId !== endCityId)
    .sort((left, right) => left.localeCompare(right));
  // A fixed start is queried first; all remaining origins stay deterministic.
  return startCityId
    ? [startCityId, ...candidates.filter((cityId) => cityId !== startCityId)]
    : candidates;
}

function buildFullMatrixPairs(
  cityIds: readonly string[],
  cityById: ReadonlyMap<string, ScheduleCity>,
  startCityId?: string,
  endCityId?: string,
): readonly CityPair[] {
  const origins = selectScheduleOrigins(
    cityIds,
    cityById,
    startCityId,
    endCityId,
  );
  const destinationsByOrigin = new Map(
    origins.map((fromCityId) => {
      const fromCity = resolveScheduleCity(fromCityId, cityById);
      const destinations = cityIds
        .filter(
          (toCityId) =>
            toCityId !== fromCityId && toCityId !== startCityId,
        )
        .map((toCityId) => ({
          toCityId,
          distanceKm: scheduleDistanceKm(
            fromCity,
            resolveScheduleCity(toCityId, cityById),
          ),
        }))
        .sort(
          (left, right) =>
            left.distanceKm - right.distanceKm ||
            left.toCityId.localeCompare(right.toCityId),
        );
      return [fromCityId, destinations] as const;
    }),
  );

  const allPairs: CityPair[] = [];
  const maximumRank = Math.max(
    0,
    ...[...destinationsByOrigin.values()].map(
      (destinations) => destinations.length,
    ),
  );
  // Round-robin by neighbour rank gives every city a nearby lookup before a
  // single origin consumes the provider budget.
  for (
    let rank = 0;
    rank < maximumRank;
    rank += 1
  ) {
    for (const fromCityId of origins) {
      const destination = destinationsByOrigin.get(fromCityId)?.[rank];
      if (!destination) continue;
      allPairs.push({ fromCityId, toCityId: destination.toCityId });
    }
  }
  return allPairs;
}

function greedyGeographicOrder(
  cityIds: readonly string[],
  cityById: ReadonlyMap<string, ScheduleCity>,
  startCityId?: string,
  endCityId?: string,
  firstInteriorCityId?: string,
): readonly string[] {
  const available = new Set(
    cityIds.filter(
      (cityId) => cityId !== startCityId && cityId !== endCityId,
    ),
  );
  const first = startCityId ?? firstInteriorCityId ?? [...available].sort()[0];
  if (!first) return endCityId ? [endCityId] : [];
  available.delete(first);
  const order = [first];
  if (firstInteriorCityId && available.delete(firstInteriorCityId)) {
    order.push(firstInteriorCityId);
  }
  while (available.size > 0) {
    const current = resolveScheduleCity(order.at(-1) as string, cityById);
    let next: string | null = null;
    let nextDistance = Number.POSITIVE_INFINITY;
    for (const candidate of available) {
      const distance = scheduleDistanceKm(
        current,
        resolveScheduleCity(candidate, cityById),
      );
      if (
        distance < nextDistance ||
        (distance === nextDistance &&
          (next === null || candidate.localeCompare(next) < 0))
      ) {
        next = candidate;
        nextDistance = distance;
      }
    }
    if (!next) break;
    order.push(next);
    available.delete(next);
  }
  if (endCityId && order.at(-1) !== endCityId) order.push(endCityId);
  return order;
}

function buildSparseCandidatePairs(
  cityIds: readonly string[],
  cityById: ReadonlyMap<string, ScheduleCity>,
  startCityId?: string,
  endCityId?: string,
): readonly CityPair[] {
  const seedCandidates = cityIds
    .filter((cityId) => cityId !== startCityId && cityId !== endCityId)
    .sort((left, right) => {
      if (!startCityId) return left.localeCompare(right);
      const start = resolveScheduleCity(startCityId, cityById);
      return (
        scheduleDistanceKm(start, resolveScheduleCity(left, cityById)) -
          scheduleDistanceKm(start, resolveScheduleCity(right, cityById)) ||
        left.localeCompare(right)
      );
    });
  const pairs: CityPair[] = [];
  const seen = new Set<string>();
  const addOrder = (order: readonly string[]): boolean => {
    for (let index = 0; index < order.length - 1; index += 1) {
      const pair = {
        fromCityId: order[index],
        toCityId: order[index + 1],
      };
      const key = `${pair.fromCityId}\u0000${pair.toCityId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push(pair);
      if (pairs.length === SCHEDULE_MAX_PROVIDER_PAIRS) return true;
    }
    return false;
  };

  if (
    addOrder(
      greedyGeographicOrder(cityIds, cityById, startCityId, endCityId),
    )
  ) return pairs;
  // Generate alternative seeds lazily. The former eager map built every
  // complete order even though the provider budget only accepts 12 edges.
  for (const seed of seedCandidates) {
    if (
      addOrder(
        greedyGeographicOrder(
          cityIds,
          cityById,
          startCityId,
          endCityId,
          seed,
        ),
      )
    ) break;
  }
  return pairs;
}

function buildScheduleCandidates(
  cityIds: readonly string[],
  cityById: ReadonlyMap<string, ScheduleCity>,
  startCityId?: string,
  endCityId?: string,
): readonly CityPair[] {
  const fullMatrixPairCount = eligiblePairCount(
    cityIds,
    startCityId,
    endCityId,
  );
  return fullMatrixPairCount <= SCHEDULE_MAX_PROVIDER_PAIRS
    ? buildFullMatrixPairs(cityIds, cityById, startCityId, endCityId)
    : buildSparseCandidatePairs(
        cityIds,
        cityById,
        startCityId,
        endCityId,
      );
}

function timeZoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const values = new Map(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return (
    Date.UTC(
      values.get("year") ?? 0,
      (values.get("month") ?? 1) - 1,
      values.get("day") ?? 1,
      values.get("hour") ?? 0,
      values.get("minute") ?? 0,
      values.get("second") ?? 0,
    ) - instant.getTime()
  );
}

function resolveScheduleCity(
  cityId: string,
  cityById?: ReadonlyMap<string, ScheduleCity>,
): ScheduleCity {
  return cityById?.get(cityId) ?? getCity(cityId);
}

function localMorningIso(departureDate: string, city: ScheduleCity): string {
  const [year, month, day] = departureDate.split("-").map(Number);
  const localWallClock = Date.UTC(year, month - 1, day, 8, 0, 0);
  let instant = localWallClock;
  for (let pass = 0; pass < 2; pass += 1) {
    instant =
      localWallClock - timeZoneOffsetMs(new Date(instant), city.timeZone);
  }
  return new Date(instant).toISOString();
}

function transitousUrl(
  pair: CityPair,
  departureDate: string,
  cityById: ReadonlyMap<string, ScheduleCity>,
): { readonly url: string; readonly queryDepartureTime: string } {
  const from = resolveScheduleCity(pair.fromCityId, cityById);
  const to = resolveScheduleCity(pair.toCityId, cityById);
  const queryDepartureTime = localMorningIso(departureDate, from);
  const query = new URLSearchParams({
    fromPlace: `${from.coordinates.latitude},${from.coordinates.longitude}`,
    toPlace: `${to.coordinates.latitude},${to.coordinates.longitude}`,
    radius: String(SCHEDULE_TRANSIT_STOP_SEARCH_RADIUS_METERS),
    time: queryDepartureTime,
    transitModes: TRANSITOUS_TRANSIT_MODES,
    directModes: "",
    preTransitModes: "WALK",
    postTransitModes: "WALK",
    detailedLegs: "false",
    detailedTransfers: "false",
    timetableView: "false",
    arriveBy: "false",
    maxTransfers: "8",
    minTransferTime: "5",
    additionalTransferTime: "5",
    useRoutedTransfers: "true",
    timeout: "7",
    language: "en",
  });
  return {
    url: `${TRANSITOUS_PLAN_URL}?${query.toString()}`,
    queryDepartureTime,
  };
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortReason(signal);
}

function createAbortScope(
  parentSignal: AbortSignal,
  timeoutMs: number,
): AbortScope {
  const controller = new AbortController();
  const onParentAbort = () => controller.abort(abortReason(parentSignal));
  if (parentSignal.aborted) onParentAbort();
  else parentSignal.addEventListener("abort", onParentAbort, { once: true });
  const timeoutId = setTimeout(
    () =>
      controller.abort(
        new DOMException("The operation reached its deadline.", "TimeoutError"),
      ),
    timeoutMs,
  );
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeoutId);
      parentSignal.removeEventListener("abort", onParentAbort);
    },
  };
}

async function awaitWithSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  throwIfAborted(signal);
  return await new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(abortReason(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      },
    );
  });
}

function dispatchProviderWaiter(): void {
  while (
    activeProviderRequests < MAX_PROVIDER_CONCURRENCY &&
    providerWaiters.length > 0
  ) {
    const waiter = providerWaiters.shift();
    if (!waiter) return;
    waiter.signal.removeEventListener("abort", waiter.onAbort);
    if (waiter.signal.aborted) {
      waiter.reject(abortReason(waiter.signal));
      continue;
    }
    activeProviderRequests += 1;
    waiter.resolve();
  }
}

async function acquireProviderSlot(signal: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  if (activeProviderRequests < MAX_PROVIDER_CONCURRENCY) {
    activeProviderRequests += 1;
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const waiter: ProviderWaiter = {
      signal,
      resolve,
      reject,
      onAbort: () => {
        const index = providerWaiters.indexOf(waiter);
        if (index >= 0) providerWaiters.splice(index, 1);
        signal.removeEventListener("abort", waiter.onAbort);
        reject(abortReason(signal));
      },
    };
    providerWaiters.push(waiter);
    signal.addEventListener("abort", waiter.onAbort, { once: true });
  });
}

async function withProviderSlot<T>(
  signal: AbortSignal,
  work: () => Promise<T>,
): Promise<T> {
  await acquireProviderSlot(signal);
  try {
    throwIfAborted(signal);
    return await work();
  } finally {
    activeProviderRequests -= 1;
    dispatchProviderWaiter();
  }
}

function providerFailureReason(error: unknown): PairFailureReason {
  if (
    error instanceof DOMException &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  ) {
    return "provider_timeout";
  }
  return "provider_error";
}

async function requestPair(
  pair: CityPair,
  departureDate: string,
  cityById: ReadonlyMap<string, ScheduleCity>,
  batchSignal: AbortSignal,
): Promise<PairLookupResult> {
  const { url, queryDepartureTime } = transitousUrl(
    pair,
    departureDate,
    cityById,
  );
  try {
    return await withProviderSlot(batchSignal, async () => {
      const providerScope = createAbortScope(
        batchSignal,
        SCHEDULE_PROVIDER_TIMEOUT_MS,
      );
      try {
        const response = await awaitWithSignal(
          fetch(url, {
            method: "GET",
            headers: {
              Accept: "application/json",
              "User-Agent": TRANSITOUS_USER_AGENT,
            },
            signal: providerScope.signal,
          }),
          providerScope.signal,
        );
        if (!response.ok) {
          return {
            ok: false,
            pair,
            reason: "provider_error",
            queryDepartureTime,
            cacheHit: false,
          };
        }
        const body: unknown = await readProviderJson(response, providerScope.signal);
        const parsed = parseTransitousPlan(
          body,
          pair.fromCityId,
          pair.toCityId,
          queryDepartureTime,
          cityById,
        );
        if (parsed) {
          return {
            ok: true,
            pair,
            ...parsed,
            queryDepartureTime,
            cacheHit: false,
          };
        }
        const noItineraries =
          isRecord(body) &&
          Array.isArray(body.itineraries) &&
          body.itineraries.length === 0;
        return {
          ok: false,
          pair,
          reason: noItineraries
            ? "no_itinerary"
            : "invalid_provider_response",
          queryDepartureTime,
          cacheHit: false,
        };
      } finally {
        providerScope.cleanup();
      }
    });
  } catch (error) {
    return {
      ok: false,
      pair,
      reason: providerFailureReason(error),
      queryDepartureTime,
      cacheHit: false,
    };
  }
}

async function readProviderJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > SCHEDULE_MAX_PROVIDER_RESPONSE_BYTES) {
    throw new Error("provider_response_too_large");
  }
  if (!response.body) throw new Error("provider_response_missing");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  try {
    while (true) {
      if (signal.aborted) throw signal.reason;
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > SCHEDULE_MAX_PROVIDER_RESPONSE_BYTES) {
        await reader.cancel("provider_response_too_large");
        throw new Error("provider_response_too_large");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as unknown;
  } finally {
    reader.releaseLock();
  }
}

function pruneCache(now: number): void {
  for (const [key, entry] of pairCache) {
    if (entry.expiresAt <= now) pairCache.delete(key);
  }
  while (pairCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = pairCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    pairCache.delete(oldestKey);
  }
}

async function lookupPair(
  pair: CityPair,
  departureDate: string,
  cityById: ReadonlyMap<string, ScheduleCity>,
  batchSignal: AbortSignal,
): Promise<PairLookupResult> {
  const now = Date.now();
  const from = resolveScheduleCity(pair.fromCityId, cityById);
  const to = resolveScheduleCity(pair.toCityId, cityById);
  const cityCacheKey = (city: ScheduleCity) =>
    `${city.id}@${city.coordinates.latitude},${city.coordinates.longitude},${city.timeZone}`;
  const key = `${departureDate}|${cityCacheKey(from)}|${cityCacheKey(to)}`;
  const cached = pairCache.get(key);
  if (cached && cached.expiresAt > now) {
    return { ...cached.result, cacheHit: true };
  }

  pruneCache(now);
  let inflight = inflightPairLookups.get(key);
  const joinedInflight = Boolean(inflight);
  if (!inflight) {
    const controller = new AbortController();
    const scope = createAbortScope(controller.signal, SCHEDULE_BATCH_DEADLINE_MS);
    const promise = requestPair(pair, departureDate, cityById, scope.signal)
      .then((result) => {
        // Cache only completed, stable provider outcomes. Timeouts,
        // cancellations, and malformed/error responses are immediately retryable.
        if (result.ok || result.reason === "no_itinerary") {
          pairCache.set(key, {
            expiresAt: Date.now() + SCHEDULE_CACHE_TTL_SECONDS * 1_000,
            result,
          });
        }
        return result;
      })
      .finally(() => {
        const current = inflightPairLookups.get(key);
        if (current?.controller === controller) {
          current.settled = true;
          inflightPairLookups.delete(key);
        }
        scope.cleanup();
      });
    const entry: InflightPairEntry = { controller, scope, promise, waiters: 0, settled: false };
    inflightPairLookups.set(key, entry);
    inflight = entry;
  }

  inflight.waiters += 1;
  try {
    return {
      ...(await awaitWithSignal(inflight.promise, batchSignal)),
      cacheHit: joinedInflight,
    };
  } catch (error) {
    return {
      ok: false,
      pair,
      reason: providerFailureReason(error),
      queryDepartureTime: transitousUrl(pair, departureDate, cityById)
        .queryDepartureTime,
      cacheHit: joinedInflight,
    };
  } finally {
    inflight.waiters -= 1;
    if (inflight.waiters === 0 && !inflight.settled) {
      // Keep shared work alive while another request is consuming it, but stop
      // orphaned provider work as soon as the final requester leaves.
      if (inflightPairLookups.get(key) === inflight) inflightPairLookups.delete(key);
      inflight.controller.abort(new DOMException("No request is waiting for this lookup.", "AbortError"));
    }
  }
}

function badRequest(code: string, message: string): Response {
  return Response.json(
    { error: { code, message } },
    { status: 400, headers: { "Cache-Control": "no-store" } },
  );
}

function rateLimitHeaders(rateLimit: RateLimitResult): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(SCHEDULE_RATE_LIMIT_REQUESTS),
    "X-RateLimit-Remaining": String(rateLimit.remaining),
    "X-RateLimit-Reset": String(Math.ceil(rateLimit.resetAt / 1_000)),
  };
}

function tooManyRequests(rateLimit: RateLimitResult): Response {
  return Response.json(
    {
      error: {
        code: "rate_limit_exceeded",
        message: `At most ${SCHEDULE_RATE_LIMIT_REQUESTS} schedule calculations are allowed per minute.`,
      },
    },
    {
      status: 429,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": String(rateLimit.retryAfterSeconds),
        ...rateLimitHeaders(rateLimit),
      },
    },
  );
}

async function readLimitedJson(request: Request): Promise<
  | { readonly ok: true; readonly value: unknown }
  | {
      readonly ok: false;
      readonly status: 400 | 413;
      readonly code: string;
      readonly message: string;
    }
> {
  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const declaredBytes = Number(contentLength);
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes < 0) {
      return {
        ok: false,
        status: 400,
        code: "invalid_content_length",
        message: "Content-Length must be a non-negative integer.",
      };
    }
    if (declaredBytes > SCHEDULE_MAX_REQUEST_BYTES) {
      return {
        ok: false,
        status: 413,
        code: "schedule_request_too_large",
        message: `The schedule request must not exceed ${SCHEDULE_MAX_REQUEST_BYTES} bytes.`,
      };
    }
  }

  if (!request.body) {
    return {
      ok: false,
      status: 400,
      code: "invalid_json",
      message: "The request body must be valid JSON.",
    };
  }
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let totalBytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > SCHEDULE_MAX_REQUEST_BYTES) {
        await reader.cancel("schedule_request_too_large");
        return {
          ok: false,
          status: 413,
          code: "schedule_request_too_large",
          message: `The schedule request must not exceed ${SCHEDULE_MAX_REQUEST_BYTES} bytes.`,
        };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return {
      ok: false,
      status: 400,
      code: "invalid_json",
      message: "The request body must be valid JSON.",
    };
  } finally {
    reader.releaseLock();
  }
}

export async function POST(request: Request): Promise<Response> {
  const parsedBody = await readLimitedJson(request);
  if (!parsedBody.ok) {
    return Response.json(
      { error: { code: parsedBody.code, message: parsedBody.message } },
      {
        status: parsedBody.status,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  const validated = parseScheduleRequest(parsedBody.value);
  if (!validated.ok) {
    return badRequest("invalid_schedule_request", validated.message);
  }

  const rateLimit = consumeRateLimit(parseClientIp(request));
  if (!rateLimit.allowed) return tooManyRequests(rateLimit);

  const totalEligiblePairCount = eligiblePairCount(
    validated.request.cityIds,
    validated.request.startCityId,
    validated.request.endCityId,
  );
  const candidatePairs = buildScheduleCandidates(
    validated.request.cityIds,
    validated.request.cityById,
    validated.request.startCityId,
    validated.request.endCityId,
  );
  const candidatePairCount = candidatePairs.length;
  const pairs = candidatePairs.slice(
    validated.request.pairOffset,
    validated.request.pairOffset + SCHEDULE_MAX_PROVIDER_PAIRS,
  );
  const batchScope = createAbortScope(
    request.signal,
    SCHEDULE_BATCH_DEADLINE_MS,
  );
  let results: readonly PairLookupResult[];
  try {
    results = await Promise.all(
      pairs.map((pair) =>
        lookupPair(
          pair,
          validated.request.departureDate,
          validated.request.cityById,
          batchScope.signal,
        ),
      ),
    );
  } finally {
    batchScope.cleanup();
  }
  const successes = results.filter(
    (result): result is Extract<PairLookupResult, { readonly ok: true }> =>
      result.ok,
  );
  const failures = results.filter(
    (result): result is Extract<PairLookupResult, { readonly ok: false }> =>
      !result.ok,
  );

  return Response.json(
    {
      source: "transitous" as const,
      calculatedAt: new Date().toISOString(),
      departureDate: validated.request.departureDate,
      routeConstraints: {
        startCityId: validated.request.startCityId ?? null,
        endCityId: validated.request.endCityId ?? null,
      },
      pairOffset: validated.request.pairOffset,
      legs: successes.map((result) => result.leg),
      schedules: successes.map((result) => ({
        ...result.schedule,
        queryDepartureTime: result.queryDepartureTime,
      })),
      partial:
        failures.length > 0 ||
        candidatePairCount < totalEligiblePairCount ||
        pairs.length < candidatePairCount,
      missingPairs: failures.map((result) => ({
        ...result.pair,
        reason: result.reason,
        queryDepartureTime: result.queryDepartureTime,
      })),
      requestSummary: {
        requestedPairCount: pairs.length,
        eligiblePairCount: totalEligiblePairCount,
        candidatePairCount,
        candidateStrategy:
          candidatePairCount === totalEligiblePairCount
            ? "full_matrix"
            : "geographic_path_candidates",
        providerPairLimitApplied: candidatePairCount < totalEligiblePairCount,
        nextPairOffset:
          validated.request.pairOffset + pairs.length < candidatePairCount
            ? validated.request.pairOffset + pairs.length
            : null,
        verifiedCandidateSetComplete:
          validated.request.pairOffset === 0 &&
          pairs.length === candidatePairCount &&
          failures.every((failure) => failure.reason === "no_itinerary"),
        actualCoverage:
          validated.request.pairOffset === 0 &&
          pairs.length === candidatePairCount &&
          candidatePairCount === totalEligiblePairCount &&
          failures.every((failure) => failure.reason === "no_itinerary"),
        optimalityGuaranteed:
          validated.request.pairOffset === 0 &&
          pairs.length === candidatePairCount &&
          candidatePairCount === totalEligiblePairCount &&
          failures.every((failure) => failure.reason === "no_itinerary") &&
          validated.request.cityIds.length <= 10,
        dynamicCityCount: validated.request.dynamicCityCount,
        providerRequestCount: results.filter((result) => !result.cacheHit)
          .length,
        cacheHitCount: results.filter((result) => result.cacheHit).length,
      },
      requestPolicy: {
        maxCities: SCHEDULE_MAX_CITIES,
        maxPairs: SCHEDULE_MAX_PROVIDER_PAIRS,
        maxRequestBytes: SCHEDULE_MAX_REQUEST_BYTES,
        maxProviderConcurrency: MAX_PROVIDER_CONCURRENCY,
        providerTimeoutMs: SCHEDULE_PROVIDER_TIMEOUT_MS,
        transitStopSearch: {
          strategy: "provider_radius",
          radiusMeters: SCHEDULE_TRANSIT_STOP_SEARCH_RADIUS_METERS,
          endpointCoordinateGate: true,
        },
        batchDeadlineMs: SCHEDULE_BATCH_DEADLINE_MS,
        cacheTtlSeconds: SCHEDULE_CACHE_TTL_SECONDS,
        pairDirection:
          "A full directed matrix is checked when it fits the provider budget. Otherwise deterministic geographic path candidates are checked; every displayed leg still requires a provider schedule and the order is disclosed as approximate.",
        rateLimit:
          `Best-effort instance-local limit of ${SCHEDULE_RATE_LIMIT_REQUESTS} valid calculation requests per ${SCHEDULE_RATE_LIMIT_WINDOW_SECONDS} seconds per client IP; it is not a globally coordinated quota.`,
        departureDateHorizon: {
          basis: "UTC calendar date, inclusive",
          pastDays: SCHEDULE_PAST_DATE_HORIZON_DAYS,
          futureDays: SCHEDULE_FUTURE_DATE_HORIZON_DAYS,
        },
        defaultLocalDepartureTime: "08:00",
      },
      attribution: TRANSITOUS_ATTRIBUTION,
    },
    {
      headers: {
        "Cache-Control": "no-store",
        ...rateLimitHeaders(rateLimit),
      },
    },
  );
}
