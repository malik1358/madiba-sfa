"use client";

import { useEffect, useRef, useState } from "react";
import { getSupabaseClient } from "../lib/supabase";
import { translate, useAppLanguage } from "../lib/appLanguage";
import { detectTable } from "../lib/schemaGuards";

const TEXT = {
  checking: { en: "Checking morning attendance...", ar: "جاري التحقق من حضور الصباح..." },
  capturing: { en: "Capturing GPS for morning attendance...", ar: "جاري التقاط GPS لحضور الصباح..." },
  title: { en: "Morning Attendance Required", ar: "حضور الصباح مطلوب" },
  description: { en: "You must complete morning attendance before starting work today.", ar: "يجب تسجيل حضور الصباح قبل بدء العمل اليوم." },
  gpsHelp: { en: "Allow location access to auto-capture GPS and continue.", ar: "اسمح بالوصول إلى الموقع لالتقاط GPS تلقائياً والمتابعة." },
  retry: { en: "Retry Attendance", ar: "إعادة محاولة الحضور" },
  locationUnsupported: { en: "Geolocation is not supported on this device.", ar: "خدمة تحديد الموقع غير مدعومة على هذا الجهاز." },
  locationFailed: { en: "Unable to read GPS location. Please allow location and retry.", ar: "تعذر قراءة موقع GPS. يرجى السماح بالموقع وإعادة المحاولة." },
  logsUnavailableBypass: {
    en: "Attendance log table is unavailable. Access is allowed, but attendance logging is temporarily disabled.",
    ar: "جدول سجلات الحضور غير متاح. تم السماح بالدخول، لكن تسجيل الحضور معطل مؤقتاً.",
  },
};

function captureLocation() {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    throw new Error("UNSUPPORTED");
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
      () => reject(new Error("LOCATION_FAILED")),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}

function readCapturedAt(note, fallbackDate) {
  try {
    const parsed = JSON.parse(String(note || ""));
    const capturedAt = parsed?.captured_at || fallbackDate;
    const ts = new Date(capturedAt).getTime();
    return Number.isFinite(ts) ? ts : 0;
  } catch {
    const ts = new Date(fallbackDate || "").getTime();
    return Number.isFinite(ts) ? ts : 0;
  }
}

