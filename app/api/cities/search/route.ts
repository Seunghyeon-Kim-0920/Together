const OPEN_METEO_GEOCODING_URL =
  "https://geocoding-api.open-meteo.com/v1/search";
const OPEN_METEO_CITY_URL =
  "https://geocoding-api.open-meteo.com/v1/get";
const OPEN_METEO_ATTRIBUTION_URL =
  "https://open-meteo.com/en/docs/geocoding-api";
const GEONAMES_ATTRIBUTION_URL = "https://www.geonames.org/";
const WIKIDATA_API_URL = "https://www.wikidata.org/w/api.php";
const WIKIMEDIA_API_USER_AGENT =
  "Together/0.5 (+https://github.com/Seunghyeon-Kim-0920/Together)";

export const CITY_SEARCH_MAX_RESULTS = 8;
export const CITY_SEARCH_CACHE_TTL_SECONDS = 6 * 60 * 60;
export const CITY_SEARCH_PROVIDER_TIMEOUT_MS = 5_000;
export const CITY_SEARCH_MAX_PROVIDER_RESPONSE_BYTES = 512_000;
export const CITY_SEARCH_RATE_LIMIT_REQUESTS = 30;
export const CITY_SEARCH_RATE_LIMIT_WINDOW_SECONDS = 60;

const PROVIDER_CANDIDATE_COUNT = 20;
const CROSS_LANGUAGE_PROVIDER_HYDRATION_LIMIT = 2;
const WIKIDATA_ENTITY_LIMIT = 2;
// Two alias searches, one labels batch, two P1566/city validations, and one
// bounded P625 coordinate rematch stay below this composite upstream quota.
const WIKIDATA_FALLBACK_RATE_COST = 12;
// One UI-locale search preserves homonyms; one input-language search verifies
// canonical alias ordering. Missing localized IDs are charged only if hydrated.
const CROSS_LANGUAGE_PROVIDER_RATE_COST = 2;
const WIKIDATA_NEGATIVE_CACHE_TTL_SECONDS = 5 * 60;
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
  readonly names?: Readonly<Record<CitySearchLocale, string>>;
}

type LocalizedCityNames = Readonly<Record<CitySearchLocale, string>>;

interface KnownCity {
  readonly providerId: number;
  readonly names: LocalizedCityNames;
  readonly aliases: readonly string[];
}

// Stable GeoNames populated-place IDs protect short and translated aliases
// from a provider search endpoint that otherwise treats them as loose prefixes.
const KNOWN_CITIES: readonly KnownCity[] = Object.freeze([
  Object.freeze({
    providerId: 2735943,
    names: Object.freeze({ ko: "포르투", en: "Porto", fr: "Porto", ja: "ポルト", zh: "波尔图" }),
    aliases: Object.freeze(["포르투", "porto", "ポルト", "波尔图", "波爾圖"]),
  }),
  Object.freeze({
    providerId: 2761369,
    names: Object.freeze({ ko: "빈", en: "Vienna", fr: "Vienne", ja: "ウィーン", zh: "维也纳" }),
    aliases: Object.freeze(["빈", "vienna", "wien", "vienne", "ウィーン", "维也纳", "維也納"]),
  }),
]);

function normalizeCityAlias(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase();
}

export function knownCityProviderIds(query: string): readonly number[] {
  const normalized = normalizeCityAlias(query);
  if (!normalized) return [];
  return KNOWN_CITIES.filter((city) => city.aliases.some((alias) => {
    const normalizedAlias = normalizeCityAlias(alias);
    return normalizedAlias === normalized;
  })).map((city) => city.providerId);
}

