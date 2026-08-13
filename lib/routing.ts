import { getCity } from "./cities.js";
import {
  DURATION_COMPONENT_KINDS,
  DomainValidationError,
  TRANSPORT_MODES,
  type DataProvenance,
  type City,
  type DurationBreakdown,
  type DurationComponent,
  type DurationComponentKind,
  type OptimizedItinerary,
  type ScheduledServiceDetails,
  type TransportMode,
  type TransportSegment,
  type TravelLeg,
} from "./domain.js";

export interface DurationComponentInput {
  readonly kind: DurationComponentKind;
  readonly label: string;
  readonly minutes: number;
}

export interface TransportSegmentInput {
  readonly id: string;
  readonly mode: TransportMode;
  readonly from: string;
  readonly to: string;
  readonly provenance: DataProvenance;
  readonly components?: readonly DurationComponentInput[];
  readonly scheduledService?: ScheduledServiceDetails;
}

export interface TravelLegInput {
  readonly id: string;
  readonly fromCityId: string;
  readonly toCityId: string;
  readonly segments: readonly TransportSegment[];
}

export interface OptimizeItineraryOptions {
  readonly startCityId?: string;
  readonly endCityId?: string;
  readonly cities?: readonly City[];
}

export type EstimatedFallbackMode = "flight" | "train" | "bus";

type EstimatedSurfaceMode = Exclude<EstimatedFallbackMode, "flight">;

interface SurfaceCorridor {
  readonly cityIds: readonly [string, string];
  readonly modes: readonly EstimatedSurfaceMode[];
}

// Known corridors supplement the conservative geographic fallback below. Every
// fallback remains explicitly estimated; published provider legs replace it when
// available.
const SURFACE_CORRIDORS: readonly SurfaceCorridor[] = Object.freeze([
  { cityIds: ["seoul", "busan"], modes: ["train", "bus"] },
  { cityIds: ["tokyo", "osaka"], modes: ["train", "bus"] },
  { cityIds: ["paris", "lyon"], modes: ["train", "bus"] },
  { cityIds: ["paris", "brussels"], modes: ["train", "bus"] },
  { cityIds: ["paris", "london"], modes: ["train", "bus"] },
  { cityIds: ["brussels", "amsterdam"], modes: ["train", "bus"] },
  { cityIds: ["madrid", "barcelona"], modes: ["train", "bus"] },
  { cityIds: ["rome", "milan"], modes: ["train", "bus"] },
  { cityIds: ["berlin", "prague"], modes: ["train", "bus"] },
  { cityIds: ["vienna", "budapest"], modes: ["train", "bus"] },
  { cityIds: ["tallinn", "riga"], modes: ["bus"] },
]);

interface GeographicSurfaceCorridor {
  readonly endpoints: readonly [
    { readonly countryCode: string; readonly latitude: number; readonly longitude: number },
    { readonly countryCode: string; readonly latitude: number; readonly longitude: number },
  ];
  readonly modes: readonly EstimatedSurfaceMode[];
  readonly trainMinutes?: number;
}

// Provider ids vary, so a handful of high-confidence corridors are matched by
// country and coordinates. This specifically covers the Venice–Florence case
// without inventing rail links for same-country island pairs.
const GEOGRAPHIC_SURFACE_CORRIDORS: readonly GeographicSurfaceCorridor[] = [
  {
    endpoints: [
      { countryCode: "IT", latitude: 45.4408, longitude: 12.3155 },
      { countryCode: "IT", latitude: 43.7696, longitude: 11.2558 },
    ],
    modes: ["train", "bus"],
    trainMinutes: 125,
  },
  {
    endpoints: [
      { countryCode: "IT", latitude: 43.7696, longitude: 11.2558 },
      { countryCode: "IT", latitude: 41.9028, longitude: 12.4964 },
    ],
    modes: ["train", "bus"],
    trainMinutes: 95,
  },
];

function unorderedCityPairKey(leftCityId: string, rightCityId: string): string {
  return [leftCityId, rightCityId].sort(compareText).join("|");
}

const surfaceModesByPair = new Map<string, readonly EstimatedSurfaceMode[]>(
  SURFACE_CORRIDORS.map((corridor) => [
    unorderedCityPairKey(...corridor.cityIds),
    Object.freeze([...corridor.modes]),
  ]),
);

// Approximate train running times between city terminals. Unlike flights, rail
// and coach fallbacks intentionally do not add city access, check-in, or buffer
// time: the UI promise is a city-to-city public-transport duration.
const TRAIN_IN_VEHICLE_MINUTES_BY_PAIR = new Map<string, number>([
  [unorderedCityPairKey("seoul", "busan"), 165],
  [unorderedCityPairKey("tokyo", "osaka"), 150],
  [unorderedCityPairKey("paris", "lyon"), 120],
  [unorderedCityPairKey("paris", "brussels"), 85],
  [unorderedCityPairKey("paris", "london"), 140],
  [unorderedCityPairKey("brussels", "amsterdam"), 120],
  [unorderedCityPairKey("madrid", "barcelona"), 165],
  [unorderedCityPairKey("rome", "milan"), 190],
  [unorderedCityPairKey("berlin", "prague"), 250],
  [unorderedCityPairKey("vienna", "budapest"), 160],
]);

