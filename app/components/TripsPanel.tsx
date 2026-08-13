"use client";

import { CalendarDays, Clock3, HardDrive, MapPin, Route, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { getCity } from "../../lib/cities";
import { DEVICE_TRIPS_KEY, parseDeviceTrips, readDeviceValue, writeDeviceValue, type DeviceTrip } from "../../lib/device-storage";
import type { SupportedLocale } from "../../lib/domain";
import { formatDuration, translate } from "../../lib/i18n";
import { parseRouteSnapshot, type RouteSnapshot } from "../../lib/route-snapshot";

function parseLocalDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function savedRouteCity(snapshot: RouteSnapshot, cityId: string) {
  return snapshot.cities?.find((city) => city.id === cityId) ?? getCity(cityId);
}

export function TripsPanel({ locale, refreshKey, onOpen, onNotify }: {
  locale: SupportedLocale;
  refreshKey: number;
  onOpen: (snapshot: RouteSnapshot) => void;
  onNotify: (message: string, tone?: "success" | "error" | "info") => void;
}) {
  const [trips, setTrips] = useState<readonly DeviceTrip[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const load = () => {
      setTrips(readDeviceValue(DEVICE_TRIPS_KEY, parseDeviceTrips, []));
      setLoaded(true);
    };
    load();
    window.addEventListener("storage", load);
    return () => window.removeEventListener("storage", load);
  }, [refreshKey]);

  const removeTrip = (tripId: string) => {
    const next = trips.filter((trip) => trip.id !== tripId);
    if (!writeDeviceValue(DEVICE_TRIPS_KEY, next)) {
      onNotify(translate(locale, "deviceSaveError"), "error");
      return;
    }
    setTrips(next);
  };

  return (
    <main className="content-page trips-page">
      <section className="page-title-row">
        <div><h1>{translate(locale, "savedTrips")}</h1><p>{translate(locale, "savedTripsDesc")}</p></div>
        <span className="privacy-indicator"><HardDrive size={17} />{translate(locale, "deviceOnly")}</span>
      </section>
      {!loaded ? (
        <div className="loading-state" role="status"><span className="loading-line" /><span className="loading-line short" />{translate(locale, "loading")}</div>
      ) : trips.length === 0 ? (
        <section className="auth-empty-state"><Route size={36} /><h2>{translate(locale, "noTrips")}</h2><p>{translate(locale, "deviceStorageHelp")}</p></section>
      ) : (
        <div className="trip-list">
          {trips.map((trip) => {
            const snapshot = parseRouteSnapshot(trip.payload);
            return (
              <article className="saved-trip-row" key={trip.id}>
                <div className="saved-trip-route-icon"><Route size={23} /></div>
                <div className="saved-trip-main">
                  <strong>{snapshot ? `${savedRouteCity(snapshot, snapshot.cityOrder[0]).names[locale]} → ${savedRouteCity(snapshot, snapshot.cityOrder.at(-1) ?? snapshot.cityOrder[0]).names[locale]}` : trip.name}</strong>
                  {snapshot ? <p>{snapshot.cityOrder.map((id) => savedRouteCity(snapshot, id).names[locale]).join(" → ")}</p> : null}
                  <div className="saved-trip-meta">
                    {snapshot ? <span><CalendarDays size={14} />{new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : locale).format(parseLocalDate(snapshot.departureDate))}</span> : null}
                    {snapshot && snapshot.provenance !== "estimated" ? <span><Clock3 size={14} />{formatDuration(snapshot.totalMinutes, locale)}</span> : null}
                    {snapshot?.provenance === "estimated" ? <span><Clock3 size={14} />{translate(locale, "recheckTimetable")}</span> : null}
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
