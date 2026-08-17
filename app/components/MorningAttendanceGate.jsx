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
  sessionCheckFailed: {
    en: "Unable to verify attendance status right now. You can continue, but attendance may not be recorded.",
    ar: "تعذر التحقق من حضور الصباح الآن. يمكنك المتابعة، لكن قد لا يتم تسجيل الحضور.",
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

function withTimeout(promise, timeoutMs, timeoutMessage = "REQUEST_TIMEOUT") {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    }),
  ]);
}

async function getSessionWithTimeout(supabase, timeoutMs = 10000) {
  const { data, error } = await withTimeout(
    supabase.auth.getSession(),
    timeoutMs,
    "SESSION_TIMEOUT",
  );
  if (error) throw error;
  return data?.session || null;
}

export default function MorningAttendanceGate({
  children,
  requireMorningAttendance = true,
  enableBackgroundGps = true,
}) {
  const { language, dir } = useAppLanguage();
  const t = translate(language, TEXT);
  const [checking, setChecking] = useState(requireMorningAttendance);
  const [capturing, setCapturing] = useState(false);
  const [ready, setReady] = useState(!requireMorningAttendance);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const attemptedAutoRef = useRef(false);
  const autoPingInFlightRef = useRef(false);
  const lastGpsCaptureAtRef = useRef(0);
  const loginPingAttemptedRef = useRef(false);

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

  async function maybeCaptureBackgroundPing({ force = false } = {}) {
    if (autoPingInFlightRef.current) return;

    const supabase = getSupabaseClient();
    if (!supabase) return;

    autoPingInFlightRef.current = true;
    try {
      const {
        data: { session },
      } = await withTimeout(
        supabase.auth.getSession(),
        10000,
        "SESSION_TIMEOUT",
      );

      const userId = session?.user?.id;
      if (!userId) return;

      const now = Date.now();
      const last = lastGpsCaptureAtRef.current || 0;
      if (!force && last && now - last < 15 * 60 * 1000) {
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
    if (!requireMorningAttendance) {
      setReady(true);
      setChecking(false);
      return;
    }

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
      const session = await getSessionWithTimeout(supabase);

      if (!session?.user?.id) {
        setReady(true);
        return;
      }

      const logsTable = await withTimeout(
        detectTable(supabase, "daily_activity_logs"),
        10000,
        "ATTENDANCE_CHECK_TIMEOUT",
      );
      if (!logsTable.available) {
        setWarning(t("logsUnavailableBypass"));
        setReady(true);
        return;
      }

      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date();
      end.setHours(23, 59, 59, 999);

      const { data, error: attendanceError } = await withTimeout(
        supabase
          .from("daily_activity_logs")
          .select("id")
          .eq("user_id", session.user.id)
          .eq("entry_type", "MORNING_ATTENDANCE")
          .gte("created_at", start.toISOString())
          .lte("created_at", end.toISOString())
          .limit(1)
          .maybeSingle(),
        10000,
        "ATTENDANCE_CHECK_TIMEOUT",
      );

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
      const message = String(err.message || "");
      if (message === "UNSUPPORTED") {
        setError(t("locationUnsupported"));
      } else if (message === "LOCATION_FAILED") {
        setError(t("locationFailed"));
      } else if (message === "SESSION_TIMEOUT" || message === "ATTENDANCE_CHECK_TIMEOUT") {
        setWarning(t("sessionCheckFailed"));
        setReady(true);
        return;
      } else {
        setError(err.message || t("locationFailed"));
      }
      setReady(false);
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    if (!requireMorningAttendance) {
      setReady(true);
      setChecking(false);
      return undefined;
    }

    const shouldAutoAttempt = !attemptedAutoRef.current;
    attemptedAutoRef.current = true;
    checkAttendance(shouldAutoAttempt);

    const safetyTimer = window.setTimeout(() => {
      setWarning((current) => current || t("sessionCheckFailed"));
      setReady(true);
      setChecking(false);
      setCapturing(false);
    }, 12000);

    return () => window.clearTimeout(safetyTimer);
  }, [requireMorningAttendance]);

  useEffect(() => {
    if (!enableBackgroundGps) return undefined;

    const backgroundGpsReady = requireMorningAttendance ? ready : true;
    if (!backgroundGpsReady) return undefined;

    let cancelled = false;

    async function startBackgroundGps() {
      const supabase = getSupabaseClient();
      if (!supabase) return;

      try {
        const session = await getSessionWithTimeout(supabase);
        const userId = session?.user?.id;
        if (!userId || cancelled) return;

        await hydrateLastCapture(userId);
        if (cancelled) return;

        if (!loginPingAttemptedRef.current) {
          loginPingAttemptedRef.current = true;
          await maybeCaptureBackgroundPing({ force: true });
        }
      } catch {
        // Background GPS should not block page access.
      }
    }

    startBackgroundGps();

    // Keep GPS fresh across authenticated pages with a max 15-minute cadence.
    const timer = window.setInterval(() => {
      maybeCaptureBackgroundPing();
    }, 60 * 1000);

    const handleVisibleOrFocused = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      maybeCaptureBackgroundPing();
    };

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibleOrFocused);
    }
    if (typeof window !== "undefined") {
      window.addEventListener("focus", handleVisibleOrFocused);
      window.addEventListener("online", handleVisibleOrFocused);
    }

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibleOrFocused);
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("focus", handleVisibleOrFocused);
        window.removeEventListener("online", handleVisibleOrFocused);
      }
    };
  }, [enableBackgroundGps, requireMorningAttendance, ready]);

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