export const EXACT_OPTIMIZATION_MAX_CITIES = 10;
const HEURISTIC_MAX_START_SEEDS = 12;

const provenancePriority: Readonly<Record<DataProvenance["kind"], number>> = {
  observed: 0,
  scheduled: 1,
  estimated: 2,
  unavailable: 3,
};

function requireNonEmpty(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new DomainValidationError(`${fieldName} must not be empty`);
  }
  return normalized;
}

function assertProvenance(provenance: DataProvenance): void {
  if (provenance.kind === "observed") {
    requireNonEmpty(provenance.source, "Observed source");
    requireNonEmpty(provenance.observedAt, "Observation timestamp");
    return;
  }
  if (provenance.kind === "scheduled") {
    requireNonEmpty(provenance.source, "Schedule source");
    return;
  }
  if (provenance.kind === "estimated") {
    requireNonEmpty(provenance.methodology, "Estimate methodology");
    return;
  }
  requireNonEmpty(provenance.reason, "Unavailable reason");
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareStringArrays(
  left: readonly string[],
  right: readonly string[],
): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const comparison = compareText(left[index], right[index]);
    if (comparison !== 0) return comparison;
  }
  return left.length - right.length;
}

export function createDurationBreakdown(
  inputs: readonly DurationComponentInput[],
): DurationBreakdown {
  if (inputs.length === 0) {
    throw new DomainValidationError("A duration needs at least one component");
  }

  const validKinds = new Set<string>(DURATION_COMPONENT_KINDS);
  const components: DurationComponent[] = inputs.map((component) => {
    if (!validKinds.has(component.kind)) {
      throw new DomainValidationError(
        `Unsupported duration component: ${component.kind}`,
      );
    }
    if (!Number.isInteger(component.minutes) || component.minutes < 0) {
      throw new DomainValidationError(
        "Duration component minutes must be a non-negative integer",
      );
    }
    return Object.freeze({
      kind: component.kind,
      label: requireNonEmpty(component.label, "Duration component label"),
      minutes: component.minutes,
    });
  });

  const totalMinutes = components.reduce(
    (total, component) => total + component.minutes,
    0,
  );
  if (totalMinutes <= 0) {
    throw new DomainValidationError("Available travel time must be positive");
  }

  return Object.freeze({
    components: Object.freeze(components),
    totalMinutes,
  });
}

export function assertDurationInvariant(duration: DurationBreakdown): void {
  const sum = duration.components.reduce(
    (total, component) => total + component.minutes,
    0,
  );
  if (sum !== duration.totalMinutes) {
    throw new DomainValidationError(
      `Duration total ${duration.totalMinutes} does not equal component sum ${sum}`,
    );
  }
}

export function createTransportSegment(
  input: TransportSegmentInput,
): TransportSegment {
  assertProvenance(input.provenance);
  if (!(TRANSPORT_MODES as readonly string[]).includes(input.mode)) {
    throw new DomainValidationError(`Unsupported transport mode: ${input.mode}`);
  }

  const shared = {
    id: requireNonEmpty(input.id, "Segment id"),
    mode: input.mode,
    from: requireNonEmpty(input.from, "Segment origin"),
    to: requireNonEmpty(input.to, "Segment destination"),
    provenance: Object.freeze({ ...input.provenance }) as DataProvenance,
    ...(input.scheduledService
      ? { scheduledService: validateScheduledService(input.scheduledService, input.provenance) }
      : {}),
  };

  if (input.provenance.kind === "unavailable") {
    if (input.components && input.components.length > 0) {
      throw new DomainValidationError(
        "Unavailable segments cannot contain a duration",
      );
    }
    return Object.freeze({ ...shared, duration: null });
  }

  const duration = createDurationBreakdown(input.components ?? []);
  return Object.freeze({ ...shared, duration });
}

function validateScheduledService(
  details: ScheduledServiceDetails,
  provenance: DataProvenance,
): ScheduledServiceDetails {
  if (provenance.kind !== "scheduled" && provenance.kind !== "observed") {
    throw new DomainValidationError(
      "Scheduled service details require scheduled or observed provenance",
    );
  }
  const departureTime = requireNonEmpty(
    details.departureTime,
    "Scheduled departure time",
  );
  const arrivalTime = requireNonEmpty(
    details.arrivalTime,
    "Scheduled arrival time",
  );
  const departureMs = Date.parse(departureTime);
  const arrivalMs = Date.parse(arrivalTime);
  if (
    !Number.isFinite(departureMs) ||
    !Number.isFinite(arrivalMs) ||
    arrivalMs <= departureMs
  ) {
    throw new DomainValidationError(
      "Scheduled service times must be valid and arrival must follow departure",
    );
  }
  return Object.freeze({
    serviceName: requireNonEmpty(details.serviceName, "Scheduled service name"),
    departurePlace: requireNonEmpty(
      details.departurePlace,
      "Scheduled departure place",
    ),
    arrivalPlace: requireNonEmpty(
      details.arrivalPlace,
      "Scheduled arrival place",
    ),
    departureTime,
    arrivalTime,
  });
}

/**
 * True only when every duration in a leg is backed by a provider schedule or
 * measured observation. Modelled/estimated values are deliberately excluded.
 */
