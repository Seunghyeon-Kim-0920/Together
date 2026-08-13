"use client";

import { CheckCircle2, Info, TriangleAlert, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { SupportedLocale } from "../lib/domain";
import { LANGUAGE_TAGS, translate } from "../lib/i18n";
import { parseRouteSnapshot, type RouteSnapshot } from "../lib/route-snapshot";
import { MAX_SHARED_LEDGER_DECODED_BYTES, MAX_SHARED_LEDGER_ENCODED_LENGTH, parseSharedExpenseLedger, type SharedExpenseLedger } from "../lib/device-storage";
import { BottomNav } from "./components/BottomNav";
import { ExpensesPanel } from "./components/ExpensesPanel";
import { Header, type ViewName } from "./components/Header";
import { ProfilePanel } from "./components/ProfilePanel";
import { RoutePlanner } from "./components/RoutePlanner";
import { TripsPanel } from "./components/TripsPanel";

type ToastState = { id: number; message: string; tone: "success" | "error" | "info" } | null;

function decodeBytes(encoded: string): Uint8Array {
  const normalized = encoded.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

async function decodeSnapshot(encoded: string): Promise<RouteSnapshot | null> {
  try {
    if (!encoded || encoded.length > 100_000) return null;
    const separator = encoded.indexOf(".");
    const codec = separator > 0 ? encoded.slice(0, separator) : "legacy";
    const payload = separator > 0 ? encoded.slice(separator + 1) : encoded;
    let bytes = decodeBytes(payload);
    if (codec === "g") {
      if (typeof DecompressionStream === "undefined") return null;
      const stream = new Blob([copyToArrayBuffer(bytes)]).stream().pipeThrough(new DecompressionStream("gzip"));
      const reader = stream.getReader();
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > 100_000) {
          await reader.cancel();
          return null;
        }
        chunks.push(value);
      }
      bytes = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
    } else if (codec !== "j" && codec !== "legacy") {
      return null;
    }
    if (bytes.byteLength > 100_000) return null;
    return parseRouteSnapshot(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}

async function decodeSharedLedger(encoded: string): Promise<SharedExpenseLedger | null> {
  try {
    if (!encoded || encoded.length > MAX_SHARED_LEDGER_ENCODED_LENGTH) return null;
    const separator = encoded.indexOf(".");
    const codec = separator > 0 ? encoded.slice(0, separator) : "j";
    let bytes = decodeBytes(separator > 0 ? encoded.slice(separator + 1) : encoded);
    if (codec === "g") {
      if (typeof DecompressionStream === "undefined") return null;
      const reader = new Blob([copyToArrayBuffer(bytes)]).stream().pipeThrough(new DecompressionStream("gzip")).getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_SHARED_LEDGER_DECODED_BYTES) {
          await reader.cancel();
          return null;
        }
        chunks.push(value);
      }
      bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
    } else if (codec !== "j") return null;
    if (bytes.byteLength > MAX_SHARED_LEDGER_DECODED_BYTES) return null;
    return parseSharedExpenseLedger(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}

export function TogetherApp({ initialTimestamp, initialLocale }: {
  initialTimestamp: string;
  initialLocale: SupportedLocale;
}) {
  const [locale, setLocale] = useState<SupportedLocale>(initialLocale);
  const [activeView, setActiveView] = useState<ViewName>("route");
  const [routeSeed, setRouteSeed] = useState<string[]>(["paris", "brussels", "amsterdam", "berlin"]);
  const [routeDepartureDate, setRouteDepartureDate] = useState<string | undefined>();
  const [routeSnapshot, setRouteSnapshot] = useState<RouteSnapshot | null>(null);
  const [routeKey, setRouteKey] = useState(0);
  const [tripRefreshKey, setTripRefreshKey] = useState(0);
  const [toast, setToast] = useState<ToastState>(null);
  const [sharedLedger, setSharedLedger] = useState<SharedExpenseLedger | null>(null);

  useEffect(() => {
    queueMicrotask(async () => {
      const hash = new URLSearchParams(window.location.hash.slice(1));
      const ledger = await decodeSharedLedger(hash.get("ledger") ?? "");
      if (ledger) {
        setSharedLedger(ledger);
        setActiveView("expenses");
      }
      const shared = new URL(window.location.href).searchParams.get("share");
      if (shared) {
        const snapshot = await decodeSnapshot(shared);
        if (snapshot) {
          setRouteSeed([...(snapshot.selectedCityIds ?? snapshot.cityOrder)]);
          setRouteDepartureDate(snapshot.departureDate);
          setRouteSnapshot(snapshot);
          setRouteKey((value) => value + 1);
          setActiveView("route");
        }
      }
    });
  }, []);

  const changeLocale = (next: SupportedLocale) => {
    setLocale(next);
    setToast(null);
    window.localStorage.setItem("together-locale", next);
    document.cookie = `together-locale=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
    document.documentElement.lang = LANGUAGE_TAGS[next];
  };

  useEffect(() => {
    document.documentElement.lang = LANGUAGE_TAGS[locale];
    document.title = translate(locale, "metadataTitle");
    const description = translate(locale, "metadataDescription");
    document.querySelector<HTMLMetaElement>('meta[name="description"]')?.setAttribute("content", description);
    document.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.setAttribute("content", translate(locale, "metadataTitle"));
    document.querySelector<HTMLMetaElement>('meta[property="og:description"]')?.setAttribute("content", description);
  }, [locale]);

  const notify = useCallback((message: string, tone: "success" | "error" | "info" = "info") => {
    const id = Date.now();
    setToast({ id, message, tone });
    window.setTimeout(() => setToast((current) => current?.id === id ? null : current), 4200);
  }, []);

  const openTrip = (candidate: RouteSnapshot) => {
    const snapshot = parseRouteSnapshot(candidate);
    if (!snapshot) return notify(translate(locale, "retry"), "error");
    setRouteSeed([...(snapshot.selectedCityIds ?? snapshot.cityOrder)]);
    setRouteDepartureDate(snapshot.departureDate);
    setRouteSnapshot(snapshot);
    setRouteKey((value) => value + 1);
    setActiveView("route");
  };

  return (
    <div className="app-shell">
      <Header locale={locale} onLocaleChange={changeLocale} activeView={activeView} onViewChange={setActiveView} />
      {activeView === "route" ? <RoutePlanner key={routeKey} locale={locale} initialCityIds={routeSeed} initialDepartureDate={routeDepartureDate} initialSnapshot={routeSnapshot ?? undefined} initialTimestamp={initialTimestamp} onNotify={notify} onTripSaved={() => setTripRefreshKey((value) => value + 1)} /> : null}
      {activeView === "trips" ? <TripsPanel locale={locale} refreshKey={tripRefreshKey} onOpen={openTrip} onNotify={notify} /> : null}
      {activeView === "expenses" ? <ExpensesPanel locale={locale} onNotify={notify} sharedLedger={sharedLedger} onSharedLedgerSaved={() => setSharedLedger(null)} /> : null}
      {activeView === "profile" ? <ProfilePanel locale={locale} onNotify={notify} /> : null}
      <BottomNav locale={locale} activeView={activeView} onViewChange={setActiveView} />
      {toast ? (
        <div className={`toast ${toast.tone}`} role="status" aria-live="polite">
          {toast.tone === "success" ? <CheckCircle2 size={19} /> : toast.tone === "error" ? <TriangleAlert size={19} /> : <Info size={19} />}
          <span>{toast.message}</span>
          <button type="button" onClick={() => setToast(null)} aria-label={translate(locale, "close")}><X size={17} /></button>
        </div>
      ) : null}
    </div>
  );
}
