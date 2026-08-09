import type { City, LocalizedText } from "./domain.js";
import { DomainValidationError } from "./domain.js";

function names(
  ko: string,
  en: string,
  fr: string,
  ja: string,
  zh: string,
): LocalizedText {
  return Object.freeze({ ko, en, fr, ja, zh });
}

export const CITIES: readonly City[] = Object.freeze([
  {
    id: "seoul",
    names: names("서울", "Seoul", "Séoul", "ソウル", "首尔"),
    country: { code: "KR", names: names("대한민국", "South Korea", "Corée du Sud", "韓国", "韩国") },
    coordinates: { latitude: 37.5665, longitude: 126.978 },
    timeZone: "Asia/Seoul",
  },
  {
    id: "busan",
    names: names("부산", "Busan", "Busan", "釜山", "釜山"),
    country: { code: "KR", names: names("대한민국", "South Korea", "Corée du Sud", "韓国", "韩国") },
    coordinates: { latitude: 35.1796, longitude: 129.0756 },
    timeZone: "Asia/Seoul",
  },
  {
    id: "tokyo",
    names: names("도쿄", "Tokyo", "Tokyo", "東京", "东京"),
    country: { code: "JP", names: names("일본", "Japan", "Japon", "日本", "日本") },
    coordinates: { latitude: 35.6762, longitude: 139.6503 },
    timeZone: "Asia/Tokyo",
  },
  {
    id: "osaka",
    names: names("오사카", "Osaka", "Osaka", "大阪", "大阪"),
    country: { code: "JP", names: names("일본", "Japan", "Japon", "日本", "日本") },
    coordinates: { latitude: 34.6937, longitude: 135.5023 },
    timeZone: "Asia/Tokyo",
  },
  {
    id: "beijing",
    names: names("베이징", "Beijing", "Pékin", "北京", "北京"),
    country: { code: "CN", names: names("중국", "China", "Chine", "中国", "中国") },
    coordinates: { latitude: 39.9042, longitude: 116.4074 },
    timeZone: "Asia/Shanghai",
  },
  {
    id: "singapore",
    names: names("싱가포르", "Singapore", "Singapour", "シンガポール", "新加坡"),
    country: { code: "SG", names: names("싱가포르", "Singapore", "Singapour", "シンガポール", "新加坡") },
    coordinates: { latitude: 1.3521, longitude: 103.8198 },
    timeZone: "Asia/Singapore",
  },
  {
    id: "sydney",
    names: names("시드니", "Sydney", "Sydney", "シドニー", "悉尼"),
    country: { code: "AU", names: names("호주", "Australia", "Australie", "オーストラリア", "澳大利亚") },
    coordinates: { latitude: -33.8688, longitude: 151.2093 },
    timeZone: "Australia/Sydney",
  },
  {
    id: "paris",
    names: names("파리", "Paris", "Paris", "パリ", "巴黎"),
    country: { code: "FR", names: names("프랑스", "France", "France", "フランス", "法国") },
    coordinates: { latitude: 48.8566, longitude: 2.3522 },
    timeZone: "Europe/Paris",
  },
  {
    id: "london",
    names: names("런던", "London", "Londres", "ロンドン", "伦敦"),
    country: { code: "GB", names: names("영국", "United Kingdom", "Royaume-Uni", "イギリス", "英国") },
    coordinates: { latitude: 51.5072, longitude: -0.1276 },
    timeZone: "Europe/London",
  },
  {
    id: "berlin",
    names: names("베를린", "Berlin", "Berlin", "ベルリン", "柏林"),
    country: { code: "DE", names: names("독일", "Germany", "Allemagne", "ドイツ", "德国") },
    coordinates: { latitude: 52.52, longitude: 13.405 },
    timeZone: "Europe/Berlin",
  },
  {
    id: "rome",
    names: names("로마", "Rome", "Rome", "ローマ", "罗马"),
    country: { code: "IT", names: names("이탈리아", "Italy", "Italie", "イタリア", "意大利") },
    coordinates: { latitude: 41.9028, longitude: 12.4964 },
    timeZone: "Europe/Rome",
  },
  {
    id: "madrid",
    names: names("마드리드", "Madrid", "Madrid", "マドリード", "马德里"),
    country: { code: "ES", names: names("스페인", "Spain", "Espagne", "スペイン", "西班牙") },
    coordinates: { latitude: 40.4168, longitude: -3.7038 },
    timeZone: "Europe/Madrid",
  },
  {
    id: "barcelona",
    names: names("바르셀로나", "Barcelona", "Barcelone", "バルセロナ", "巴塞罗那"),
    country: { code: "ES", names: names("스페인", "Spain", "Espagne", "スペイン", "西班牙") },
    coordinates: { latitude: 41.3874, longitude: 2.1686 },
    timeZone: "Europe/Madrid",
  },
  {
    id: "istanbul",
    names: names("이스탄불", "Istanbul", "Istanbul", "イスタンブール", "伊斯坦布尔"),
    country: { code: "TR", names: names("튀르키예", "Türkiye", "Turquie", "トルコ", "土耳其") },
    coordinates: { latitude: 41.0082, longitude: 28.9784 },
    timeZone: "Europe/Istanbul",
  },
  {
    id: "dubai",
    names: names("두바이", "Dubai", "Dubaï", "ドバイ", "迪拜"),
    country: { code: "AE", names: names("아랍에미리트", "United Arab Emirates", "Émirats arabes unis", "アラブ首長国連邦", "阿拉伯联合酋长国") },
    coordinates: { latitude: 25.2048, longitude: 55.2708 },
    timeZone: "Asia/Dubai",
  },
  {
    id: "new-york",
    names: names("뉴욕", "New York", "New York", "ニューヨーク", "纽约"),
    country: { code: "US", names: names("미국", "United States", "États-Unis", "アメリカ合衆国", "美国") },
    coordinates: { latitude: 40.7128, longitude: -74.006 },
    timeZone: "America/New_York",
  },
  {
    id: "los-angeles",
    names: names("로스앤젤레스", "Los Angeles", "Los Angeles", "ロサンゼルス", "洛杉矶"),
    country: { code: "US", names: names("미국", "United States", "États-Unis", "アメリカ合衆国", "美国") },
    coordinates: { latitude: 34.0522, longitude: -118.2437 },
    timeZone: "America/Los_Angeles",
  },
  {
    id: "paris-texas",
    names: names("패리스(텍사스)", "Paris, Texas", "Paris (Texas)", "パリス（テキサス州）", "巴黎市（得克萨斯州）"),
    country: { code: "US", names: names("미국", "United States", "États-Unis", "アメリカ合衆国", "美国") },
    coordinates: { latitude: 33.6609, longitude: -95.5555 },
    timeZone: "America/Chicago",
  },
  {
    id: "mexico-city",
    names: names("멕시코시티", "Mexico City", "Mexico", "メキシコシティ", "墨西哥城"),
    country: { code: "MX", names: names("멕시코", "Mexico", "Mexique", "メキシコ", "墨西哥") },
    coordinates: { latitude: 19.4326, longitude: -99.1332 },
    timeZone: "America/Mexico_City",
  },
  {
    id: "sao-paulo",
    names: names("상파울루", "São Paulo", "São Paulo", "サンパウロ", "圣保罗"),
    country: { code: "BR", names: names("브라질", "Brazil", "Brésil", "ブラジル", "巴西") },
    coordinates: { latitude: -23.5558, longitude: -46.6396 },
    timeZone: "America/Sao_Paulo",
  },
  {
    id: "cairo",
    names: names("카이로", "Cairo", "Le Caire", "カイロ", "开罗"),
    country: { code: "EG", names: names("이집트", "Egypt", "Égypte", "エジプト", "埃及") },
    coordinates: { latitude: 30.0444, longitude: 31.2357 },
    timeZone: "Africa/Cairo",
  },
  {
    id: "cape-town",
    names: names("케이프타운", "Cape Town", "Le Cap", "ケープタウン", "开普敦"),
    country: { code: "ZA", names: names("남아프리카공화국", "South Africa", "Afrique du Sud", "南アフリカ", "南非") },
    coordinates: { latitude: -33.9249, longitude: 18.4241 },
    timeZone: "Africa/Johannesburg",
  },
]);

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en")
    .trim();
}

