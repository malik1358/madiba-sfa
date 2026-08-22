"use client";

import { useEffect, useRef, useState } from "react";
import { useModuleAccess } from "../hooks/useModuleAccess";
import { shouldRequireTransactionGps } from "../lib/moduleAccess";
import { getSupabaseClient } from "../lib/supabase";
import { translate, useAppLanguage } from "../lib/appLanguage";
import { detectTable } from "../lib/schemaGuards";
import { autoCloseForgottenWorkdays, BACKGROUND_GPS_IDLE_MS, IDLE_GPS_ACTIVITY_ENTRY_TYPES, shouldCaptureIdleGpsPing } from "../lib/workdayActivity";
import { NATIVE_WORKDAY_READY_EVENT } from "../lib/nativeFieldTracking";
import WorkdayInactivityPrompt from "./WorkdayInactivityPrompt";

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

const BACKGROUND_GPS_CHECK_MS = 5 * 60 * 1000;

function backgroundGpsStorageKey(userId, suffix) {
  return `madiba-sfa:bg-gps:${userId}:${suffix}`;
}

function readStoredTimestamp(userId, suffix) {
  if (typeof window === "undefined" || !userId) return 0;
  try {
    const ts = Number(window.sessionStorage.getItem(backgroundGpsStorageKey(userId, suffix)) || 0);
    return Number.isFinite(ts) ? ts : 0;
  } catch {
    return 0;
  }
}

