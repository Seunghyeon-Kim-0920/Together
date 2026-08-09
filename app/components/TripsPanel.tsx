"use client";

import { CalendarDays, Clock3, LockKeyhole, MapPin, Route, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { getCity } from "../../lib/cities";
import type { SupportedLocale } from "../../lib/domain";
import { formatDuration, translate } from "../../lib/i18n";
import type { RouteSnapshot } from "./RoutePlanner";

type SavedTrip = { id: string; name: string; payload: RouteSnapshot | null; updatedAt: string };

export function TripsPanel({ locale, user, signInUrl, refreshKey, onOpen, onNotify }: {
  locale: SupportedLocale;
  user: { displayName: string; email: string } | null;
  signInUrl: string;
  refreshKey: number;
  onOpen: (snapshot: RouteSnapshot) => void;
  onNotify: (message: string, tone?: "success" | "error" | "info") => void;
}) {
  const [trips, setTrips] = useState<SavedTrip[]>([]);
  const [loading, setLoading] = useState(Boolean(user));

  useEffect(() => {
    if (!user) return;
    let active = true;
    fetch("/api/trips")
      .then(async (response) => {
        if (!response.ok) throw new Error("request failed");
        return await response.json() as { trips: SavedTrip[] };
      })
      .then((data) => { if (active) setTrips(data.trips); })
      .catch(() => { if (active) onNotify(translate(locale, "retry"), "error"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user, refreshKey, locale, onNotify]);

  const removeTrip = async (tripId: string) => {
    const response = await fetch(`/api/trips/${encodeURIComponent(tripId)}`, { method: "DELETE" });
    if (!response.ok) return onNotify(translate(locale, "retry"), "error");
    setTrips((items) => items.filter((trip) => trip.id !== tripId));
  };

  return (
    <main className="content-page trips-page">
      <section className="page-title-row">
        <div><h1>{translate(locale, "savedTrips")}</h1><p>{translate(locale, "savedTripsDesc")}</p></div>
        <span className="privacy-indicator"><LockKeyhole size={17} />{translate(locale, "private")}</span>
      </section>
      {!user ? (
        <section className="auth-empty-state">
          <LockKeyhole size={34} />
          <h2>{translate(locale, "noAccountData")}</h2>
          <p>{translate(locale, "savedTripsDesc")}</p>
          <a className="primary-action compact" href={signInUrl}>{translate(locale, "signIn")}</a>
        </section>
      ) : loading ? (
        <div className="loading-state" role="status"><span className="loading-line" /><span className="loading-line short" />{translate(locale, "loading")}</div>
      ) : trips.length === 0 ? (
        <section className="auth-empty-state"><Route size={36} /><h2>{translate(locale, "noTrips")}</h2><p>{translate(locale, "savedTripsDesc")}</p></section>
      ) : (
        <div className="trip-list">
          {trips.map((trip) => {
            const snapshot = trip.payload;
            return (
              <article className="saved-trip-row" key={trip.id}>
                <div className="saved-trip-route-icon"><Route size={23} /></div>
                <div className="saved-trip-main">
                  <strong>{trip.name}</strong>
                  {snapshot ? <p>{snapshot.cityOrder.map((id) => getCity(id).names[locale]).join(" → ")}</p> : null}
                  <div className="saved-trip-meta">
                    {snapshot ? <span><CalendarDays size={14} />{new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : locale).format(new Date(snapshot.departureDate))}</span> : null}
                    {snapshot ? <span><Clock3 size={14} />{formatDuration(snapshot.totalMinutes, locale)}</span> : null}
                    {snapshot ? <span><MapPin size={14} />{snapshot.cityOrder.length}</span> : null}
                  </div>
                </div>
                <div className="saved-trip-actions">
                  {snapshot ? <button type="button" onClick={() => onOpen(snapshot)}>{translate(locale, "open")}</button> : null}
                  <button type="button" className="danger-quiet" onClick={() => removeTrip(trip.id)} aria-label={translate(locale, "remove")}><Trash2 size={18} /></button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
}
