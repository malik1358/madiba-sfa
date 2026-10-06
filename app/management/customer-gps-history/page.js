"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";
import ExportableTable from "../../components/ExportableTable";
import MorningAttendanceGate from "../../components/MorningAttendanceGate";
import { translate, useAppLanguage } from "../../lib/appLanguage";
import { fetchJsonWithTimeout, resolveAuthSession } from "../../lib/authSession";
import { getSupabaseClient } from "../../lib/supabase";
import { getKsaDateString, KSA_TIMEZONE } from "../../lib/workdayActivity";

const TEXT = {
  title: { en: "Customer GPS History", ar: "سجل مواقع العملاء" },
  back: { en: "Management", ar: "الإدارة" },
  from: { en: "From", ar: "من" },
  to: { en: "To", ar: "إلى" },
  customerCode: { en: "Customer code (exact)", ar: "كود العميل (مطابقة تامة)" },
  acceptedOnly: { en: "Salesman accepted only", ar: "المواقع المقبولة من المندوب فقط" },
  apply: { en: "Apply", ar: "تطبيق" },
  loading: { en: "Loading GPS history...", ar: "جاري تحميل سجل المواقع..." },
  noRows: { en: "No GPS history for these filters.", ar: "لا يوجد سجل مواقع لهذه الفلاتر." },
  total: { en: "Total records", ar: "إجمالي السجلات" },
  code: { en: "Code", ar: "الكود" },
  customer: { en: "Customer", ar: "العميل" },
  oldGps: { en: "Previous coordinates", ar: "الإحداثيات السابقة" },
  newGps: { en: "Saved coordinates", ar: "الإحداثيات المحفوظة" },
  distance: { en: "Change (m)", ar: "التغيير (م)" },
  actor: { en: "Saved by", ar: "حفظ بواسطة" },
  savedAt: { en: "Saved at (KSA)", ar: "وقت الحفظ (السعودية)" },
  source: { en: "Source", ar: "المصدر" },
  approval: { en: "Approval status", ar: "حالة الموافقة" },
  confirmed_salesman: { en: "Confirmed by salesman", ar: "مؤكد من المندوب" },
  confirmed_other: { en: "Confirmed by other user", ar: "مؤكد من مستخدم آخر" },
  not_recorded: { en: "Not recorded", ar: "غير مسجلة" },
  customer_master: { en: "Customer master", ar: "سجل العميل" },
  visit: { en: "Visit", ar: "زيارة" },
  salesman_accepted: { en: "Salesman accepted", ar: "وافق المندوب" },
  visit_accepted: { en: "GPS update accepted", ar: "تمت الموافقة على تحديث الموقع" },
  excel_import: { en: "Excel import", ar: "استيراد Excel" },
  home_location_cleanup: { en: "Home location cleanup", ar: "تنظيف مواقع المنزل" },
  prev: { en: "Previous", ar: "السابق" },
  next: { en: "Next", ar: "التالي" },
  page: { en: "Page", ar: "صفحة" },
  of: { en: "of", ar: "من" },
  invalidDates: { en: "Choose a valid date range: From must not be after To.", ar: "اختر فترة صحيحة: تاريخ البداية يجب ألا يتجاوز تاريخ النهاية." },
  login: { en: "Please login again.", ar: "يرجى تسجيل الدخول مرة أخرى." },
  denied: { en: "Only admin or manager can access this report.", ar: "هذا التقرير متاح للأدمن والمدير فقط." },
  loadError: { en: "Unable to load GPS history.", ar: "تعذر تحميل سجل المواقع." },
  unavailable: { en: "Supabase is unavailable for this report.", ar: "خدمة Supabase غير متاحة لهذا التقرير." },
};

const EMPTY_PAGINATION = { page: 1, limit: 50, total: 0, totalPages: 1 };