export default function MorningAttendanceGate({ children }) {
  const { language, dir } = useAppLanguage();
  const t = translate(language, TEXT);
  const [checking, setChecking] = useState(true);
  const [capturing, setCapturing] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const attemptedAutoRef = useRef(false);
  const autoPingInFlightRef = useRef(false);
  const lastGpsCaptureAtRef = useRef(0);

  async function insertAttendance(sessionUserId) {
    const supabase = getSupabaseClient();
    if (!supabase) {
      throw new Error("Supabase is not configured.");
    }

    const location = await captureLocation();
    const payload = {
      user_id: sessionUserId,
      entry_type: "MORNING_ATTENDANCE",
      note: JSON.stringify({
        action: "MORNING_ATTENDANCE",
        autoCaptured: true,
        captured_at: new Date().toISOString(),
        location,
      }),
    };

    const { error: insertError } = await supabase.from("daily_activity_logs").insert(payload);
    if (insertError) throw insertError;
  }

  async function captureBackgroundPing(sessionUserId) {
    const supabase = getSupabaseClient();
    if (!supabase) return;

    const location = await captureLocation();
    const nowIso = new Date().toISOString();

    const payload = {
      user_id: sessionUserId,
      entry_type: "GPS_PING",
      note: JSON.stringify({
        action: "GPS_PING",
        captured_at: nowIso,
        location,
      }),
    };

    const { error: insertError } = await supabase.from("daily_activity_logs").insert(payload);
    if (insertError) throw insertError;

    lastGpsCaptureAtRef.current = new Date(nowIso).getTime();
  }

  async function hydrateLastCapture(sessionUserId) {
    const supabase = getSupabaseClient();
    if (!supabase) return;

    const start = new Date();
    start.setHours(0, 0, 0, 0);

    const { data, error: latestError } = await supabase
      .from("daily_activity_logs")
      .select("note,created_at")
      .eq("user_id", sessionUserId)
      .in("entry_type", ["MORNING_ATTENDANCE", "LUNCH_BREAK_OUT", "LUNCH_BREAK_IN", "END_OF_DAY", "NOTE", "GPS_PING", "VISIT_REPORT"])
      .gte("created_at", start.toISOString())
      .order("created_at", { ascending: false })
      .limit(50);

    if (latestError) return;

    const latest = (data || []).reduce((maxTs, row) => {
      const ts = readCapturedAt(row?.note, row?.created_at);
      return Math.max(maxTs, ts);
    }, 0);

    lastGpsCaptureAtRef.current = latest;
  }

  async function maybeCaptureBackgroundPing() {
    if (autoPingInFlightRef.current) return;

    const supabase = getSupabaseClient();
    if (!supabase) return;

    autoPingInFlightRef.current = true;
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const userId = session?.user?.id;
      if (!userId) return;

      const now = Date.now();
      const last = lastGpsCaptureAtRef.current || 0;
      if (last && now - last < 15 * 60 * 1000) {
        return;
      }

      await captureBackgroundPing(userId);
    } catch {
      // Ignore background GPS failures; user can continue working.
    } finally {
      autoPingInFlightRef.current = false;
    }
  }

  async function checkAttendance(triggerAutoCapture = false) {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setReady(true);
      setChecking(false);
      return;
    }

    setChecking(true);
    setError("");
    setWarning("");

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user?.id) {
        setReady(true);
        return;
      }

      const logsTable = await detectTable(supabase, "daily_activity_logs");
      if (!logsTable.available) {
        setWarning(t("logsUnavailableBypass"));
        setReady(true);
        return;
      }

      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date();
      end.setHours(23, 59, 59, 999);

      const { data, error: attendanceError } = await supabase
        .from("daily_activity_logs")
        .select("id")
        .eq("user_id", session.user.id)
        .eq("entry_type", "MORNING_ATTENDANCE")
        .gte("created_at", start.toISOString())
        .lte("created_at", end.toISOString())
        .limit(1)
        .maybeSingle();

      if (attendanceError) throw attendanceError;

      if (data?.id) {
        await hydrateLastCapture(session.user.id);
        setReady(true);
        return;
      }

      if (triggerAutoCapture) {
        setCapturing(true);
        try {
          await insertAttendance(session.user.id);
          lastGpsCaptureAtRef.current = Date.now();
          setReady(true);
          return;
        } finally {
          setCapturing(false);
        }
      }

      setReady(false);
    } catch (err) {
      if (String(err.message || "") === "UNSUPPORTED") {
        setError(t("locationUnsupported"));
      } else if (String(err.message || "") === "LOCATION_FAILED") {
        setError(t("locationFailed"));
      } else {
        setError(err.message || t("locationFailed"));
      }
      setReady(false);
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    const shouldAutoAttempt = !attemptedAutoRef.current;
    attemptedAutoRef.current = true;
    checkAttendance(shouldAutoAttempt);
  }, []);

  useEffect(() => {
    if (!ready || warning) return undefined;

    // Keep GPS fresh across all authenticated pages with a max 15-minute cadence.
    const timer = window.setInterval(() => {
      maybeCaptureBackgroundPing();
    }, 60 * 1000);

    maybeCaptureBackgroundPing();

    return () => window.clearInterval(timer);
  }, [ready, warning]);

  if (ready) {
    return children;
  }

  return (
    <main className="modulePage" dir={dir}>
      <div className="moduleShell">
        <section className="moduleSection">
          <div className="moduleSectionHeader">
            <h2>{capturing ? t("capturing") : checking ? t("checking") : t("title")}</h2>
          </div>
          {!checking && !capturing && (
            <>
              <div className="moduleHint">{t("description")}</div>
              <div className="moduleHint">{t("gpsHelp")}</div>
            </>
          )}
          {warning && <div className="moduleWarning">{warning}</div>}
          {error && <div className="moduleError">{error}</div>}
          {!checking && !capturing && (
            <button type="button" className="modulePrimaryButton" onClick={() => checkAttendance(true)}>
              {t("retry")}
            </button>
          )}
        </section>
      </div>
    </main>
  );
}