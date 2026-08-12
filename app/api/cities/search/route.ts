const OPEN_METEO_GEOCODING_URL =
  "https://geocoding-api.open-meteo.com/v1/search";
const OPEN_METEO_CITY_URL =
  "https://geocoding-api.open-meteo.com/v1/get";
const OPEN_METEO_ATTRIBUTION_URL =
  "https://open-meteo.com/en/docs/geocoding-api";
const GEONAMES_ATTRIBUTION_URL = "https://www.geonames.org/";

export const CITY_SEARCH_MAX_RESULTS = 8;
export const CITY_SEARCH_CACHE_TTL_SECONDS = 6 * 60 * 60;
export const CITY_SEARCH_PROVIDER_TIMEOUT_MS = 5_000;
export const CITY_SEARCH_RATE_LIMIT_REQUESTS = 30;
export const CITY_SEARCH_RATE_LIMIT_WINDOW_SECONDS = 60;

const PROVIDER_CANDIDATE_COUNT = 20;
const MAX_CACHE_ENTRIES = 256;
const MAX_RATE_LIMIT_ENTRIES = 4_096;

export type CitySearchLocale = "ko" | "en" | "fr" | "ja" | "zh";
const CITY_SEARCH_LOCALES: readonly CitySearchLocale[] = ["ko", "en", "fr", "ja", "zh"];

export interface CitySearchResult {
  readonly id: string;
  readonly providerId: number;
  readonly name: string;
  readonly country: string;
  readonly countryCode: string;
  readonly admin1?: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly timeZone: string;
  readonly population?: number;
}

export type ParsedCitySearchQuery =
  | {
      readonly ok: true;
      readonly query: string;
      readonly locale: CitySearchLocale;
      readonly includeTranslations: boolean;
      readonly providerId?: number;
    }
  | {
      readonly ok: false;
      readonly message: string;
    };

interface CacheEntry {
  readonly expiresAt: number;
  readonly promise: Promise<readonly CitySearchResult[]>;
}