function knownNames(providerId: number): LocalizedCityNames | undefined {
  return KNOWN_CITIES.find((city) => city.providerId === providerId)?.names;
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

interface WikidataCacheEntry {
  readonly expiresAt: number;
  readonly promise: Promise<readonly CitySearchResult[]>;
}

interface NamesCacheEntry {
  readonly expiresAt: number;
  readonly names: LocalizedCityNames;
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
const inputLanguageSearchCache = new Map<string, CacheEntry>();
const cityCache = new Map<string, CityCacheEntry>();
const wikidataCache = new Map<string, WikidataCacheEntry>();
const wikidataNamesCache = new Map<number, NamesCacheEntry>();
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
  if ([...query].length < 1 || query.length > 80) {
    return {
      ok: false,
      message: "q must contain between 1 and 80 characters.",
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
const JAPANESE_KANA_SCRIPT = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const HAN_SCRIPT = /\p{Script=Han}/u;
const GREEK_SCRIPT = /\p{Script=Greek}/u;
const CYRILLIC_SCRIPT = /\p{Script=Cyrillic}/u;
const ARABIC_SCRIPT = /\p{Script=Arabic}/u;
const HEBREW_SCRIPT = /\p{Script=Hebrew}/u;
const DEVANAGARI_SCRIPT = /\p{Script=Devanagari}/u;
const BENGALI_SCRIPT = /\p{Script=Bengali}/u;
const THAI_SCRIPT = /\p{Script=Thai}/u;
const ARMENIAN_SCRIPT = /\p{Script=Armenian}/u;
const GEORGIAN_SCRIPT = /\p{Script=Georgian}/u;
const ETHIOPIC_SCRIPT = /\p{Script=Ethiopic}/u;
const TAMIL_SCRIPT = /\p{Script=Tamil}/u;
const TELUGU_SCRIPT = /\p{Script=Telugu}/u;
const KANNADA_SCRIPT = /\p{Script=Kannada}/u;
const MALAYALAM_SCRIPT = /\p{Script=Malayalam}/u;
const KHMER_SCRIPT = /\p{Script=Khmer}/u;
const LAO_SCRIPT = /\p{Script=Lao}/u;
const MYANMAR_SCRIPT = /\p{Script=Myanmar}/u;
const TWO_HAN_CHARACTERS = /^\p{Script=Han}{2}$/u;
const COMBINING_MARKS = /\p{Mark}+/gu;
const NON_LETTER_OR_NUMBER = /[^\p{Letter}\p{Number}]+/gu;

function normalizedCitySearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .toLocaleLowerCase()
    .replace(NON_LETTER_OR_NUMBER, "");
}

export function providerCityNameMatchesQuery(query: string, cityName: string): boolean {
  const normalizedQuery = normalizedCitySearchText(query);
  return normalizedQuery.length > 0
    && normalizedQuery === normalizedCitySearchText(cityName);
}

function usesLocaleScript(value: string, locale: CitySearchLocale): boolean {
  if (locale === "ko") return HANGUL_SCRIPT.test(value);
  if (locale === "ja") return JAPANESE_SCRIPT.test(value);
  if (locale === "zh") return HAN_SCRIPT.test(value);
  return LATIN_SCRIPT.test(value);
}

export function japaneseCityFallbackQueries(
  query: string,
  locale: CitySearchLocale,
): readonly string[] {
  if (locale !== "ja" || !TWO_HAN_CHARACTERS.test(query)) return [];
  return [`${query}市`, `${query}都`];
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
  for (const [key, entry] of inputLanguageSearchCache) {
    if (entry.expiresAt <= now) inputLanguageSearchCache.delete(key);
  }
  while (inputLanguageSearchCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = inputLanguageSearchCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    inputLanguageSearchCache.delete(oldestKey);
  }
  for (const [key, entry] of cityCache) {
    if (entry.expiresAt <= now) cityCache.delete(key);
  }
  while (cityCache.size >= MAX_CACHE_ENTRIES * CITY_SEARCH_LOCALES.length) {
    const oldestKey = cityCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    cityCache.delete(oldestKey);
  }
  for (const [key, entry] of wikidataCache) {
    if (entry.expiresAt <= now) wikidataCache.delete(key);
  }
  while (wikidataCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = wikidataCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    wikidataCache.delete(oldestKey);
  }
  for (const [providerId, entry] of wikidataNamesCache) {
    if (entry.expiresAt <= now) wikidataNamesCache.delete(providerId);
  }
}

async function readBoundedProviderJson(
  response: Response,
  signal: AbortSignal,
): Promise<unknown> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) {
      throw new Error("invalid_provider_content_length");
    }
    const declaredBytes = Number(declaredLength);
    if (
      !Number.isSafeInteger(declaredBytes) ||
      declaredBytes > CITY_SEARCH_MAX_PROVIDER_RESPONSE_BYTES
    ) {
      throw new Error("provider_response_too_large");
    }
  }
  if (!response.body) throw new Error("provider_response_missing");

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let totalBytes = 0;
  let text = "";
  try {
    while (true) {
      if (signal.aborted) {
        throw signal.reason ?? new DOMException("Provider request aborted.", "AbortError");
      }
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > CITY_SEARCH_MAX_PROVIDER_RESPONSE_BYTES) {
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

async function requestProviderInLanguage(
  query: string,
  providerLanguage: string,
): Promise<readonly CitySearchResult[]> {
  const search = new URLSearchParams({
    name: query,
    count: String(PROVIDER_CANDIDATE_COUNT),
    language: providerLanguage,
    format: "json",
  });
  const signal = AbortSignal.timeout(CITY_SEARCH_PROVIDER_TIMEOUT_MS);
  const response = await fetch(`${OPEN_METEO_GEOCODING_URL}?${search}`, {
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) throw new Error("provider_unavailable");
  const parsed = parseOpenMeteoGeocodingResponse(
    await readBoundedProviderJson(response, signal),
  );
  if (!parsed) throw new Error("invalid_provider_response");
  return parsed;
}

async function requestProvider(
  query: string,
  locale: CitySearchLocale,
): Promise<readonly CitySearchResult[]> {
  const results = await requestProviderInLanguage(query, locale);
  return results.map((city) => sanitizeCityForLocale(city, locale));
}

async function requestProviderCity(
  providerId: number,
  locale: CitySearchLocale,
): Promise<CitySearchResult> {
  const search = new URLSearchParams({ id: String(providerId), language: locale });
  const signal = AbortSignal.timeout(CITY_SEARCH_PROVIDER_TIMEOUT_MS);
  const response = await fetch(`${OPEN_METEO_CITY_URL}?${search}`, {
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) throw new Error("provider_unavailable");
  const parsed = parseOpenMeteoCityResponse(
    await readBoundedProviderJson(response, signal),
  );
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

async function lookupCitiesInProviderLanguage(
  query: string,
  providerLanguage: string,
): Promise<{ readonly results: readonly CitySearchResult[]; readonly cacheHit: boolean }> {
  const now = Date.now();
  const cacheKey = `${providerLanguage}|${normalizeCityAlias(query)}`;
  const cached = inputLanguageSearchCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return { results: await cached.promise, cacheHit: true };
  }

  pruneCache(now);
  const promise = requestProviderInLanguage(query, providerLanguage);
  inputLanguageSearchCache.set(cacheKey, {
    expiresAt: now + CITY_SEARCH_CACHE_TTL_SECONDS * 1_000,
    promise,
  });
  try {
    return { results: await promise, cacheHit: false };
  } catch (error) {
    inputLanguageSearchCache.delete(cacheKey);
    throw error;
  }
}

async function localizeProviderCandidates(
  candidates: readonly CitySearchResult[],
  locale: CitySearchLocale,
): Promise<readonly CitySearchResult[]> {
  const settled = await Promise.allSettled(
    candidates
      .slice(0, CROSS_LANGUAGE_PROVIDER_HYDRATION_LIMIT)
      .map((city) => lookupCity(city.providerId, locale)),
  );
  return settled.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
}

async function lookupKnownCities(
  query: string,
  locale: CitySearchLocale,
): Promise<readonly CitySearchResult[]> {
  const providerIds = knownCityProviderIds(query);
  if (providerIds.length === 0) return [];
  const settled = await Promise.allSettled(providerIds.map((providerId) => lookupCity(providerId, locale)));
  return settled.flatMap((result) => {
    if (result.status !== "fulfilled") return [];
    const names = knownNames(result.value.providerId);
    return [{ ...result.value, name: names?.[locale] ?? result.value.name, names }];
  });
}

function wikidataEntityIds(value: unknown): readonly string[] {
  if (!isRecord(value) || !Array.isArray(value.search)) return [];
  return value.search.flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    const id = boundedText(candidate.id, 24);
    return id && /^Q[1-9]\d*$/.test(id) ? [id] : [];
  }).slice(0, WIKIDATA_ENTITY_LIMIT);
}

export function wikidataSearchLocales(
  query: string,
  interfaceLocale: CitySearchLocale,
): readonly string[] {
  if (HANGUL_SCRIPT.test(query)) return ["ko"];
  if (JAPANESE_KANA_SCRIPT.test(query)) return ["ja"];
  if (HAN_SCRIPT.test(query)) {
    return interfaceLocale === "zh" ? ["zh", "ja"] : ["ja", "zh"];
  }
  if (GREEK_SCRIPT.test(query)) return ["el"];
  if (CYRILLIC_SCRIPT.test(query)) return ["ru", "uk"];
  if (ARABIC_SCRIPT.test(query)) return ["ar"];
  if (HEBREW_SCRIPT.test(query)) return ["he"];
  if (DEVANAGARI_SCRIPT.test(query)) return ["hi"];
  if (BENGALI_SCRIPT.test(query)) return ["bn"];
  if (THAI_SCRIPT.test(query)) return ["th"];
  if (ARMENIAN_SCRIPT.test(query)) return ["hy"];
  if (GEORGIAN_SCRIPT.test(query)) return ["ka"];
  if (ETHIOPIC_SCRIPT.test(query)) return ["am"];
  if (TAMIL_SCRIPT.test(query)) return ["ta"];
  if (TELUGU_SCRIPT.test(query)) return ["te"];
  if (KANNADA_SCRIPT.test(query)) return ["kn"];
  if (MALAYALAM_SCRIPT.test(query)) return ["ml"];
  if (KHMER_SCRIPT.test(query)) return ["km"];
  if (LAO_SCRIPT.test(query)) return ["lo"];
  if (MYANMAR_SCRIPT.test(query)) return ["my"];
  if (LATIN_SCRIPT.test(query)) {
    return interfaceLocale === "fr" ? ["fr", "en"] : ["en", "fr"];
  }
  return [...new Set([interfaceLocale, "en"])];
}

/**
 * Search language follows the user's input script, while response labels keep
 * following the selected Together interface locale. This is intentionally
 * independent of the five UI locales so names written in Greek, Cyrillic,
 * Arabic, Indic, and other common scripts can still reach the provider index.
 */
export function cityProviderSearchLocales(
  query: string,
  interfaceLocale: CitySearchLocale,
): readonly string[] {
  if (usesLocaleScript(query, interfaceLocale)) return [interfaceLocale];
  return wikidataSearchLocales(query, interfaceLocale);
}

function wikidataGeoNamesId(entity: Record<string, unknown>): number | null {
  const claims = isRecord(entity.claims) ? entity.claims : null;
  const candidates = claims && Array.isArray(claims.P1566) ? claims.P1566 : [];
  for (const candidate of candidates) {
    if (!isRecord(candidate) || !isRecord(candidate.mainsnak)) continue;
    const dataValue = isRecord(candidate.mainsnak.datavalue) ? candidate.mainsnak.datavalue : null;
    const value = dataValue?.value;
    if (typeof value !== "string" || !/^\d+$/.test(value)) continue;
    const providerId = Number(value);
    if (Number.isSafeInteger(providerId) && providerId > 0) return providerId;
  }
  return null;
}

function wikidataCoordinates(entity: Record<string, unknown>): { latitude: number; longitude: number } | null {
  const claims = isRecord(entity.claims) ? entity.claims : null;
  const candidates = claims && Array.isArray(claims.P625) ? claims.P625 : [];
  for (const candidate of candidates) {
    if (!isRecord(candidate) || !isRecord(candidate.mainsnak)) continue;
    const dataValue = isRecord(candidate.mainsnak.datavalue) ? candidate.mainsnak.datavalue : null;
    const value = isRecord(dataValue?.value) ? dataValue.value : null;
    const latitude = finiteNumber(value?.latitude);
    const longitude = finiteNumber(value?.longitude);
    if (latitude !== null && latitude >= -90 && latitude <= 90 && longitude !== null && longitude >= -180 && longitude <= 180) {
      return { latitude, longitude };
    }
  }
  return null;
}

function wikidataLabel(entity: Record<string, unknown>, locale: CitySearchLocale): string | null {
  const labels = isRecord(entity.labels) ? entity.labels : {};
  for (const candidateLocale of [locale, "en"] as const) {
    const label = isRecord(labels[candidateLocale]) ? boundedText(labels[candidateLocale].value, 200) : null;
    if (label && (candidateLocale === "en" || usesLocaleScript(label, candidateLocale))) return label;
  }
  return null;
}

function distanceKilometres(
  left: { latitude: number; longitude: number },
  right: { latitude: number; longitude: number },
): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const latitudeDelta = radians(right.latitude - left.latitude);
  const longitudeDelta = radians(right.longitude - left.longitude);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(left.latitude)) * Math.cos(radians(right.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return 6_371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function rematchWikidataPopulatedPlace(
  entity: Record<string, unknown>,
  locale: CitySearchLocale,
): Promise<CitySearchResult | null> {
  const coordinates = wikidataCoordinates(entity);
  const label = wikidataLabel(entity, locale);
  if (!coordinates || !label) return null;
  // Prefer the English label when present: Open-Meteo's free text search has
  // materially better coverage for Latin canonical names than translations.
  const englishLabel = wikidataLabel(entity, "en") ?? label;
  const candidates = await requestProvider(englishLabel, "en");
  let nearest: CitySearchResult | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const distance = distanceKilometres(coordinates, candidate);
    if (distance < nearestDistance) {
      nearest = candidate;
      nearestDistance = distance;
    }
  }
  // A tight coordinate gate avoids accepting a same-name city in a different
  // country when a Wikidata GeoNames claim points to an ADM* feature.
  if (!nearest || nearestDistance > 20) return null;
  return lookupCity(nearest.providerId, locale);
}

function wikidataLocalizedNames(
  entity: Record<string, unknown>,
  city: CitySearchResult,
): LocalizedCityNames {
  const labels = isRecord(entity.labels) ? entity.labels : {};
  return Object.freeze(Object.fromEntries(CITY_SEARCH_LOCALES.map((locale) => {
    const label = isRecord(labels[locale]) ? boundedText(labels[locale].value, 200) : null;
    return [locale, label && usesLocaleScript(label, locale) ? label : neutralCityLabel(city)];
  })) as Record<CitySearchLocale, string>);
}

async function requestWikidataJson(search: URLSearchParams): Promise<unknown> {
  const signal = AbortSignal.timeout(CITY_SEARCH_PROVIDER_TIMEOUT_MS);
  const response = await fetch(`${WIKIDATA_API_URL}?${search}`, {
    headers: {
      Accept: "application/json",
      "Api-User-Agent": WIKIMEDIA_API_USER_AGENT,
      "User-Agent": WIKIMEDIA_API_USER_AGENT,
    },
    signal,
  });
  // Do not immediately retry a Wikimedia 429. The caller returns the original
  // provider result and a short negative cache prevents repeated fallback traffic.
  if (!response.ok) throw new Error(response.status === 429 ? "wikimedia_rate_limited" : "wikimedia_unavailable");
  return readBoundedProviderJson(response, signal);
}

async function requestWikidataClaims(
  entityId: string,
  property: "P1566" | "P625",
): Promise<Record<string, unknown>> {
  const payload = await requestWikidataJson(new URLSearchParams({
    action: "wbgetclaims",
    entity: entityId,
    property,
    format: "json",
  }));
  return isRecord(payload) && isRecord(payload.claims)
    ? { claims: payload.claims }
    : { claims: {} };
}

async function requestWikidataCities(
  query: string,
  locale: CitySearchLocale,
): Promise<readonly CitySearchResult[]> {
  const entityIds: string[] = [];
  for (const searchLocale of wikidataSearchLocales(query, locale)) {
    const ids = wikidataEntityIds(await requestWikidataJson(new URLSearchParams({
      action: "wbsearchentities",
      search: query,
      language: searchLocale,
      uselang: locale,
      type: "item",
      limit: String(WIKIDATA_ENTITY_LIMIT),
      format: "json",
    })));
    for (const id of ids) {
      if (!entityIds.includes(id)) entityIds.push(id);
      if (entityIds.length === WIKIDATA_ENTITY_LIMIT) break;
    }
    if (entityIds.length === WIKIDATA_ENTITY_LIMIT) break;
  }
  if (entityIds.length === 0) return [];
  const payload = await requestWikidataJson(new URLSearchParams({
    action: "wbgetentities",
    ids: entityIds.join("|"),
    // Claims can make major-city entities exceed the provider response cap.
    // Only labels are batched; P1566 and (only if needed) P625 are requested
    // separately below.
    props: "labels",
    languages: CITY_SEARCH_LOCALES.join("|"),
    languagefallback: "1",
    format: "json",
  }));
  const entities = isRecord(payload) && isRecord(payload.entities) ? payload.entities : {};
  const seen = new Set<number>();
  const results: CitySearchResult[] = [];
  // Resolve sequentially: it avoids bursts against both public services and
  // preserves Wikidata's relevance order.
  for (const [entityIndex, entityId] of entityIds.entries()) {
    const entity = isRecord(entities[entityId]) ? entities[entityId] : null;
    if (!entity) continue;
    try {
      const geoNamesClaims = await requestWikidataClaims(entityId, "P1566");
      const claimedProviderId = wikidataGeoNamesId(geoNamesClaims);
      if (!claimedProviderId) continue;
      // /v1/get plus parseProviderCity is the city-only gate: ADM*, airports,
      // and other non-populated-place Wikidata entities cannot pass it.
      let city: CitySearchResult;
      try {
        city = await lookupCity(claimedProviderId, locale);
      } catch {
        if (entityIndex > 0) continue;
        const coordinateClaims = await requestWikidataClaims(entityId, "P625");
        const rematched = await rematchWikidataPopulatedPlace(
          { ...entity, claims: coordinateClaims.claims },
          locale,
        );
        if (!rematched) continue;
        city = rematched;
      }
      if (seen.has(city.providerId)) continue;
      seen.add(city.providerId);
      const names = wikidataLocalizedNames(entity, city);
      wikidataNamesCache.set(city.providerId, {
        expiresAt: Date.now() + CITY_SEARCH_CACHE_TTL_SECONDS * 1_000,
        names,
      });
      results.push({ ...city, name: names[locale], names });
    } catch {
      // A bad/missing GeoNames claim should not hide other valid candidates.
    }
  }
  return results;
}

async function lookupWikidataCities(
  query: string,
  locale: CitySearchLocale,
): Promise<readonly CitySearchResult[]> {
  const now = Date.now();
  const cacheKey = `${locale}|${normalizeCityAlias(query)}`;
  const cached = wikidataCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.promise;
  pruneCache(now);
  const promise = requestWikidataCities(query, locale).then((results) => {
    const settled = Promise.resolve(results);
    wikidataCache.set(cacheKey, {
      expiresAt: now + (results.length > 0 ? CITY_SEARCH_CACHE_TTL_SECONDS : WIKIDATA_NEGATIVE_CACHE_TTL_SECONDS) * 1_000,
      promise: settled,
    });
    return results;
  }).catch(() => {
    const results: readonly CitySearchResult[] = [];
    wikidataCache.set(cacheKey, {
      expiresAt: now + WIKIDATA_NEGATIVE_CACHE_TTL_SECONDS * 1_000,
      promise: Promise.resolve(results),
    });
    return results;
  });
  wikidataCache.set(cacheKey, {
    expiresAt: now + WIKIDATA_NEGATIVE_CACHE_TTL_SECONDS * 1_000,
    promise,
  });
  return promise;
}

function mergeCityResults(
  preferred: readonly CitySearchResult[],
  additional: readonly CitySearchResult[],
): readonly CitySearchResult[] {
  const seen = new Set<number>();
  const merged: CitySearchResult[] = [];
  for (const city of [...preferred, ...additional]) {
    if (seen.has(city.providerId)) continue;
    seen.add(city.providerId);
    merged.push(city);
    if (merged.length === CITY_SEARCH_MAX_RESULTS) break;
  }
  return merged;
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
  if (
    code === "invalid_provider_response" ||
    code === "invalid_provider_content_length" ||
    code === "provider_response_too_large" ||
    code === "provider_response_missing"
  ) {
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
  const knownProviderCount = validated.includeTranslations ? 0 : knownCityProviderIds(validated.query).length;
  const codePointLength = [...validated.query].length;
  const providerSearchLocales = cityProviderSearchLocales(validated.query, validated.locale);
  const crossLanguageProviderSearch = codePointLength > 1
    && (providerSearchLocales.length > 1 || providerSearchLocales[0] !== validated.locale);
  const requestCostBase = codePointLength === 1
    ? Math.max(1, knownProviderCount)
    : (crossLanguageProviderSearch ? CROSS_LANGUAGE_PROVIDER_RATE_COST : 1) + knownProviderCount;
  let requestCost = validated.includeTranslations ? CITY_SEARCH_LOCALES.length : requestCostBase;
  const clientIp = parseCitySearchClientIp(request);
  let rateLimit = consumeRateLimit(clientIp, requestCost);
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
    const knownResults = validated.includeTranslations
      ? []
      : await lookupKnownCities(validated.query, validated.locale);
    const providerSearchLanguagesTried: string[] = [];
    let providerExactNameMatch = knownResults.length > 0;
    let providerLookup: { readonly results: readonly CitySearchResult[]; readonly cacheHit: boolean } | null = null;
    if (!validated.includeTranslations && codePointLength > 1) {
      providerSearchLanguagesTried.push(validated.locale);
      const localizedLookup = await lookupCities(validated.query, validated.locale);
      providerLookup = localizedLookup;
      if (!crossLanguageProviderSearch) {
        providerExactNameMatch = providerExactNameMatch || providerLookup.results.some(
          (city) => providerCityNameMatchesQuery(validated.query, city.name),
        );
      } else {
        let allCacheHits = localizedLookup.cacheHit;
        let rawResults: readonly CitySearchResult[] = [];
        for (const [languageIndex, providerLanguage] of providerSearchLocales.slice(0, 2).entries()) {
          if (languageIndex > 0) {
            const retryRateLimit = consumeRateLimit(clientIp, 1);
            if (!retryRateLimit.allowed) break;
            rateLimit = retryRateLimit;
            requestCost += 1;
          }
          providerSearchLanguagesTried.push(providerLanguage);
          let rawLookup: Awaited<ReturnType<typeof lookupCitiesInProviderLanguage>>;
          try {
            rawLookup = await lookupCitiesInProviderLanguage(validated.query, providerLanguage);
          } catch {
            allCacheHits = false;
            continue;
          }
          allCacheHits = allCacheHits && rawLookup.cacheHit;
          if (rawLookup.results.length === 0) continue;
          rawResults = rawLookup.results;
          providerExactNameMatch = providerExactNameMatch || rawLookup.results.some(
            (city) => providerCityNameMatchesQuery(validated.query, city.name),
          );
          break;
        }

        const localizedById = new Map(
          localizedLookup.results.map((city) => [city.providerId, city] as const),
        );
        const missingRawCandidates = rawResults.filter(
          (city) => !localizedById.has(city.providerId),
        ).slice(0, CROSS_LANGUAGE_PROVIDER_HYDRATION_LIMIT);
        let hydratedMissing: readonly CitySearchResult[] = [];
        if (missingRawCandidates.length > 0) {
          const hydrationRateLimit = consumeRateLimit(clientIp, missingRawCandidates.length);
          if (hydrationRateLimit.allowed) {
            rateLimit = hydrationRateLimit;
            requestCost += missingRawCandidates.length;
            hydratedMissing = await localizeProviderCandidates(missingRawCandidates, validated.locale);
          }
        }
        const localizedCandidatesById = new Map(
          [...localizedLookup.results, ...hydratedMissing]
            .map((city) => [city.providerId, city] as const),
        );
        const inputRankedLocalized = rawResults.flatMap((city) => {
          const localized = localizedCandidatesById.get(city.providerId);
          return localized ? [localized] : [];
        });
        providerLookup = {
          results: mergeCityResults(inputRankedLocalized, localizedLookup.results),
          cacheHit: allCacheHits,
        };
      }
    }
    let lookup = validated.includeTranslations
      ? null
      : providerLookup
        ? {
            results: mergeCityResults(knownResults, providerLookup.results),
            cacheHit: providerLookup.cacheHit,
          }
        : { results: knownResults, cacheHit: true };
    const fallbackQueriesTried: string[] = [];
    if (lookup && lookup.results.length === 0) {
      for (const fallbackQuery of japaneseCityFallbackQueries(validated.query, validated.locale)) {
        const retryRateLimit = consumeRateLimit(clientIp, 1);
        if (!retryRateLimit.allowed) break;
        rateLimit = retryRateLimit;
        requestCost += 1;
        fallbackQueriesTried.push(fallbackQuery);
        try {
          const fallbackLookup = await lookupCities(fallbackQuery, validated.locale);
          const exactResults = fallbackLookup.results.filter(
            (city) => city.name.normalize("NFKC") === fallbackQuery.normalize("NFKC"),
          );
          lookup = {
            results: exactResults,
            cacheHit: lookup.cacheHit && fallbackLookup.cacheHit,
          };
          if (exactResults.length > 0) break;
        } catch {
          // A bounded spelling fallback must not turn a valid empty search
          // response into a provider error. The next suffix may still work.
        }
      }
    }
    let wikidataFallbackUsed = false;
    const allowWikidataFallback = codePointLength > 1
      && (!LATIN_SCRIPT.test(validated.query) || codePointLength >= 3);
    const needsAliasDisambiguation = lookup !== null
      && lookup.results.length > 0
      && codePointLength >= 5
      && !providerExactNameMatch;
    if (lookup && allowWikidataFallback && (lookup.results.length === 0 || needsAliasDisambiguation)) {
      const fallbackRateLimit = consumeRateLimit(clientIp, WIKIDATA_FALLBACK_RATE_COST);
      if (fallbackRateLimit.allowed) {
        rateLimit = fallbackRateLimit;
        requestCost += WIKIDATA_FALLBACK_RATE_COST;
        wikidataFallbackUsed = true;
        const results = await lookupWikidataCities(validated.query, validated.locale);
        lookup = { results: mergeCityResults(results, lookup.results), cacheHit: false };
      }
    }
    const localizedLookups = validated.includeTranslations
      ? await Promise.allSettled(CITY_SEARCH_LOCALES.map((locale) => lookupCity(validated.providerId!, locale)))
      : [];
    const fulfilled = localizedLookups.flatMap((result, index) => result.status === "fulfilled"
      ? [{ locale: CITY_SEARCH_LOCALES[index], city: result.value }]
      : []);
    if (validated.includeTranslations && fulfilled.length === 0) throw new Error("provider_unavailable");
    const source = fulfilled.find(({ locale }) => locale === validated.locale)?.city ?? fulfilled[0]?.city;
    const cachedNames = validated.providerId === undefined
      ? undefined
      : knownNames(validated.providerId) ?? wikidataNamesCache.get(validated.providerId)?.names;
    const names = source ? Object.fromEntries(CITY_SEARCH_LOCALES.map((locale) => {
      const localized = fulfilled.find((entry) => entry.locale === locale)?.city;
      return [locale, cachedNames?.[locale] ?? localized?.name ?? neutralCityLabel(source)];
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
          fallbackQueriesTried,
          providerSearchLanguagesTried,
          wikidataFallbackUsed,
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
