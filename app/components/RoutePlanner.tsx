"use client";

import {
  AlertTriangle, ArrowDown, ArrowUp, Bookmark, Bus, CalendarDays, CarFront, ChevronDown,
  ChevronUp, CircleDot, Clock3, Database, FileDown, GripVertical, MapPin, Plane, Plus,
  RotateCcw, Search, Share2, Train, X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CITIES } from "../../lib/cities";
import { DEVICE_TRIPS_KEY, MAX_DEVICE_TRIPS, parseDeviceTrips, readDeviceValue, writeDeviceValue } from "../../lib/device-storage";
import { provenanceLabel, SUPPORTED_LOCALES, type City, type DurationComponentKind, type OptimizedItinerary, type SupportedLocale, type TransportMode, type TravelLeg } from "../../lib/domain";
import { isVerifiedTransportLeg, optimizeVerifiedItinerary } from "../../lib/routing";
import { formatDateTime, formatDuration, LANGUAGE_TAGS, translate } from "../../lib/i18n";
import type { RouteSnapshot } from "../../lib/route-snapshot";
import { RouteMap } from "./RouteMap";

export { parseRouteSnapshot } from "../../lib/route-snapshot";
export type { RouteSnapshot } from "../../lib/route-snapshot";

type RoutePlannerProps = {
  locale: SupportedLocale;
  initialCityIds?: string[];
  initialDepartureDate?: string;
  initialSnapshot?: RouteSnapshot;
  initialTimestamp: string;
  onNotify: (message: string, tone?: "success" | "error" | "info") => void;
  onTripSaved: () => void;
};

type ScheduleResult = {
  key: string;
  legs: readonly TravelLeg[];
  partial: boolean;
  calculatedAt: string;
  actualCoverage: boolean;
  candidateQueryComplete: boolean;
  optimalityGuaranteed: boolean;
};

export function evaluateScheduleCoverage(input: {
  readonly pairOffset: number;
  readonly queriedPairCount: number;
  readonly candidatePairCount: number;
  readonly eligiblePairCount: number;
  readonly unknownProviderFailures: boolean;
  readonly cityCount: number;
}) {
  const candidateQueryComplete =
    input.pairOffset >= input.candidatePairCount &&
    input.queriedPairCount === input.candidatePairCount;
  const actualCoverage =
    candidateQueryComplete &&
    !input.unknownProviderFailures &&
    input.candidatePairCount === input.eligiblePairCount;
  return Object.freeze({
    candidateQueryComplete,
    actualCoverage,
    optimalityGuaranteed: actualCoverage && input.cityCount <= 10,
  });
}

export type CitySearchResult = {
  readonly id: string;
  readonly providerId: number;
  readonly name: string;
  readonly country: string;
  readonly countryCode: string;
  readonly admin1?: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly timeZone: string;
  readonly names?: Readonly<Record<SupportedLocale, string>>;
};

function routeCity(cities: ReadonlyMap<string, City>, cityId: string): City {
  const city = cities.get(cityId);
  if (!city) throw new Error(`Missing route city: ${cityId}`);
  return city;
}

function localizedCountryNames(countryCode: string, fallback: string): City["country"]["names"] {
  const displayName = (locale: SupportedLocale) => {
    try {
      return new Intl.DisplayNames([LANGUAGE_TAGS[locale]], { type: "region" }).of(countryCode) ?? fallback;
    } catch {
      return fallback;
    }
  };
  return Object.freeze({
    ko: displayName("ko"),
    en: displayName("en"),
    fr: displayName("fr"),
    ja: displayName("ja"),
    zh: displayName("zh"),
  });
}

export function cityFromSearchResult(result: CitySearchResult, localizedNames?: City["names"]): City {
  const staticMatch = CITIES.find((city) =>
    city.country.code === result.countryCode &&
    Math.abs(city.coordinates.latitude - result.latitude) < 0.03 &&
    Math.abs(city.coordinates.longitude - result.longitude) < 0.03
  );
  if (staticMatch) return staticMatch;
  const neutralName = `${result.countryCode} ${result.latitude.toFixed(3)}, ${result.longitude.toFixed(3)}`;
  const names = localizedNames ?? Object.freeze({ ko: neutralName, en: neutralName, fr: neutralName, ja: neutralName, zh: neutralName });
  return Object.freeze({
    id: result.id,
    names,
    country: Object.freeze({
      code: result.countryCode,
      names: localizedCountryNames(result.countryCode, result.country),
    }),
    coordinates: Object.freeze({ latitude: result.latitude, longitude: result.longitude }),
    timeZone: result.timeZone,
  });
}

