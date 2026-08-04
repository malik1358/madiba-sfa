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

export default function MorningAttendanceGate({ children }) {
  const { language, dir } = useAppLanguage();
  const t = translate(language, TEXT);
  const [checking, setChecking] = useState(true);
  const [capturing, setCapturing] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const attemptedAutoRef = useRef(false);

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
        setReady(true);
        return;
      }

      if (triggerAutoCapture) {
        setCapturing(true);
        try {
          await insertAttendance(session.user.id);
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