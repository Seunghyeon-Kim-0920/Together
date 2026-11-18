import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { watchRateRefresh } from "../lib/fxRefresh";
import { browserRateDependencies, browserStorage, loadRates, parseRateRequest, rateKey, requiredRates, serializeRateRequest, type FxExpense, type RateLoadResult, type RatePoint } from "../lib/exchangeRates";
import { defaultFxTarget, readFxSettings, sanitizeFxSettings, writeFxSettings, type FxSettings } from "../lib/fxSettings";
import { convertExpenseAmounts, summarizeRates } from "../lib/fxSummary";
import type { Locale } from "../lib/types";

const NO_RATES: ReadonlyMap<string, RatePoint> = new Map();

/** Both ledger types use the same dated rates, preferences and refresh rules. */
export function useLedgerFx(ledgerId: string, expenses: readonly FxExpense[], locale: Locale) {
  const [storage] = useState(() => browserStorage());
  const [settings, setSettings] = useState<FxSettings>(() => readFxSettings(storage, ledgerId, defaultFxTarget(locale)));
  const [attempt, setAttempt] = useState(0);
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine !== false);
  const [loaded, setLoaded] = useState<{ readonly key: string; readonly result: RateLoadResult } | null>(null);
  const pending = useRef<{ key: string; promise: Promise<RateLoadResult> } | null>(null);
  const manualRates = useMemo<Readonly<Record<string, number>>>(() => Object.fromEntries(Object.entries(settings.manualRates).map(([currency, rate]) => [currency, Number(rate)])), [settings.manualRates]);
  const foreign = useMemo(() => [...requiredRates({ expenses }, settings.target).keys()], [expenses, settings.target]);
  const request = useMemo(() => {
    const needs = requiredRates({ expenses }, settings.target, new Set(Object.keys(manualRates)));
    return { size: needs.size, key: serializeRateRequest(settings.target, needs) };
  }, [expenses, settings.target, manualRates]);
  const needsRates = settings.enabled && request.size > 0;
  useEffect(() => {
    if (!needsRates) return;
    const parsed = parseRateRequest(request.key);
    if (!parsed) return;
    const load = () => {
      const deps = browserRateDependencies();
      const key = JSON.stringify([request.key, deps.online]);
      // Only share in-flight work (e.g. React Strict Mode); a fulfilled stale
      // request must not suppress future refreshes of this same currency pair.
      if (pending.current?.key === key) return pending.current.promise;
      const promise = loadRates(parsed.target, parsed.needs, deps).catch((): RateLoadResult => ({
        rates: NO_RATES, missing: [...parsed.needs].flatMap(([currency, dates]) => dates.map((date) => ({ currency, date }))), failed: true,
      }));
      pending.current = { key, promise };
      void promise.then(() => { if (pending.current?.promise === promise) pending.current = null; });
      return promise;
    };
    return watchRateRefresh({
      now: Date.now,
      visible: () => document.visibilityState !== "hidden",
      online: () => navigator.onLine !== false,
      schedule: (ms, callback) => { const timer = window.setTimeout(callback, ms); return () => window.clearTimeout(timer); },
      watchWake: (callback) => {
        for (const event of ["focus", "online", "offline"]) window.addEventListener(event, callback);
        document.addEventListener("visibilitychange", callback);
        return () => {
          for (const event of ["focus", "online", "offline"]) window.removeEventListener(event, callback);
          document.removeEventListener("visibilitychange", callback);
        };
      },
    }, load, (result) => setLoaded({ key: request.key, result }));
  }, [needsRates, request.key, attempt]);
  useEffect(() => {
    const changed = () => setOnline(navigator.onLine !== false);
    window.addEventListener("online", changed); window.addEventListener("offline", changed);
    return () => { window.removeEventListener("online", changed); window.removeEventListener("offline", changed); };
  }, []);
  const result = needsRates && loaded?.key === request.key ? loaded.result : null;
  const ready = !needsRates || result !== null;
  const rates = result?.rates ?? NO_RATES;
  const resolve = useCallback((currency: string, date: string) => (Object.hasOwn(manualRates, currency) ? manualRates[currency] : rates.get(rateKey(currency, date))?.rate) ?? null, [manualRates, rates]);
  const amounts = useMemo(() => settings.enabled ? convertExpenseAmounts(expenses, settings.target, resolve) : new Map<string, number | null>(), [expenses, settings.enabled, settings.target, resolve]);
  const summaries = useMemo(() => summarizeRates({ expenses }, settings.target, manualRates, rates), [expenses, settings.target, manualRates, rates]);
  const save = (next: FxSettings) => { const clean = sanitizeFxSettings(next); setSettings(clean); writeFxSettings(storage, ledgerId, clean); };
  return { settings, save, online, ready, rates, manualRates, foreign, resolve, amounts, summaries, retry: () => setAttempt((value) => value + 1) };
}

export type LedgerFxState = ReturnType<typeof useLedgerFx>;
