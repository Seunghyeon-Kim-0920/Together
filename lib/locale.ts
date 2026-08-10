import { SUPPORTED_LOCALES, type SupportedLocale } from "./domain";

export function parseSupportedLocale(value: string | null | undefined): SupportedLocale | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase().replaceAll("_", "-");
  const direct = normalized.split("-")[0];
  return (SUPPORTED_LOCALES as readonly string[]).includes(direct) ? direct as SupportedLocale : null;
}

export function localeFromAcceptLanguage(value: string | null | undefined): SupportedLocale {
  if (!value) return "ko";
  for (const item of value.split(",")) {
    const locale = parseSupportedLocale(item.split(";")[0]);
    if (locale) return locale;
  }
  return "ko";
}
