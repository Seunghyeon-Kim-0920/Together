"use client";

import { Maximize2, Minus, Plus } from "lucide-react";
import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from "react";
import type { City, OptimizedItinerary, SupportedLocale } from "../../lib/domain";
import { translate } from "../../lib/i18n";

type ViewBox = { x: number; y: number; width: number; height: number };
type MapPoint = { city: City; index: number; x: number; y: number; latitude: number; longitude: number };

const MAP_SIZE = 1_000;
const MAP_HEIGHT = MAP_SIZE / 2;
const MAP_ASPECT_RATIO = 16 / 9;
const EMPTY_MAP_VIEW: ViewBox = Object.freeze({
  x: 0,
  y: (MAP_HEIGHT - MAP_SIZE / MAP_ASPECT_RATIO) / 2,
  width: MAP_SIZE,
  height: MAP_SIZE / MAP_ASPECT_RATIO,
});

function clampLatitude(latitude: number): number {
  return Math.max(-90, Math.min(90, latitude));
}

function unwrapLongitude(longitude: number, reference: number): number {
  let adjusted = longitude;
  while (adjusted - reference > 180) adjusted -= 360;
  while (adjusted - reference < -180) adjusted += 360;
  return adjusted;
}

export function projectRouteCities(cities: readonly City[]): readonly MapPoint[] {
  if (cities.length === 0) return [];
  const referenceLongitude = cities[0].coordinates.longitude;
  return cities.map((city, index) => {
    const latitude = clampLatitude(city.coordinates.latitude);
    const longitude = unwrapLongitude(city.coordinates.longitude, referenceLongitude);
    return Object.freeze({
      city,
      index,
      latitude: city.coordinates.latitude,
      longitude: city.coordinates.longitude,
      x: ((longitude + 180) / 360) * MAP_SIZE,
      // The bundled geographic background is equirectangular. Using the same
      // projection keeps each marker aligned with its real latitude/longitude.
      y: ((90 - latitude) / 180) * MAP_HEIGHT,
    });
  });
}

export function fitRouteView(points: readonly Pick<MapPoint, "x" | "y">[]): ViewBox {
  if (points.length === 0) return EMPTY_MAP_VIEW;

  // A single pass also keeps fitting safe for very large, user-defined routes.
  let minX = points[0].x;
  let maxX = points[0].x;
  let minY = points[0].y;
  let maxY = points[0].y;
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index];
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }

  const horizontalSpan = maxX - minX;
  const verticalSpan = maxY - minY;
  const horizontalPadding = Math.max(3.2, horizontalSpan * 0.18);
  const verticalPadding = Math.max(2.2, verticalSpan * 0.22);
  let width = Math.max(18, horizontalSpan + horizontalPadding * 2);
  let height = Math.max(10.125, verticalSpan + verticalPadding * 2);
  if (width / height < MAP_ASPECT_RATIO) width = height * MAP_ASPECT_RATIO;
  else height = width / MAP_ASPECT_RATIO;
  return Object.freeze({
    x: (minX + maxX - width) / 2,
    y: (minY + maxY - height) / 2,
    width,
    height,
  });
}

function scaleView(view: ViewBox, factor: number, anchorX = view.x + view.width / 2, anchorY = view.y + view.height / 2): ViewBox {
  const width = view.width * factor;
  const height = view.height * factor;
  const horizontalRatio = (anchorX - view.x) / view.width;
  const verticalRatio = (anchorY - view.y) / view.height;
  return {
    x: anchorX - width * horizontalRatio,
    y: anchorY - height * verticalRatio,
    width,
    height,
  };
}

export function constrainRouteView(candidate: ViewBox, fittedView: ViewBox): ViewBox {
  const minimumWidth = Math.max(3, fittedView.width / 8);
  const maximumWidth = Math.min(MAP_SIZE * 1.35, fittedView.width * 2.2);
  const width = Math.max(minimumWidth, Math.min(maximumWidth, candidate.width));
  const height = width / MAP_ASPECT_RATIO;
  const candidateCenterX = candidate.x + candidate.width / 2;
  const candidateCenterY = candidate.y + candidate.height / 2;
  const fittedCenterX = fittedView.x + fittedView.width / 2;
  const fittedCenterY = fittedView.y + fittedView.height / 2;
  const horizontalFreedom = fittedView.width * 0.75;
  const verticalFreedom = fittedView.height * 0.75;
  const centerX = Math.max(fittedCenterX - horizontalFreedom, Math.min(fittedCenterX + horizontalFreedom, candidateCenterX));
  const routeBoundCenterY = Math.max(fittedCenterY - verticalFreedom, Math.min(fittedCenterY + verticalFreedom, candidateCenterY));
  const centerY = height >= MAP_HEIGHT
    ? MAP_HEIGHT / 2
    : Math.max(height / 2, Math.min(MAP_HEIGHT - height / 2, routeBoundCenterY));
  return {
    x: centerX - width / 2,
    y: centerY - height / 2,
    width,
    height,
  };
}