export function isVerifiedTransportLeg(leg: TravelLeg): boolean {
  if (
    leg.totalMinutes === null ||
    (leg.provenance.kind !== "scheduled" && leg.provenance.kind !== "observed")
  ) {
    return false;
  }
  return leg.segments.every((segment) => {
    if (!segment.duration) return false;
    if (segment.provenance.kind === "scheduled") {
      return Boolean(segment.scheduledService);
    }
    return segment.provenance.kind === "observed";
  });
}

function combineProvenance(
  provenances: readonly DataProvenance[],
): DataProvenance {
  if (provenances.length === 0) {
    return {
      kind: "unavailable",
      reason: "No transport segments were supplied",
    };
  }

  const unavailable = provenances.find(
    (provenance) => provenance.kind === "unavailable",
  );
  if (unavailable?.kind === "unavailable") {
    return {
      kind: "unavailable",
      reason: `At least one segment is unavailable: ${unavailable.reason}`,
    };
  }

  const sources = Array.from(
    new Set(
      provenances.flatMap((provenance) =>
        "source" in provenance && provenance.source ? [provenance.source] : [],
      ),
    ),
  ).sort(compareText);

  if (provenances.some((provenance) => provenance.kind === "estimated")) {
    return {
      kind: "estimated",
      methodology: "The journey contains one or more estimated segments",
      ...(sources.length > 0 ? { source: sources.join(" + ") } : {}),
    };
  }

  if (provenances.some((provenance) => provenance.kind === "scheduled")) {
    return {
      kind: "scheduled",
      source: sources.join(" + ") || "Published transport schedules",
    };
  }

  const observed = provenances.filter(
    (provenance): provenance is Extract<DataProvenance, { kind: "observed" }> =>
      provenance.kind === "observed",
  );
  return {
    kind: "observed",
    source: sources.join(" + ") || "Measured journey data",
    observedAt: observed
      .map((provenance) => provenance.observedAt)
      .sort(compareText)
      .at(-1) ?? "unknown",
  };
}

const requiredFlightComponents: readonly DurationComponentKind[] = [
  "city_to_terminal",
  "check_in_security",
  "in_vehicle",
  "terminal_to_city",
  "buffer",
];

function assertFlightDoorToDoorCoverage(
  segments: readonly TransportSegment[],
): void {
  if (!segments.some((segment) => segment.mode === "flight")) return;
  if (segments.some((segment) => segment.duration === null)) return;

  const includedKinds = new Set(
    segments.flatMap(
      (segment) =>
        segment.duration?.components.map((component) => component.kind) ?? [],
    ),
  );
  const missing = requiredFlightComponents.filter(
    (kind) => !includedKinds.has(kind),
  );
  if (missing.length > 0) {
    throw new DomainValidationError(
      `Flight journeys must include complete door-to-door time; missing: ${missing.join(", ")}`,
    );
  }
}

export function createTravelLeg(input: TravelLegInput): TravelLeg {
  const fromCityId = requireNonEmpty(input.fromCityId, "Leg origin city");
  const toCityId = requireNonEmpty(input.toCityId, "Leg destination city");
  if (fromCityId === toCityId) {
    throw new DomainValidationError("A travel leg must connect two cities");
  }
  if (input.segments.length === 0) {
    throw new DomainValidationError("A travel leg needs at least one segment");
  }

  for (let index = 1; index < input.segments.length; index += 1) {
    if (input.segments[index - 1].to !== input.segments[index].from) {
      throw new DomainValidationError(
        `Disconnected segments at position ${index}`,
      );
    }
  }

  assertFlightDoorToDoorCoverage(input.segments);
  const modes = Array.from(
    new Set(input.segments.map((segment) => segment.mode)),
  );
  const hasUnavailableSegment = input.segments.some(
    (segment) => segment.duration === null,
  );
  const totalMinutes = hasUnavailableSegment
    ? null
    : input.segments.reduce(
        (total, segment) => total + (segment.duration?.totalMinutes ?? 0),
        0,
      );

  const leg: TravelLeg = Object.freeze({
    id: requireNonEmpty(input.id, "Leg id"),
    fromCityId,
    toCityId,
    segments: Object.freeze([...input.segments]),
    modes: Object.freeze(modes),
    isMixedTransport: modes.length > 1,
    provenance: Object.freeze(
      combineProvenance(input.segments.map((segment) => segment.provenance)),
    ),
    totalMinutes,
  });
  assertTravelLegInvariant(leg);
  return leg;
}

export function assertTravelLegInvariant(leg: TravelLeg): void {
  for (const segment of leg.segments) {
    if (segment.duration) assertDurationInvariant(segment.duration);
  }
  const containsUnavailable = leg.segments.some(
    (segment) => segment.duration === null,
  );
  if (containsUnavailable) {
    if (leg.totalMinutes !== null || leg.provenance.kind !== "unavailable") {
      throw new DomainValidationError(
        "A leg with unavailable segments must have a null total and unavailable provenance",
      );
    }
    return;
  }

  const sum = leg.segments.reduce(
    (total, segment) => total + (segment.duration?.totalMinutes ?? 0),
    0,
  );
  if (leg.totalMinutes !== sum) {
    throw new DomainValidationError(
      `Leg total ${leg.totalMinutes} does not equal segment sum ${sum}`,
    );
  }
}

