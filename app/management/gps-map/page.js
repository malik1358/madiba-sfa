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
  subtitle: { en: "Latest attendance GPS points for all salesmen", ar: "آخر نقاط GPS للحضور لجميع المندوبين" },
  management: { en: "← Management", ar: "← الإدارة" },
  loading: { en: "Loading GPS map...", ar: "جاري تحميل خريطة GPS..." },
};

function parseGps(note) {
  if (!note) return null;

  try {
    const parsed = JSON.parse(note);
    const location = parsed?.location || null;
    if (!location) return null;

    return {
      latitude: Number(location.latitude),
      longitude: Number(location.longitude),
      accuracy: Number(location.accuracy || 0),
      action: parsed.action || "ATTENDANCE",
      captured_at: parsed.captured_at || null,
    };
  } catch {
    return null;
  }
}

function mapBounds(points) {
  if (!points.length) {
    return { minLat: 0, maxLat: 1, minLng: 0, maxLng: 1 };
  }

  return points.reduce(
    (bounds, point) => ({
      minLat: Math.min(bounds.minLat, point.latitude),
      maxLat: Math.max(bounds.maxLat, point.latitude),
      minLng: Math.min(bounds.minLng, point.longitude),
      maxLng: Math.max(bounds.maxLng, point.longitude),
    }),
    { minLat: points[0].latitude, maxLat: points[0].latitude, minLng: points[0].longitude, maxLng: points[0].longitude }
  );
}

export default function GpsMapPage() {
  const { language, dir, setLanguage } = useAppLanguage();
  const t = translate(language, TEXT);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [points, setPoints] = useState([]);
  const [userRole, setUserRole] = useState("");

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
          .limit(1000);

        if (logsError) throw logsError;

        const { data: profiles, error: profilesError } = await supabase
          .from("profiles")
          .select("id,salesman_code,salesman_name")
          .in("role", ["salesman", "manager", "admin"]);

        if (profilesError) throw profilesError;

        const profileMap = new Map((profiles || []).map((row) => [row.id, row]));
        const latestBySalesman = new Map();

        (logs || []).forEach((log) => {
          const gps = parseGps(log.note);
          if (!gps || latestBySalesman.has(log.user_id)) return;

          latestBySalesman.set(log.user_id, {
            ...gps,
            user_id: log.user_id,
            profile: profileMap.get(log.user_id) || null,
            created_at: log.created_at,
          });
        });

        setPoints(Array.from(latestBySalesman.values()));
      } catch (err) {
        setError(err.message || "Unable to load GPS map.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  const bounds = useMemo(() => mapBounds(points), [points]);

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
          <section className="moduleMetricCard"><span>Visible salesmen</span><strong>{points.length}</strong></section>
          <section className="moduleMetricCard"><span>Administrator only</span><strong>{userRole === "admin" ? "Yes" : "No"}</strong></section>
        </div>

        <section className="moduleSection">
          <div className="moduleSectionHeader">
            <h2>Live GPS View</h2>
            <span>Latest known point per salesman</span>
          </div>
          <div className="gpsMapShell">
            {points.length === 0 ? (
              <div className="moduleHint">No GPS attendance points captured yet.</div>
            ) : (
              points.map((point) => {
                const left = ((point.longitude - bounds.minLng) / Math.max(0.000001, bounds.maxLng - bounds.minLng)) * 100;
                const top = ((bounds.maxLat - point.latitude) / Math.max(0.000001, bounds.maxLat - bounds.minLat)) * 100;

                return (
                  <div
                    key={point.user_id}
                    className="gpsPin"
                    style={{ left: `${Math.min(96, Math.max(4, left))}%`, top: `${Math.min(96, Math.max(4, top))}%` }}
                  >
                    <strong>{point.profile?.salesman_name || point.profile?.salesman_code || point.user_id}</strong>
                    <span>{point.latitude.toFixed(6)}, {point.longitude.toFixed(6)}</span>
                    <small>{point.action}</small>
                  </div>
                );
              })
            )}
          </div>
        </section>

        <section className="moduleSection">
          <div className="moduleSectionHeader">
            <h2>Salesman Locations</h2>
          </div>
          <div className="moduleTableWrap">
            <table className="moduleTable">
              <thead>
                <tr>
                  <th>Salesman</th>
                  <th>Action</th>
                  <th>GPS</th>
                  <th>Captured At</th>
                </tr>
              </thead>
              <tbody>
                {points.map((point) => (
                  <tr key={point.user_id}>
                    <td>{point.profile?.salesman_name || point.profile?.salesman_code || point.user_id}</td>
                    <td>{point.action}</td>
                    <td>{point.latitude.toFixed(6)}, {point.longitude.toFixed(6)}</td>
                    <td>{point.captured_at ? new Date(point.captured_at).toLocaleString("en-GB") : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
    </MorningAttendanceGate>
  );
}