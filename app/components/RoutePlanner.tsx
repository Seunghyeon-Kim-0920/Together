"use client";

import {
  AlertTriangle, ArrowDown, ArrowUp, Bookmark, Bus, CalendarDays, CarFront, ChevronDown,
  ChevronUp, CircleDot, Clock3, Database, FileDown, GripVertical, MapPin, Plane, Plus,
  RotateCcw, Share2, Train, X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { CITIES, getCity } from "../../lib/cities";
import type { DurationComponentKind, OptimizedItinerary, SupportedLocale, TransportMode } from "../../lib/domain";
import { buildEstimatedFallbackOptions, optimizeItinerary } from "../../lib/routing";
import { formatDuration, translate } from "../../lib/i18n";

export type RouteSnapshot = {
  version: 1;
  name: string;
  departureDate: string;
  cityOrder: string[];
  totalMinutes: number;
  createdAt: string;
  provenance: "estimated" | "scheduled" | "observed";
};

type RoutePlannerProps = {
  locale: SupportedLocale;
  user: { displayName: string; email: string } | null;
  signInUrl: string;
  initialCityIds?: string[];
  initialDepartureDate?: string;
  initialTimestamp: string;
  onNotify: (message: string, tone?: "success" | "error" | "info") => void;
  onTripSaved: () => void;
};

function encodeSnapshot(snapshot: RouteSnapshot) {
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function copyShareUrl(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const input = document.createElement("textarea");
    input.value = value;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.select();
    input.setSelectionRange(0, value.length);
    const copied = document.execCommand("copy");
    input.remove();
    return copied;
  }
}

function ModeGlyph({ mode }: { mode: TransportMode }) {
  if (mode === "flight") return <Plane size={21} strokeWidth={1.9} aria-hidden="true" />;
  if (mode === "train" || mode === "metro") return <Train size={21} strokeWidth={1.9} aria-hidden="true" />;
  if (mode === "bus") return <Bus size={21} strokeWidth={1.9} aria-hidden="true" />;
  return <CarFront size={21} strokeWidth={1.9} aria-hidden="true" />;
}

function componentLabel(kind: DurationComponentKind, locale: SupportedLocale) {
  const labels: Record<DurationComponentKind, Record<SupportedLocale, string>> = {
    city_to_terminal: { ko: "도심→터미널", en: "City to terminal", fr: "Ville → terminal", ja: "市内→ターミナル", zh: "市区→交通枢纽" },
    waiting: { ko: "탑승·대기", en: "Boarding wait", fr: "Embarquement", ja: "乗車・待機", zh: "候车/登机" },
    check_in_security: { ko: "체크인·보안", en: "Check-in & security", fr: "Enregistrement", ja: "搭乗・保安検査", zh: "值机与安检" },
    border_control: { ko: "출입국", en: "Border control", fr: "Contrôle frontière", ja: "出入国審査", zh: "边境检查" },
    in_vehicle: { ko: "탑승 이동", en: "In-vehicle", fr: "Temps à bord", ja: "乗車時間", zh: "乘坐时间" },
    transfer: { ko: "환승", en: "Transfer", fr: "Correspondance", ja: "乗り換え", zh: "换乘" },
    baggage: { ko: "수하물", en: "Baggage", fr: "Bagages", ja: "手荷物", zh: "行李" },
    terminal_to_city: { ko: "터미널→도심", en: "Terminal to city", fr: "Terminal → ville", ja: "ターミナル→市内", zh: "交通枢纽→市区" },
    buffer: { ko: "운항 여유", en: "Reliability buffer", fr: "Marge de fiabilité", ja: "運行バッファ", zh: "运行缓冲" },
  };
  return labels[kind][locale];
}

function RouteMap({ itinerary, locale }: { itinerary: OptimizedItinerary; locale: SupportedLocale }) {
  const points = itinerary.cityOrder.map((cityId, index) => {
    const city = getCity(cityId);
    const x = Math.min(93, Math.max(7, ((city.coordinates.longitude + 180) / 360) * 100));
    const y = Math.min(82, Math.max(15, ((78 - city.coordinates.latitude) / 145) * 100));
    return { city, index, x, y };
  });
  return (
    <div className="route-map" role="img" aria-label={itinerary.cityOrder.map((id) => getCity(id).names[locale]).join(" → ")}>
      <div className="map-paper" />
      {points.slice(0, -1).map((point, index) => {
        const next = points[index + 1];
        const dx = next.x - point.x;
        const dy = next.y - point.y;
        const length = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx) * (180 / Math.PI);
        return <span key={`${point.city.id}-${next.city.id}`} className="map-route-line" style={{ left: `${point.x}%`, top: `${point.y}%`, width: `${length}%`, transform: `rotate(${angle}deg)` }} />;
      })}
      {points.map(({ city, index, x, y }) => (
        <div className="map-marker" key={city.id} style={{ left: `${x}%`, top: `${y}%` }}>
          <span>{index + 1}</span>
          <strong>{city.names[locale]}</strong>
        </div>
      ))}
    </div>
  );
}

