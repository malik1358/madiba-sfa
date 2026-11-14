"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";
import ExportableTable from "../../components/ExportableTable";
import MorningAttendanceGate from "../../components/MorningAttendanceGate";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";
import BiExcelHead, { useBiExcelFilters } from "../business-dashboard/BiExcelHead";
import { useModuleAccess } from "../../hooks/useModuleAccess";
import { translate, useAppLanguage } from "../../lib/appLanguage";
import { resolveAuthSession } from "../../lib/authSession";
import { excelFilterCellText } from "../../lib/biExcelFilters";
import {
  COLLECTION_STALE_OVERDUE_MIN_VISIT_AGE_DAYS,
  COLLECTION_STALE_OVERDUE_RECEIPT_LOOKBACK_DAYS,
  COLLECTION_STALE_OVERDUE_RECENT_COLLECTION_WORKDAYS,
} from "../../lib/collectionStaleOverdueEmail.js";
import { getSupabaseClient } from "../../lib/supabase";

const TEXT = {
  title: { en: "Stale Overdue Collections", ar: "تحصيلات متأخرة راكدة" },
  subtitle: {
    en: "Due customers needing credit follow-up: overdue aging past threshold, no recent receipt, no near collection visit, and stale visit without order.",
    ar: "عملاء مستحقون يحتاجون متابعة ائتمان: تقادم تجاوز الحد، بلا إيصال حديث، بلا زيارة تحصيل قريبة، وزيارة بدون طلب قديمة.",
  },
  hint: {
    en: `Same rules as the daily email. Over 60 days (Parvez & Junaid: over 30), no receipt in the last ${COLLECTION_STALE_OVERDUE_RECEIPT_LOOKBACK_DAYS} days, no near collection visit in the last ${COLLECTION_STALE_OVERDUE_RECENT_COLLECTION_WORKDAYS} completed working days, last near visit without order older than ${COLLECTION_STALE_OVERDUE_MIN_VISIT_AGE_DAYS} days (or never). FAR visits are shown but do not count as fresh. Legal transfers stay listed and are marked.`,
    ar: `نفس قواعد البريد اليومي. أكثر من 60 يوماً (بارفيز وجنيد: أكثر من 30)، بلا إيصال خلال آخر ${COLLECTION_STALE_OVERDUE_RECEIPT_LOOKBACK_DAYS} أيام، بلا زيارة تحصيل قريبة خلال آخر ${COLLECTION_STALE_OVERDUE_RECENT_COLLECTION_WORKDAYS} أيام عمل مكتملة، وآخر زيارة قريبة بدون طلب أقدم من ${COLLECTION_STALE_OVERDUE_MIN_VISIT_AGE_DAYS} أيام (أو لم تُزر). زيارات FAR تظهر ولا تُحسب جديدة. المحولون للقانوني يبقون ويُعلَّمون.`,
  },
  back: { en: "← Management", ar: "← الإدارة" },
  paymentCollections: { en: "Payment Collections", ar: "التحصيلات" },
  potentialBadDebts: { en: "Potential Bad Debts", ar: "ديون محتملة معدومة" },
  loading: { en: "Loading report...", ar: "جاري تحميل التقرير..." },
  refresh: { en: "Refresh", ar: "تحديث" },
  code: { en: "Code", ar: "الكود" },
  customer: { en: "Customer", ar: "العميل" },
  salesman: { en: "Salesman", ar: "المندوب" },
  cityArea: { en: "City / Area", ar: "المدينة / المنطقة" },
  due: { en: "Due", ar: "المستحق" },
  overdue: { en: "Overdue", ar: "المتأخر" },
  aging: { en: "Aging bucket", ar: "شريحة التقادم" },
  maxOverdue: { en: "Max overdue days", ar: "أقصى أيام تأخير" },
  received: {
    en: `Recv ${COLLECTION_STALE_OVERDUE_RECEIPT_LOOKBACK_DAYS}d`,
    ar: `مستلم ${COLLECTION_STALE_OVERDUE_RECEIPT_LOOKBACK_DAYS}ي`,
  },
  lastCollection: { en: "Last collection", ar: "آخر تحصيل" },
  lastVisitWo: { en: "Last visit w/o order", ar: "آخر زيارة بدون طلب" },
  lastOutcome: { en: "Last outcome", ar: "آخر نتيجة" },
  remarks: { en: "Remarks", ar: "الملاحظات" },
  total: { en: "Total", ar: "الإجمالي" },
  customers: { en: "Customers", ar: "العملاء" },
  salesmen: { en: "Salesmen", ar: "المندوبون" },
  shown: { en: "shown", ar: "ظاهر" },
  asOf: { en: "As of", ar: "حتى" },
  noRows: { en: "No customers match the stale overdue filters today.", ar: "لا يوجد عملاء مطابقون لفلاتر التحصيل الراكد اليوم." },
  legalBadge: { en: "Legal", ar: "قانوني" },
  accessDenied: {
    en: "Only admin, manager, or invoice maker can open this report.",
    ar: "هذا التقرير للمدير أو الأدمن أو معد الفواتير.",
  },
  signIn: { en: "Please login again.", ar: "يرجى تسجيل الدخول مرة أخرى." },
};

