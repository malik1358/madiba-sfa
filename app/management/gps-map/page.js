"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";
import MorningAttendanceGate from "../../components/MorningAttendanceGate";
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

export default function GpsMapPage() {
  const { language, dir, setLanguage } = useAppLanguage();
  const t = translate(language, TEXT);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [records, setRecords] = useState([]);
  const [userRole, setUserRole] = useState("");
  const [salesmanFilter, setSalesmanFilter] = useState("ALL");
  const [actionFilter, setActionFilter] = useState("ALL");
  const [customerFilter, setCustomerFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedCustomerCode, setSelectedCustomerCode] = useState("");

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
        if (role !== "admin") {
          setError("Only administrators can view the GPS map.");
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
          .in("role", ["salesman", "manager", "admin"]);

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
    () => [
      "ALL",
      ...new Set(
        records
          .map((row) => String(row.salesman_name || row.salesman_code || row.user_id || "").trim())
          .filter(Boolean)
      ),
    ],
    [records]
  );

  const actionOptions = useMemo(
    () => ["ALL", ...new Set(records.map((row) => String(row.action || row.entry_type || "").trim()).filter(Boolean))],
    [records]
  );

  const filteredRecords = useMemo(() => {
    const query = customerFilter.trim().toLowerCase();
    const fromTs = dateFrom ? toTimestamp(`${dateFrom}T00:00:00`) : 0;
    const toTs = dateTo ? toTimestamp(`${dateTo}T23:59:59`) : 0;

    return records.filter((row) => {
      const salesmanLabel = String(row.salesman_name || row.salesman_code || row.user_id || "").trim();
      if (salesmanFilter !== "ALL" && salesmanLabel !== salesmanFilter) return false;

      const rowAction = String(row.action || row.entry_type || "").trim();
      if (actionFilter !== "ALL" && rowAction !== actionFilter) return false;

      if (query) {
        const haystack = [row.customer_code, row.customer_name, salesmanLabel]
          .map((value) => String(value || "").toLowerCase())
          .join(" ");
        if (!haystack.includes(query)) return false;
      }

      const ts = toTimestamp(row.captured_at || row.created_at);
      if (fromTs && ts < fromTs) return false;
      if (toTs && ts > toTs) return false;
      return true;
    });
  }, [records, salesmanFilter, actionFilter, customerFilter, dateFrom, dateTo]);

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
            <div className="moduleHeaderMeta"><AppLanguageSwitch language={language} setLanguage={setLanguage} /><Link href="/management" className="moduleBackLink">{t("management")}</Link></div>
          </div>

          {error && <div className="moduleError">{error}</div>}

          <div className="moduleMetricGrid">
            <section className="moduleMetricCard"><span>Visible salesmen</span><strong>{new Set(filteredRecords.map((row) => row.user_id)).size}</strong></section>
            <section className="moduleMetricCard"><span>Customer visit points</span><strong>{customerVisitPoints.length}</strong></section>
            <section className="moduleMetricCard"><span>Raw GPS captures</span><strong>{filteredRecords.length}</strong></section>
            <section className="moduleMetricCard"><span>Administrator only</span><strong>{userRole === "admin" ? "Yes" : "No"}</strong></section>
          </div>

          <section className="moduleSection">
            <div className="moduleSectionHeader">
              <h2>Filters</h2>
            </div>
            <div className="moduleFilterRow" style={{ gridTemplateColumns: "repeat(5, minmax(0, 1fr))" }}>
              <select className="moduleInput" value={salesmanFilter} onChange={(event) => setSalesmanFilter(event.target.value)}>
                {salesmanOptions.map((option) => (
                  <option key={option} value={option}>{option === "ALL" ? "All Salesmen" : option}</option>
                ))}
              </select>
              <select className="moduleInput" value={actionFilter} onChange={(event) => setActionFilter(event.target.value)}>
                {actionOptions.map((option) => (
                  <option key={option} value={option}>{option === "ALL" ? "All Actions" : option}</option>
                ))}
              </select>
              <input className="moduleInput" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
              <input className="moduleInput" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
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
                    <th>GPS</th>
                    <th>Accuracy</th>
                    <th>Google Map</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRecords.map((point) => (
                    <tr key={point.id}>
                      <td>{toDateValue(point.captured_at || point.created_at) || "-"}</td>
                      <td>{point.captured_at ? new Date(point.captured_at).toLocaleTimeString("en-GB") : "-"}</td>
                      <td>{point.salesman_name || point.salesman_code || point.user_id}</td>
                      <td>{point.customer_name || point.customer_code || "-"}</td>
                      <td>{point.action || point.entry_type}</td>
                      <td>{point.latitude.toFixed(6)}, {point.longitude.toFixed(6)}</td>
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
                  {filteredRecords.length === 0 && (
                    <tr>
                      <td colSpan={8}>No GPS captures found for selected filters.</td>
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