function LegRow({ leg, index, locale }: { leg: OptimizedItinerary["legs"][number]; index: number; locale: SupportedLocale }) {
  const [expanded, setExpanded] = useState(index === 0);
  const from = getCity(leg.fromCityId);
  const to = getCity(leg.toCityId);
  const components = leg.segments.flatMap((segment) => segment.duration?.components ?? []);
  return (
    <article className={expanded ? "leg-row expanded" : "leg-row"}>
      <button className="leg-summary" type="button" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
        <span className="leg-number">{index + 1}</span>
        <span className="mode-icon"><ModeGlyph mode={leg.modes[0]} /></span>
        <span className="leg-cities"><strong>{from.names[locale]} → {to.names[locale]}</strong><small>{leg.modes.join(" + ")}</small></span>
        <span className="leg-duration">{formatDuration(leg.totalMinutes ?? 0, locale)}</span>
        {expanded ? <ChevronUp size={19} aria-hidden="true" /> : <ChevronDown size={19} aria-hidden="true" />}
      </button>
      {expanded ? (
        <div className="leg-breakdown">
          {components.map((component, componentIndex) => (
            <div className="breakdown-item" key={`${component.kind}-${componentIndex}`}>
              <CircleDot size={14} aria-hidden="true" />
              <span>{componentLabel(component.kind, locale)}</span>
              <strong>{formatDuration(component.minutes, locale)}</strong>
            </div>
          ))}
        </div>
      ) : null}
    </article>
  );
}