interface CityCacheEntry {
  readonly expiresAt: number;
  readonly promise: Promise<CitySearchResult>;
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

const searchCache = new Map<string, CacheEntry>();
const cityCache = new Map<string, CityCacheEntry>();
const rateLimits = new Map<string, RateLimitEntry>();

const LOCALE_ALIASES: Readonly<Record<string, CitySearchLocale>> = {
  ko: "ko",
  "ko-kr": "ko",
  en: "en",
  "en-us": "en",
  "en-gb": "en",
  fr: "fr",
  "fr-fr": "fr",
  ja: "ja",
  "ja-jp": "ja",
  zh: "zh",
  "zh-cn": "zh",
  "zh-hans": "zh",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function boundedText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function normalizeLocale(value: string | null): CitySearchLocale | null {
  if (!value) return "en";
  return LOCALE_ALIASES[value.trim().toLowerCase()] ?? null;
}

export function parseCitySearchQuery(
  searchParams: URLSearchParams,
): ParsedCitySearchQuery {
  const query = searchParams.get("q")?.trim() ?? "";
  if (query.length < 2 || query.length > 80) {
    return {
      ok: false,
      message: "q must contain between 2 and 80 characters.",
    };
  }
  const locale = normalizeLocale(searchParams.get("locale"));
  if (!locale) {
    return {
      ok: false,
      message: "locale must be ko, en, fr, ja, or zh.",
    };
  }
  const includeTranslations = searchParams.get("translations") === "1";
  const providerIdText = searchParams.get("providerId")?.trim();
  let providerId: number | undefined;
  if (providerIdText !== undefined) {
    providerId = Number(providerIdText);
    if (!/^\d+$/.test(providerIdText) || !Number.isSafeInteger(providerId) || providerId <= 0) {
      return { ok: false, message: "providerId must be a positive integer." };
    }
  }
  if (includeTranslations && providerId === undefined) {
    return { ok: false, message: "providerId is required when translations=1." };
  }
  return {
    ok: true,
    query,
    locale,
    includeTranslations,
    ...(providerId === undefined ? {} : { providerId }),
  };
}

const LATIN_SCRIPT = /\p{Script=Latin}/u;
const HANGUL_SCRIPT = /\p{Script=Hangul}/u;
const JAPANESE_SCRIPT = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;
const HAN_SCRIPT = /\p{Script=Han}/u;

function usesLocaleScript(value: string, locale: CitySearchLocale): boolean {
  if (locale === "ko") return HANGUL_SCRIPT.test(value);
  if (locale === "ja") return JAPANESE_SCRIPT.test(value);
  if (locale === "zh") return HAN_SCRIPT.test(value);
  return LATIN_SCRIPT.test(value);
}

export function neutralCityLabel(city: Pick<CitySearchResult, "countryCode" | "latitude" | "longitude">): string {
  return `${city.countryCode} ${city.latitude.toFixed(3)}, ${city.longitude.toFixed(3)}`;
}

export function safeLocalizedCityName(
  name: string,
  locale: CitySearchLocale,
  city: Pick<CitySearchResult, "countryCode" | "latitude" | "longitude">,
): string {
  return usesLocaleScript(name, locale) ? name : neutralCityLabel(city);
}

function localizedCountryName(countryCode: string, locale: CitySearchLocale): string {
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(countryCode) ?? countryCode;
  } catch {
    return countryCode;
  }
}

function sanitizeCityForLocale(city: CitySearchResult, locale: CitySearchLocale): CitySearchResult {
  const admin1 = city.admin1 && usesLocaleScript(city.admin1, locale) ? city.admin1 : undefined;
  return {
    ...city,
    name: safeLocalizedCityName(city.name, locale, city),
    country: localizedCountryName(city.countryCode, locale),
    ...(admin1 ? { admin1 } : { admin1: undefined }),
  };
}

function parseProviderCity(value: unknown): CitySearchResult | null {
  if (!isRecord(value)) return null;

  const providerId = finiteNumber(value.id);
  const name = boundedText(value.name, 200);
  const country = boundedText(value.country, 200);
  const countryCode = boundedText(value.country_code, 2)?.toUpperCase() ?? null;
  const featureCode = boundedText(value.feature_code, 20)?.toUpperCase() ?? null;
  const latitude = finiteNumber(value.latitude);
  const longitude = finiteNumber(value.longitude);
  const timeZone = boundedText(value.timezone, 100);

  if (
    providerId === null ||
    !Number.isInteger(providerId) ||
    providerId <= 0 ||
    !name ||
    !country ||
    !countryCode ||
    !/^[A-Z]{2}$/.test(countryCode) ||
    !featureCode?.startsWith("P") ||
    latitude === null ||
    latitude < -90 ||
    latitude > 90 ||
    longitude === null ||
    longitude < -180 ||
    longitude > 180 ||
    !timeZone
  ) {
    return null;
  }

  const admin1 = boundedText(value.admin1, 200) ?? undefined;
  const rawPopulation = finiteNumber(value.population);
  const population =
    rawPopulation !== null &&
    Number.isInteger(rawPopulation) &&
    rawPopulation >= 0
      ? rawPopulation
      : undefined;

  return {
    id: `open-meteo:${providerId}`,
    providerId,
    name,
    country,
    countryCode,
    ...(admin1 ? { admin1 } : {}),
    latitude,
    longitude,
    timeZone,
    ...(population === undefined ? {} : { population }),
  };
}

/**
 * Pure parser kept separate from network access so provider payload changes can
 * be checked with deterministic fixtures. Non-populated-place GeoNames feature
 * codes are intentionally excluded.
 */
export function parseOpenMeteoGeocodingResponse(
  value: unknown,
): readonly CitySearchResult[] | null {
  if (!isRecord(value)) return null;
  if (value.results === undefined) return [];
  if (!Array.isArray(value.results)) return null;

  const seen = new Set<string>();
  const results: CitySearchResult[] = [];
  for (const candidate of value.results) {
    const parsed = parseProviderCity(candidate);
    if (!parsed || seen.has(parsed.id)) continue;
    seen.add(parsed.id);
    results.push(parsed);
    if (results.length === CITY_SEARCH_MAX_RESULTS) break;
  }
  return results;
}

export function parseOpenMeteoCityResponse(value: unknown): CitySearchResult | null {
  return parseProviderCity(value);
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
  return candidate && (isValidIpv4(candidate) || isValidIpv6(candidate))
    ? candidate.toLowerCase()
    : null;
}

export function parseCitySearchClientIp(request: Request): string {
  return (
    firstValidHeaderIp(request.headers.get("cf-connecting-ip")) ??
    firstValidHeaderIp(request.headers.get("x-forwarded-for")) ??
    "unknown"
  );
}

function pruneRateLimits(now: number): void {
  const windowMs = CITY_SEARCH_RATE_LIMIT_WINDOW_SECONDS * 1_000;
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

function consumeRateLimit(clientIp: string, cost = 1, now = Date.now()): RateLimitResult {
  const windowMs = CITY_SEARCH_RATE_LIMIT_WINDOW_SECONDS * 1_000;
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
  if (entry.count + cost > CITY_SEARCH_RATE_LIMIT_REQUESTS) {
    return { allowed: false, remaining: 0, resetAt, retryAfterSeconds };
  }
  entry.count += cost;
  return {
    allowed: true,
    remaining: CITY_SEARCH_RATE_LIMIT_REQUESTS - entry.count,
    resetAt,
    retryAfterSeconds,
  };
}

function rateLimitHeaders(rateLimit: RateLimitResult): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(CITY_SEARCH_RATE_LIMIT_REQUESTS),
    "X-RateLimit-Remaining": String(rateLimit.remaining),
    "X-RateLimit-Reset": String(Math.ceil(rateLimit.resetAt / 1_000)),
  };
}