export function RouteMap({ itinerary, locale, cities }: {
  itinerary: OptimizedItinerary;
  locale: SupportedLocale;
  cities: ReadonlyMap<string, City>;
}) {
  const routeCities = useMemo(() => itinerary.cityOrder.map((cityId) => {
    const city = cities.get(cityId);
    if (!city) throw new Error(`Unknown route city: ${cityId}`);
    return city;
  }), [cities, itinerary.cityOrder]);
  const points = useMemo(() => projectRouteCities(routeCities), [routeCities]);
  const fittedView = useMemo(() => fitRouteView(points), [points]);
  const [view, setView] = useState<ViewBox>(fittedView);
  const drag = useRef<{ pointerId: number; clientX: number; clientY: number; view: ViewBox } | null>(null);
  const pointers = useRef(new Map<number, { clientX: number; clientY: number }>());
  const pinch = useRef<{ distance: number; centreX: number; centreY: number; view: ViewBox } | null>(null);

  const zoom = (factor: number, anchorX?: number, anchorY?: number) => {
    setView((current) => {
      const next = scaleView(current, factor, anchorX, anchorY);
      return constrainRouteView(next, fittedView);
    });
  };

  const handlePointerDown = (event: PointerEvent<SVGSVGElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
    const active = [...pointers.current.entries()];
    if (active.length === 1) {
      drag.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, view };
      pinch.current = null;
    } else if (active.length === 2) {
      const [, left] = active[0];
      const [, right] = active[1];
      pinch.current = {
        distance: Math.hypot(right.clientX - left.clientX, right.clientY - left.clientY),
        centreX: (left.clientX + right.clientX) / 2,
        centreY: (left.clientY + right.clientY) / 2,
        view,
      };
      drag.current = null;
    }
  };

  const handlePointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
    const bounds = event.currentTarget.getBoundingClientRect();
    const active = [...pointers.current.values()];
    if (active.length >= 2 && pinch.current) {
      const [left, right] = active;
      const distance = Math.max(1, Math.hypot(right.clientX - left.clientX, right.clientY - left.clientY));
      const centreX = (left.clientX + right.clientX) / 2;
      const centreY = (left.clientY + right.clientY) / 2;
      const anchorX = pinch.current.view.x + (pinch.current.centreX - bounds.left) / bounds.width * pinch.current.view.width;
      const anchorY = pinch.current.view.y + (pinch.current.centreY - bounds.top) / bounds.height * pinch.current.view.height;
      const scaled = scaleView(pinch.current.view, pinch.current.distance / distance, anchorX, anchorY);
      const dx = (centreX - pinch.current.centreX) / bounds.width * scaled.width;
      const dy = (centreY - pinch.current.centreY) / bounds.height * scaled.height;
      setView(constrainRouteView({ ...scaled, x: scaled.x - dx, y: scaled.y - dy }, fittedView));
      return;
    }
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    const dx = (event.clientX - drag.current.clientX) / bounds.width * drag.current.view.width;
    const dy = (event.clientY - drag.current.clientY) / bounds.height * drag.current.view.height;
    setView(constrainRouteView({ ...drag.current.view, x: drag.current.view.x - dx, y: drag.current.view.y - dy }, fittedView));
  };

  const stopDragging = (event: PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(event.pointerId);
    pinch.current = null;
    const remaining = [...pointers.current.entries()][0];
    drag.current = remaining ? { pointerId: remaining[0], clientX: remaining[1].clientX, clientY: remaining[1].clientY, view } : null;
  };

  const handleWheel = (event: WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const anchorX = view.x + (event.clientX - bounds.left) / bounds.width * view.width;
    const anchorY = view.y + (event.clientY - bounds.top) / bounds.height * view.height;
    zoom(event.deltaY > 0 ? 1.18 : 0.84, anchorX, anchorY);
  };

  const handleKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    const panX = view.width * 0.08;
    const panY = view.height * 0.08;
    if (event.key === "+" || event.key === "=") zoom(0.8);
    else if (event.key === "-") zoom(1.25);
    else if (event.key === "0") setView(fittedView);
    else if (event.key === "ArrowLeft") setView((current) => constrainRouteView({ ...current, x: current.x - panX }, fittedView));
    else if (event.key === "ArrowRight") setView((current) => constrainRouteView({ ...current, x: current.x + panX }, fittedView));
    else if (event.key === "ArrowUp") setView((current) => constrainRouteView({ ...current, y: current.y - panY }, fittedView));
    else if (event.key === "ArrowDown") setView((current) => constrainRouteView({ ...current, y: current.y + panY }, fittedView));
    else return;
    event.preventDefault();
  };

  const markerRadius = view.width / 65;
  const labelFontSize = view.width / 36;
  const routeCoordinates = points.map((point) => `${point.x},${point.y}`).join(" ");
  return (
    <div className="route-map" role="region" tabIndex={0} onKeyDown={handleKeyboard} aria-label={`${translate(locale, "routeMap")}: ${routeCities.map((city) => city.names[locale]).join(" → ")}`}>
      <svg data-map-source="natural-earth-50m" viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={stopDragging} onPointerCancel={stopDragging} onWheel={handleWheel} aria-hidden="true">
        <defs>
          <pattern id="route-map-grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(29, 89, 76, .10)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          </pattern>
          <filter id="route-map-shadow" x="-80%" y="-80%" width="260%" height="260%"><feDropShadow dx="0" dy={markerRadius * 0.16} stdDeviation={markerRadius * 0.18} floodOpacity=".22" /></filter>
        </defs>
        <image className="route-map-land" href="/assets/natural-earth-land-50m.svg" x={-MAP_SIZE} y="0" width={MAP_SIZE} height={MAP_HEIGHT} preserveAspectRatio="none" />
        <image className="route-map-land" href="/assets/natural-earth-land-50m.svg" x="0" y="0" width={MAP_SIZE} height={MAP_HEIGHT} preserveAspectRatio="none" />
        <image className="route-map-land" href="/assets/natural-earth-land-50m.svg" x={MAP_SIZE} y="0" width={MAP_SIZE} height={MAP_HEIGHT} preserveAspectRatio="none" />
        <rect x={view.x} y={view.y} width={view.width} height={view.height} fill="url(#route-map-grid)" opacity=".18" />
        <polyline className="route-map-path-halo" points={routeCoordinates} vectorEffect="non-scaling-stroke" />
        <polyline className="route-map-path" points={routeCoordinates} vectorEffect="non-scaling-stroke" />
        {points.map((point) => (
          <g className="route-map-point" key={point.city.id} transform={`translate(${point.x} ${point.y})`} data-city-id={point.city.id} data-latitude={point.latitude} data-longitude={point.longitude}>
            <title>{`${point.city.names[locale]} · ${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}`}</title>
            <circle r={markerRadius * 1.8} className="route-map-marker-ring" vectorEffect="non-scaling-stroke" />
            <circle r={markerRadius} className="route-map-marker" filter="url(#route-map-shadow)" vectorEffect="non-scaling-stroke" />
            <text className="route-map-marker-number" y={markerRadius * 0.36} fontSize={markerRadius * 1.05}>{point.index + 1}</text>
            <text className="route-map-city-label" x={markerRadius * 1.7} y={-markerRadius * 1.35} fontSize={labelFontSize} vectorEffect="non-scaling-stroke">{point.city.names[locale]}</text>
          </g>
        ))}
      </svg>
      <div className="map-controls" aria-label={translate(locale, "mapControls")}>
        <button type="button" onClick={() => zoom(0.8)} aria-label={translate(locale, "zoomIn")} title={translate(locale, "zoomIn")}><Plus size={18} /></button>
        <button type="button" onClick={() => zoom(1.25)} aria-label={translate(locale, "zoomOut")} title={translate(locale, "zoomOut")}><Minus size={18} /></button>
        <button type="button" onClick={() => setView(fittedView)} aria-label={translate(locale, "fitMap")} title={translate(locale, "fitMap")}><Maximize2 size={17} /></button>
      </div>
      <p className="map-help">{translate(locale, "mapHelp")}</p>
      <a className="map-attribution" href="https://www.naturalearthdata.com/" target="_blank" rel="noreferrer">{translate(locale, "mapAttribution")}</a>
    </div>
  );
}
