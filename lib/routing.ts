import { getCity } from "./cities.js";
import {
  DURATION_COMPONENT_KINDS,
  DomainValidationError,
  TRANSPORT_MODES,
  type DataProvenance,
  type DurationBreakdown,
  type DurationComponent,
  type DurationComponentKind,
  type OptimizedItinerary,
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
}

export type EstimatedFallbackMode = "flight" | "train" | "bus";

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
  return legs
    .filter(
      (leg) =>
        leg.fromCityId === fromCityId &&
        leg.toCityId === toCityId &&
        leg.totalMinutes !== null,
    )
    .sort((left, right) => {
      const durationDifference =
        (left.totalMinutes ?? Infinity) - (right.totalMinutes ?? Infinity);
      if (durationDifference !== 0) return durationDifference;
      const provenanceDifference =
        provenancePriority[left.provenance.kind] -
        provenancePriority[right.provenance.kind];
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

export function optimizeItinerary(
  cityIdsInput: readonly string[],
  candidateLegs: readonly TravelLeg[],
  options: OptimizeItineraryOptions = {},
): OptimizedItinerary {
  if (cityIdsInput.length < 2) {
    throw new DomainValidationError("At least two cities are required");
  }
  if (cityIdsInput.length > 10) {
    throw new DomainValidationError(
      "Exact route optimization supports at most 10 cities",
    );
  }

  const cityIds = [...cityIdsInput];
  const uniqueCityIds = new Set(cityIds);
  if (uniqueCityIds.size !== cityIds.length) {
    throw new DomainValidationError("A route cannot contain duplicate cities");
  }
  cityIds.forEach(getCity);

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
  const bestLegs: Array<Array<TravelLeg | undefined>> = Array.from(
    { length: count },
    () => Array<TravelLeg | undefined>(count),
  );
  for (let from = 0; from < count; from += 1) {
    for (let to = 0; to < count; to += 1) {
      if (from !== to) {
        bestLegs[from][to] = selectFastestLeg(
          candidateLegs,
          cityIds[from],
          cityIds[to],
        );
      }
    }
  }

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

export function haversineDistanceKm(
  fromCityId: string,
  toCityId: string,
): number {
  const from = getCity(fromCityId);
  const to = getCity(toCityId);
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

function estimateMinutes(distanceKm: number, speedKmPerHour: number): number {
  return Math.max(1, Math.round((distanceKm / speedKmPerHour) * 60));
}

export function createEstimatedFallbackLeg(
  fromCityId: string,
  toCityId: string,
  mode: EstimatedFallbackMode,
): TravelLeg {
  if (!(mode === "flight" || mode === "train" || mode === "bus")) {
    throw new DomainValidationError(`Unsupported fallback mode: ${mode}`);
  }
  getCity(fromCityId);
  getCity(toCityId);
  const distanceKm = haversineDistanceKm(fromCityId, toCityId);
  const methodology = `${mode} fallback derived from great-circle distance; replace with provider data`;
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

  const speed = mode === "train" ? 160 : 72;
  const routeFactor = mode === "train" ? 1.18 : 1.25;
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
          { kind: "city_to_terminal", label: "City to terminal", minutes: mode === "train" ? 25 : 20 },
          { kind: "waiting", label: "Boarding wait", minutes: mode === "train" ? 20 : 15 },
          { kind: "in_vehicle", label: "Travel time", minutes: estimateMinutes(distanceKm * routeFactor, speed) },
          { kind: "terminal_to_city", label: "Terminal to city", minutes: mode === "train" ? 20 : 15 },
          { kind: "buffer", label: "Operational buffer", minutes: 15 },
        ],
      }),
    ],
  });
}

export function buildEstimatedFallbackOptions(
  cityIds: readonly string[],
): readonly TravelLeg[] {
  const legs: TravelLeg[] = [];
  for (const fromCityId of cityIds) {
    for (const toCityId of cityIds) {
      if (fromCityId === toCityId) continue;
      for (const mode of ["flight", "train", "bus"] as const) {
        legs.push(createEstimatedFallbackLeg(fromCityId, toCityId, mode));
      }
    }
  }
  return Object.freeze(legs);
}