function pruneCache(now: number): void {
  for (const [key, entry] of searchCache) {
    if (entry.expiresAt <= now) searchCache.delete(key);
  }
  while (searchCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = searchCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    searchCache.delete(oldestKey);
  }
  for (const [key, entry] of cityCache) {
    if (entry.expiresAt <= now) cityCache.delete(key);
  }
  while (cityCache.size >= MAX_CACHE_ENTRIES * CITY_SEARCH_LOCALES.length) {
    const oldestKey = cityCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    cityCache.delete(oldestKey);
  }
}

async function requestProvider(
  query: string,
  locale: CitySearchLocale,
): Promise<readonly CitySearchResult[]> {
  const search = new URLSearchParams({
    name: query,
    count: String(PROVIDER_CANDIDATE_COUNT),
    language: locale,
    format: "json",
  });
  const response = await fetch(`${OPEN_METEO_GEOCODING_URL}?${search}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(CITY_SEARCH_PROVIDER_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error("provider_unavailable");
  const parsed = parseOpenMeteoGeocodingResponse(await response.json());
  if (!parsed) throw new Error("invalid_provider_response");
  return parsed.map((city) => sanitizeCityForLocale(city, locale));
}

async function requestProviderCity(
  providerId: number,
  locale: CitySearchLocale,
): Promise<CitySearchResult> {
  const search = new URLSearchParams({ id: String(providerId), language: locale });
  const response = await fetch(`${OPEN_METEO_CITY_URL}?${search}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(CITY_SEARCH_PROVIDER_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error("provider_unavailable");
  const parsed = parseOpenMeteoCityResponse(await response.json());
  if (!parsed || parsed.providerId !== providerId) throw new Error("invalid_provider_response");
  return sanitizeCityForLocale(parsed, locale);
}

async function lookupCity(
  providerId: number,
  locale: CitySearchLocale,
): Promise<CitySearchResult> {
  const now = Date.now();
  const cacheKey = `${providerId}|${locale}`;
  const cached = cityCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.promise;
  pruneCache(now);
  const promise = requestProviderCity(providerId, locale);
  cityCache.set(cacheKey, {
    expiresAt: now + CITY_SEARCH_CACHE_TTL_SECONDS * 1_000,
    promise,
  });
  try {
    return await promise;
  } catch (error) {
    cityCache.delete(cacheKey);
    throw error;
  }
}

async function lookupCities(
  query: string,
  locale: CitySearchLocale,
): Promise<{ readonly results: readonly CitySearchResult[]; readonly cacheHit: boolean }> {
  const now = Date.now();
  const cacheKey = `${locale}|${query.toLocaleLowerCase(locale)}`;
  const cached = searchCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return { results: await cached.promise, cacheHit: true };
  }

  pruneCache(now);
  const promise = requestProvider(query, locale);
  searchCache.set(cacheKey, {
    expiresAt: now + CITY_SEARCH_CACHE_TTL_SECONDS * 1_000,
    promise,
  });
  try {
    return { results: await promise, cacheHit: false };
  } catch (error) {
    searchCache.delete(cacheKey);
    throw error;
  }
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  headers: Record<string, string> = {},
): Response {
  return Response.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store", ...headers } },
  );
}