function encodeBytes(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

async function encodeSnapshot(snapshot: RouteSnapshot): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
  if (typeof CompressionStream !== "undefined") {
    const stream = new Blob([copyToArrayBuffer(bytes)]).stream().pipeThrough(new CompressionStream("gzip"));
    return `g.${encodeBytes(new Uint8Array(await new Response(stream).arrayBuffer()))}`;
  }
  return `j.${encodeBytes(bytes)}`;
}

async function copyShareUrl(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const input = document.createElement("textarea");
    input.value = value;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.select();
    input.setSelectionRange(0, value.length);
    const copied = document.execCommand("copy");
    input.remove();
    return copied;
  }
}

function ModeGlyph({ mode }: { mode: TransportMode }) {
  if (mode === "flight") return <Plane size={21} strokeWidth={1.9} aria-hidden="true" />;
  if (mode === "train" || mode === "metro") return <Train size={21} strokeWidth={1.9} aria-hidden="true" />;
  if (mode === "bus") return <Bus size={21} strokeWidth={1.9} aria-hidden="true" />;
  return <CarFront size={21} strokeWidth={1.9} aria-hidden="true" />;
}

function primaryTransportMode(modes: readonly TransportMode[]): TransportMode {
  return (["flight", "train", "bus", "ferry", "metro", "car", "taxi", "walk"] as const).find((mode) => modes.includes(mode)) ?? "walk";
}

function componentLabel(kind: DurationComponentKind, locale: SupportedLocale) {
  const labels: Record<DurationComponentKind, Record<SupportedLocale, string>> = {
    city_to_terminal: { ko: "도심→터미널", en: "City to terminal", fr: "Ville → terminal", ja: "市内→ターミナル", zh: "市区→交通枢纽" },
    waiting: { ko: "탑승·대기", en: "Boarding wait", fr: "Attente et embarquement", ja: "乗車・待機", zh: "候车/登机" },
    check_in_security: { ko: "체크인·보안", en: "Check-in & security", fr: "Enregistrement et sûreté", ja: "チェックイン・保安検査", zh: "值机与安检" },
    border_control: { ko: "출입국", en: "Border control", fr: "Contrôle frontière", ja: "出入国審査", zh: "边境检查" },
    in_vehicle: { ko: "탑승 이동", en: "In-vehicle", fr: "Temps à bord", ja: "乗車時間", zh: "乘坐时间" },
    transfer: { ko: "환승", en: "Transfer", fr: "Correspondance", ja: "乗り換え", zh: "换乘" },
    baggage: { ko: "수하물", en: "Baggage", fr: "Bagages", ja: "手荷物", zh: "行李" },
    terminal_to_city: { ko: "터미널→도심", en: "Terminal to city", fr: "Terminal → ville", ja: "ターミナル→市内", zh: "交通枢纽→市区" },
    buffer: { ko: "운항 여유", en: "Reliability buffer", fr: "Marge de fiabilité", ja: "運行バッファ", zh: "运行缓冲" },
  };
  return labels[kind][locale];
}

function modeLabel(mode: TransportMode, locale: SupportedLocale) {
  const labels: Record<TransportMode, Record<SupportedLocale, string>> = {
    walk: { ko: "도보", en: "Walk", fr: "Marche", ja: "徒歩", zh: "步行" },
    taxi: { ko: "택시", en: "Taxi", fr: "Taxi", ja: "タクシー", zh: "出租车" },
    car: { ko: "자동차", en: "Car", fr: "Voiture", ja: "自動車", zh: "汽车" },
    bus: { ko: "버스", en: "Bus", fr: "Bus", ja: "バス", zh: "巴士" },
    train: { ko: "기차", en: "Train", fr: "Train", ja: "鉄道", zh: "火车" },
    flight: { ko: "항공", en: "Flight", fr: "Avion", ja: "航空便", zh: "航班" },
    ferry: { ko: "페리", en: "Ferry", fr: "Ferry", ja: "フェリー", zh: "渡轮" },
    metro: { ko: "지하철", en: "Metro", fr: "Métro", ja: "地下鉄", zh: "地铁" },
  };
  return labels[mode][locale];
}

