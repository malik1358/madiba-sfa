"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";
import MorningAttendanceGate from "../../components/MorningAttendanceGate";
import MostVisitedPages from "../../components/MostVisitedPages";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";
import { translate, useAppLanguage } from "../../lib/appLanguage";
import { getSupabaseClient } from "../../lib/supabase";

const TEXT = {
  title: { en: "GPS Map", ar: "خريطة GPS" },
  subtitle: { en: "Customer-wise salesman visit map and raw GPS capture logs", ar: "خريطة زيارات العملاء للمندوبين مع سجلات GPS الخام" },
  management: { en: "← Management", ar: "← الإدارة" },
  loading: { en: "Loading GPS map...", ar: "جاري تحميل خريطة GPS..." },
};

function parseNotePayload(note) {
  if (!note) return null;
  if (typeof note === "object") return note;

  try {
    return JSON.parse(String(note));
  } catch {
    return null;
  }
}

function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function extractStreetName(parsed) {
  if (!parsed || typeof parsed !== "object") return "";

  const location = parsed?.location || {};
  const locationAddress = location?.address;
  const payloadAddress = parsed?.address;

  const candidates = [
    location?.street_name,
    parsed?.street_name,
    location?.street,
    parsed?.street,
    typeof locationAddress === "object" ? locationAddress?.road : "",
    typeof locationAddress === "object" ? locationAddress?.pedestrian : "",
    typeof locationAddress === "object" ? locationAddress?.residential : "",
    typeof payloadAddress === "object" ? payloadAddress?.road : "",
    typeof payloadAddress === "object" ? payloadAddress?.pedestrian : "",
    typeof payloadAddress === "object" ? payloadAddress?.residential : "",
    typeof locationAddress === "string" ? locationAddress : "",
    typeof payloadAddress === "string" ? payloadAddress : "",
  ];

  return String(candidates.find((value) => String(value || "").trim()) || "").trim();
}