export function selectFastestLeg(
  legs: readonly TravelLeg[],
  fromCityId: string,
  toCityId: string,
): TravelLeg | undefined {
  const candidates = legs.filter(
    (leg) =>
      leg.fromCityId === fromCityId &&
      leg.toCityId === toCityId &&
      leg.totalMinutes !== null,
  );
  const familyOrder: readonly TransportMode[] = ["flight", "train", "bus", "ferry", "metro", "car", "taxi", "walk"];
  const family = (leg: TravelLeg): TransportMode => familyOrder.find((mode) => leg.modes.includes(mode)) ?? "walk";
  const strongestByFamily = new Map<TransportMode, number>();
  for (const candidate of candidates) {
    const key = family(candidate);
    const priority = provenancePriority[candidate.provenance.kind];
    strongestByFamily.set(key, Math.min(strongestByFamily.get(key) ?? Infinity, priority));
  }

  return candidates
    // A published or measured option replaces a model estimate for the same
    // transport family. Different transport families still compete on time.
    .filter((leg) => provenancePriority[leg.provenance.kind] === strongestByFamily.get(family(leg)))
    .sort((left, right) => {
      const durationDifference =
        (left.totalMinutes ?? Infinity) - (right.totalMinutes ?? Infinity);
      if (durationDifference !== 0) return durationDifference;
      const provenanceDifference = provenancePriority[left.provenance.kind] - provenancePriority[right.provenance.kind];
      return provenanceDifference || compareText(left.id, right.id);
    })[0];
}

interface RouteState {
  readonly totalMinutes: number;
  readonly order: readonly number[];
}

function isBetterState(
  candidate: RouteState,
  current: RouteState | undefined,
  cityIds: readonly string[],
): boolean {
  if (!current) return true;
  if (candidate.totalMinutes !== current.totalMinutes) {
    return candidate.totalMinutes < current.totalMinutes;
  }
  return (
    compareStringArrays(
      candidate.order.map((index) => cityIds[index]),
      current.order.map((index) => cityIds[index]),
    ) < 0
  );
}

function exactRouteState(
  cityIds: readonly string[],
  bestLegs: readonly (readonly (TravelLeg | undefined)[])[],
  startIndex: number,
  endIndex: number,
): RouteState | undefined {
  const count = cityIds.length;
  const stateCount = 1 << count;
  const states: Array<Array<RouteState | undefined>> = Array.from(
    { length: stateCount },
    () => Array<RouteState | undefined>(count),
  );
  const allowedStarts =
    startIndex >= 0
      ? [startIndex]
      : Array.from({ length: count }, (_, index) => index).filter(
          (index) => index !== endIndex,
        );
  for (const index of allowedStarts) {
    states[1 << index][index] = { totalMinutes: 0, order: [index] };
  }

  for (let mask = 1; mask < stateCount; mask += 1) {
    for (let last = 0; last < count; last += 1) {
      const state = states[mask][last];
      if (!state) continue;
      for (let next = 0; next < count; next += 1) {
        if ((mask & (1 << next)) !== 0) continue;
        // A fixed destination can only be appended after every other city.
        if (
          next === endIndex &&
          mask !== ((stateCount - 1) ^ (1 << endIndex))
        ) {
          continue;
        }
        const leg = bestLegs[last][next];
        if (!leg || leg.totalMinutes === null) continue;
        const nextMask = mask | (1 << next);
        const candidate: RouteState = {
          totalMinutes: state.totalMinutes + leg.totalMinutes,
          order: [...state.order, next],
        };
        if (isBetterState(candidate, states[nextMask][next], cityIds)) {
          states[nextMask][next] = candidate;
        }
      }
    }
  }

  const fullMask = stateCount - 1;
  const allowedEnds =
    endIndex >= 0
      ? [endIndex]
      : Array.from({ length: count }, (_, index) => index);
  let bestState: RouteState | undefined;
  for (const index of allowedEnds) {
    const candidate = states[fullMask][index];
    if (candidate && isBetterState(candidate, bestState, cityIds)) {
      bestState = candidate;
    }
  }
  return bestState;
}

function routeStateForOrder(
  order: readonly number[],
  bestLegs: readonly (readonly (TravelLeg | undefined)[])[],
): RouteState | undefined {
  let totalMinutes = 0;
  for (let index = 1; index < order.length; index += 1) {
    const leg = bestLegs[order[index - 1]][order[index]];
    if (!leg || leg.totalMinutes === null) return undefined;
    totalMinutes += leg.totalMinutes;
  }
  return { totalMinutes, order };
}

