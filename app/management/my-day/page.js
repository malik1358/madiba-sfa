"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { getSupabaseClient } from "../../lib/supabase";
import { fetchSalesScope } from "../../lib/salesScope";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";
import { detectTable } from "../../lib/schemaGuards";

function daysBetween(date) {
  if (!date) return 0;
  const target = new Date(`${date}T00:00:00`);
  const now = new Date();
  const diff = now.getTime() - target.getTime();
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
}

export default function MyDayPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [warnings, setWarnings] = useState([]);
  const [logsEnabled, setLogsEnabled] = useState(true);
  const [prospectsEnabled, setProspectsEnabled] = useState(true);
  const [profile, setProfile] = useState(null);
  const [summary, setSummary] = useState({
    visitsToday: 0,
    followUps: 0,
    pendingOrders: 0,
    overdueVisits: 0,
    newCustomersAssigned: 0,
    completedVisits: 0,
  });
  const [routeRows, setRouteRows] = useState([]);
  const [visitStatusRows, setVisitStatusRows] = useState([]);
  const [todayLogs, setTodayLogs] = useState([]);
  const [note, setNote] = useState("");
  const [attendanceBusy, setAttendanceBusy] = useState("");
  const [latestGpsCaptureAt, setLatestGpsCaptureAt] = useState(0);
  const [accessScope, setAccessScope] = useState(null);
  const autoPingInFlight = useRef(false);

  const today = new Date().toISOString().slice(0, 10);

  function readCapturedAt(log) {
    if (!log?.note) return 0;

    try {
      const parsed = JSON.parse(log.note);
      const capturedAt = parsed?.captured_at || log.created_at;
      const time = new Date(capturedAt).getTime();
      return Number.isFinite(time) ? time : 0;
    } catch {
      return 0;
    }
  }

  function isGpsLog(entryType) {
    return ["MORNING_ATTENDANCE", "LUNCH_BREAK_OUT", "LUNCH_BREAK_IN", "END_OF_DAY", "NOTE", "GPS_PING"].includes(entryType);
  }

  useEffect(() => {
    async function load() {
      const supabase = getSupabaseClient();
      if (!supabase) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError("");
      setWarnings([]);

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session?.user) {
          throw new Error("Please login again.");
        }

        const scope = await fetchSalesScope();
        setAccessScope(scope);

        const { data: profileData, error: profileError } = await supabase
          .from("profiles")
          .select("id,salesman_code,salesman_name")
          .eq("id", session.user.id)
          .single();

        if (profileError) throw profileError;
        setProfile(profileData);

        const [logsCheck, prospectsCheck] = await Promise.all([
          detectTable(supabase, "daily_activity_logs"),
          detectTable(supabase, "prospects"),
        ]);

        setLogsEnabled(logsCheck.available);
        setProspectsEnabled(prospectsCheck.available);

        const nextWarnings = [];
        if (!logsCheck.available) {
          nextWarnings.push(`${logsCheck.reason}. Check-in/check-out and notes are disabled.`);
        }
        if (!prospectsCheck.available) {
          nextWarnings.push(`${prospectsCheck.reason}. New customers assigned metric is unavailable.`);
        }
        setWarnings(nextWarnings);

        let todaySalesQuery = supabase
          .from("sales_raw")
          .select("customer_code,sales_amount")
          .eq("transaction_date", today);

        let pendingOrdersQuery = supabase
          .from("sales_orders")
          .select("id,status,created_by,salesman_code")
          .eq("status", "DRAFT");

        let submittedOrdersQuery = supabase
          .from("sales_orders")
          .select("id,status,created_by,salesman_code")
          .eq("status", "SUBMITTED")
          .gte("submitted_at", `${today}T00:00:00`)
          .lte("submitted_at", `${today}T23:59:59`);

        let customersQuery = supabase
          .from("customers")
          .select("customer_code,customer_name,city,area,latest_transaction_date,current_salesman_code");

        let routeQuery = supabase
          .from("customers")
          .select("customer_code,customer_name,city,area,latest_transaction_date")
          .order("city")
          .limit(20);

        if (scope.hasAllAccess) {
          // no-op
        } else {
          todaySalesQuery = todaySalesQuery.in("salesman_code", scope.visibleSalesmanCodes);
          customersQuery = customersQuery.in("current_salesman_code", scope.visibleSalesmanCodes);
          routeQuery = routeQuery.in("current_salesman_code", scope.visibleSalesmanCodes);
        }

        const [
          todaySalesRes,
          pendingOrdersRes,
          submittedTodayRes,
          customersRes,
          routeRes,
        ] = await Promise.all([
          todaySalesQuery,
          pendingOrdersQuery,
          submittedOrdersQuery,
          customersQuery,
          routeQuery,
        ]);

        if (todaySalesRes.error) throw todaySalesRes.error;
        if (pendingOrdersRes.error) throw pendingOrdersRes.error;
        if (submittedTodayRes.error) throw submittedTodayRes.error;
        if (customersRes.error) throw customersRes.error;
        if (routeRes.error) throw routeRes.error;

        let newProspectsCount = 0;
        if (prospectsCheck.available) {
          let prospectsQuery = supabase
            .from("prospects")
            .select("id")
            .gte("created_at", `${today}T00:00:00`);

          if (!scope.hasAllAccess) {
            prospectsQuery = prospectsQuery.in("salesman_code", scope.visibleSalesmanCodes);
          }

          const { data: newProspectsData, error: newProspectsError } = await prospectsQuery;

          if (!newProspectsError) {
            newProspectsCount = (newProspectsData || []).length;
          }
        }

        if (logsCheck.available) {
          let logsQuery = supabase
            .from("daily_activity_logs")
            .select("id,user_id,entry_type,note,created_at")
            .gte("created_at", `${today}T00:00:00`)
            .lte("created_at", `${today}T23:59:59`)
            .order("created_at", { ascending: false });

          if (!scope.hasAllAccess) {
            logsQuery = logsQuery.in("user_id", scope.visibleUserIds);
          }

          const { data: logsData, error: logsError } = await logsQuery;

          if (!logsError) {
            const rows = logsData || [];
            setTodayLogs(rows);

            const newestGpsCapture = rows
              .filter((row) => isGpsLog(row.entry_type))
              .reduce((latest, row) => Math.max(latest, readCapturedAt(row)), 0);

            setLatestGpsCaptureAt(newestGpsCapture);
          } else {
            setTodayLogs([]);
            setLatestGpsCaptureAt(0);
          }
        } else {
          setTodayLogs([]);
          setLatestGpsCaptureAt(0);
        }

        const todayCustomers = new Set((todaySalesRes.data || []).map((row) => row.customer_code).filter(Boolean));
        const productiveCustomers = new Set(
          (todaySalesRes.data || [])
            .filter((row) => Number(row.sales_amount || 0) > 0)
            .map((row) => row.customer_code)
            .filter(Boolean)
        );

        const customerRows = customersRes.data || [];
        const overdueRows = customerRows.filter((row) => daysBetween(row.latest_transaction_date) > 21);
        const followUpRows = customerRows.filter((row) => daysBetween(row.latest_transaction_date) > 10);

        const visiblePendingOrders = (pendingOrdersRes.data || []).filter((row) => {
          if (scope.hasAllAccess) return true;
          return scope.visibleUserIds.includes(row.created_by) || scope.visibleSalesmanCodes.includes(String(row.salesman_code || "").trim().toUpperCase());
        });

        const visibleSubmittedOrders = (submittedTodayRes.data || []).filter((row) => {
          if (scope.hasAllAccess) return true;
          return scope.visibleUserIds.includes(row.created_by) || scope.visibleSalesmanCodes.includes(String(row.salesman_code || "").trim().toUpperCase());
        });

        setSummary({
          visitsToday: todayCustomers.size,
          followUps: followUpRows.length,
          pendingOrders: visiblePendingOrders.length,
          overdueVisits: overdueRows.length,
          newCustomersAssigned: newProspectsCount,
          completedVisits: productiveCustomers.size,
        });

        setRouteRows(routeRes.data || []);

        setVisitStatusRows(
          customerRows
            .slice(0, 30)
            .map((row) => ({
              customer_code: row.customer_code,
              customer_name: row.customer_name,
              city: row.city,
              area: row.area,
              days_since_last: daysBetween(row.latest_transaction_date),
              status: todayCustomers.has(row.customer_code)
                ? "Visited"
                : daysBetween(row.latest_transaction_date) > 21
                ? "Overdue"
                : "Planned",
            }))
        );
      } catch (err) {
        setError(err.message || "Unable to load My Day planner.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [today]);

  async function captureLocation() {
    if (!navigator.geolocation) {
      throw new Error("Geolocation is not supported on this device.");
    }

    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            latitude: Number(position.coords.latitude.toFixed(6)),
            longitude: Number(position.coords.longitude.toFixed(6)),
            accuracy: Number(position.coords.accuracy.toFixed(1)),
          });
        },
        () => reject(new Error("Unable to read GPS location.")),
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });
  }

  async function addLog(entryType) {
    if (!logsEnabled) {
      setError("Daily activity logs are disabled until the daily_activity_logs table is available.");
      return;
    }

    const supabase = getSupabaseClient();
    if (!supabase) {
      setError("Supabase is not configured.");
      return;
    }

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) {
        throw new Error("Please login again.");
      }

      const location = await captureLocation();

      const payload = {
        user_id: session.user.id,
        entry_type: entryType,
        note: JSON.stringify({
          action: entryType,
          note: entryType === "NOTE" ? note || null : null,
          captured_at: new Date().toISOString(),
          location,
        }),
      };

      const { error: insertError } = await supabase.from("daily_activity_logs").insert(payload);
      if (insertError) throw insertError;

      setMessage(entryType === "NOTE" ? "Note saved with GPS." : `${entryType} logged with GPS.`);
      if (entryType === "NOTE") setNote("");

      const { data: logs, error: logsError } = await supabase
        .from("daily_activity_logs")
        .select("id,entry_type,note,created_at")
        .eq("user_id", session.user.id)
        .gte("created_at", `${today}T00:00:00`)
        .lte("created_at", `${today}T23:59:59`)
        .order("created_at", { ascending: false });

      if (logsError) throw logsError;
      const rows = logs || [];
      setTodayLogs(rows);
      const newestGpsCapture = rows
        .filter((row) => isGpsLog(row.entry_type))
        .reduce((latest, row) => Math.max(latest, readCapturedAt(row)), 0);
      setLatestGpsCaptureAt(newestGpsCapture);
    } catch (err) {
      setError(err.message || "Unable to save activity log.");
    }
  }

  async function saveGpsPing() {
    if (!logsEnabled || autoPingInFlight.current) return;

    const now = Date.now();
    if (latestGpsCaptureAt && now - latestGpsCaptureAt < 15 * 60 * 1000) {
      return;
    }

    autoPingInFlight.current = true;

    try {
      const supabase = getSupabaseClient();
      if (!supabase) return;

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) return;

      const location = await captureLocation();

      const payload = {
        user_id: session.user.id,
        entry_type: "GPS_PING",
        note: JSON.stringify({
          action: "GPS_PING",
          captured_at: new Date().toISOString(),
          location,
        }),
      };

      const { error: insertError } = await supabase.from("daily_activity_logs").insert(payload);
      if (insertError) throw insertError;

      const { data: logs, error: logsError } = await supabase
        .from("daily_activity_logs")
        .select("id,entry_type,note,created_at")
        .eq("user_id", session.user.id)
        .gte("created_at", `${today}T00:00:00`)
        .lte("created_at", `${today}T23:59:59`)
        .order("created_at", { ascending: false });

      if (logsError) throw logsError;

      const rows = logs || [];
      setTodayLogs(rows);
      setLatestGpsCaptureAt(Date.now());
      setMessage("Automatic GPS capture saved.");
    } catch {
      // Keep the screen quiet if the browser blocks background geolocation.
    } finally {
      autoPingInFlight.current = false;
    }
  }

  async function handleAttendanceAction(entryType) {
    setAttendanceBusy(entryType);
    setError("");
    setMessage("");

    try {
      await addLog(entryType);
    } catch (err) {
      setError(err.message || "Unable to save attendance action.");
    } finally {
      setAttendanceBusy("");
    }
  }

  useEffect(() => {
    if (!logsEnabled) return undefined;

    const timer = window.setInterval(() => {
      saveGpsPing();
    }, 60 * 1000);

    saveGpsPing();

    return () => window.clearInterval(timer);
  }, [logsEnabled, latestGpsCaptureAt]);

  const routeSummary = useMemo(() => {
    const map = new Map();
    routeRows.forEach((row) => {
      const key = row.city || "Unknown";
      map.set(key, (map.get(key) || 0) + 1);
    });
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [routeRows]);

  const supabaseClient = getSupabaseClient();
  if (!supabaseClient) {
    return (
      <SupabaseUnavailable
        title="My Day unavailable"
        message="Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to load daily planner data."
      />
    );
  }

  if (loading) {
    return (
      <main className="modulePage">
        <div className="moduleShell">
          <div className="moduleLoading">Loading daily planner...</div>
        </div>
      </main>
    );
  }

  return (
    <main className="modulePage">
      <div className="moduleShell">
        <div className="moduleHeader">
          <div>
            <p className="moduleEyebrow">MADIBA SFA</p>
            <h1>My Day</h1>
            <p className="moduleSubtitle">Daily planning and visit execution</p>
          </div>
          <Link href="/" className="moduleBackLink">← Dashboard</Link>
        </div>

        {error && <div className="moduleError">{error}</div>}
        {message && <div className="moduleSuccess">{message}</div>}
        {warnings.map((warning) => (
          <div key={warning} className="moduleWarning">{warning}</div>
        ))}

        <div className="moduleMetricGrid">
          <section className="moduleMetricCard"><span>Today's customer visits</span><strong>{summary.visitsToday}</strong></section>
          <section className="moduleMetricCard"><span>Follow-ups</span><strong>{summary.followUps}</strong></section>
          <section className="moduleMetricCard"><span>Pending orders</span><strong>{summary.pendingOrders}</strong></section>
          <section className="moduleMetricCard"><span>Overdue visits</span><strong>{summary.overdueVisits}</strong></section>
          <section className="moduleMetricCard"><span>New customers assigned</span><strong>{summary.newCustomersAssigned}</strong></section>
          <section className="moduleMetricCard"><span>Completed visits</span><strong>{summary.completedVisits}</strong></section>
        </div>

        <section className="moduleSection">
          <div className="moduleSectionHeader">
            <h2>Attendance</h2>
            <span>{profile?.salesman_name || profile?.salesman_code || ""}</span>
          </div>
          <div className="moduleActionRow">
            <button type="button" className="modulePrimaryButton" onClick={() => handleAttendanceAction("MORNING_ATTENDANCE")} disabled={!logsEnabled || Boolean(attendanceBusy)}>
              {attendanceBusy === "MORNING_ATTENDANCE" ? "Saving..." : "Morning Attendance"}
            </button>
            <button type="button" className="modulePrimaryButton" onClick={() => handleAttendanceAction("LUNCH_BREAK_OUT")} disabled={!logsEnabled || Boolean(attendanceBusy)}>
              {attendanceBusy === "LUNCH_BREAK_OUT" ? "Saving..." : "Lunch Break Out"}
            </button>
            <button type="button" className="modulePrimaryButton" onClick={() => handleAttendanceAction("LUNCH_BREAK_IN")} disabled={!logsEnabled || Boolean(attendanceBusy)}>
              {attendanceBusy === "LUNCH_BREAK_IN" ? "Saving..." : "Lunch Break In"}
            </button>
            <button type="button" className="modulePrimaryButton" onClick={() => handleAttendanceAction("END_OF_DAY")} disabled={!logsEnabled || Boolean(attendanceBusy)}>
              {attendanceBusy === "END_OF_DAY" ? "Saving..." : "End of Day"}
            </button>
          </div>
          <div className="moduleFilterRow">
            <input
              className="moduleInput"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Add planner note"
              disabled={!logsEnabled}
            />
            <button type="button" className="moduleInlineButton" onClick={() => handleAttendanceAction("NOTE")} disabled={!logsEnabled || Boolean(attendanceBusy)}>Save Note</button>
          </div>
          <ul className="moduleList">
            {todayLogs.map((row) => (
              <li key={row.id}>
                <strong>{row.entry_type}</strong>
                <span>{row.created_at ? new Date(row.created_at).toLocaleTimeString("en-GB") : ""}</span>
                {row.note ? <p>{row.note}</p> : null}
              </li>
            ))}
            {todayLogs.length === 0 && <li>No activity logs for today.</li>}
          </ul>
        </section>

        <section className="moduleSection">
          <div className="moduleSectionHeader">
            <h2>Route Summary</h2>
          </div>
          <div className="moduleHealthGrid">
            {routeSummary.map(([city, count]) => (
              <div key={city}><span>{city}</span><strong>{count} customers</strong></div>
            ))}
            {routeSummary.length === 0 && <div><span>No routes</span><strong>0 customers</strong></div>}
          </div>
        </section>

        <section className="moduleSection">
          <div className="moduleSectionHeader">
            <h2>Visit Status</h2>
          </div>
          <div className="moduleTableWrap">
            <table className="moduleTable">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>City / Area</th>
                  <th>Days Since Last</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {visitStatusRows.map((row) => (
                  <tr key={row.customer_code}>
                    <td>{row.customer_name || row.customer_code}</td>
                    <td>{`${row.city || "-"} / ${row.area || "-"}`}</td>
                    <td>{row.days_since_last}</td>
                    <td>{row.status}</td>
                  </tr>
                ))}
                {visitStatusRows.length === 0 && (
                  <tr>
                    <td colSpan={4}>No customers available for route status.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