function parseGps(note) {
  const parsed = parseNotePayload(note);
  if (!parsed) return null;

  const location = parsed?.location || {};
  const latitude = toFiniteNumber(location.latitude ?? location.lat ?? parsed.latitude ?? parsed.lat);
  const longitude = toFiniteNumber(location.longitude ?? location.lng ?? parsed.longitude ?? parsed.lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return {
    latitude,
    longitude,
    accuracy: toFiniteNumber(location.accuracy ?? parsed.accuracy) || 0,
    street_name: extractStreetName(parsed),
    action: parsed.action || "ATTENDANCE",
    customer_code: String(parsed.customer_code || parsed.customerCode || "").trim(),
    customer_name: String(parsed.customer_name || parsed.customerName || "").trim(),
    captured_at: parsed.captured_at || parsed.capturedAt || null,
  };
}

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function toTimestamp(value) {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function toDateValue(value) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

function getSalesmanLabel(row) {
  return String(row?.salesman_name || row?.salesman_code || row?.user_id || "").trim();
}

function classifyCaptureType(row) {
  const normalized = String(row?.action || row?.entry_type || "").trim().toUpperCase();
  return normalized === "GPS_PING" ? "Regular 15-min capture" : "Event capture";
}

function toRadians(value) {
  return (Number(value) * Math.PI) / 180;
}

function haversineDistanceKm(fromLat, fromLng, toLat, toLng) {
  const earthRadiusKm = 6371;
  const dLat = toRadians(toLat - fromLat);
  const dLng = toRadians(toLng - fromLng);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(fromLat)) * Math.cos(toRadians(toLat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

function formatDurationFromMs(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return "-";
  const totalMinutes = Math.floor(durationMs / (1000 * 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function isWithinWorkingWindow(ts, windows) {
  if (!Number.isFinite(ts)) return false;
  return windows.some(([startTs, endTs]) => ts >= startTs && ts <= endTs);
}

function buildGoogleRouteUrl(points) {
  if (!Array.isArray(points) || points.length < 2) return "#";

  const capped = points.slice(0, 25);
  const origin = `${capped[0].latitude},${capped[0].longitude}`;
  const destination = `${capped[capped.length - 1].latitude},${capped[capped.length - 1].longitude}`;
  const waypoints = capped.slice(1, -1).map((point) => `${point.latitude},${point.longitude}`).join("|");

  const params = new URLSearchParams({
    api: "1",
    origin,
    destination,
    travelmode: "driving",
  });

  if (waypoints) {
    params.set("waypoints", waypoints);
  }

  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function toCoordinateKey(latitude, longitude) {
  return `${Number(latitude).toFixed(4)},${Number(longitude).toFixed(4)}`;
}

function isInvoiceMakerRole(role) {
  const normalized = String(role || "").toLowerCase();
  return normalized === "invoice-maker" || normalized === "invoice_maker";
}

function isProductPromoterRole(role) {
  const normalized = String(role || "").toLowerCase();
  return normalized === "product-promoter" || normalized === "product_promoter";
}

export default function GpsMapPage() {
  const { language, dir, setLanguage } = useAppLanguage();
  const t = translate(language, TEXT);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [records, setRecords] = useState([]);
  const [userRole, setUserRole] = useState("");
  const [selectedSalesmen, setSelectedSalesmen] = useState([]);
  const [selectedDates, setSelectedDates] = useState([]);
  const [actionFilter, setActionFilter] = useState("ALL");
  const [customerFilter, setCustomerFilter] = useState("");
  const [selectedCustomerCode, setSelectedCustomerCode] = useState("");
  const [routeSalesman, setRouteSalesman] = useState("");
  const [routeDate, setRouteDate] = useState("");
  const [streetByCoordinate, setStreetByCoordinate] = useState({});
  const [streetLookupBusy, setStreetLookupBusy] = useState(false);

  useEffect(() => {
    async function load() {
      const supabase = getSupabaseClient();
      if (!supabase) {
        setLoading(false);
        return;
      }

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session?.user) {
          throw new Error("Please login again.");
        }

        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", session.user.id)
          .single();

        if (profileError) throw profileError;

        const role = String(profile?.role || "").toLowerCase();
        setUserRole(role);
        if (role !== "admin" && !isInvoiceMakerRole(role) && !isProductPromoterRole(role)) {
          setError("Only administrators, invoice-makers, and product promoters can view the GPS map.");
          return;
        }

        const { data: logs, error: logsError } = await supabase
          .from("daily_activity_logs")
          .select("id,user_id,entry_type,note,created_at")
          .order("created_at", { ascending: false })
          .limit(5000);

        if (logsError) throw logsError;

        const { data: profiles, error: profilesError } = await supabase
          .from("profiles")
          .select("id,salesman_code,salesman_name")
          .in("role", ["salesman", "manager", "admin", "invoice-maker", "invoice_maker", "product-promoter", "product_promoter"]);

        if (profilesError) throw profilesError;

        const profileMap = new Map((profiles || []).map((row) => [row.id, row]));

        const rows = (logs || [])
          .map((log) => {
            const gps = parseGps(log.note);
            if (!gps) return null;

            const profileRow = profileMap.get(log.user_id) || null;
            const capturedAt = gps.captured_at || log.created_at;

            return {
              id: log.id,
              user_id: log.user_id,
              salesman_code: String(profileRow?.salesman_code || "").trim(),
              salesman_name: String(profileRow?.salesman_name || "").trim(),
              entry_type: String(log.entry_type || "").trim(),
              action: String(gps.action || log.entry_type || "GPS").trim(),
              customer_code: String(gps.customer_code || "").trim(),
              customer_name: String(gps.customer_name || "").trim(),
              latitude: gps.latitude,
              longitude: gps.longitude,
              accuracy: gps.accuracy,
              street_name: String(gps.street_name || "").trim(),
              captured_at: capturedAt,
              created_at: log.created_at,
            };
          })
          .filter((row) => row && Number.isFinite(row.latitude) && Number.isFinite(row.longitude));

        setRecords(rows);
      } catch (err) {
        setError(err.message || "Unable to load GPS map.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  const salesmanOptions = useMemo(
    () => [...new Set(records.map((row) => getSalesmanLabel(row)).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [records]
  );

  const dateOptions = useMemo(
    () => [...new Set(records.map((row) => toDateValue(row.captured_at || row.created_at)).filter(Boolean))].sort((a, b) => b.localeCompare(a)),
    [records]
  );

  const actionOptions = useMemo(
    () => ["ALL", ...new Set(records.map((row) => String(row.action || row.entry_type || "").trim()).filter(Boolean))],
    [records]
  );

  const filteredRecords = useMemo(() => {
    const query = customerFilter.trim().toLowerCase();
    const selectedSalesmanSet = new Set(selectedSalesmen);
    const selectedDateSet = new Set(selectedDates);

    return records.filter((row) => {
      const salesmanLabel = getSalesmanLabel(row);
      if (selectedSalesmanSet.size > 0 && !selectedSalesmanSet.has(salesmanLabel)) return false;

      const rowAction = String(row.action || row.entry_type || "").trim();
      if (actionFilter !== "ALL" && rowAction !== actionFilter) return false;

      const rowDate = toDateValue(row.captured_at || row.created_at);
      if (selectedDateSet.size > 0 && !selectedDateSet.has(rowDate)) return false;

      if (query) {
        const haystack = [row.customer_code, row.customer_name, salesmanLabel]
          .map((value) => String(value || "").toLowerCase())
          .join(" ");
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [records, selectedSalesmen, selectedDates, actionFilter, customerFilter]);

  const enrichedFilteredRecords = useMemo(() => {
    const sortedByTimeAsc = [...filteredRecords].sort(
      (a, b) => toTimestamp(a.captured_at || a.created_at) - toTimestamp(b.captured_at || b.created_at)
    );

    const previousByUser = new Map();
    const distanceById = new Map();

    sortedByTimeAsc.forEach((row) => {
      const previous = previousByUser.get(row.user_id);
      if (
        previous &&
        Number.isFinite(previous.latitude) &&
        Number.isFinite(previous.longitude) &&
        Number.isFinite(row.latitude) &&
        Number.isFinite(row.longitude)
      ) {
        distanceById.set(
          row.id,
          haversineDistanceKm(previous.latitude, previous.longitude, row.latitude, row.longitude)
        );
      } else {
        distanceById.set(row.id, null);
      }

      previousByUser.set(row.user_id, row);
    });

    return filteredRecords.map((row) => ({
      ...row,
      capture_type: classifyCaptureType(row),
      distance_from_previous_km: distanceById.get(row.id),
    }));
  }, [filteredRecords]);

  const customerVisitPoints = useMemo(() => {
    const latestByCustomer = new Map();

    filteredRecords
      .filter((row) => normalizeCode(row.customer_code))
      .forEach((row) => {
        const code = normalizeCode(row.customer_code);
        const current = latestByCustomer.get(code);
        const rowTs = toTimestamp(row.captured_at || row.created_at);
        const currentTs = current ? toTimestamp(current.captured_at || current.created_at) : 0;

        if (!current || rowTs > currentTs) {
          latestByCustomer.set(code, row);
        }
      });

    return Array.from(latestByCustomer.values()).sort((a, b) => {
      const byTime = toTimestamp(b.captured_at || b.created_at) - toTimestamp(a.captured_at || a.created_at);
      if (byTime !== 0) return byTime;
      return String(a.customer_name || a.customer_code || "").localeCompare(String(b.customer_name || b.customer_code || ""));
    });
  }, [filteredRecords]);

  const salesmanLastSeen = useMemo(() => {
    const map = new Map();

    filteredRecords.forEach((row) => {
      const key = row.user_id;
      const ts = toTimestamp(row.captured_at || row.created_at);
      const current = map.get(key);
      const currentTs = current ? toTimestamp(current.captured_at || current.created_at) : 0;
      if (!current || ts > currentTs) {
        map.set(key, row);
      }
    });

    return Array.from(map.values()).sort(
      (a, b) => toTimestamp(b.captured_at || b.created_at) - toTimestamp(a.captured_at || a.created_at)
    );
  }, [filteredRecords]);

  const selectedPoint = useMemo(() => {
    if (!customerVisitPoints.length) return null;

    const preferred = customerVisitPoints.find((row) => normalizeCode(row.customer_code) === normalizeCode(selectedCustomerCode));
    return preferred || customerVisitPoints[0];
  }, [customerVisitPoints, selectedCustomerCode]);

  const routeSalesmanOptions = useMemo(
    () => [...new Set(records.map((row) => getSalesmanLabel(row)).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [records]
  );

  const effectiveRouteSalesman = routeSalesmanOptions.includes(routeSalesman)
    ? routeSalesman
    : routeSalesmanOptions[0] || "";

  const routeDateOptions = useMemo(() => {
    const source = records.filter((row) => {
      if (!effectiveRouteSalesman) return false;
      return getSalesmanLabel(row) === effectiveRouteSalesman;
    });
    return [...new Set(source.map((row) => toDateValue(row.captured_at || row.created_at)).filter(Boolean))].sort((a, b) => b.localeCompare(a));
  }, [records, effectiveRouteSalesman]);

  const effectiveRouteDate = routeDateOptions.includes(routeDate)
    ? routeDate
    : routeDateOptions[0] || "";

  const routeDayRecords = useMemo(() => {
    if (!effectiveRouteSalesman || !effectiveRouteDate) return [];

    return records
      .filter((row) => getSalesmanLabel(row) === effectiveRouteSalesman)
      .filter((row) => toDateValue(row.captured_at || row.created_at) === effectiveRouteDate)
      .sort((a, b) => toTimestamp(a.captured_at || a.created_at) - toTimestamp(b.captured_at || b.created_at));
  }, [records, effectiveRouteSalesman, effectiveRouteDate]);

  const routeWorkingWindows = useMemo(() => {
    let morningTs = 0;
    let lunchOutTs = 0;
    let lunchInTs = 0;
    let endOfDayTs = 0;

    routeDayRecords.forEach((row) => {
      const rowAction = String(row.action || row.entry_type || "").trim().toUpperCase();
      const ts = toTimestamp(row.captured_at || row.created_at);
      if (!ts) return;

      if (rowAction === "MORNING_ATTENDANCE" && !morningTs) {
        morningTs = ts;
        return;
      }
      if (rowAction === "LUNCH_BREAK_OUT" && morningTs && !lunchOutTs && ts >= morningTs) {
        lunchOutTs = ts;
        return;
      }
      if (rowAction === "LUNCH_BREAK_IN" && lunchOutTs && !lunchInTs && ts >= lunchOutTs) {
        lunchInTs = ts;
        return;
      }
      if (rowAction === "END_OF_DAY" && lunchInTs && !endOfDayTs && ts >= lunchInTs) {
        endOfDayTs = ts;
      }
    });

    const windows = [];
    if (morningTs && lunchOutTs && lunchOutTs > morningTs) {
      windows.push([morningTs, lunchOutTs]);
    }
    if (lunchInTs && endOfDayTs && endOfDayTs > lunchInTs) {
      windows.push([lunchInTs, endOfDayTs]);
    }

    return windows;
  }, [routeDayRecords]);

  const routeWorkingPins = useMemo(() => {
    if (routeDayRecords.length === 0) return [];

    if (routeWorkingWindows.length === 0) {
      return routeDayRecords;
    }

    return routeDayRecords.filter((row) => isWithinWorkingWindow(toTimestamp(row.captured_at || row.created_at), routeWorkingWindows));
  }, [routeDayRecords, routeWorkingWindows]);

  useEffect(() => {
    const missingCoordinates = [...new Set(
      routeWorkingPins
        .filter((pin) => !String(pin.street_name || "").trim())
        .map((pin) => toCoordinateKey(pin.latitude, pin.longitude))
        .filter((key) => !streetByCoordinate[key])
    )].slice(0, 40);

    if (missingCoordinates.length === 0) return undefined;

    let active = true;

    async function resolveStreetNames() {
      setStreetLookupBusy(true);
      const resolved = {};

      for (const coordinateKey of missingCoordinates) {
        const [lat, lng] = coordinateKey.split(",");

        try {
          const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}`,
            {
              headers: {
                Accept: "application/json",
              },
            }
          );

          if (!response.ok) throw new Error("reverse_geocode_failed");
          const payload = await response.json();
          const address = payload?.address || {};

          const streetLabel = String(
            address.road ||
            address.pedestrian ||
            address.residential ||
            address.neighbourhood ||
            address.suburb ||
            address.city_district ||
            payload?.name ||
            ""
          ).trim();

          resolved[coordinateKey] = streetLabel || "Street unavailable";
        } catch {
          resolved[coordinateKey] = "Street unavailable";
        }
      }

      if (!active) return;

      setStreetByCoordinate((current) => ({
        ...current,
        ...resolved,
      }));
      setStreetLookupBusy(false);
    }

    resolveStreetNames();

    return () => {
      active = false;
    };
  }, [routeWorkingPins, streetByCoordinate]);

  const routeTotalDistanceKm = useMemo(() => {
    let total = 0;
    for (let i = 1; i < routeWorkingPins.length; i += 1) {
      const prev = routeWorkingPins[i - 1];
      const current = routeWorkingPins[i];
      total += haversineDistanceKm(prev.latitude, prev.longitude, current.latitude, current.longitude);
    }
    return total;
  }, [routeWorkingPins]);

  const routeStreetSummary = useMemo(() => {
    if (routeWorkingPins.length === 0) return [];

    const sortedPins = [...routeWorkingPins].sort(
      (a, b) => toTimestamp(a.captured_at || a.created_at) - toTimestamp(b.captured_at || b.created_at)
    );

    const sessions = [];
    let currentSession = null;

    for (let index = 0; index < sortedPins.length; index += 1) {
      const pin = sortedPins[index];
      const ts = toTimestamp(pin.captured_at || pin.created_at);
      if (!ts) continue;

      const nextPin = sortedPins[index + 1] || null;
      const nextTs = nextPin ? toTimestamp(nextPin.captured_at || nextPin.created_at) : ts;
      const pinnedStreet = String(pin.street_name || "").trim();
      const coordinateKey = toCoordinateKey(pin.latitude, pin.longitude);
      const geocodedStreet = String(streetByCoordinate[coordinateKey] || "").trim();
      const fallbackStreet = `Near ${Number(pin.latitude).toFixed(4)}, ${Number(pin.longitude).toFixed(4)}`;
      const streetName = pinnedStreet || geocodedStreet || fallbackStreet;
      const customerLabel = String(pin.customer_name || pin.customer_code || "").trim();

      if (!currentSession || currentSession.streetName !== streetName) {
        if (currentSession) {
          currentSession.toTs = ts;
          currentSession.durationMs = Math.max(0, currentSession.toTs - currentSession.fromTs);
          currentSession.customers = Array.from(currentSession.customerSet).sort((a, b) => a.localeCompare(b));
          sessions.push(currentSession);
        }

        currentSession = {
          streetName,
          fromTs: ts,
          toTs: ts,
          durationMs: 0,
          pinCount: 0,
          latitude: pin.latitude,
          longitude: pin.longitude,
          customerSet: new Set(),
          customers: [],
        };
      }

      currentSession.pinCount += 1;
      currentSession.latitude = pin.latitude;
      currentSession.longitude = pin.longitude;
      if (customerLabel) {
        currentSession.customerSet.add(customerLabel);
      }

      if (!nextPin) {
        currentSession.toTs = ts;
        currentSession.durationMs = Math.max(0, currentSession.toTs - currentSession.fromTs);
        currentSession.customers = Array.from(currentSession.customerSet).sort((a, b) => a.localeCompare(b));
        sessions.push(currentSession);
        currentSession = null;
      } else {
        currentSession.toTs = nextTs;
      }
    }

    return sessions.sort((a, b) => a.fromTs - b.fromTs);
  }, [routeWorkingPins, streetByCoordinate]);

  const streetsOverThirtyMins = useMemo(
    () => routeStreetSummary.filter((row) => row.durationMs >= 30 * 60 * 1000).length,
    [routeStreetSummary]
  );

  const routeStreetTotalDurationMs = useMemo(
    () => routeStreetSummary.reduce((total, row) => total + Number(row.durationMs || 0), 0),
    [routeStreetSummary]
  );

  const routeStreetTotalPins = useMemo(
    () => routeStreetSummary.reduce((total, row) => total + Number(row.pinCount || 0), 0),
    [routeStreetSummary]
  );

  const routeMapLink = useMemo(() => buildGoogleRouteUrl(routeWorkingPins), [routeWorkingPins]);

  const mapUrl = useMemo(() => {
    if (!selectedPoint) return "";
    return `https://maps.google.com/maps?q=${encodeURIComponent(`${selectedPoint.latitude},${selectedPoint.longitude}`)}&z=15&output=embed`;
  }, [selectedPoint]);

  const openMapUrl = useMemo(() => {
    if (!selectedPoint) return "#";
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${selectedPoint.latitude},${selectedPoint.longitude}`)}`;
  }, [selectedPoint]);

  const supabaseClient = getSupabaseClient();
  if (!supabaseClient) {
    return (
      <SupabaseUnavailable
        title="GPS map unavailable"
        message="Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to view salesman GPS locations."
      />
    );
  }

  if (loading) {
    return (
      <main className="modulePage" dir={dir}>
        <div className="moduleShell">
          <div className="moduleLoading">{t("loading")}</div>
        </div>
      </main>
    );
  }

  return (
    <MorningAttendanceGate>
      <main className="modulePage" dir={dir}>
        <div className="moduleShell">
          <div className="moduleHeader">
            <div>
              <p className="moduleEyebrow">MADIBA SFA</p>
              <h1>{t("title")}</h1>
              <p className="moduleSubtitle">{t("subtitle")}</p>
            </div>
            <div className="moduleHeaderMeta"><AppLanguageSwitch language={language} setLanguage={setLanguage} /><MostVisitedPages /><Link href="/management" className="moduleBackLink">{t("management")}</Link></div>
          </div>

          {error && <div className="moduleError">{error}</div>}

          <div className="moduleMetricGrid">
            <section className="moduleMetricCard"><span>Visible salesmen</span><strong>{new Set(filteredRecords.map((row) => row.user_id)).size}</strong></section>
            <section className="moduleMetricCard"><span>Customer visit points</span><strong>{customerVisitPoints.length}</strong></section>
            <section className="moduleMetricCard"><span>Raw GPS captures</span><strong>{enrichedFilteredRecords.length}</strong></section>
            <section className="moduleMetricCard"><span>Admin/Invoice-maker</span><strong>{userRole === "admin" || isInvoiceMakerRole(userRole) ? "Yes" : "No"}</strong></section>
          </div>

          <section className="moduleSection">
            <div className="moduleSectionHeader">
              <h2>Filters</h2>
            </div>
            <div className="moduleFilterRow" style={{ gridTemplateColumns: "repeat(5, minmax(0, 1fr))" }}>
              <select
                className="moduleInput"
                multiple
                value={selectedSalesmen}
                onChange={(event) => setSelectedSalesmen(Array.from(event.target.selectedOptions).map((option) => option.value))}
                title="Select one or more salesmen"
                style={{ minHeight: "120px" }}
              >
                {salesmanOptions.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
              <select className="moduleInput" value={actionFilter} onChange={(event) => setActionFilter(event.target.value)}>
                {actionOptions.map((option) => (
                  <option key={option} value={option}>{option === "ALL" ? "All Actions" : option}</option>
                ))}
              </select>
              <select
                className="moduleInput"
                multiple
                value={selectedDates}
                onChange={(event) => setSelectedDates(Array.from(event.target.selectedOptions).map((option) => option.value))}
                title="Select one or more dates"
                style={{ minHeight: "120px" }}
              >
                {dateOptions.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
              <div className="moduleHint" style={{ alignSelf: "center" }}>
                Multi-select help: hold Ctrl (or Cmd) while clicking.
              </div>
              <input className="moduleInput" type="search" placeholder="Customer code/name" value={customerFilter} onChange={(event) => setCustomerFilter(event.target.value)} />
            </div>
          </section>

          <section className="moduleSection">
            <div className="moduleSectionHeader">
              <h2>Google Map (Customer-wise Visit)</h2>
              <span>Latest captured point per customer</span>
            </div>
            {selectedPoint ? (
              <>
                <div className="gpsMapShell" style={{ padding: 0 }}>
                  <iframe
                    title="Customer visit map"
                    src={mapUrl}
                    width="100%"
                    height="420"
                    style={{ border: 0, display: "block" }}
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                  />
                </div>
                <div className="moduleFilterRow" style={{ marginTop: "10px" }}>
                  <div className="moduleHint">
                    Showing: {selectedPoint.customer_name || selectedPoint.customer_code} ({selectedPoint.customer_code || "-"}) • {selectedPoint.salesman_name || selectedPoint.salesman_code || selectedPoint.user_id}
                  </div>
                  <a className="moduleInlineButton" href={openMapUrl} target="_blank" rel="noreferrer">Open in Google Maps</a>
                </div>
              </>
            ) : (
              <div className="moduleHint">No customer-wise GPS visit points found for current filters.</div>
            )}
          </section>

          <section className="moduleSection">
            <div className="moduleSectionHeader">
              <h2>Salesman Route (All GPS Pins)</h2>
              <span>See full day route and long stays</span>
            </div>
            <div className="moduleFilterRow" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
              <select className="moduleInput" value={effectiveRouteSalesman} onChange={(event) => setRouteSalesman(event.target.value)}>
                {routeSalesmanOptions.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
              <select className="moduleInput" value={effectiveRouteDate} onChange={(event) => setRouteDate(event.target.value)}>
                {routeDateOptions.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </div>

            <div className="moduleMetricGrid">
              <section className="moduleMetricCard"><span>Route pins (working hours)</span><strong>{routeWorkingPins.length}</strong></section>
              <section className="moduleMetricCard"><span>Total route distance</span><strong>{routeTotalDistanceKm.toFixed(2)} km</strong></section>
              <section className="moduleMetricCard"><span>Street sessions over 30 mins</span><strong>{streetsOverThirtyMins}</strong></section>
              <section className="moduleMetricCard"><span>Working-window mode</span><strong>{routeWorkingWindows.length > 0 ? "Attendance based" : "All day pins"}</strong></section>
            </div>

            <div className="moduleFilterRow" style={{ marginTop: "10px" }}>
              <div className="moduleHint">
                {routeWorkingWindows.length > 0
                  ? "Pins are filtered to working windows (Check-in->Lunch Out and Lunch In->End of Day)."
                  : "Attendance pair logs are incomplete for this day, so route uses all captured pins."}
              </div>
              {routeWorkingPins.length >= 2 ? (
                <a className="moduleInlineButton" href={routeMapLink} target="_blank" rel="noreferrer">Open Route in Google Maps</a>
              ) : (
                <span className="moduleHint">Need at least 2 pins to open a route.</span>
              )}
            </div>
            {routeWorkingPins.length > 25 && (
              <div className="moduleHint" style={{ marginTop: "8px" }}>
                Google Maps route link uses first 25 pins due waypoint limits.
              </div>
            )}
            {streetLookupBusy && (
              <div className="moduleHint" style={{ marginTop: "8px" }}>
                Resolving street names from map data...
              </div>
            )}

            <div className="moduleTableWrap" style={{ marginTop: "12px" }}>
              <table className="moduleTable">
                <thead>
                  <tr>
                    <th>Street</th>
                    <th>Customer Visited</th>
                    <th>From</th>
                    <th>To</th>
                    <th>Time Spent</th>
                    <th>Pins</th>
                    <th>30+ mins</th>
                    <th>Map</th>
                  </tr>
                </thead>
                <tbody>
                  {routeStreetSummary.map((street) => (
                    <tr key={`${street.streetName}-${street.fromTs}-${street.toTs}-${street.pinCount}`}>
                      <td>{street.streetName}</td>
                      <td>{street.customers.length > 0 ? street.customers.join(", ") : "-"}</td>
                      <td>{new Date(street.fromTs).toLocaleString("en-GB")}</td>
                      <td>{new Date(street.toTs).toLocaleString("en-GB")}</td>
                      <td>{formatDurationFromMs(street.durationMs)}</td>
                      <td>{street.pinCount}</td>
                      <td>{street.durationMs >= 30 * 60 * 1000 ? "Yes" : "No"}</td>
                      <td>
                        <a
                          className="moduleInlineButton"
                          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${street.latitude},${street.longitude}`)}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open
                        </a>
                      </td>
                    </tr>
                  ))}
                  {routeStreetSummary.length > 0 && (
                    <tr>
                      <td><strong>Total</strong></td>
                      <td>-</td>
                      <td>-</td>
                      <td>-</td>
                      <td><strong>{formatDurationFromMs(routeStreetTotalDurationMs)}</strong></td>
                      <td><strong>{routeStreetTotalPins}</strong></td>
                      <td><strong>{streetsOverThirtyMins}</strong></td>
                      <td>-</td>
                    </tr>
                  )}
                  {routeStreetSummary.length === 0 && (
                    <tr>
                      <td colSpan={8}>No street-level GPS summary available for selected day.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="moduleSection">
            <div className="moduleSectionHeader">
              <h2>Customer-wise Latest Visit Points</h2>
            </div>
            <div className="moduleTableWrap">
              <table className="moduleTable">
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Salesman</th>
                    <th>Action</th>
                    <th>GPS</th>
                    <th>Captured At</th>
                    <th>Map</th>
                  </tr>
                </thead>
                <tbody>
                  {customerVisitPoints.map((point) => (
                    <tr key={`${point.customer_code}-${point.id}`}>
                      <td>{point.customer_name || point.customer_code || "-"}<div className="moduleCode">{point.customer_code || "-"}</div></td>
                      <td>{point.salesman_name || point.salesman_code || point.user_id}</td>
                      <td>{point.action || point.entry_type}</td>
                      <td>{point.latitude.toFixed(6)}, {point.longitude.toFixed(6)}</td>
                      <td>{point.captured_at ? new Date(point.captured_at).toLocaleString("en-GB") : "-"}</td>
                      <td>
                        <div className="moduleInlineStack">
                          <button type="button" className="moduleInlineButton" onClick={() => setSelectedCustomerCode(point.customer_code || "")}>View</button>
                          <a className="moduleInlineButton" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${point.latitude},${point.longitude}`)}`} target="_blank" rel="noreferrer">Open</a>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {customerVisitPoints.length === 0 && (
                    <tr>
                      <td colSpan={6}>No customer-wise visit points found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="moduleSection">
            <div className="moduleSectionHeader">
              <h2>Last Seen by Salesman</h2>
              <span>Latest record per user for current filters</span>
            </div>
            <div className="moduleTableWrap">
              <table className="moduleTable">
                <thead>
                  <tr>
                    <th>Salesman</th>
                    <th>User ID</th>
                    <th>Last Action</th>
                    <th>Last Seen</th>
                    <th>GPS</th>
                  </tr>
                </thead>
                <tbody>
                  {salesmanLastSeen.map((row) => (
                    <tr key={`last-seen-${row.user_id}`}>
                      <td>{row.salesman_name || row.salesman_code || row.user_id}</td>
                      <td><span className="moduleCode">{row.user_id}</span></td>
                      <td>{row.action || row.entry_type || "-"}</td>
                      <td>{row.captured_at ? new Date(row.captured_at).toLocaleString("en-GB") : "-"}</td>
                      <td>{row.latitude.toFixed(6)}, {row.longitude.toFixed(6)}</td>
                    </tr>
                  ))}
                  {salesmanLastSeen.length === 0 && (
                    <tr>
                      <td colSpan={5}>No salesman activity found for selected filters.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="moduleSection">
            <div className="moduleSectionHeader">
              <h2>Raw GPS Capture Log</h2>
              <span>Filterable backend capture records</span>
            </div>
            <div className="moduleTableWrap">
              <table className="moduleTable">
                <thead>
                  <tr>
                    <th>Captured Date</th>
                    <th>Captured Time</th>
                    <th>Salesman</th>
                    <th>Customer</th>
                    <th>Action</th>
                    <th>Capture Type</th>
                    <th>GPS</th>
                    <th>Distance From Previous</th>
                    <th>Accuracy</th>
                    <th>Google Map</th>
                  </tr>
                </thead>
                <tbody>
                  {enrichedFilteredRecords.map((point) => (
                    <tr key={point.id}>
                      <td>{toDateValue(point.captured_at || point.created_at) || "-"}</td>
                      <td>{point.captured_at ? new Date(point.captured_at).toLocaleTimeString("en-GB") : "-"}</td>
                      <td>{point.salesman_name || point.salesman_code || point.user_id}</td>
                      <td>{point.customer_name || point.customer_code || "-"}</td>
                      <td>{point.action || point.entry_type}</td>
                      <td>{point.capture_type}</td>
                      <td>{point.latitude.toFixed(6)}, {point.longitude.toFixed(6)}</td>
                      <td>{Number.isFinite(point.distance_from_previous_km) ? `${point.distance_from_previous_km.toFixed(2)} km` : "-"}</td>
                      <td>{point.accuracy ? `${Number(point.accuracy).toFixed(1)} m` : "-"}</td>
                      <td>
                        <a
                          className="moduleInlineButton"
                          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${point.latitude},${point.longitude}`)}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open
                        </a>
                      </td>
                    </tr>
                  ))}
                  {enrichedFilteredRecords.length === 0 && (
                    <tr>
                      <td colSpan={10}>No GPS captures found for selected filters.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </main>
    </MorningAttendanceGate>
  );
}
