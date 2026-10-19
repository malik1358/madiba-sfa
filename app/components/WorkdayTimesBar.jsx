"use client";

import { translate, useAppLanguage } from "../lib/appLanguage";
import { useTodayWorkdayLogs } from "../hooks/useTodayWorkdayLogs";

const TEXT = {
  login: { en: "Login", ar: "تسجيل الدخول" },
  lunchOut: { en: "Lunch out", ar: "خروج الغداء" },
  lunchIn: { en: "Lunch in", ar: "عودة الغداء" },
};

export default function WorkdayTimesBar() {
  const { language, dir } = useAppLanguage();
  const t = translate(language, TEXT);
  const {
    signedIn,
    loginTime,
    lunchOutTime,
    lunchInTime,
  } = useTodayWorkdayLogs();

  if (!signedIn) return null;

  return (
    <div className="workdayTimesBar" role="status" dir={dir}>
      <span><strong>{t("login")}:</strong> {loginTime}</span>
      <span><strong>{t("lunchOut")}:</strong> {lunchOutTime}</span>
      <span><strong>{t("lunchIn")}:</strong> {lunchInTime}</span>
    </div>
  );
}