function LegRow({ leg, index, locale, cities, forceExpanded = false }: { leg: OptimizedItinerary["legs"][number]; index: number; locale: SupportedLocale; cities: ReadonlyMap<string, City>; forceExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(index === 0);
  const detailsVisible = expanded || forceExpanded;
  const from = routeCity(cities, leg.fromCityId);
  const to = routeCity(cities, leg.toCityId);
  const components = leg.segments.flatMap((segment) => segment.duration?.components ?? []);
  return (
    <article className={detailsVisible ? "leg-row expanded" : "leg-row"}>
      <button className="leg-summary" type="button" onClick={() => setExpanded((value) => !value)} aria-expanded={detailsVisible}>
        <span className="leg-number">{index + 1}</span>
        <span className="mode-icon"><ModeGlyph mode={primaryTransportMode(leg.modes)} /></span>
        <span className="leg-cities"><strong>{from.names[locale]} → {to.names[locale]}</strong><small>{leg.modes.map((mode) => modeLabel(mode, locale)).join(" + ")}<span className={`leg-provenance ${leg.provenance.kind}`}>{provenanceLabel(leg.provenance, locale)}</span></small></span>
        <span className="leg-duration">{formatDuration(leg.totalMinutes ?? 0, locale)}</span>
        {detailsVisible ? <ChevronUp size={19} aria-hidden="true" /> : <ChevronDown size={19} aria-hidden="true" />}
      </button>
      {detailsVisible ? (
        <div className="leg-breakdown">
          {leg.segments.map((segment) => {
            const service = segment.scheduledService;
            if (!service) return null;
            const timeFormatter = new Intl.DateTimeFormat(LANGUAGE_TAGS[locale], {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            });
            return (
              <div className="scheduled-segment" key={segment.id}>
                <span className="scheduled-segment-mode"><ModeGlyph mode={segment.mode} />{modeLabel(segment.mode, locale)}</span>
                <strong>{service.serviceName}</strong>
                <span>{service.departurePlace} · {timeFormatter.format(new Date(service.departureTime))}</span>
                <i aria-hidden="true">→</i>
                <span>{service.arrivalPlace} · {timeFormatter.format(new Date(service.arrivalTime))}</span>
              </div>
            );
          })}
          {components.map((component, componentIndex) => (
            <div className="breakdown-item" key={`${component.kind}-${componentIndex}`}>
              <CircleDot size={14} aria-hidden="true" />
              <span>{componentLabel(component.kind, locale)}</span>
              <strong>{formatDuration(component.minutes, locale)}</strong>
            </div>
          ))}
        </div>
      ) : null}
    </article>
  );
}

export function RoutePlanner({ locale, initialCityIds, initialDepartureDate, initialSnapshot, initialTimestamp, onNotify, onTripSaved }: RoutePlannerProps) {
  const initialSelectedCityIds = initialSnapshot?.selectedCityIds ?? initialSnapshot?.cityOrder ?? initialCityIds;
  const initialRouteDate = initialSnapshot?.departureDate ?? initialDepartureDate ?? new Date(Date.parse(initialTimestamp) + 1000 * 60 * 60 * 24 * 30).toISOString().slice(0, 10);
  const initialStartCityId = initialSnapshot?.cityOrder[0] ?? initialSelectedCityIds?.[0] ?? "paris";
  const initialEndCityId = initialSnapshot?.cityOrder.at(-1) ?? initialSelectedCityIds?.at(-1) ?? "berlin";
  const initialExtraCities = (initialSnapshot?.cities ?? []).filter((city) => !CITIES.some((catalogueCity) => catalogueCity.id === city.id));
  const [cityIds, setCityIds] = useState<string[]>(initialSelectedCityIds?.length ? [...initialSelectedCityIds] : ["paris", "brussels", "amsterdam", "berlin"]);
  const [extraCities, setExtraCities] = useState<readonly City[]>(initialExtraCities);
  const [cityQuery, setCityQuery] = useState("");
  const [citySearchResults, setCitySearchResults] = useState<readonly CitySearchResult[]>([]);
  const [citySearchResultLocale, setCitySearchResultLocale] = useState<SupportedLocale | null>(null);
  const [citySearchLoading, setCitySearchLoading] = useState(false);
  const [citySearchError, setCitySearchError] = useState(false);
  const [addingCityId, setAddingCityId] = useState<string | null>(null);
  const addingCityIds = useRef(new Set<string>());
  const [departureDate, setDepartureDate] = useState(initialRouteDate);
  const [startCityId, setStartCityId] = useState(initialStartCityId);
  const [endCityId, setEndCityId] = useState(initialEndCityId);
  const [busy, setBusy] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [pdfMode, setPdfMode] = useState(false);
  const [error, setError] = useState("");
  const [scheduleResult, setScheduleResult] = useState<ScheduleResult | null>(null);
  const [restoredRoute, setRestoredRoute] = useState(() => initialSnapshot?.itinerary ? {
    key: `${initialRouteDate}:${initialStartCityId}:${initialEndCityId}:${(initialSelectedCityIds ?? initialSnapshot.cityOrder).join(",")}`,
    itinerary: initialSnapshot.itinerary,
    calculatedAt: initialSnapshot.createdAt,
  } : null);
  const shouldRevalidateInitialSnapshot = Boolean(initialSnapshot?.itinerary);
  const initialRevalidationStarted = useRef(false);

  const availableCities = useMemo(() => [...CITIES, ...extraCities], [extraCities]);
  const cityMap = useMemo(() => new Map(availableCities.map((city) => [city.id, city])), [availableCities]);
  const selectedCities = useMemo(
    () => cityIds.map((cityId) => cityMap.get(cityId)).filter((city): city is City => Boolean(city)),
    [cityIds, cityMap],
  );
  const effectiveStartCityId = cityIds.includes(startCityId) ? startCityId : cityIds[0] ?? "";
  const effectiveEndCityId = cityIds.includes(endCityId) && endCityId !== effectiveStartCityId
    ? endCityId
    : [...cityIds].reverse().find((cityId) => cityId !== effectiveStartCityId) ?? "";
  const scheduleKey = `${departureDate}:${effectiveStartCityId}:${effectiveEndCityId}:${cityIds.join(",")}`;
  const routeStateKey = `${departureDate}:${effectiveStartCityId}:${effectiveEndCityId}:${cityIds.join(",")}`;
  const activeSchedule = scheduleResult?.key === scheduleKey ? scheduleResult : null;
  const visibleCitySearchResults = citySearchResultLocale === locale ? citySearchResults : [];
  const departureBounds = useMemo(() => {
    const base = new Date(initialTimestamp);
    const asDate = (offsetDays: number) => new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + offsetDays)).toISOString().slice(0, 10);
    return { minimum: asDate(-1), maximum: asDate(365) };
  }, [initialTimestamp]);
  const displayedCalculatedAt = restoredRoute?.key === routeStateKey
    ? restoredRoute.calculatedAt
    : activeSchedule?.calculatedAt ?? initialTimestamp;

  const itinerary = useMemo(() => {
    if (cityIds.length < 2 || selectedCities.length !== cityIds.length || new Set(cityIds).size !== cityIds.length) return null;
    if (
      restoredRoute?.key === routeStateKey &&
      restoredRoute.itinerary.legs.every(isVerifiedTransportLeg) &&
      cityIds.length <= 10
    ) return restoredRoute.itinerary;
    if (!activeSchedule?.candidateQueryComplete) return null;
    try {
      return optimizeVerifiedItinerary(cityIds, activeSchedule.legs, {
        startCityId: effectiveStartCityId,
        endCityId: effectiveEndCityId,
        cities: selectedCities,
      });
    } catch {
      return null;
    }
  }, [activeSchedule, cityIds, effectiveEndCityId, effectiveStartCityId, restoredRoute, routeStateKey, selectedCities]);

  useEffect(() => {
    const query = cityQuery.trim();
    if (!query) {
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setCitySearchLoading(true);
      setCitySearchError(false);
      try {
        const params = new URLSearchParams({ q: query, locale });
        const response = await fetch(`/api/cities/search?${params}`, { signal: controller.signal });
        if (!response.ok) throw new Error("city search unavailable");
        const data = await response.json() as { results?: CitySearchResult[] };
        setCitySearchResults(Array.isArray(data.results) ? data.results : []);
        setCitySearchResultLocale(locale);
      } catch (searchError) {
        if (searchError instanceof DOMException && searchError.name === "AbortError") return;
        setCitySearchResults([]);
        setCitySearchResultLocale(locale);
        setCitySearchError(true);
      } finally {
        if (!controller.signal.aborted) setCitySearchLoading(false);
      }
    }, 350);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [cityQuery, locale]);

  const selectedHasScheduled = Boolean(itinerary?.legs.some((leg) => leg.provenance.kind === "scheduled"));
  const selectedProvenanceKey = selectedHasScheduled ? "scheduled" : "observed";

  const updateCity = (index: number, cityId: string) => {
    setError("");
    if (cityIds.some((id, existingIndex) => id === cityId && existingIndex !== index)) {
      setError(translate(locale, "duplicateCity"));
      return;
    }
    const previousCityId = cityIds[index];
    if (startCityId === previousCityId) setStartCityId(cityId);
    if (endCityId === previousCityId) setEndCityId(cityId);
    setCityIds((items) => items.map((item, itemIndex) => itemIndex === index ? cityId : item));
  };

  const removeCity = (index: number) => {
    if (cityIds.length <= 2) return;
    const removedCityId = cityIds[index];
    const remainingCityIds = cityIds.filter((_, itemIndex) => itemIndex !== index);
    const nextStartCityId = removedCityId === startCityId || !remainingCityIds.includes(startCityId)
      ? remainingCityIds[0] ?? ""
      : startCityId;
    const nextEndCityId = removedCityId === endCityId
      || !remainingCityIds.includes(endCityId)
      || endCityId === nextStartCityId
      ? [...remainingCityIds].reverse().find((cityId) => cityId !== nextStartCityId) ?? ""
      : endCityId;
    setStartCityId(nextStartCityId);
    setEndCityId(nextEndCityId);
    setCityIds(remainingCityIds);
  };

  const moveCity = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= cityIds.length) return;
    setCityIds((items) => {
      const copy = [...items];
      [copy[index], copy[target]] = [copy[target], copy[index]];
      return copy;
    });
  };

  const addCity = () => {
    const next = CITIES.find((city) => !cityIds.includes(city.id));
    if (next) setCityIds((items) => [...items, next.id]);
  };

  const addSearchResult = async (result: CitySearchResult) => {
    if (addingCityIds.current.has(result.id)) return;
    addingCityIds.current.add(result.id);
    setAddingCityId(result.id);
    const localizationQuery = cityQuery.trim() || result.name;
    let localizedResult: CitySearchResult | undefined;
    try {
      const params = new URLSearchParams({ q: localizationQuery, locale, translations: "1", providerId: String(result.providerId) });
      const response = await fetch(`/api/cities/search?${params}`);
      if (response.ok) {
        const data = await response.json() as { results?: CitySearchResult[] };
        localizedResult = data.results?.find((candidate) => candidate.id === result.id);
      }
    } catch {
      // The selected provider label remains a safe proper-name fallback.
    }
    const neutralName = `${result.countryCode} ${result.latitude.toFixed(3)}, ${result.longitude.toFixed(3)}`;
    const localizedNames = localizedResult?.names ?? result.names ?? Object.freeze(Object.fromEntries(
      SUPPORTED_LOCALES.map((resultLocale) => [resultLocale, resultLocale === locale ? result.name : neutralName]),
    )) as City["names"];
    const city = cityFromSearchResult(result, localizedNames);
    if (cityIds.includes(city.id)) {
      addingCityIds.current.delete(result.id);
      setAddingCityId(null);
      return setError(translate(locale, "duplicateCity"));
    }
    if (!CITIES.some((catalogueCity) => catalogueCity.id === city.id)) {
      setExtraCities((items) => items.some((item) => item.id === city.id) ? items : [...items, city]);
    }
    setCityIds((items) => items.includes(city.id) ? items : [...items, city.id]);
    setCityQuery("");
    setCitySearchResults([]);
    setCitySearchResultLocale(null);
    addingCityIds.current.delete(result.id);
    setAddingCityId(null);
    setError("");
  };

  const calculate = async () => {
    if (cityIds.length < 2) return setError(translate(locale, "cityLimit"));
    setError("");
    setBusy(true);
    setCalculating(true);
    setRestoredRoute(null);
    try {
      const commonBody = {
        cityIds,
        startCityId: effectiveStartCityId,
        endCityId: effectiveEndCityId,
        cities: selectedCities.map((city) => ({
          id: city.id,
          latitude: city.coordinates.latitude,
          longitude: city.coordinates.longitude,
          timeZone: city.timeZone,
        })),
        departureDate,
      };
      const collectedLegs = new Map<string, TravelLeg>();
      let pairOffset = 0;
      let eligiblePairCount = Number.POSITIVE_INFINITY;
      let candidatePairCount = Number.POSITIVE_INFINITY;
      let queriedPairCount = 0;
      let unknownProviderFailures = false;
      let calculatedAt = new Date().toISOString();
      for (let batch = 0; batch < 1 && pairOffset < eligiblePairCount; batch += 1) {
        const response = await fetch("/api/routes/schedule", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...commonBody, pairOffset }),
        });
        if (!response.ok) throw new Error("schedule unavailable");
        const data = await response.json() as {
          legs?: TravelLeg[];
          missingPairs?: { reason?: string }[];
          calculatedAt?: string;
          requestSummary?: {
            requestedPairCount?: number;
            eligiblePairCount?: number;
            candidatePairCount?: number;
            nextPairOffset?: number | null;
          };
        };
        for (const leg of Array.isArray(data.legs) ? data.legs : []) {
          collectedLegs.set(`${leg.fromCityId}\u0000${leg.toCityId}`, leg);
        }
        const summary = data.requestSummary;
        const requested = summary?.requestedPairCount;
        const eligible = summary?.eligiblePairCount;
        const candidates = summary?.candidatePairCount;
        if (
          !Number.isSafeInteger(requested) ||
          !Number.isSafeInteger(eligible) ||
          !Number.isSafeInteger(candidates)
        ) {
          throw new Error("invalid schedule coverage");
        }
        queriedPairCount += requested as number;
        eligiblePairCount = eligible as number;
        candidatePairCount = candidates as number;
        unknownProviderFailures ||= Array.isArray(data.missingPairs) && data.missingPairs.some((missing) => missing.reason !== "no_itinerary");
        calculatedAt = typeof data.calculatedAt === "string" ? data.calculatedAt : calculatedAt;
        const next = summary?.nextPairOffset;
        if (next === null) {
          pairOffset = candidatePairCount;
          break;
        }
        if (!Number.isSafeInteger(next) || (next as number) <= pairOffset) break;
        pairOffset = next as number;
      }
      const coverage = evaluateScheduleCoverage({
        pairOffset,
        queriedPairCount,
        candidatePairCount,
        eligiblePairCount,
        unknownProviderFailures,
        cityCount: cityIds.length,
      });
      setScheduleResult({
        key: scheduleKey,
        legs: [...collectedLegs.values()],
        partial: !coverage.actualCoverage,
        ...coverage,
        calculatedAt,
      });
    } catch {
      setScheduleResult({ key: scheduleKey, legs: [], partial: true, actualCoverage: false, candidateQueryComplete: false, optimalityGuaranteed: false, calculatedAt: new Date().toISOString() });
    } finally {
      setBusy(false);
      setCalculating(false);
      window.requestAnimationFrame(() => document.getElementById("route-results")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  };

  useEffect(() => {
    if (!shouldRevalidateInitialSnapshot || initialRevalidationStarted.current) return;
    initialRevalidationStarted.current = true;
    void calculate();
    // calculate intentionally uses the immutable initial planner state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const snapshot = (): RouteSnapshot | null => itinerary ? {
    version: 3,
    name: `${routeCity(cityMap, itinerary.cityOrder[0]).names[locale]} → ${routeCity(cityMap, itinerary.cityOrder.at(-1) ?? itinerary.cityOrder[0]).names[locale]}`,
    departureDate,
    cityOrder: [...itinerary.cityOrder],
    totalMinutes: itinerary.totalMinutes,
    createdAt: new Date().toISOString(),
    provenance: itinerary.provenance.kind === "observed" ? "observed" : itinerary.provenance.kind === "scheduled" ? "scheduled" : "estimated",
    selectedCityIds: [...cityIds],
    startCityId: effectiveStartCityId,
    endCityId: effectiveEndCityId,
    optimizationMethod: activeSchedule?.optimalityGuaranteed ? "exact" : "heuristic",
    itinerary,
    cities: itinerary.cityOrder.map((cityId) => routeCity(cityMap, cityId)),
  } : null;

  const shareRoute = async () => {
    const data = snapshot();
    if (!data) return;
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("share", await encodeSnapshot(data));
    try {
      const copied = await copyShareUrl(url.toString());
      if (navigator.share && window.matchMedia("(max-width: 820px)").matches) {
        await navigator.share({ title: `Together · ${data.name}`, text: translate(locale, "optimizedOrder"), url: url.toString() });
      }
      onNotify(copied ? translate(locale, "copied") : url.toString(), copied ? "success" : "info");
    } catch (shareError) {
      if (shareError instanceof Error && shareError.name === "AbortError") return;
      const copied = await copyShareUrl(url.toString());
      onNotify(copied ? translate(locale, "copied") : url.toString(), copied ? "success" : "info");
    }
  };

  const downloadPdf = async () => {
    const target = document.getElementById("route-results");
    if (!target) return;
    setBusy(true);
    setPdfMode(true);
    try {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())));
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);
      const canvas = await html2canvas(target, { scale: 1.8, backgroundColor: "#ffffff", useCORS: true, ignoreElements: (element) => element.classList.contains("route-actions") });
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imageHeight = (canvas.height * pageWidth) / canvas.width;
      const imageData = canvas.toDataURL("image/jpeg", 0.9);
      let remaining = imageHeight;
      let offset = 0;
      pdf.addImage(imageData, "JPEG", 0, offset, pageWidth, imageHeight, undefined, "FAST");
      remaining -= pageHeight;
      while (remaining > 0) {
        offset = remaining - imageHeight;
        pdf.addPage();
        pdf.addImage(imageData, "JPEG", 0, offset, pageWidth, imageHeight, undefined, "FAST");
        remaining -= pageHeight;
      }
      pdf.save(`Together-${departureDate}.pdf`);
      onNotify(translate(locale, "pdfReady"), "success");
    } catch {
      onNotify(translate(locale, "pdfError"), "error");
    } finally {
      setPdfMode(false);
      setBusy(false);
    }
  };

  const saveTrip = async () => {
    const data = snapshot();
    if (!data) return;
    setBusy(true);
    const existing = readDeviceValue(DEVICE_TRIPS_KEY, parseDeviceTrips, []);
    if (existing.length >= MAX_DEVICE_TRIPS) {
      onNotify(translate(locale, "storageLimit"), "error");
      setBusy(false);
      return;
    }
    const next = [{ id: crypto.randomUUID(), name: data.name, payload: data, updatedAt: new Date().toISOString() }, ...existing];
    if (writeDeviceValue(DEVICE_TRIPS_KEY, next)) {
      onNotify(translate(locale, "saved"), "success");
      onTripSaved();
    } else {
      onNotify(translate(locale, "deviceSaveError"), "error");
    }
    setBusy(false);
  };

  return (
    <main className="route-page">
      <section className="route-hero">
        {/* Responsive WebP variants are pre-compressed and served directly by the PWA/worker. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="route-hero-image" src="/assets/eiffel-paris-hero.webp" srcSet="/assets/eiffel-paris-hero-mobile.webp 900w, /assets/eiffel-paris-hero.webp 1792w" sizes="(max-width: 820px) 100vw, 1500px" alt="" fetchPriority="high" aria-hidden="true" />
        <div className="route-hero-wash" aria-hidden="true" />
        <div className="route-intro">
          <div className="route-copy">
            <span className="travel-kicker">Together</span>
            <h1>{translate(locale, "routeTitle")}</h1>
          </div>
        </div>
      </section>

      <div className="planner-layout">
        <aside className="planner-controls" aria-label={translate(locale, "cities")}>
          <div className="section-heading"><h2>{translate(locale, "cities")}</h2><span>{cityIds.length}</span></div>
          <div className="city-list">
            {cityIds.map((cityId, index) => (
              <div className="city-control" key={`${cityId}-${index}`}>
                <GripVertical size={17} className="grip" aria-hidden="true" />
                <span className="city-index">{index + 1}</span>
                <label>
                  <span className="sr-only">{translate(locale, "cities")} {index + 1}</span>
                  <select value={cityId} onChange={(event) => updateCity(index, event.target.value)}>
                    {availableCities.map((city) => <option key={city.id} value={city.id}>{city.names[locale]} · {city.country.names[locale]}</option>)}
                  </select>
                </label>
                <span className="reorder-actions">
                  <button type="button" onClick={() => moveCity(index, -1)} disabled={index === 0} aria-label={translate(locale, "moveUp")}><ArrowUp size={15} /></button>
                  <button type="button" onClick={() => moveCity(index, 1)} disabled={index === cityIds.length - 1} aria-label={translate(locale, "moveDown")}><ArrowDown size={15} /></button>
                </span>
                <button className="remove-city" type="button" onClick={() => removeCity(index)} disabled={cityIds.length <= 2} aria-label={translate(locale, "remove")}><X size={17} /></button>
              </div>
            ))}
          </div>
          <button className="add-city" type="button" onClick={addCity}><Plus size={18} />{translate(locale, "addCity")}</button>
          <div className="world-city-search">
            <label>
              <span className="sr-only">{translate(locale, "searchWorldCities")}</span>
              <Search size={18} aria-hidden="true" />
              <input type="search" value={cityQuery} onChange={(event) => {
                const nextQuery = event.target.value;
                setCityQuery(nextQuery);
                // Never leave a result from the previous query clickable while
                // the debounced request for the new text is starting.
                setCitySearchResults([]);
                setCitySearchResultLocale(null);
                setCitySearchLoading(Boolean(nextQuery.trim()));
                setCitySearchError(false);
              }} placeholder={translate(locale, "citySearchPlaceholder")} autoComplete="off" />
              {citySearchLoading ? <RotateCcw className="spin" size={16} aria-label={translate(locale, "loading")} /> : null}
            </label>
            {visibleCitySearchResults.length > 0 ? (
              <ul className="city-search-results">
                {visibleCitySearchResults.map((result) => (
                  <li key={result.id}>
                    <button type="button" data-provider-id={result.providerId} onClick={() => addSearchResult(result)} disabled={addingCityId !== null} aria-busy={addingCityId === result.id}>
                      <strong>{result.name}</strong>
                      <span>{[result.admin1, result.country].filter(Boolean).join(" · ")}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : cityQuery.trim().length >= 1 && !citySearchLoading ? (
              <p className={citySearchError ? "city-search-status error" : "city-search-status"}>{translate(locale, citySearchError ? "citySearchError" : "noCityResults")}</p>
            ) : null}
            <small className="city-search-credit">{translate(locale, "citySearchHint")} <a href="https://open-meteo.com/en/docs/geocoding-api" target="_blank" rel="noreferrer">{translate(locale, "geocodingCredit")}</a> · <a href="https://www.wikidata.org/" target="_blank" rel="noreferrer">{translate(locale, "wikidataCredit")}</a></small>
          </div>
          <label className="field-row date-field"><span><CalendarDays size={18} />{translate(locale, "departure")}</span><input type="date" min={departureBounds.minimum} max={departureBounds.maximum} value={departureDate} onChange={(event) => setDepartureDate(event.target.value)} /></label>
          <div className="endpoint-fields">
            <label><span>{translate(locale, "startCity")}</span><select value={effectiveStartCityId} onChange={(event) => { const next = event.target.value; setStartCityId(next); if (next === effectiveEndCityId) setEndCityId(cityIds.find((cityId) => cityId !== next) ?? ""); }}>{selectedCities.map((city) => <option key={city.id} value={city.id}>{city.names[locale]}</option>)}</select></label>
            <label><span>{translate(locale, "endCity")}</span><select value={effectiveEndCityId} onChange={(event) => { const next = event.target.value; setEndCityId(next); if (next === effectiveStartCityId) setStartCityId(cityIds.find((cityId) => cityId !== next) ?? ""); }}>{selectedCities.map((city) => <option key={city.id} value={city.id}>{city.names[locale]}</option>)}</select></label>
          </div>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <button className="primary-action find-route" type="button" onClick={calculate} disabled={busy}>{calculating ? <RotateCcw className="spin" size={19} /> : <MapPin size={19} />}{translate(locale, calculating ? "scheduleLoading" : "findRoute")}</button>
          {activeSchedule ? <p className={itinerary ? "schedule-feedback success" : "schedule-feedback"}>{translate(locale, itinerary ? "scheduleFound" : "verifiedRouteUnavailable")}</p> : null}
        </aside>

        {itinerary ? (
          <section className="route-results" id="route-results" aria-live="polite">
            <div className="result-heading">
              <div><h2>{translate(locale, "optimizedOrder")}</h2><p>{translate(locale, activeSchedule?.optimalityGuaranteed ? "exactOptimization" : "fastApproximation")}</p></div>
              <span className="provenance-state"><Database size={15} />{translate(locale, selectedProvenanceKey)}</span>
            </div>
            <div className="order-rail" aria-label={translate(locale, "optimizedOrder")}>
              {itinerary.cityOrder.map((cityId, index) => (
                <div className="order-city" key={cityId}><span>{index + 1}</span><strong>{routeCity(cityMap, cityId).names[locale]}</strong>{index < itinerary.cityOrder.length - 1 ? <i aria-hidden="true">→</i> : null}</div>
              ))}
            </div>
            <RouteMap key={`${itinerary.cityOrder.join("|")}|${itinerary.legs.map((leg) => leg.id).join("|")}`} itinerary={itinerary} locale={locale} cities={cityMap} />
            <div className="route-summary">
              <div><Clock3 size={22} /><span>{translate(locale, "totalTravel")}<strong>{formatDuration(itinerary.totalMinutes, locale)}</strong></span></div>
              <div><MapPin size={22} /><span>{itinerary.legs.length}<strong>{translate(locale, "legs")}</strong></span></div>
              <div className="summary-source"><Database size={22} /><span>{translate(locale, "dataSource")}<strong>{translate(locale, selectedProvenanceKey)}</strong></span></div>
            </div>
            <div className="legs-list">
              {itinerary.legs.map((leg, index) => <LegRow key={leg.id} leg={leg} index={index} locale={locale} cities={cityMap} forceExpanded={pdfMode} />)}
            </div>
            <p className="provider-note"><AlertTriangle size={16} />{translate(locale, "providerRequired")} <a href="https://transitous.org/sources/" target="_blank" rel="noreferrer">{translate(locale, "transitDataCredit")}</a><span>{translate(locale, "dataUpdated")}: {formatDateTime(displayedCalculatedAt, locale)}</span></p>
            <div className="route-actions">
              <button type="button" onClick={shareRoute}><Share2 size={18} />{translate(locale, "share")}</button>
              <button type="button" onClick={downloadPdf} disabled={busy}><FileDown size={18} />{translate(locale, "pdf")}</button>
              <button className="save-route" type="button" onClick={saveTrip} disabled={busy}><Bookmark size={18} />{translate(locale, "save")}</button>
            </div>
          </section>
        ) : activeSchedule ? (
          <section className="route-results route-unavailable" id="route-results" aria-live="polite">
            <AlertTriangle size={28} aria-hidden="true" />
            <h2>{translate(locale, "verifiedRouteUnavailable")}</h2>
            <p>{translate(locale, "verifiedRouteUnavailableHelp")}</p>
          </section>
        ) : null}
      </div>
    </main>
  );
}
