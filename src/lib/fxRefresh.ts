import { nextRateRefreshAt, type RateLoadResult } from "./exchangeRates";

interface FxRefreshEnvironment {
  visible(): boolean;
  online(): boolean;
  now(): number;
  schedule(ms: number, callback: () => void): () => void;
  watchWake(callback: () => void): () => void;
}

/** Only the visible ledger needs live refresh. Schedule one wake-up for the
 * next expiring publication; with only settled rates there is no timer. */
export function watchRateRefresh(env: FxRefreshEnvironment, load: () => Promise<RateLoadResult>, receive: (result: RateLoadResult) => void): () => void {
  let active = true, busy = false, first = true, online = env.online();
  let due: number | null = 0;
  let cancelTimer: (() => void) | undefined;
  const check = () => {
    cancelTimer?.(); cancelTimer = undefined;
    const connected = env.online();
    if (connected && !online) due = 0;
    online = connected;
    if (!active || busy || !env.visible() || (!first && (!connected || due === null))) return;
    const delay = (due ?? 0) - env.now();
    if (!first && delay > 0) { cancelTimer = env.schedule(delay, check); return; }
    // On an initial offline mount load() may return the local cached rates.
    first = false; busy = true;
    void load().then((result) => {
      if (!active) return;
      busy = false;
      due = !connected && env.online() ? 0 : nextRateRefreshAt(result, env.now());
      receive(result);
      check();
    });
  };
  const unwatch = env.watchWake(check);
  check();
  return () => { active = false; cancelTimer?.(); unwatch(); };
}