function nearestNeighborRouteState(
  cityIds: readonly string[],
  bestLegs: readonly (readonly (TravelLeg | undefined)[])[],
  startIndex: number,
  endIndex: number,
  firstVisitIndex?: number,
): RouteState | undefined {
  const order = [startIndex];
  const unvisited = new Set(
    Array.from({ length: cityIds.length }, (_, index) => index).filter(
      (index) => index !== startIndex,
    ),
  );

  if (firstVisitIndex !== undefined) {
    if (
      !unvisited.has(firstVisitIndex) ||
      (firstVisitIndex === endIndex && unvisited.size > 1) ||
      !Number.isFinite(edgeMinutes(bestLegs, startIndex, firstVisitIndex))
    ) {
      return undefined;
    }
    order.push(firstVisitIndex);
    unvisited.delete(firstVisitIndex);
  }

  while (unvisited.size > 0) {
    const current = order.at(-1) as number;
    let next: number | undefined;
    let nextMinutes = Number.POSITIVE_INFINITY;
    for (const candidateIndex of unvisited) {
      if (candidateIndex === endIndex && unvisited.size > 1) continue;
      const candidateMinutes = edgeMinutes(
        bestLegs,
        current,
        candidateIndex,
      );
      if (!Number.isFinite(candidateMinutes)) continue;
      if (
        candidateMinutes < nextMinutes ||
        (candidateMinutes === nextMinutes &&
          (next === undefined ||
            compareText(cityIds[candidateIndex], cityIds[next]) < 0))
      ) {
        next = candidateIndex;
        nextMinutes = candidateMinutes;
      }
    }
    if (next === undefined) return undefined;
    order.push(next);
    unvisited.delete(next);
  }
  return routeStateForOrder(order, bestLegs);
}

function edgeMinutes(
  bestLegs: readonly (readonly (TravelLeg | undefined)[])[],
  fromIndex: number,
  toIndex: number,
): number {
  return bestLegs[fromIndex][toIndex]?.totalMinutes ?? Number.POSITIVE_INFINITY;
}

// Directed 2-opt uses prefix sums for reversed internal edges, keeping each
// improvement pass O(n²) instead of O(n³). A fixed first/last city is never
// moved. Ties are resolved by city id so identical inputs are reproducible.
function improveRouteWithTwoOpt(
  initial: RouteState,
  cityIds: readonly string[],
  bestLegs: readonly (readonly (TravelLeg | undefined)[])[],
  startIndex: number,
  endIndex: number,
): RouteState {
  let current = initial;
  const count = current.order.length;
  const firstMovable = startIndex >= 0 ? 1 : 0;
  const lastMovable = endIndex >= 0 ? count - 2 : count - 1;
  const maximumPasses = Math.min(count, 12);

  for (let pass = 0; pass < maximumPasses; pass += 1) {
    const forwardPrefix = Array<number>(count).fill(0);
    const reversePrefix = Array<number>(count).fill(0);
    const reverseMissingPrefix = Array<number>(count).fill(0);
    for (let index = 1; index < count; index += 1) {
      forwardPrefix[index] =
        forwardPrefix[index - 1] +
        edgeMinutes(bestLegs, current.order[index - 1], current.order[index]);
      const reverseMinutes = edgeMinutes(
        bestLegs,
        current.order[index],
        current.order[index - 1],
      );
      reversePrefix[index] =
        reversePrefix[index - 1] +
        (Number.isFinite(reverseMinutes) ? reverseMinutes : 0);
      reverseMissingPrefix[index] =
        reverseMissingPrefix[index - 1] +
        (Number.isFinite(reverseMinutes) ? 0 : 1);
    }

    let best = current;
    for (let left = firstMovable; left < lastMovable; left += 1) {
      for (let right = left + 1; right <= lastMovable; right += 1) {
        const oldInternal = forwardPrefix[right] - forwardPrefix[left];
        if (
          reverseMissingPrefix[right] - reverseMissingPrefix[left] >
          0
        ) {
          continue;
        }
        const newInternal = reversePrefix[right] - reversePrefix[left];

        let candidateTotal = current.totalMinutes - oldInternal + newInternal;
        if (left > 0) {
          candidateTotal -= edgeMinutes(
            bestLegs,
            current.order[left - 1],
            current.order[left],
          );
          candidateTotal += edgeMinutes(
            bestLegs,
            current.order[left - 1],
            current.order[right],
          );
        }
        if (right < count - 1) {
          candidateTotal -= edgeMinutes(
            bestLegs,
            current.order[right],
            current.order[right + 1],
          );
          candidateTotal += edgeMinutes(
            bestLegs,
            current.order[left],
            current.order[right + 1],
          );
        }
        if (!Number.isFinite(candidateTotal) || candidateTotal > best.totalMinutes) {
          continue;
        }

        const candidate: RouteState = {
          totalMinutes: candidateTotal,
          order: [
            ...current.order.slice(0, left),
            ...current.order.slice(left, right + 1).reverse(),
            ...current.order.slice(right + 1),
          ],
        };
        if (isBetterState(candidate, best, cityIds)) best = candidate;
      }
    }
    if (best.order === current.order) break;
    current = best;
  }

  // Recompute from selected legs so floating-point prefix arithmetic can never
  // become the persisted itinerary total.
  return routeStateForOrder(current.order, bestLegs) ?? initial;
}