function coordinatePair(latitude, longitude) {
  if (latitude == null || longitude == null || latitude === "" || longitude === "") return null;
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

function CoordinateLink({ latitude, longitude, mapUrl }) {
  const coordinates = coordinatePair(latitude, longitude);
  if (!coordinates) return "-";
  let href = `https://www.google.com/maps?q=${encodeURIComponent(coordinates)}`;
  try {
    const url = new URL(mapUrl);
    if (url.protocol === "https:") href = url.href;
  } catch {}
  return <a href={href} target="_blank" rel="noopener noreferrer" dir="ltr">{coordinates}</a>;
}

function formatSavedAt(value, language) {
  if (!value) return "-";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "-";
  return new Intl.DateTimeFormat(language === "ar" ? "ar-SA" : "en-GB", {
    timeZone: KSA_TIMEZONE,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(date);
}

export default function CustomerGpsHistoryPage() {
  const { language, dir, setLanguage } = useAppLanguage();
  const t = translate(language, TEXT);
  const supabase = getSupabaseClient();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [customerCode, setCustomerCode] = useState("");
  const [acceptedOnly, setAcceptedOnly] = useState(false);
  const [applied, setApplied] = useState(null);
  const [history, setHistory] = useState([]);
  const [pagination, setPagination] = useState(EMPTY_PAGINATION);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [accessDenied, setAccessDenied] = useState(false);
  const [migrationHint, setMigrationHint] = useState("");

  useEffect(() => {
    const today = getKsaDateString();
    const monthStart = `${today.slice(0, 7)}-01`;
    setFrom(monthStart);
    setTo(today);
    setApplied({ from: monthStart, to: today, customerCode: "", acceptedOnly: false, page: 1 });
  }, []);

  useEffect(() => {
    if (!applied || !supabase) return undefined;
    let cancelled = false;
    const text = translate(language, TEXT);

    async function loadHistory() {
      setLoading(true);
      setError("");
      setAccessDenied(false);
      setMigrationHint("");
      setHistory([]);
      setPagination(EMPTY_PAGINATION);
      try {
        const session = await resolveAuthSession(supabase, 8000);
        if (cancelled) return;
        if (!session?.access_token) throw new Error(text("login"));
        const params = new URLSearchParams({
          from: applied.from,
          to: applied.to,
          page: String(applied.page),
        });
        if (applied.customerCode) params.set("customerCode", applied.customerCode);
        if (applied.acceptedOnly) params.set("acceptedOnly", "true");
        const { response, payload } = await fetchJsonWithTimeout(
          `/api/admin/customers/gps-history?${params.toString()}`,
          { headers: { Authorization: `Bearer ${session.access_token}` } },
          30000,
        );
        if (cancelled) return;
        if (response.status === 403) {
          setAccessDenied(true);
          return;
        }
        if (response.status === 401) throw new Error(text("login"));
        if (!response.ok || !payload.success) throw new Error(payload.error || text("loadError"));
        const rows = Array.isArray(payload.history) ? payload.history : [];
        setHistory(rows);
        setPagination(payload.pagination || { ...EMPTY_PAGINATION, total: rows.length });
        setMigrationHint(typeof payload.migrationHint === "string" ? payload.migrationHint : "");
      } catch (err) {
        if (!cancelled) setError(err.message || text("loadError"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadHistory();
    return () => { cancelled = true; };
  }, [applied, supabase, language]);

  function applyFilters(event) {
    event.preventDefault();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
      setError(t("invalidDates"));
      return;
    }
    setApplied({ from, to, customerCode: customerCode.trim().toUpperCase(), acceptedOnly, page: 1 });
  }

  return (
    <MorningAttendanceGate requireMorningAttendance={false}>
      <main className="modulePage" dir={dir}>
        <div className="moduleShell" style={{ minWidth: 0 }}>
          <div className="moduleHeader">
            <div><p className="moduleEyebrow">MADIBA SFA</p><h1>{t("title")}</h1></div>
            <div className="moduleHeaderMeta">
              <AppLanguageSwitch language={language} setLanguage={setLanguage} />
              <Link href="/management" className="moduleBackLink">{t("back")}</Link>
            </div>
          </div>

          {!supabase ? <p role="alert" className="moduleHint">{t("unavailable")}</p> : (
            <section aria-label={t("title")} style={{ minWidth: 0 }}>
              <form onSubmit={applyFilters} className="moduleFilterRow" style={{ display: "flex", flexWrap: "wrap", alignItems: "end", gap: "12px", marginBottom: "12px" }}>
                <label style={{ flex: "0 1 180px", minWidth: 0 }}>
                  {t("from")}
                  <input className="moduleInput" type="date" required value={from} onChange={(event) => setFrom(event.target.value)} style={{ width: "100%" }} />
                </label>
                <label style={{ flex: "0 1 180px", minWidth: 0 }}>
                  {t("to")}
                  <input className="moduleInput" type="date" required min={from || undefined} value={to} onChange={(event) => setTo(event.target.value)} style={{ width: "100%" }} />
                </label>
                <label style={{ flex: "0 1 230px", minWidth: 0 }}>
                  {t("customerCode")}
                  <input className="moduleInput" value={customerCode} onChange={(event) => setCustomerCode(event.target.value)} dir="ltr" style={{ width: "100%" }} />
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "8px", paddingBottom: "8px" }}>
                  <input type="checkbox" checked={acceptedOnly} onChange={(event) => setAcceptedOnly(event.target.checked)} />
                  {t("acceptedOnly")}
                </label>
                <button type="submit" className="moduleInlineButton" disabled={loading || accessDenied}>{t("apply")}</button>
              </form>

              {accessDenied && <p role="alert" className="moduleHint">{t("denied")}</p>}
              {error && <p role="alert" className="moduleHint">{error}</p>}
              {migrationHint && <p role="status" className="moduleHint">{migrationHint}</p>}
              {loading ? <div role="status" className="moduleLoading">{t("loading")}</div> : !accessDenied && !error && (
                <>
                  <p role="status" style={{ margin: "8px 0" }}>{t("total")}: <strong>{pagination.total}</strong></p>
                  {history.length === 0 ? <div className="moduleHint">{t("noRows")}</div> : (
                    <ExportableTable
                      filename={`customer-gps-history-${applied.from}-${applied.to}-page-${pagination.page}`}
                      sheetName="Customer GPS History"
                      className="moduleTableWrap"
                      style={{ overflowX: "auto", maxWidth: "100%" }}
                      onError={(err) => setError(err?.message || t("loadError"))}
                    >
                      <table className="moduleTable" style={{ minWidth: "1150px" }}>
                        <thead><tr>
                          {["code", "customer", "oldGps", "newGps", "distance", "actor", "savedAt", "source", "approval"].map((key) => (
                            <th key={key} scope="col" style={{ background: "#0f4c5c", color: "#fff" }}>{t(key)}</th>
                          ))}
                        </tr></thead>
                        <tbody>{history.map((row) => (
                          <tr key={row.id}>
                            <td data-label={t("code")}>{row.customer_code || "-"}</td>
                            <td data-label={t("customer")}>{row.customer_name || "-"}</td>
                            <td data-label={t("oldGps")} style={{ whiteSpace: "nowrap" }}><CoordinateLink latitude={row.previous_latitude} longitude={row.previous_longitude} mapUrl={row.old_map_url} /></td>
                            <td data-label={t("newGps")} style={{ whiteSpace: "nowrap" }}><CoordinateLink latitude={row.latitude} longitude={row.longitude} mapUrl={row.new_map_url} /></td>
                            <td data-label={t("distance")}>{row.distance_meters != null && Number.isFinite(Number(row.distance_meters)) ? Number(row.distance_meters).toLocaleString(language === "ar" ? "ar-SA" : "en-US", { maximumFractionDigits: 1 }) : "-"}</td>
                            <td data-label={t("actor")} style={{ overflowWrap: "anywhere" }}>{row.updated_by_name || row.updated_by || "-"}</td>
                            <td data-label={t("savedAt")} style={{ whiteSpace: "nowrap" }}>{formatSavedAt(row.created_at, language)}</td>
                            <td data-label={t("source")}>{["customer_master", "visit", "salesman_accepted", "visit_accepted", "excel_import", "home_location_cleanup"].includes(row.source) ? t(row.source) : row.source || "-"}</td>
                            <td data-label={t("approval")} style={{ color: row.acceptance === "confirmed_salesman" ? "#166534" : row.acceptance === "confirmed_other" ? "#075985" : "#6b7280", fontWeight: 600 }}>
                              {t(["confirmed_salesman", "confirmed_other"].includes(row.acceptance) ? row.acceptance : "not_recorded")}
                            </td>
                          </tr>
                        ))}</tbody>
                        <tfoot><tr><th scope="row" colSpan={8}>{t("total")}</th><td>{pagination.total}</td></tr></tfoot>
                      </table>
                    </ExportableTable>
                  )}
                </>
              )}
              <div className="moduleFilterRow" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px", marginTop: "12px" }}>
                <button type="button" className="moduleInlineButton" disabled={loading || accessDenied || !!error || pagination.page <= 1} onClick={() => setApplied((current) => ({ ...current, page: pagination.page - 1 }))}>{t("prev")}</button>
                <span>{t("page")} {pagination.page} {t("of")} {Math.max(1, pagination.totalPages)}</span>
                <button type="button" className="moduleInlineButton" disabled={loading || accessDenied || !!error || pagination.page >= pagination.totalPages} onClick={() => setApplied((current) => ({ ...current, page: pagination.page + 1 }))}>{t("next")}</button>
              </div>
            </section>
          )}
        </div>
      </main>
    </MorningAttendanceGate>
  );
}