const FILTER_KEYS = [
  "code",
  "customer",
  "salesman",
  "cityArea",
  "due",
  "overdue",
  "aging",
  "maxOverdue",
  "received",
  "lastCollection",
  "lastVisitWo",
  "lastOutcome",
  "remarks",
];

function formatAmount(value) {
  return Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDateLabel(value) {
  return String(value || "").trim() || "Never";
}

function rowFilterValue(row, key, legalBadgeLabel) {
  if (key === "code") {
    const code = excelFilterCellText(row.customerCode);
    return row.isLegal ? `${code} ${legalBadgeLabel}` : code;
  }
  if (key === "customer") return excelFilterCellText(row.customerName);
  if (key === "salesman") return excelFilterCellText(row.salesman || "-");
  if (key === "cityArea") return excelFilterCellText(`${row.city || "-"} / ${row.area || "-"}`);
  if (key === "due") return formatAmount(row.dueAmount);
  if (key === "overdue") return formatAmount(row.overdueAmount);
  if (key === "aging") return excelFilterCellText(row.agingLabel || "-");
  if (key === "maxOverdue") return String(row.maxOverdueDays ?? "-");
  if (key === "received") return formatAmount(row.receivedLookbackDays);
  if (key === "lastCollection") return formatDateLabel(row.lastVisitDate);
  if (key === "lastVisitWo") return formatDateLabel(row.lastVisitWithoutOrderDate);
  if (key === "lastOutcome") return excelFilterCellText(row.lastOutcome || "-");
  if (key === "remarks") return excelFilterCellText(row.remarks || "-");
  return "-";
}

export default function CollectionStaleOverduePage() {
  const { language, dir, setLanguage } = useAppLanguage();
  const t = translate(language, TEXT);
  const supabaseClient = getSupabaseClient();
  const { access, loading: accessLoading } = useModuleAccess();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [asOf, setAsOf] = useState("");
  const [groupCount, setGroupCount] = useState(0);

  const valueOf = useCallback(
    (row, key) => rowFilterValue(row, key, t("legalBadge")),
    [t],
  );
  const { filters, options, visibleRows, setFilter } = useBiExcelFilters(rows, FILTER_KEYS, valueOf);

  const visibleSummary = useMemo(() => visibleRows.reduce((totals, row) => ({
    customers: totals.customers + 1,
    dueAmount: totals.dueAmount + Number(row.dueAmount || 0),
    overdueAmount: totals.overdueAmount + Number(row.overdueAmount || 0),
  }), { customers: 0, dueAmount: 0, overdueAmount: 0 }), [visibleRows]);

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const supabase = getSupabaseClient();
      const session = await resolveAuthSession(supabase);
      const token = session?.access_token || "";
      if (!token) throw new Error("SIGN_IN");
      const response = await fetch("/api/collection-stale-overdue", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 401) throw new Error("SIGN_IN");
      if (response.status === 403) throw new Error("DENIED");
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Unable to load the report.");
      }
      setRows(Array.isArray(payload.rows) ? payload.rows : []);
      setSummary(payload.summary || null);
      setAsOf(payload.asOf || payload.date || "");
      setGroupCount(Number(payload.groupCount || 0) || 0);
    } catch (err) {
      setRows([]);
      setSummary(null);
      setGroupCount(0);
      setError(err.message || "Unable to load the report.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (accessLoading) return;
    if (!access.canAccess("collectionStaleOverdue")) {
      setLoading(false);
      setError("DENIED");
      return;
    }
    void loadReport();
  }, [access, accessLoading, loadReport]);

  if (!supabaseClient) {
    return (
      <SupabaseUnavailable
        title="Stale overdue collections unavailable"
        message="Supabase credentials are required for this report."
      />
    );
  }

  const denied = error === "DENIED";
  const signedOut = error === "SIGN_IN";
  const showTable = !loading && !denied && !signedOut;

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
              <Link href="/management/payment-collections" className="moduleBackLink">{t("paymentCollections")}</Link>
              <Link href="/management/potential-bad-debts" className="moduleBackLink">{t("potentialBadDebts")}</Link>
              <Link href="/management" className="moduleBackLink">{t("back")}</Link>
            </div>
          </div>

          {denied || signedOut ? (
            <p className="moduleHint">{signedOut ? t("signIn") : t("accessDenied")}</p>
          ) : (
            <section className="moduleSection">
              <div className="moduleSectionHeader">
                <h2>{t("title")}</h2>
                <span>
                  {visibleRows.length} {t("shown")} / {rows.length}
                  {asOf ? ` · ${t("asOf")} ${asOf}` : ""}
                  {groupCount ? ` · ${groupCount} ${t("salesmen")}` : ""}
                </span>
              </div>

              <div className="moduleHint" style={{ marginBottom: "12px" }}>{t("hint")}</div>

              <div className="moduleFilterRow" style={{ marginBottom: "12px" }}>
                <button type="button" className="moduleInlineButton" onClick={() => void loadReport()} disabled={loading}>
                  {t("refresh")}
                </button>
                {summary ? (
                  <span className="moduleHint">
                    {t("customers")}: {summary.customers}
                    {" · "}
                    {t("due")}: {formatAmount(summary.dueAmount)}
                    {" · "}
                    {t("overdue")}: {formatAmount(summary.overdueAmount)}
                  </span>
                ) : null}
              </div>

              {loading ? (
                <div className="moduleLoading">{t("loading")}</div>
              ) : null}

              {showTable && !error && rows.length === 0 ? (
                <div className="moduleHint">{t("noRows")}</div>
              ) : null}

              {showTable && error && error !== "DENIED" && error !== "SIGN_IN" ? (
                <div className="moduleHint">{error}</div>
              ) : null}

              {showTable && rows.length > 0 ? (
                <ExportableTable
                  filename="collection-stale-overdue"
                  sheetName="Stale overdue"
                  className="moduleTableWrap"
                >
                  <table className="moduleTable moduleBiTable">
                    <thead>
                      <tr>
                        <BiExcelHead label={t("code")} filterKey="code" options={options} filters={filters} onChange={setFilter} />
                        <BiExcelHead label={t("customer")} filterKey="customer" options={options} filters={filters} onChange={setFilter} />
                        <BiExcelHead label={t("salesman")} filterKey="salesman" options={options} filters={filters} onChange={setFilter} />
                        <BiExcelHead label={t("cityArea")} filterKey="cityArea" options={options} filters={filters} onChange={setFilter} />
                        <BiExcelHead label={t("due")} filterKey="due" options={options} filters={filters} onChange={setFilter} className="moduleBiTotalCol" />
                        <BiExcelHead label={t("overdue")} filterKey="overdue" options={options} filters={filters} onChange={setFilter} className="moduleBiTotalCol" />
                        <BiExcelHead label={t("aging")} filterKey="aging" options={options} filters={filters} onChange={setFilter} />
                        <BiExcelHead label={t("maxOverdue")} filterKey="maxOverdue" options={options} filters={filters} onChange={setFilter} />
                        <BiExcelHead label={t("received")} filterKey="received" options={options} filters={filters} onChange={setFilter} />
                        <BiExcelHead label={t("lastCollection")} filterKey="lastCollection" options={options} filters={filters} onChange={setFilter} />
                        <BiExcelHead label={t("lastVisitWo")} filterKey="lastVisitWo" options={options} filters={filters} onChange={setFilter} />
                        <BiExcelHead label={t("lastOutcome")} filterKey="lastOutcome" options={options} filters={filters} onChange={setFilter} />
                        <BiExcelHead label={t("remarks")} filterKey="remarks" options={options} filters={filters} onChange={setFilter} />
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRows.map((row) => (
                        <tr key={`${row.customerCode}-${row.salesman}`}>
                          <td data-label={t("code")}>
                            {row.customerCode || "-"}
                            {row.isLegal ? (
                              <>
                                {" "}
                                <span className="moduleBiMonthCell--down">{t("legalBadge")}</span>
                              </>
                            ) : null}
                          </td>
                          <td data-label={t("customer")}>{row.customerName || "-"}</td>
                          <td data-label={t("salesman")}>{row.salesman || "-"}</td>
                          <td data-label={t("cityArea")}>{`${row.city || "-"} / ${row.area || "-"}`}</td>
                          <td data-label={t("due")} className="moduleBiTotalCol">{formatAmount(row.dueAmount)}</td>
                          <td data-label={t("overdue")} className="moduleBiTotalCol moduleBiMonthCell--down">
                            {formatAmount(row.overdueAmount)}
                          </td>
                          <td data-label={t("aging")}>{row.agingLabel || "-"}</td>
                          <td data-label={t("maxOverdue")}>{row.maxOverdueDays ?? "-"}</td>
                          <td data-label={t("received")}>{formatAmount(row.receivedLookbackDays)}</td>
                          <td data-label={t("lastCollection")}>
                            {formatDateLabel(row.lastVisitDate)}
                            {row.lastVisitIsFar ? " FAR" : ""}
                          </td>
                          <td data-label={t("lastVisitWo")}>
                            {formatDateLabel(row.lastVisitWithoutOrderDate)}
                            {row.lastVisitWithoutOrderIsFar ? " FAR" : ""}
                          </td>
                          <td data-label={t("lastOutcome")}>{row.lastOutcome || "-"}</td>
                          <td data-label={t("remarks")}>{row.remarks || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={4}><strong>{t("total")}</strong></td>
                        <td className="moduleBiTotalCol"><strong>{formatAmount(visibleSummary.dueAmount)}</strong></td>
                        <td className="moduleBiTotalCol"><strong>{formatAmount(visibleSummary.overdueAmount)}</strong></td>
                        <td colSpan={7}>
                          <strong>
                            {visibleSummary.customers} {t("customers")}
                          </strong>
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </ExportableTable>
              ) : null}
            </section>
          )}
        </div>
      </main>
    </MorningAttendanceGate>
  );
}
