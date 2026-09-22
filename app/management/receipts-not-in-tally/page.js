"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";
import MorningAttendanceGate from "../../components/MorningAttendanceGate";
import AccessibleHeaderLink from "../../components/AccessibleHeaderLink";
import ExportableTable from "../../components/ExportableTable";
import BiExcelHead, { useBiExcelFilters } from "../business-dashboard/BiExcelHead";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";
import { translate, useAppLanguage } from "../../lib/appLanguage";
import { fetchJsonWithTimeout, resolveAuthSession, startReportSafetyTimer } from "../../lib/authSession";
import { excelFilterCellText } from "../../lib/biExcelFilters";
import { getKsaDateString } from "../../lib/workdayActivity";
import { getSupabaseClient } from "../../lib/supabase";
import { usePopupMessages } from "../../hooks/usePopupMessages";
import { useModuleAccess } from "../../hooks/useModuleAccess";

const TEXT = {
  title: { en: "Receipts Not in Tally", ar: "إيصالات غير موجودة في تالي" },
  subtitle: {
    en: "App collection receipts (Funds Received) that do not match a row in the Tally receipt register upload.",
    ar: "إيصالات التحصيل في التطبيق (تم استلام مبلغ) التي لا تطابق صفاً في رفع سجل إيصالات تالي.",
  },
  back: { en: "← Management", ar: "← الإدارة" },
  collections: { en: "Collections", ar: "التحصيلات" },
  upload: { en: "Imports", ar: "الاستيراد" },
  loading: { en: "Loading reconciliation...", ar: "جاري تحميل المطابقة..." },
  from: { en: "From", ar: "من" },
  to: { en: "To", ar: "إلى" },
  windowDays: { en: "Date window (± days)", ar: "نافذة التاريخ (± أيام)" },
  refresh: { en: "Refresh", ar: "تحديث" },
  accessDenied: {
    en: "Only admin, manager, or collector can access this report.",
    ar: "فقط المدير أو الأدمن أو المحصل يمكنه الوصول لهذا التقرير.",
  },
  noRows: {
    en: "All app receipts in this period match a Tally upload row (customer + amount + date).",
    ar: "كل إيصالات التطبيق في هذه الفترة تطابق صفاً في رفع تالي (عميل + مبلغ + تاريخ).",
  },
  noUpload: {
    en: "No Tally receipt register has been uploaded yet. Import a receipt file first.",
    ar: "لم يتم رفع سجل إيصالات تالي بعد. استورد ملف الإيصالات أولاً.",
  },
  hint: {
    en: "Match rule: same customer (code or same trading name), amount within 1.00, and receipt date within the selected day window of the app visit date (KSA). Choose 0–30 days. One Tally voucher is used at most once.",
    ar: "قاعدة المطابقة: نفس العميل (الكود أو نفس الاسم التجاري)، فرق المبلغ حتى 1.00، وتاريخ إيصال تالي ضمن نافذة الأيام المحددة حول تاريخ زيارة التطبيق (توقيت السعودية). اختر من 0 إلى 30 يوماً. يُستخدم كل قسيمة تالي مرة واحدة فقط.",
  },
  appReceipts: { en: "App receipts", ar: "إيصالات التطبيق" },
  matched: { en: "Matched to Tally", ar: "مطابق لتالي" },
  missing: { en: "Missing in Tally", ar: "غير موجود في تالي" },
  missingAmount: { en: "Missing amount", ar: "المبلغ الناقص" },
  appTotal: { en: "App total", ar: "إجمالي التطبيق" },
  tallyFile: { en: "Tally file", ar: "ملف تالي" },
  tallyRows: { en: "Tally rows (window)", ar: "صفوف تالي (النافذة)" },
  uploadedAt: { en: "Uploaded", ar: "تاريخ الرفع" },
  visitDate: { en: "Visit date", ar: "تاريخ الزيارة" },
  time: { en: "Time", ar: "الوقت" },
  customer: { en: "Customer", ar: "العميل" },
  amount: { en: "Amount", ar: "المبلغ" },
  mode: { en: "Mode", ar: "الطريقة" },
  collector: { en: "Collected by", ar: "محصّل بواسطة" },
  status: { en: "Status", ar: "الحالة" },
  total: { en: "Total", ar: "الإجمالي" },
  none: { en: "None", ar: "لا يوجد" },
  shown: { en: "shown", ar: "ظاهر" },
};