function providerError(error: unknown): Response {
  if (
    error instanceof DOMException &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  ) {
    return errorResponse(
      504,
      "geocoding_provider_timeout",
      "The city search provider did not respond in time.",
    );
  }
  const code = error instanceof Error ? error.message : "";
  if (code === "invalid_provider_response") {
    return errorResponse(
      502,
      "invalid_geocoding_provider_response",
      "The city search provider returned an invalid response.",
    );
  }
  return errorResponse(
    502,
    "geocoding_provider_unavailable",
    "The city search provider is temporarily unavailable.",
  );
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const validated = parseCitySearchQuery(url.searchParams);
  if (!validated.ok) {
    return errorResponse(400, "invalid_city_search_query", validated.message);
  }

  // A five-language hydration may fan out to five provider lookups. Charge
  // that full cost so one client cannot multiply the no-key upstream quota.
  const requestCost = validated.includeTranslations ? CITY_SEARCH_LOCALES.length : 1;
  const rateLimit = consumeRateLimit(parseCitySearchClientIp(request), requestCost);
  if (!rateLimit.allowed) {
    return errorResponse(
      429,
      "city_search_rate_limit_exceeded",
      `At most ${CITY_SEARCH_RATE_LIMIT_REQUESTS} city-provider lookup units are allowed per minute.`,
      {
        "Retry-After": String(rateLimit.retryAfterSeconds),
        ...rateLimitHeaders(rateLimit),
      },
    );
  }

  try {
    const lookup = validated.includeTranslations ? null : await lookupCities(validated.query, validated.locale);
    const localizedLookups = validated.includeTranslations
      ? await Promise.allSettled(CITY_SEARCH_LOCALES.map((locale) => lookupCity(validated.providerId!, locale)))
      : [];
    const fulfilled = localizedLookups.flatMap((result, index) => result.status === "fulfilled"
      ? [{ locale: CITY_SEARCH_LOCALES[index], city: result.value }]
      : []);
    if (validated.includeTranslations && fulfilled.length === 0) throw new Error("provider_unavailable");
    const source = fulfilled.find(({ locale }) => locale === validated.locale)?.city ?? fulfilled[0]?.city;
    const names = source ? Object.fromEntries(CITY_SEARCH_LOCALES.map((locale) => {
      const localized = fulfilled.find((entry) => entry.locale === locale)?.city;
      return [locale, localized?.name ?? neutralCityLabel(source)];
    })) as Readonly<Record<CitySearchLocale, string>> : undefined;
    const results = source && names
      ? [{ ...source, name: names[validated.locale], country: localizedCountryName(source.countryCode, validated.locale), admin1: undefined, names }]
      : lookup?.results ?? [];
    return Response.json(
      {
        results,
        meta: {
          query: validated.query,
          locale: validated.locale,
          resultCount: results.length,
          cacheHit: lookup?.cacheHit ?? false,
          translationsIncluded: validated.includeTranslations,
          requestCost,
          provider: "open-meteo-geocoding",
          dataset: "GeoNames",
          attribution: {
            label: "GeoNames via Open-Meteo",
            providerUrl: OPEN_METEO_ATTRIBUTION_URL,
            datasetUrl: GEONAMES_ATTRIBUTION_URL,
          },
          // This describes the current integration accurately. It is not a
          // claim that the open endpoint is licensed for commercial traffic.
          usage: {
            tier: "open-access-no-key-non-commercial-beta",
            notice:
              "No-key Open-Meteo access is used for Together's current non-commercial beta. Commercial production use requires a separate provider plan and terms review.",
          },
        },
      },
      {
        headers: {
          // Rate-limit headers are client-specific; provider data is cached in
          // the worker map, while this response stays out of shared HTTP caches.
          "Cache-Control": "private, max-age=300",
          ...rateLimitHeaders(rateLimit),
        },
      },
    );
  } catch (error) {
    const response = providerError(error);
    for (const [key, value] of Object.entries(rateLimitHeaders(rateLimit))) {
      response.headers.set(key, value);
    }
    return response;
  }
}
