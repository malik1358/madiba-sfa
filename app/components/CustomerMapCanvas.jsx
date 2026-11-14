"use client";

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";

const AREA_ZOOM_THRESHOLD = 12;
const SAUDI_CENTER = [24.0, 45.0];
const SAUDI_ZOOM = 6;

function areaRadius(count) {
  const value = Number(count || 0);
  if (value <= 1) return 10;
  if (value <= 5) return 14;
  if (value <= 15) return 18;
  if (value <= 40) return 24;
  return 30;
}

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
  return `
    <div class="customerMapPopup">
      <strong>${city}</strong>
      <div>${name}</div>
      <div>${customers} ${label}</div>
      <div>${withGps} ${gpsLabel}</div>
    </div>
  `;
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
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    onSelectAreaRef.current = onSelectArea;
  }, [onSelectArea]);

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
      const zoom = map.getZoom();
      const showCustomers = zoom >= AREA_ZOOM_THRESHOLD;

      if (showCustomers) {
        for (const point of mapPoints) {
          const marker = L.circleMarker([point.latitude, point.longitude], {
            radius: 7,
            color: "#0f4c5c",
            weight: 1,
            fillColor: selectedAreaKey && point.area_key === selectedAreaKey ? "#e36414" : "#2a9d8f",
            fillOpacity: 0.9,
          });
          marker.bindPopup(customerPopupHtml(point));
          marker.addTo(layer);
        }
        return;
      }

      for (const area of areaRows) {
        if (area.latitude == null || area.longitude == null || !area.with_gps) continue;
        const selected = selectedAreaKey && area.area_key === selectedAreaKey;
        const marker = L.circleMarker([area.latitude, area.longitude], {
          radius: areaRadius(area.customers),
          color: selected ? "#9a3412" : "#0f4c5c",
          weight: selected ? 3 : 2,
          fillColor: selected ? "#e36414" : "#0f4c5c",
          fillOpacity: 0.72,
        });
        marker.bindTooltip(String(area.customers), {
          permanent: true,
          direction: "center",
          className: "customerMapCountLabel",
        });
        marker.bindPopup(areaPopupHtml(area, language));
        marker.on("click", () => {
          onSelectAreaRef.current?.(area.area_key);
          map.flyTo([area.latitude, area.longitude], Math.max(map.getZoom(), AREA_ZOOM_THRESHOLD + 1), {
            duration: 0.6,
          });
        });
        marker.addTo(layer);
      }
    };

    redraw();
    map.on("zoomend", redraw);
    map.invalidateSize();
    return () => {
      map.off("zoomend", redraw);
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
      map.setView(SAUDI_CENTER, SAUDI_ZOOM);
      return;
    }

    if (points.length === 1) {
      map.flyTo([points[0].latitude, points[0].longitude], 15, { duration: 0.5 });
      return;
    }

    const bounds = L.latLngBounds(points.map((point) => [point.latitude, point.longitude]));
    map.fitBounds(bounds.pad(0.18), { animate: true, maxZoom: selectedAreaKey ? 16 : 12 });
  }, [mapReady, fitToken, mapPoints, selectedAreaKey]);

  return <div ref={containerRef} className="customerMapCanvas" role="presentation" />;
}