function validateCity(city: City): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(city.id)) {
    throw new DomainValidationError(`Invalid city id: ${city.id}`);
  }
  if (!/^[A-Z]{2}$/.test(city.country.code)) {
    throw new DomainValidationError(`Invalid country code for ${city.id}`);
  }
  if (
    city.coordinates.latitude < -90 ||
    city.coordinates.latitude > 90 ||
    city.coordinates.longitude < -180 ||
    city.coordinates.longitude > 180
  ) {
    throw new DomainValidationError(`Invalid coordinates for ${city.id}`);
  }
  try {
    new Intl.DateTimeFormat("en", { timeZone: city.timeZone }).format(0);
  } catch {
    throw new DomainValidationError(`Invalid IANA time zone for ${city.id}`);
  }
}

const cityMap = new Map<string, City>();

for (const city of CITIES) {
  validateCity(city);
  if (cityMap.has(city.id)) {
    throw new DomainValidationError(`Duplicate city id: ${city.id}`);
  }
  cityMap.set(city.id, city);
}

export function getCity(cityId: string): City {
  const city = cityMap.get(cityId);
  if (!city) {
    throw new DomainValidationError(`Unknown city id: ${cityId}`);
  }
  return city;
}

export function findCity(cityId: string): City | undefined {
  return cityMap.get(cityId);
}

export function searchCities(query: string, limit = 8): readonly City[] {
  if (!Number.isInteger(limit) || limit < 0) {
    throw new DomainValidationError("City search limit must be a non-negative integer");
  }
  const normalized = normalizeSearchText(query);
  if (!normalized || limit === 0) return [];

  return CITIES.filter((city) => {
    const fields = [
      city.id,
      city.country.code,
      ...Object.values(city.names),
      ...Object.values(city.country.names),
    ];
    return fields.some((field) => normalizeSearchText(field).includes(normalized));
  }).slice(0, limit);
}
