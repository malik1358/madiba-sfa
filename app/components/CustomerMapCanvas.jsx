"use client";

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";

const AREA_ZOOM_THRESHOLD = 12;
const SAUDI_CENTER = [24.0, 45.0];
const SAUDI_ZOOM = 6;

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function customerPopupHtml(point) {
  const code = escapeHtml(point.customer_code);
  const name = escapeHtml(point.customer_name || point.customer_code);
  const place = escapeHtml([point.city, point.area].filter(Boolean).join(" / "));
  const salesman = escapeHtml(point.current_salesman_code || "-");
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${point.latitude},${point.longitude}`)}`;
  const auditUrl = `/management/customer-audit?customer=${encodeURIComponent(point.customer_code)}`;
  return `
    <div class="customerMapPopup">
      <strong>${name}</strong>
      <div>${code}</div>
      <div>${place || "-"}</div>
      <div>Salesman: ${salesman}</div>
      <div class="customerMapPopupLinks">
        <a href="${auditUrl}">Audit</a>
        <a href="${mapsUrl}" target="_blank" rel="noreferrer">Google Maps</a>
      </div>
    </div>
  `;
}

function areaPopupHtml(area, language) {
  const city = escapeHtml(area.city);
  const name = escapeHtml(area.area);
  const customers = Number(area.customers || 0).toLocaleString("en-SA");
  const withGps = Number(area.with_gps || 0).toLocaleString("en-SA");
  const label = language === "ar" ? "عملاء" : "customers";
  const gpsLabel = language === "ar" ? "مع GPS" : "with GPS";
  const listHint = language === "ar" ? "انقر لعرض قائمة العملاء" : "Click to show customer list";
  return `
    <div class="customerMapPopup">
      <strong>${city}</strong>
      <div>${name}</div>
      <div>${customers} ${label}</div>
      <div>${withGps} ${gpsLabel}</div>
      <div class="customerMapPopupHint">${listHint}</div>
    </div>
  `;
}

function areaBubbleSize(count) {
  const value = Number(count || 0);
  if (value <= 1) return 28;
  if (value <= 5) return 34;
  if (value <= 15) return 40;
  if (value <= 40) return 48;
  return 56;
}

function createCustomerPinIcon(L, selected) {
  return L.divIcon({
    className: `customerMapPin${selected ? " customerMapPin--selected" : ""}`,
    html: `<span class="customerMapPinDot" aria-hidden="true"></span>`,
    iconSize: [28, 36],
    iconAnchor: [14, 34],
    popupAnchor: [0, -30],
  });
}

function createAreaBubbleIcon(L, count, selected) {
  const size = areaBubbleSize(count);
  return L.divIcon({
    className: `customerMapAreaBubble${selected ? " customerMapAreaBubble--selected" : ""}`,
    html: `<span class="customerMapAreaBubbleInner">${escapeHtml(String(count))}</span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
}

export default function CustomerMapCanvas({
  mapPoints = [],
  areaRows = [],
  selectedAreaKey = "",
  language = "en",
  onSelectArea,
  fitToken = 0,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const leafletRef = useRef(null);
  const onSelectAreaRef = useRef(onSelectArea);
  const dataRef = useRef({ mapPoints, areaRows, selectedAreaKey, language });
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    onSelectAreaRef.current = onSelectArea;
  }, [onSelectArea]);

  useEffect(() => {
    dataRef.current = { mapPoints, areaRows, selectedAreaKey, language };
  }, [mapPoints, areaRows, selectedAreaKey, language]);

  useEffect(() => {
    let cancelled = false;

    async function setupMap() {
      if (!containerRef.current || mapRef.current) return;
      const leaflet = await import("leaflet");
      if (cancelled || !containerRef.current) return;

      const L = leaflet.default || leaflet;
      leafletRef.current = L;
      const map = L.map(containerRef.current, {
        center: SAUDI_CENTER,
        zoom: SAUDI_ZOOM,
        scrollWheelZoom: true,
        // HTML markers stay sharp at high zoom; SVG paths can collapse to dots/squares.
        preferCanvas: false,
        maxZoom: 19,
      });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      const layer = L.layerGroup().addTo(map);
      mapRef.current = map;
      layerRef.current = layer;
      setMapReady(true);
    }

    setupMap();
    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        layerRef.current = null;
      }
      setMapReady(false);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    const L = leafletRef.current;
    if (!mapReady || !map || !layer || !L) return;

    const redraw = () => {
      layer.clearLayers();
      const {
        mapPoints: points,
        areaRows: areas,
        selectedAreaKey: areaKey,
        language: lang,
      } = dataRef.current;
      const zoom = map.getZoom();
      const showCustomers = zoom >= AREA_ZOOM_THRESHOLD || Boolean(areaKey);
      const visiblePoints = areaKey
        ? points.filter((point) => point.area_key === areaKey)
        : points;

      if (showCustomers) {
        for (const point of visiblePoints) {
          if (point.latitude == null || point.longitude == null) continue;
          const selected = Boolean(areaKey) && point.area_key === areaKey;
          const marker = L.marker([point.latitude, point.longitude], {
            icon: createCustomerPinIcon(L, selected),
            keyboard: true,
            riseOnHover: true,
            title: point.customer_name || point.customer_code || "",
          });
          marker.bindPopup(customerPopupHtml(point));
          marker.addTo(layer);
        }
        return;
      }

      for (const area of areas) {
        if (area.latitude == null || area.longitude == null || !area.with_gps) continue;
        const selected = Boolean(areaKey) && area.area_key === areaKey;
        const marker = L.marker([area.latitude, area.longitude], {
          icon: createAreaBubbleIcon(L, area.customers, selected),
          keyboard: true,
          riseOnHover: true,
          title: `${area.city} / ${area.area}`,
        });
        marker.bindPopup(areaPopupHtml(area, lang));
        marker.on("click", () => {
          onSelectAreaRef.current?.(area.area_key);
          map.flyTo(
            [area.latitude, area.longitude],
            Math.max(map.getZoom(), AREA_ZOOM_THRESHOLD + 1),
            { duration: 0.6 },
          );
        });
        marker.addTo(layer);
      }
    };

    redraw();
    map.on("zoomend", redraw);
    map.on("moveend", redraw);
    map.invalidateSize();
    return () => {
      map.off("zoomend", redraw);
      map.off("moveend", redraw);
    };
  }, [mapReady, mapPoints, areaRows, selectedAreaKey, language, fitToken]);

  useEffect(() => {
    const map = mapRef.current;
    const L = leafletRef.current;
    if (!mapReady || !map || !L) return;

    const points = selectedAreaKey
      ? mapPoints.filter((point) => point.area_key === selectedAreaKey)
      : mapPoints;

    if (!points.length) {
      if (!selectedAreaKey) map.setView(SAUDI_CENTER, SAUDI_ZOOM);
      return;
    }

    if (points.length === 1) {
      map.flyTo([points[0].latitude, points[0].longitude], 16, { duration: 0.5 });
      return;
    }

    const bounds = L.latLngBounds(points.map((point) => [point.latitude, point.longitude]));
    map.fitBounds(bounds.pad(0.2), {
      animate: true,
      maxZoom: selectedAreaKey ? 17 : 12,
    });
  }, [mapReady, fitToken, mapPoints, selectedAreaKey]);

  return <div ref={containerRef} className="customerMapCanvas" role="presentation" />;
}