const FILTER_KEYS = ["visitDate", "time", "customer", "amount", "mode", "status", "collector"];


function monthStart(today = getKsaDateString()) {
  return `${today.slice(0, 7)}-01`;
}

function formatAmount(value) {
  return Number(value || 0).toLocaleString("en-SA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDateDisplay(iso) {
  const text = String(iso || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return text || "-";
  const [year, month, day] = text.split("-");
  return `${day}/${month}/${year}`;
}

function formatTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("en-GB", {
    timeZone: "Asia/Riyadh",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatMode(value) {
  const text = String(value || "").trim();
  if (!text) return "-";
  return text.replace(/_/g, " ");
}

function receiptFilterValue(row, key) {
  if (key === "visitDate") return formatDateDisplay(row.visitDate);
  if (key === "time") return formatTime(row.savedAt);
  if (key === "customer") {
    return excelFilterCellText(`${row.customerName || row.customerCode || ""} ${row.customerCode || ""}`);
  }
  if (key === "amount") return formatAmount(row.amountReceived);
  if (key === "mode") return formatMode(row.receiptMode);
  if (key === "status") return formatMode(row.paymentStatus);
  if (key === "collector") return excelFilterCellText(row.collectorName || "-");
  return "-";
}

export default function ReceiptsNotInTallyPage() {
  const { language, dir, setLanguage } = useAppLanguage();
  const t = translate(language, TEXT);
  const { access, loading: loadingAccess } = useModuleAccess();
  const supabaseClient = getSupabaseClient();

  const [fromDate, setFromDate] = useState(() => monthStart());
  const [toDate, setToDate] = useState(() => getKsaDateString());
  const [windowDays, setWindowDays] = useState("1");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [report, setReport] = useState(null);

  usePopupMessages({ error });

  const canAccess = access.canAccess("receiptsNotInTally");

  const missingRows = useMemo(
    () => (Array.isArray(report?.missingInTally) ? report.missingInTally : []),
    [report],
  );

  const {
    filters,
    options,
    visibleRows,
    setFilter,
  } = useBiExcelFilters(missingRows, FILTER_KEYS, receiptFilterValue);

  const missingTotal = useMemo(
    () => visibleRows.reduce((sum, row) => sum + Number(row.amountReceived || 0), 0),
    [visibleRows],
  );

  useEffect(() => {
    if (loadingAccess) return undefined;
    if (!canAccess) {
      setLoading(false);
      setReport(null);
      return undefined;
    }

    let cancelled = false;
    const stopSafetyTimer = startReportSafetyTimer(() => {
      if (cancelled) return;
      setLoading(false);
      setError((current) => current || "Report load timed out. Please login and refresh the page.");
    });

    async function loadReport() {
      const supabase = getSupabaseClient();
      if (!supabase) {
        stopSafetyTimer();
        setLoading(false);
        return;
      }

      setLoading(true);
      setError("");

      try {
        const session = await resolveAuthSession(supabase, 12000);
        if (cancelled) return;
        if (!session?.access_token) {
          throw new Error("Please login again.");
        }

        const params = new URLSearchParams({
          from: fromDate,
          to: toDate,
          windowDays: String(windowDays || "1"),
        });

        const { response, payload } = await fetchJsonWithTimeout(
          `/api/receipts-not-in-tally?${params.toString()}`,
          {
            headers: {
              Authorization: `Bearer ${session.access_token}`,
            },
          },
          60000,
        );

        if (cancelled) return;
        if (!response.ok || !payload.success) {
          throw new Error(payload.error || "Unable to load receipts not in Tally report.");
        }

        setReport(payload);
      } catch (err) {
        if (cancelled) return;
        const message = String(err.message || "");
        if (message === "SESSION_TIMEOUT") {
          setError("Session check timed out. Please refresh the page or login again.");
        } else {
          setError(err.message || "Unable to load receipts not in Tally report.");
        }
        setReport(null);
      } finally {
        stopSafetyTimer();
        if (!cancelled) setLoading(false);
      }
    }

    loadReport();
    return () => {
      cancelled = true;
      stopSafetyTimer();
    };
  }, [canAccess, fromDate, loadingAccess, toDate, windowDays]);

  if (!supabaseClient) {
    return (
      <SupabaseUnavailable
        title="Receipts not in Tally unavailable"
        message="This report needs Supabase credentials."
      />
    );
  }

  if (!loadingAccess && !canAccess) {
    return (
      <MorningAttendanceGate requireMorningAttendance={false}>
        <main className="modulePage" dir={dir}>
          <div className="moduleShell">
            <div className="moduleHeader">
              <div>
                <p className="moduleEyebrow">MADIBA SFA</p>
                <h1>{t("title")}</h1>
              </div>
              <div className="moduleHeaderMeta">
                <AppLanguageSwitch language={language} setLanguage={setLanguage} />
                <Link href="/management" className="moduleBackLink">{t("back")}</Link>
              </div>
            </div>
            <div className="moduleHint">{t("accessDenied")}</div>
          </div>
        </main>
      </MorningAttendanceGate>
    );
  }

  const tallyFileName = report?.tallyUpload?.fileName || "";
  const hasTallyUpload = Boolean(tallyFileName || Number(report?.tallyUpload?.rowsCount || 0));

  return (
    <MorningAttendanceGate requireMorningAttendance={false}>
      <main className="modulePage" dir={dir}>
        <div className="moduleShell">
          <div className="moduleHeader">
            <div>
              <p className="moduleEyebrow">MADIBA SFA</p>
              <h1>{t("title")}</h1>
              <p className="moduleSubtitle">{t("subtitle")}</p>
            </div>
            <div className="moduleHeaderMeta">
              <AppLanguageSwitch language={language} setLanguage={setLanguage} />
              <AccessibleHeaderLink moduleKey="paymentCollections" href="/management/payment-collections" className="moduleBackLink">
                {t("collections")}
              </AccessibleHeaderLink>
              <AccessibleHeaderLink moduleKey="upload" href="/management/upload" className="moduleBackLink">
                {t("upload")}
              </AccessibleHeaderLink>
              <Link href="/management" className="moduleBackLink">{t("back")}</Link>
            </div>
          </div>

          <div className="moduleHint">{t("hint")}</div>

          <section className="moduleSection">
            <div className="moduleCollectorFilterGrid">
              <label className="moduleField">
                {t("from")}
                <input
                  className="moduleInput"
                  type="date"
                  value={fromDate}
                  onChange={(event) => setFromDate(event.target.value)}
                />
              </label>
              <label className="moduleField">
                {t("to")}
                <input
                  className="moduleInput"
                  type="date"
                  value={toDate}
                  onChange={(event) => setToDate(event.target.value)}
                />
              </label>
              <label className="moduleField">
                {t("windowDays")}
                <input
                  className="moduleInput"
                  type="number"
                  min="0"
                  max="30"
                  step="1"
                  value={windowDays}
                  onChange={(event) => {
                    const next = event.target.value;
                    if (next === "") {
                      setWindowDays("");
                      return;
                    }
                    const parsed = Number(next);
                    if (!Number.isFinite(parsed)) return;
                    setWindowDays(String(Math.max(0, Math.min(30, Math.round(parsed)))));
                  }}
                />
              </label>
            </div>
          </section>

          {error && error.includes("login") ? (
            <div className="moduleActionRow" style={{ marginBottom: "12px" }}>
              <Link href="/" className="moduleInlineButton">Go to login</Link>
            </div>
          ) : null}
          {loading && <div className="moduleLoading">{t("loading")}</div>}

          {!loading && report && (
            <>
              {!hasTallyUpload ? (
                <div className="moduleHint">{t("noUpload")}</div>
              ) : (
                <div className="moduleHint">
                  {t("tallyFile")}: {tallyFileName || t("none")}
                  {" · "}
                  {t("uploadedAt")}: {report.tallyUpload?.uploadedAt
                    ? new Date(report.tallyUpload.uploadedAt).toLocaleString("en-GB", { timeZone: "Asia/Riyadh" })
                    : t("none")}
                  {" · "}
                  {t("tallyRows")}: {report.summary?.tallyCandidateCount ?? 0}
                </div>
              )}

              <div className="moduleMetricGrid moduleMetricGridCols6">
                <section className="moduleMetricCard">
                  <span>{t("appReceipts")}</span>
                  <strong>{report.summary?.appCount || 0}</strong>
                </section>
                <section className="moduleMetricCard">
                  <span>{t("matched")}</span>
                  <strong>{report.summary?.matchedCount || 0}</strong>
                </section>
                <section className="moduleMetricCard">
                  <span>{t("missing")}</span>
                  <strong>{report.summary?.missingCount || 0}</strong>
                </section>
                <section className="moduleMetricCard">
                  <span>{t("appTotal")}</span>
                  <strong>{formatAmount(report.summary?.appTotal)}</strong>
                </section>
                <section className="moduleMetricCard">
                  <span>{t("missingAmount")}</span>
                  <strong>{formatAmount(report.summary?.missingTotal)}</strong>
                </section>
              </div>

              <section className="moduleSection">
                <div className="moduleSectionHeader">
                  <h2>{t("missing")}</h2>
                  <span>
                    {visibleRows.length} {t("shown")} / {missingRows.length}
                    {" · "}
                    {formatAmount(missingTotal)}
                  </span>
                </div>

                <ExportableTable
                  filename={`receipts-not-in-tally-${fromDate}-to-${toDate}`}
                  sheetName="Missing in Tally"
                  className="moduleTableWrap"
                >
                  <table className="moduleTable moduleBiTable">
                    <thead>
                      <tr>
                        <BiExcelHead label={t("visitDate")} filterKey="visitDate" options={options} filters={filters} onChange={setFilter} />
                        <BiExcelHead label={t("time")} filterKey="time" options={options} filters={filters} onChange={setFilter} />
                        <BiExcelHead label={t("customer")} filterKey="customer" options={options} filters={filters} onChange={setFilter} />
                        <BiExcelHead label={t("amount")} filterKey="amount" options={options} filters={filters} onChange={setFilter} className="moduleBiTotalCol" />
                        <BiExcelHead label={t("mode")} filterKey="mode" options={options} filters={filters} onChange={setFilter} />
                        <BiExcelHead label={t("status")} filterKey="status" options={options} filters={filters} onChange={setFilter} />
                        <BiExcelHead label={t("collector")} filterKey="collector" options={options} filters={filters} onChange={setFilter} />
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRows.map((row) => (
                        <tr key={row.id}>
                          <td>{formatDateDisplay(row.visitDate)}</td>
                          <td>{formatTime(row.savedAt)}</td>
                          <td>
                            {row.customerName || row.customerCode}
                            <div className="moduleCode">{row.customerCode}</div>
                          </td>
                          <td className="moduleBiTotalCol moduleBiMonthCell--down">
                            {formatAmount(row.amountReceived)}
                          </td>
                          <td>{formatMode(row.receiptMode)}</td>
                          <td>{formatMode(row.paymentStatus)}</td>
                          <td>{row.collectorName || "-"}</td>
                        </tr>
                      ))}
                      {visibleRows.length === 0 && (
                        <tr>
                          <td colSpan={7}>{t("noRows")}</td>
                        </tr>
                      )}
                    </tbody>
                    {visibleRows.length > 0 ? (
                      <tfoot>
                        <tr>
                          <td colSpan={3}><strong>{t("total")}</strong></td>
                          <td className="moduleBiTotalCol"><strong>{formatAmount(missingTotal)}</strong></td>
                          <td colSpan={3} />
                        </tr>
                      </tfoot>
                    ) : null}
                  </table>
                </ExportableTable>
              </section>
            </>
          )}
        </div>
      </main>
    </MorningAttendanceGate>
  );
}