function heuristicRouteState(
  cityIds: readonly string[],
  bestLegs: readonly (readonly (TravelLeg | undefined)[])[],
  startIndex: number,
  endIndex: number,
): RouteState | undefined {
  const allAllowedStarts =
    startIndex >= 0
      ? [startIndex]
      : Array.from({ length: cityIds.length }, (_, index) => index)
          .filter((index) => index !== endIndex)
          .sort((left, right) => compareText(cityIds[left], cityIds[right]));
  // An unrestricted city list must not turn the heuristic into an O(n^3)
  // search merely because neither endpoint was fixed. Evenly spaced seeds in
  // stable city-id order keep the result reproducible while the nearest-neighbour
  // and directed 2-opt work remains bounded by a small number of starts.
  const allowedStarts =
    allAllowedStarts.length <= HEURISTIC_MAX_START_SEEDS
      ? allAllowedStarts
      : Array.from(
          { length: HEURISTIC_MAX_START_SEEDS },
          (_, seedIndex) =>
            allAllowedStarts[
              Math.floor(
                (seedIndex * (allAllowedStarts.length - 1)) /
                  (HEURISTIC_MAX_START_SEEDS - 1),
              )
            ],
        );
  const greedySeeds: RouteState[] = [];
  for (const candidateStart of allowedStarts) {
    const firstVisits =
      startIndex >= 0
        ? Array.from({ length: cityIds.length }, (_, index) => index)
            .filter(
              (index) =>
                index !== candidateStart &&
                (index !== endIndex || cityIds.length === 2) &&
                Number.isFinite(edgeMinutes(bestLegs, candidateStart, index)),
            )
            .sort(
              (left, right) =>
                edgeMinutes(bestLegs, candidateStart, left) -
                  edgeMinutes(bestLegs, candidateStart, right) ||
                compareText(cityIds[left], cityIds[right]),
            )
            .slice(0, 4)
        : [undefined];
    for (const firstVisit of firstVisits) {
      const candidate = nearestNeighborRouteState(
        cityIds,
        bestLegs,
        candidateStart,
        endIndex,
        firstVisit,
      );
      if (candidate) greedySeeds.push(candidate);
    }
  }
  const seedsToImprove = greedySeeds
    .sort((left, right) =>
      isBetterState(left, right, cityIds)
        ? -1
        : isBetterState(right, left, cityIds)
          ? 1
          : 0,
    )
    .slice(0, 4);
  let best: RouteState | undefined;
  for (const seed of seedsToImprove) {
    const improved = improveRouteWithTwoOpt(
      seed,
      cityIds,
      bestLegs,
      startIndex,
      endIndex,
    );
    if (isBetterState(improved, best, cityIds)) best = improved;
  }
  return best;
}

export function optimizeItinerary(
  cityIdsInput: readonly string[],
  candidateLegs: readonly TravelLeg[],
  options: OptimizeItineraryOptions = {},
): OptimizedItinerary {
  if (cityIdsInput.length < 2) {
    throw new DomainValidationError("At least two cities are required");
  }

  const cityIds = [...cityIdsInput];
  const uniqueCityIds = new Set(cityIds);
  if (uniqueCityIds.size !== cityIds.length) {
    throw new DomainValidationError("A route cannot contain duplicate cities");
  }
  if (options.cities) {
    const suppliedCityIds = new Set(options.cities.map((city) => city.id));
    if (suppliedCityIds.size !== options.cities.length || cityIds.some((cityId) => !suppliedCityIds.has(cityId))) {
      throw new DomainValidationError("Every route city needs valid location metadata");
    }
  } else {
    cityIds.forEach(getCity);
  }

  const startIndex = options.startCityId
    ? cityIds.indexOf(options.startCityId)
    : -1;
  const endIndex = options.endCityId ? cityIds.indexOf(options.endCityId) : -1;
  if (options.startCityId && startIndex < 0) {
    throw new DomainValidationError("The fixed start city is not in the route");
  }
  if (options.endCityId && endIndex < 0) {
    throw new DomainValidationError("The fixed end city is not in the route");
  }
  if (startIndex >= 0 && startIndex === endIndex) {
    throw new DomainValidationError(
      "Start and end cities must differ for a multi-city route",
    );
  }

  const count = cityIds.length;
  const candidateLegsByPair = new Map<string, TravelLeg[]>();
  const directedPairKey = (fromCityId: string, toCityId: string) =>
    `${fromCityId}\u0000${toCityId}`;
  for (const candidateLeg of candidateLegs) {
    const key = directedPairKey(
      candidateLeg.fromCityId,
      candidateLeg.toCityId,
    );
    const pairCandidates = candidateLegsByPair.get(key);
    if (pairCandidates) pairCandidates.push(candidateLeg);
    else candidateLegsByPair.set(key, [candidateLeg]);
  }
  const bestLegs: Array<Array<TravelLeg | undefined>> = Array.from(
    { length: count },
    () => Array<TravelLeg | undefined>(count),
  );
  for (let from = 0; from < count; from += 1) {
    for (let to = 0; to < count; to += 1) {
      if (from !== to) {
        bestLegs[from][to] = selectFastestLeg(
          candidateLegsByPair.get(
            directedPairKey(cityIds[from], cityIds[to]),
          ) ?? [],
          cityIds[from],
          cityIds[to],
        );
      }
    }
  }

  const bestState =
    count <= EXACT_OPTIMIZATION_MAX_CITIES
      ? exactRouteState(cityIds, bestLegs, startIndex, endIndex)
      : heuristicRouteState(cityIds, bestLegs, startIndex, endIndex);

  if (!bestState) {
    throw new DomainValidationError(
      "No complete route is available for the selected cities",
    );
  }

  const cityOrder = bestState.order.map((index) => cityIds[index]);
  const legs = bestState.order.slice(1).map((toIndex, routeIndex) => {
    const fromIndex = bestState.order[routeIndex];
    const leg = bestLegs[fromIndex][toIndex];
    if (!leg) {
      throw new DomainValidationError("Optimized route lost a required leg");
    }
    return leg;
  });
  const totalMinutes = legs.reduce(
    (total, leg) => total + (leg.totalMinutes ?? 0),
    0,
  );
  if (totalMinutes !== bestState.totalMinutes) {
    throw new DomainValidationError(
      "Optimized route total does not equal its leg totals",
    );
  }

  return Object.freeze({
    cityOrder: Object.freeze(cityOrder),
    legs: Object.freeze(legs),
    totalMinutes,
    provenance: Object.freeze(
      combineProvenance(legs.map((leg) => leg.provenance)),
    ),
  });
}