function writeStoredTimestamp(userId, suffix, value) {
  if (typeof window === "undefined" || !userId) return;
  try {
    window.sessionStorage.setItem(backgroundGpsStorageKey(userId, suffix), String(value));
  } catch {
    // Ignore storage failures.
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
  const { access, loading: accessLoading } = useModuleAccess();
  const t = translate(language, TEXT);
  const attendanceRequired = requireMorningAttendance
    && access.role !== "admin"
    && shouldRequireTransactionGps(access.role);
  const backgroundGpsEnabled = enableBackgroundGps && shouldRequireTransactionGps(access.role);
  const [checking, setChecking] = useState(requireMorningAttendance);
  const [capturing, setCapturing] = useState(false);
  const [ready, setReady] = useState(!requireMorningAttendance);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const attemptedAutoRef = useRef(false);
  const autoPingInFlightRef = useRef(false);
  const lastGpsPingAtRef = useRef(0);
  const lastActivityAtRef = useRef(0);

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

    const capturedTs = new Date(nowIso).getTime();
    lastGpsPingAtRef.current = capturedTs;
    writeStoredTimestamp(sessionUserId, "lastPing", capturedTs);
  }

  async function hydrateActivityTimestamps(sessionUserId) {
    const supabase = getSupabaseClient();
    if (!supabase) return;

    const start = new Date();
    start.setHours(0, 0, 0, 0);

    const { data, error: latestError } = await supabase
      .from("daily_activity_logs")
      .select("entry_type,note,created_at")
      .eq("user_id", sessionUserId)
      .in("entry_type", [...IDLE_GPS_ACTIVITY_ENTRY_TYPES, "GPS_PING"])
      .gte("created_at", start.toISOString())
      .order("created_at", { ascending: false })
      .limit(200);

    if (latestError) return;

    let lastGpsPingTs = readStoredTimestamp(sessionUserId, "lastPing");
    let lastActivityTs = 0;

    (data || []).forEach((row) => {
      const ts = readCapturedAt(row?.note, row?.created_at);
      if (row.entry_type === "GPS_PING") {
        lastGpsPingTs = Math.max(lastGpsPingTs, ts);
      }
      if (IDLE_GPS_ACTIVITY_ENTRY_TYPES.includes(row.entry_type)) {
        lastActivityTs = Math.max(lastActivityTs, ts);
      }
    });

    lastGpsPingAtRef.current = lastGpsPingTs;
    lastActivityAtRef.current = lastActivityTs;
    writeStoredTimestamp(sessionUserId, "lastPing", lastGpsPingTs);
    writeStoredTimestamp(sessionUserId, "lastActivity", lastActivityTs);
  }

  async function maybeCaptureBackgroundPing() {
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

      await hydrateActivityTimestamps(userId);

      const now = Date.now();
      const lastActivityTs = Math.max(
        lastActivityAtRef.current || 0,
        readStoredTimestamp(userId, "lastActivity"),
      );
      const lastGpsPingTs = Math.max(
        lastGpsPingAtRef.current || 0,
        readStoredTimestamp(userId, "lastPing"),
      );

      if (!shouldCaptureIdleGpsPing({ now, lastActivityTs, lastGpsPingTs, idleMs: BACKGROUND_GPS_IDLE_MS })) {
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
    if (!attendanceRequired) {
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

      try {
        await autoCloseForgottenWorkdays(supabase, session.user.id);
      } catch {
        // Do not block access if auto-close fails.
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
        await hydrateActivityTimestamps(session.user.id);
        setReady(true);
        return;
      }

      if (triggerAutoCapture) {
        setCapturing(true);
        try {
          await insertAttendance(session.user.id);
          const loginTs = Date.now();
          lastActivityAtRef.current = loginTs;
          lastGpsPingAtRef.current = loginTs;
          writeStoredTimestamp(session.user.id, "lastActivity", loginTs);
          writeStoredTimestamp(session.user.id, "lastPing", loginTs);
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
    if (accessLoading) {
      return undefined;
    }

    if (!attendanceRequired) {
      let cancelled = false;

      async function runAutoClose() {
        const supabase = getSupabaseClient();
        if (!supabase || cancelled) return;

        try {
          const session = await getSessionWithTimeout(supabase);
          if (session?.user?.id && !cancelled) {
            await autoCloseForgottenWorkdays(supabase, session.user.id);
          }
        } catch {
          // Do not block access if auto-close fails.
        }
      }

      runAutoClose();
      setReady(true);
      setChecking(false);

      return () => {
        cancelled = true;
      };
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
  }, [attendanceRequired, accessLoading]);

  useEffect(() => {
    if (!backgroundGpsEnabled) return undefined;

    const backgroundGpsReady = attendanceRequired ? ready : true;
    if (!backgroundGpsReady) return undefined;

    let cancelled = false;

    async function startBackgroundGps() {
      const supabase = getSupabaseClient();
      if (!supabase) return;

      try {
        const session = await getSessionWithTimeout(supabase);
        const userId = session?.user?.id;
        if (!userId || cancelled) return;

        await hydrateActivityTimestamps(userId);
      } catch {
        // Background GPS should not block page access.
      }
    }

    startBackgroundGps();

    const timer = window.setInterval(() => {
      maybeCaptureBackgroundPing();
    }, BACKGROUND_GPS_CHECK_MS);

    let focusTimer = 0;
    const handleVisibleOrFocused = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      window.clearTimeout(focusTimer);
      focusTimer = window.setTimeout(() => {
        maybeCaptureBackgroundPing();
      }, 1000);
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
      window.clearTimeout(focusTimer);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibleOrFocused);
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("focus", handleVisibleOrFocused);
        window.removeEventListener("online", handleVisibleOrFocused);
      }
    };
  }, [backgroundGpsEnabled, attendanceRequired, ready]);

  useEffect(() => {
    if (!ready || !backgroundGpsEnabled || typeof window === "undefined") return undefined;

    let cancelled = false;
    const supabase = getSupabaseClient();
    if (!supabase) return undefined;

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      const userId = data?.session?.user?.id;
      if (!userId) return;
      window.dispatchEvent(new CustomEvent(NATIVE_WORKDAY_READY_EVENT, {
        detail: { userId, trackingEnabled: true },
      }));
    }).catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [backgroundGpsEnabled, ready]);

  if (accessLoading && requireMorningAttendance) {
    return (
      <main className="modulePage" dir={dir}>
        <div className="moduleShell">
          <section className="moduleSection">
            <div className="moduleSectionHeader">
              <h2>{t("checking")}</h2>
            </div>
          </section>
        </div>
      </main>
    );
  }

  if (ready) {
    return (
      <>
        {attendanceRequired ? <WorkdayInactivityPrompt /> : null}
        {children}
      </>
    );
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