import type { Locale } from "./types";

const FALLBACK_CURRENCIES = [
  "AED", "ARS", "AUD", "BRL", "CAD", "CHF", "CLP", "CNY", "COP", "CZK", "DKK", "EGP", "EUR", "GBP", "HKD", "HUF", "IDR", "ILS", "INR", "ISK", "JPY", "KRW", "KWD", "MAD", "MXN", "MYR", "NOK", "NZD", "PHP", "PLN", "QAR", "RON", "SAR", "SEK", "SGD", "THB", "TRY", "TWD", "USD", "VND", "ZAR",
] as const;

export function availableCurrencies(): readonly string[] {
  try {
    const values = (Intl as typeof Intl & { supportedValuesOf?: (key: "currency") => string[] }).supportedValuesOf?.("currency");
    return values?.length ? values : FALLBACK_CURRENCIES;
  } catch {
    return FALLBACK_CURRENCIES;
  }
}

export function currencyDigits(currency: string): number {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

export function parseMinorUnits(input: string, currency: string): number | null {
  const digits = currencyDigits(currency);
  const normalized = input.trim().replace(/\s/g, "").replace(",", ".");
  const expression = digits === 0 ? /^(\d{1,14})$/ : new RegExp(`^(\\d{1,12})(?:\\.(\\d{1,${digits}}))?$`);
  const match = expression.exec(normalized);
  if (!match) return null;
  const scale = 10 ** digits;
  const whole = Number(match[1]);
  const fraction = digits === 0 ? 0 : Number((match[2] ?? "").padEnd(digits, "0"));
  const result = whole * scale + fraction;
  return Number.isSafeInteger(result) && result > 0 ? result : null;
}

export function formatMoney(minorUnits: number, currency: string, locale: Locale): string {
  return new Intl.NumberFormat(locale === "ko" ? "ko-KR" : locale, {
    style: "currency",
    currency,
    maximumFractionDigits: currencyDigits(currency),
  }).format(minorUnits / 10 ** currencyDigits(currency));
}

export function currencyName(currency: string, locale: Locale): string {
  try {
    const display = new Intl.DisplayNames([locale === "ko" ? "ko-KR" : locale], { type: "currency" }).of(currency);
    return display ? `${currency} · ${display}` : currency;
  } catch {
    return currency;
  }
}