/**
 * Product-facing optimizer. It refuses to fabricate missing edges: only
 * provider-scheduled or measured legs may participate in a recommendation.
 */
export function optimizeVerifiedItinerary(
  cityIds: readonly string[],
  candidateLegs: readonly TravelLeg[],
  options: OptimizeItineraryOptions = {},
): OptimizedItinerary {
  return optimizeItinerary(
    cityIds,
    candidateLegs.filter(isVerifiedTransportLeg),
    options,
  );
}

export function haversineDistanceBetweenCities(
  from: City,
  to: City,
): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = radians(
    to.coordinates.latitude - from.coordinates.latitude,
  );
  const longitudeDelta = radians(
    to.coordinates.longitude - from.coordinates.longitude,
  );
  const fromLatitude = radians(from.coordinates.latitude);
  const toLatitude = radians(to.coordinates.latitude);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLatitude) *
      Math.cos(toLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 6_371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function haversineDistanceKm(
  fromCityId: string,
  toCityId: string,
): number {
  return haversineDistanceBetweenCities(getCity(fromCityId), getCity(toCityId));
}

function estimateMinutes(distanceKm: number, speedKmPerHour: number): number {
  return Math.max(1, Math.round((distanceKm / speedKmPerHour) * 60));
}

export function getEstimatedFallbackModes(
  fromCityId: string,
  toCityId: string,
): readonly EstimatedFallbackMode[] {
  return getEstimatedFallbackModesForCities(getCity(fromCityId), getCity(toCityId));
}

function matchesGeographicEndpoint(
  city: City,
  endpoint: GeographicSurfaceCorridor["endpoints"][number],
): boolean {
  return (
    city.country.code === endpoint.countryCode &&
    Math.abs(city.coordinates.latitude - endpoint.latitude) <= 0.2 &&
    Math.abs(city.coordinates.longitude - endpoint.longitude) <= 0.25
  );
}

function findGeographicSurfaceCorridor(
  fromCity: City,
  toCity: City,
): GeographicSurfaceCorridor | undefined {
  return GEOGRAPHIC_SURFACE_CORRIDORS.find(({ endpoints }) => {
    const [left, right] = endpoints;
    return (
      (matchesGeographicEndpoint(fromCity, left) &&
        matchesGeographicEndpoint(toCity, right)) ||
      (matchesGeographicEndpoint(fromCity, right) &&
        matchesGeographicEndpoint(toCity, left))
    );
  });
}

function isLikelyItalianMainlandCity(city: City): boolean {
  if (city.country.code !== "IT") return false;
  const { latitude, longitude } = city.coordinates;
  if (latitude < 38.5) return false;
  // Avoid treating Sardinian cities as rail-connected to mainland Italy. The
  // remaining rule is intentionally conservative and explicitly estimated.
  const isSardinia =
    latitude <= 41.5 &&
    longitude >= 8 &&
    longitude <= 10.2;
  return !isSardinia;
}

function hasConservativeSameCountrySurfaceFallback(
  fromCity: City,
  toCity: City,
): boolean {
  return (
    isLikelyItalianMainlandCity(fromCity) &&
    isLikelyItalianMainlandCity(toCity) &&
    haversineDistanceBetweenCities(fromCity, toCity) <= 650
  );
}

export function getEstimatedFallbackModesForCities(
  fromCity: City,
  toCity: City,
): readonly EstimatedFallbackMode[] {
  const fromCityId = fromCity.id;
  const toCityId = toCity.id;
  if (fromCityId === toCityId) return Object.freeze([]);

  const surfaceModes = new Set<EstimatedSurfaceMode>(
    surfaceModesByPair.get(unorderedCityPairKey(fromCityId, toCityId)) ?? [],
  );
  const geographicCorridor = findGeographicSurfaceCorridor(fromCity, toCity);
  geographicCorridor?.modes.forEach((mode) => surfaceModes.add(mode));
  if (hasConservativeSameCountrySurfaceFallback(fromCity, toCity)) {
    surfaceModes.add("train");
    surfaceModes.add("bus");
  }
  return Object.freeze([
    "flight",
    ...(["train", "bus"] as const).filter((mode) => surfaceModes.has(mode)),
  ]);
}

export function createEstimatedFallbackLegForCities(
  fromCity: City,
  toCity: City,
  mode: EstimatedFallbackMode,
): TravelLeg {
  const fromCityId = fromCity.id;
  const toCityId = toCity.id;
  if (!(mode === "flight" || mode === "train" || mode === "bus")) {
    throw new DomainValidationError(`Unsupported fallback mode: ${mode}`);
  }
  if (!getEstimatedFallbackModesForCities(fromCity, toCity).includes(mode)) {
    throw new DomainValidationError(
      `No conservative ${mode} fallback connects ${fromCityId} and ${toCityId}`,
    );
  }
  const distanceKm = haversineDistanceBetweenCities(fromCity, toCity);
  const pairKey = unorderedCityPairKey(fromCityId, toCityId);
  const railBenchmarkMinutes =
    TRAIN_IN_VEHICLE_MINUTES_BY_PAIR.get(pairKey) ??
    findGeographicSurfaceCorridor(fromCity, toCity)?.trainMinutes;
  const methodology =
    mode === "train"
      ? railBenchmarkMinutes
        ? "Curated corridor city-to-city train running-time benchmark; replace with provider schedule data"
        : "Estimated city-to-city train running time from geographic distance and conservative rail speeds; service existence must be verified with provider data"
      : mode === "bus"
        ? "Estimated city-to-city coach running time from geographic distance and conservative road speeds; service existence must be verified with provider data"
        : "Estimated flight door-to-door time from great-circle distance, airport access, processing, baggage and operational allowances; replace with provider data";
  const provenance: DataProvenance = { kind: "estimated", methodology };
  const fromCentre = `${fromCityId}:city-centre`;
  const toCentre = `${toCityId}:city-centre`;

  if (mode === "flight") {
    const fromAirport = `${fromCityId}:airport`;
    const toAirport = `${toCityId}:airport`;
    return createTravelLeg({
      id: `fallback:${fromCityId}:${toCityId}:flight`,
      fromCityId,
      toCityId,
      segments: [
        createTransportSegment({
          id: `fallback:${fromCityId}:airport-access`,
          mode: "taxi",
          from: fromCentre,
          to: fromAirport,
          provenance,
          components: [
            { kind: "city_to_terminal", label: "City to airport", minutes: 50 },
          ],
        }),
        createTransportSegment({
          id: `fallback:${fromCityId}:${toCityId}:air`,
          mode: "flight",
          from: fromAirport,
          to: toAirport,
          provenance,
          components: [
            { kind: "check_in_security", label: "Check-in and security", minutes: 120 },
            { kind: "in_vehicle", label: "Air time", minutes: estimateMinutes(distanceKm, 780) + 35 },
            { kind: "buffer", label: "Operational buffer", minutes: 25 },
            { kind: "baggage", label: "Arrival and baggage allowance", minutes: 20 },
          ],
        }),
        createTransportSegment({
          id: `fallback:${toCityId}:airport-egress`,
          mode: "train",
          from: toAirport,
          to: toCentre,
          provenance,
          components: [
            { kind: "terminal_to_city", label: "Airport to city", minutes: 45 },
          ],
        }),
      ],
    });
  }

  if (mode === "train") {
    const routeDistanceKm = distanceKm * 1.12;
    const averageSpeedKmPerHour =
      distanceKm <= 250 ? 110 : distanceKm <= 600 ? 145 : 155;
    const trainMinutes =
      railBenchmarkMinutes ??
      estimateMinutes(routeDistanceKm, averageSpeedKmPerHour) + 5;
    return createTravelLeg({
      id: `fallback:${fromCityId}:${toCityId}:train`,
      fromCityId,
      toCityId,
      segments: [
        createTransportSegment({
          id: `fallback:${fromCityId}:${toCityId}:train:segment`,
          mode: "train",
          from: fromCentre,
          to: toCentre,
          provenance,
          components: [
            {
              kind: "in_vehicle",
              label: railBenchmarkMinutes
                ? "Intercity train benchmark"
                : "Estimated intercity train time",
              minutes: trainMinutes,
            },
          ],
        }),
      ],
    });
  }

  return createTravelLeg({
    id: `fallback:${fromCityId}:${toCityId}:${mode}`,
    fromCityId,
    toCityId,
    segments: [
      createTransportSegment({
        id: `fallback:${fromCityId}:${toCityId}:${mode}:segment`,
        mode,
        from: fromCentre,
        to: toCentre,
        provenance,
        components: [
          {
            kind: "in_vehicle",
            label: "Estimated intercity coach time",
            minutes: estimateMinutes(distanceKm * 1.2, 68),
          },
        ],
      }),
    ],
  });
}

export function createEstimatedFallbackLeg(
  fromCityId: string,
  toCityId: string,
  mode: EstimatedFallbackMode,
): TravelLeg {
  return createEstimatedFallbackLegForCities(
    getCity(fromCityId),
    getCity(toCityId),
    mode,
  );
}

export function buildEstimatedFallbackOptionsForCities(
  cities: readonly City[],
): readonly TravelLeg[] {
  const legs: TravelLeg[] = [];
  for (const fromCity of cities) {
    for (const toCity of cities) {
      if (fromCity.id === toCity.id) continue;
      for (const mode of getEstimatedFallbackModesForCities(fromCity, toCity)) {
        legs.push(createEstimatedFallbackLegForCities(fromCity, toCity, mode));
      }
    }
  }
  return Object.freeze(legs);
}

export function buildEstimatedFallbackOptions(
  cityIds: readonly string[],
): readonly TravelLeg[] {
  return buildEstimatedFallbackOptionsForCities(cityIds.map(getCity));
}
