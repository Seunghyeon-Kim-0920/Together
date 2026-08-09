"use client";

import { CheckCircle2, Info, TriangleAlert, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { SUPPORTED_LOCALES, type SupportedLocale } from "../lib/domain";
import { BottomNav } from "./components/BottomNav";
import { ExpensesPanel } from "./components/ExpensesPanel";
import { Header, type ViewName } from "./components/Header";
import { ProfilePanel } from "./components/ProfilePanel";
import { RoutePlanner, type RouteSnapshot } from "./components/RoutePlanner";
import { TripsPanel } from "./components/TripsPanel";

type ToastState = { id: number; message: string; tone: "success" | "error" | "info" } | null;

function decodeSnapshot(encoded: string): RouteSnapshot | null {
  try {
    const normalized = encoded.replaceAll("-", "+").replaceAll("_", "/");
    const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as RouteSnapshot;
    if (parsed.version !== 1 || !Array.isArray(parsed.cityOrder) || parsed.cityOrder.length < 2 || parsed.cityOrder.length > 10) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function TogetherApp({ user, signInUrl, signOutUrl }: {
  user: { displayName: string; email: string } | null;
  signInUrl: string;
  signOutUrl: string;
}) {
  const [locale, setLocale] = useState<SupportedLocale>("ko");
  const [activeView, setActiveView] = useState<ViewName>("route");
  const [routeSeed, setRouteSeed] = useState<string[]>(["seoul", "tokyo", "paris", "barcelona"]);
  const [routeKey, setRouteKey] = useState(0);
  const [tripRefreshKey, setTripRefreshKey] = useState(0);
  const [toast, setToast] = useState<ToastState>(null);

  useEffect(() => {
    queueMicrotask(() => {
      const stored = window.localStorage.getItem("together-locale");
      if (stored && (SUPPORTED_LOCALES as readonly string[]).includes(stored)) setLocale(stored as SupportedLocale);
      const shared = new URL(window.location.href).searchParams.get("share");
      if (shared) {
        const snapshot = decodeSnapshot(shared);
        if (snapshot) {
          setRouteSeed(snapshot.cityOrder);
          setRouteKey((value) => value + 1);
          setActiveView("route");
        }
      }
    });
  }, []);

  const changeLocale = (next: SupportedLocale) => {
    setLocale(next);
    window.localStorage.setItem("together-locale", next);
    document.documentElement.lang = next === "zh" ? "zh-CN" : next;
  };

  const notify = useCallback((message: string, tone: "success" | "error" | "info" = "info") => {
    const id = Date.now();
    setToast({ id, message, tone });
    window.setTimeout(() => setToast((current) => current?.id === id ? null : current), 4200);
  }, []);

  const openTrip = (snapshot: RouteSnapshot) => {
    setRouteSeed(snapshot.cityOrder);
    setRouteKey((value) => value + 1);
    setActiveView("route");
  };

  return (
    <div className="app-shell">
      <Header locale={locale} onLocaleChange={changeLocale} activeView={activeView} onViewChange={setActiveView} user={user} signInUrl={signInUrl} signOutUrl={signOutUrl} />
      {activeView === "route" ? <RoutePlanner key={routeKey} locale={locale} user={user} signInUrl={signInUrl} initialCityIds={routeSeed} onNotify={notify} onTripSaved={() => setTripRefreshKey((value) => value + 1)} /> : null}
      {activeView === "trips" ? <TripsPanel locale={locale} user={user} signInUrl={signInUrl} refreshKey={tripRefreshKey} onOpen={openTrip} onNotify={notify} /> : null}
      {activeView === "expenses" ? <ExpensesPanel locale={locale} user={user} signInUrl={signInUrl} onNotify={notify} /> : null}
      {activeView === "profile" ? <ProfilePanel locale={locale} user={user} signInUrl={signInUrl} onNotify={notify} /> : null}
      <BottomNav locale={locale} activeView={activeView} onViewChange={setActiveView} />
      {toast ? (
        <div className={`toast ${toast.tone}`} role="status" aria-live="polite">
          {toast.tone === "success" ? <CheckCircle2 size={19} /> : toast.tone === "error" ? <TriangleAlert size={19} /> : <Info size={19} />}
          <span>{toast.message}</span>
          <button type="button" onClick={() => setToast(null)} aria-label="Close"><X size={17} /></button>
        </div>
      ) : null}
    </div>
  );
}
