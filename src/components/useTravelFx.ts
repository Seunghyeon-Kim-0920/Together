import { useMemo } from "react";
import { settleInCurrency } from "../lib/convertedSettlement";
import type { Locale, TravelLedger } from "../lib/types";
import { useLedgerFx } from "./useLedgerFx";

export function useTravelFx(ledger: TravelLedger, locale: Locale) {
  const fx = useLedgerFx(ledger.id, ledger.expenses, locale);
  const { settings, resolve } = fx;
  const settlement = useMemo(() => {
    if (!settings.enabled) return null;
    try { return settleInCurrency(ledger, settings.target, resolve); } catch { return null; }
  }, [ledger, settings.enabled, settings.target, resolve]);
  return { ...fx, settlement };
}

export type TravelFxState = ReturnType<typeof useTravelFx>;