export function RoutePlanner({ locale, user, signInUrl, initialCityIds, initialDepartureDate, initialTimestamp, onNotify, onTripSaved }: RoutePlannerProps) {
  const [cityIds, setCityIds] = useState<string[]>(initialCityIds?.length ? initialCityIds : ["seoul", "tokyo", "paris", "barcelona"]);
  const [departureDate, setDepartureDate] = useState(() => initialDepartureDate ?? new Date(Date.parse(initialTimestamp) + 1000 * 60 * 60 * 24 * 30).toISOString().slice(0, 10));
  const [fixedStart, setFixedStart] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const itinerary = useMemo(() => {
    if (cityIds.length < 2 || cityIds.some((id) => !CITIES.some((city) => city.id === id)) || new Set(cityIds).size !== cityIds.length) return null;
    const candidates = buildEstimatedFallbackOptions(cityIds);
    return optimizeItinerary(cityIds, candidates, fixedStart ? { startCityId: cityIds[0] } : {});
  }, [cityIds, fixedStart]);

  const updateCity = (index: number, cityId: string) => {
    setError("");
    if (cityIds.some((id, existingIndex) => id === cityId && existingIndex !== index)) {
      setError(translate(locale, "duplicateCity"));
      return;
    }
    setCityIds((items) => items.map((item, itemIndex) => itemIndex === index ? cityId : item));
  };

  const moveCity = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= cityIds.length) return;
    setCityIds((items) => {
      const copy = [...items];
      [copy[index], copy[target]] = [copy[target], copy[index]];
      return copy;
    });
  };

  const addCity = () => {
    if (cityIds.length >= 10) return setError(translate(locale, "cityLimit"));
    const next = CITIES.find((city) => !cityIds.includes(city.id));
    if (next) setCityIds((items) => [...items, next.id]);
  };

  const calculate = () => {
    if (cityIds.length < 2 || cityIds.length > 10) return setError(translate(locale, "cityLimit"));
    setError("");
    setBusy(true);
    window.setTimeout(() => {
      setBusy(false);
      document.getElementById("route-results")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 420);
  };

  const snapshot = (): RouteSnapshot | null => itinerary ? {
    version: 1,
    name: `${getCity(itinerary.cityOrder[0]).names[locale]} → ${getCity(itinerary.cityOrder.at(-1) ?? itinerary.cityOrder[0]).names[locale]}`,
    departureDate,
    cityOrder: [...itinerary.cityOrder],
    totalMinutes: itinerary.totalMinutes,
    createdAt: new Date().toISOString(),
    provenance: itinerary.provenance.kind === "observed" ? "observed" : itinerary.provenance.kind === "scheduled" ? "scheduled" : "estimated",
  } : null;

  const shareRoute = async () => {
    const data = snapshot();
    if (!data) return;
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("share", encodeSnapshot(data));
    try {
      const copied = await copyShareUrl(url.toString());
      if (navigator.share && window.matchMedia("(max-width: 820px)").matches) {
        await navigator.share({ title: `Together · ${data.name}`, text: translate(locale, "optimizedOrder"), url: url.toString() });
      }
      onNotify(copied ? translate(locale, "copied") : url.toString(), copied ? "success" : "info");
    } catch (shareError) {
      if (shareError instanceof Error && shareError.name === "AbortError") return;
      const copied = await copyShareUrl(url.toString());
      onNotify(copied ? translate(locale, "copied") : url.toString(), copied ? "success" : "info");
    }
  };

  const downloadPdf = async () => {
    const target = document.getElementById("route-export");
    if (!target) return;
    setBusy(true);
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);
      const canvas = await html2canvas(target, { scale: 1.8, backgroundColor: "#ffffff", useCORS: true });
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imageHeight = (canvas.height * pageWidth) / canvas.width;
      const imageData = canvas.toDataURL("image/jpeg", 0.9);
      let remaining = imageHeight;
      let offset = 0;
      pdf.addImage(imageData, "JPEG", 0, offset, pageWidth, imageHeight, undefined, "FAST");
      remaining -= pageHeight;
      while (remaining > 0) {
        offset = remaining - imageHeight;
        pdf.addPage();
        pdf.addImage(imageData, "JPEG", 0, offset, pageWidth, imageHeight, undefined, "FAST");
        remaining -= pageHeight;
      }
      pdf.save(`Together-route-${departureDate}.pdf`);
      onNotify(translate(locale, "pdfReady"), "success");
    } catch {
      onNotify("PDF export failed. Please retry.", "error");
    } finally {
      setBusy(false);
    }
  };

  const saveTrip = async () => {
    if (!user) {
      onNotify(translate(locale, "signInToSave"), "info");
      window.setTimeout(() => { window.location.href = signInUrl; }, 500);
      return;
    }
    const data = snapshot();
    if (!data) return;
    setBusy(true);
    try {
      const response = await fetch("/api/trips", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: data.name, payload: data }) });
      if (!response.ok) throw new Error("save failed");
      onNotify(translate(locale, "saved"), "success");
      onTripSaved();
    } catch {
      onNotify(translate(locale, "retry"), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="route-page" id="route-export">
      <section className="route-intro">
        <div className="route-copy">
          <h1>{translate(locale, "routeTitle")}</h1>
          <p>{translate(locale, "routeDescription")}</p>
        </div>
        <div className="data-truth-note">
          <AlertTriangle size={20} aria-hidden="true" />
          <div><strong>{translate(locale, "estimatedLabel")}</strong><span>{translate(locale, "estimatedHelp")}</span></div>
        </div>
      </section>

      <div className="planner-layout">
        <aside className="planner-controls" aria-label={translate(locale, "cities")}>
          <div className="section-heading"><h2>{translate(locale, "cities")}</h2><span>{cityIds.length}/10</span></div>
          <div className="city-list">
            {cityIds.map((cityId, index) => (
              <div className="city-control" key={`${cityId}-${index}`}>
                <GripVertical size={17} className="grip" aria-hidden="true" />
                <span className="city-index">{index + 1}</span>
                <label>
                  <span className="sr-only">{translate(locale, "cities")} {index + 1}</span>
                  <select value={cityId} onChange={(event) => updateCity(index, event.target.value)}>
                    {CITIES.map((city) => <option key={city.id} value={city.id}>{city.names[locale]} · {city.country.names[locale]}</option>)}
                  </select>
                </label>
                <span className="reorder-actions">
                  <button type="button" onClick={() => moveCity(index, -1)} disabled={index === 0} aria-label="Move up"><ArrowUp size={15} /></button>
                  <button type="button" onClick={() => moveCity(index, 1)} disabled={index === cityIds.length - 1} aria-label="Move down"><ArrowDown size={15} /></button>
                </span>
                <button className="remove-city" type="button" onClick={() => setCityIds((items) => items.filter((_, itemIndex) => itemIndex !== index))} disabled={cityIds.length <= 2} aria-label={translate(locale, "remove")}><X size={17} /></button>
              </div>
            ))}
          </div>
          <button className="add-city" type="button" onClick={addCity} disabled={cityIds.length >= 10}><Plus size={18} />{translate(locale, "addCity")}</button>
          <label className="field-row date-field"><span><CalendarDays size={18} />{translate(locale, "departure")}</span><input type="date" value={departureDate} onChange={(event) => setDepartureDate(event.target.value)} /></label>
          <label className="checkbox-row"><input type="checkbox" checked={fixedStart} onChange={(event) => setFixedStart(event.target.checked)} /><span>{translate(locale, "fixedStart")}</span></label>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <button className="primary-action find-route" type="button" onClick={calculate} disabled={busy}>{busy ? <RotateCcw className="spin" size={19} /> : <MapPin size={19} />}{translate(locale, "findRoute")}</button>
        </aside>

        {itinerary ? (
          <section className="route-results" id="route-results" aria-live="polite">
            <div className="result-heading">
              <div><h2>{translate(locale, "optimizedOrder")}</h2><p>{translate(locale, "exactOptimization")}</p></div>
              <span className="provenance-state"><Database size={15} />{translate(locale, "estimated")}</span>
            </div>
            <div className="order-rail" aria-label={translate(locale, "optimizedOrder")}>
              {itinerary.cityOrder.map((cityId, index) => (
                <div className="order-city" key={cityId}><span>{index + 1}</span><strong>{getCity(cityId).names[locale]}</strong>{index < itinerary.cityOrder.length - 1 ? <i aria-hidden="true">→</i> : null}</div>
              ))}
            </div>
            <RouteMap itinerary={itinerary} locale={locale} />
            <div className="route-summary">
              <div><Clock3 size={22} /><span>{translate(locale, "totalTravel")}<strong>{formatDuration(itinerary.totalMinutes, locale)}</strong></span></div>
              <div><MapPin size={22} /><span>{itinerary.legs.length}<strong>{translate(locale, "legs")}</strong></span></div>
              <div className="summary-source"><Database size={22} /><span>{translate(locale, "dataSource")}<strong>{translate(locale, "estimatedLabel")}</strong></span></div>
            </div>
            <div className="legs-list">
              {itinerary.legs.map((leg, index) => <LegRow key={leg.id} leg={leg} index={index} locale={locale} />)}
            </div>
            <p className="provider-note"><AlertTriangle size={16} />{translate(locale, "providerRequired")} <span>{translate(locale, "dataUpdated")}: {new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : locale, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(initialTimestamp))} UTC</span></p>
            <div className="route-actions">
              <button type="button" onClick={shareRoute}><Share2 size={18} />{translate(locale, "share")}</button>
              <button type="button" onClick={downloadPdf} disabled={busy}><FileDown size={18} />{translate(locale, "pdf")}</button>
              <button className="save-route" type="button" onClick={saveTrip} disabled={busy}><Bookmark size={18} />{translate(locale, "save")}</button>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
