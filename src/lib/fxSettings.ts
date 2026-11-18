import type { KeyValueStore } from "./exchangeRates";
import type { Locale } from "./types";

/** Per-ledger preferences of the converted settlement. They stay on this
 * device, outside the wallet state, shared trips, PDFs and ledger files. */
export interface FxSettings {
  readonly enabled: boolean;
  readonly target: string;
  /** Currency code → rate typed by the user, as a canonical decimal string. */
  readonly manualRates: Readonly<Record<string, string>>;
}

export const FX_SETTINGS_KEY = "wallet-diary-fx-settings-v1";
const MAX_LEDGERS = 100;
const CURRENCY = /^[A-Z]{3}$/;
const LEDGER_ID = /^[A-Za-z0-9_-]{1,100}$/;

export function defaultFxTarget(locale: Locale): string { return locale === "ko" ? "KRW" : locale === "fr" ? "EUR" : "USD"; }

/** Digits with one optional decimal separator. A comma before exactly three
 * digits ("1,380") could mean 1380 or 1.38, so it is rejected instead of guessed;
 * "0,925" is unambiguous and accepted. */
export function normalizeManualRate(input: string): string | null {
  const compact = input.replace(/\s/g, "");
  if (!/^\d{1,9}(?:[.,]\d{1,8})?$/.test(compact) || /^[1-9]\d{0,2},\d{3}$/.test(compact)) return null;
  const [whole, fraction = ""] = compact.replace(",", ".").split(".");
  const canonical = `${whole.replace(/^0+(?=\d)/, "")}${fraction.replace(/0+$/, "") ? `.${fraction.replace(/0+$/, "")}` : ""}`;
  return Number(canonical) > 0 ? canonical : null;
}
export function parseManualRate(input: string): number | null {
  const canonical = normalizeManualRate(input);
  return canonical === null ? null : Number(canonical);
}

/** Canonical rates only, and never a rate for the settlement currency itself. */
export function sanitizeFxSettings(settings: FxSettings): FxSettings {
  const manualRates: Record<string, string> = {};
  for (const [currency, rate] of Object.entries(settings.manualRates)) {
    const canonical = normalizeManualRate(rate);
    if (CURRENCY.test(currency) && currency !== settings.target && canonical) manualRates[currency] = canonical;
  }
  return { enabled: settings.enabled === true, target: settings.target, manualRates };
}

/** Manual values describe a currency pair, not just a source currency. Never
 * reuse USD→KRW = 1380 as USD→EUR = 1380 after selecting a new target. */
export function withFxTarget(settings: FxSettings, target: string): FxSettings {
  if (!CURRENCY.test(target)) throw new Error("invalid target currency");
  return sanitizeFxSettings({ ...settings, target, manualRates: settings.target === target ? settings.manualRates : {} });
}

type StoredLedger = { readonly e: 0 | 1; readonly t: string; readonly m: Record<string, string>; readonly u: number };

/** A Map keeps unusual identifiers such as "__proto__" from touching object prototypes. */
function readAll(storage: KeyValueStore | null): Map<string, StoredLedger> {
  const ledgers = new Map<string, StoredLedger>();
  if (!storage) return ledgers;
  try {
    const parsed: unknown = JSON.parse(storage.getItem(FX_SETTINGS_KEY) ?? "null");
    if (typeof parsed !== "object" || parsed === null || (parsed as { v?: unknown }).v !== 1) return ledgers;
    const stored = (parsed as { ledgers?: unknown }).ledgers;
    if (typeof stored !== "object" || stored === null) return ledgers;
    for (const [id, value] of Object.entries(stored as Record<string, unknown>)) {
      if (!LEDGER_ID.test(id) || typeof value !== "object" || value === null) continue;
      const item = value as Record<string, unknown>;
      if (typeof item.t !== "string" || !CURRENCY.test(item.t) || typeof item.m !== "object" || item.m === null) continue;
      const manual: Record<string, string> = {};
      for (const [currency, rate] of Object.entries(item.m as Record<string, unknown>)) {
        if (CURRENCY.test(currency) && typeof rate === "string" && normalizeManualRate(rate) === rate) manual[currency] = rate;
      }
      ledgers.set(id, { e: item.e === 1 ? 1 : 0, t: item.t, m: manual, u: typeof item.u === "number" && Number.isFinite(item.u) ? item.u : 0 });
    }
  } catch { /* Unreadable preferences fall back to the defaults. */ }
  return ledgers;
}

export function readFxSettings(storage: KeyValueStore | null, ledgerId: string, fallbackTarget: string): FxSettings {
  const saved = readAll(storage).get(ledgerId);
  return saved ? { enabled: saved.e === 1, target: saved.t, manualRates: saved.m } : { enabled: false, target: fallbackTarget, manualRates: {} };
}

export function writeFxSettings(storage: KeyValueStore | null, ledgerId: string, settings: FxSettings, now = Date.now()): void {
  if (!storage || !LEDGER_ID.test(ledgerId) || !CURRENCY.test(settings.target)) return;
  const ledgers = readAll(storage);
  const clean = sanitizeFxSettings(settings);
  ledgers.set(ledgerId, { e: clean.enabled ? 1 : 0, t: clean.target, m: { ...clean.manualRates }, u: now });
  const kept = [...ledgers].sort(([, a], [, b]) => b.u - a.u).slice(0, MAX_LEDGERS);
  try { storage.setItem(FX_SETTINGS_KEY, JSON.stringify({ v: 1, ledgers: Object.fromEntries(kept) })); } catch { /* Preferences are optional. */ }
}
