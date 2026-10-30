"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import AppLanguageSwitch from "./AppLanguageSwitch";
import ExportableTable from "./ExportableTable";
import MorningAttendanceGate from "./MorningAttendanceGate";
import SupabaseUnavailable from "./SupabaseUnavailable";
import BiExcelHead, { useBiExcelFilters } from "../management/business-dashboard/BiExcelHead";
import { translate, useAppLanguage } from "../lib/appLanguage";
import { resolveAuthSession } from "../lib/authSession";
import { excelFilterCellText } from "../lib/biExcelFilters";
import { getSupabaseClient } from "../lib/supabase";
import { useModuleAccess } from "../hooks/useModuleAccess";

const COPY = {
  "bad-debts": {
    title: { en: "Potential Bad Debts", ar: "ديون محتملة معدومة" },
    subtitle: {
      en: "Customers with outstanding older than 120 days and no Funds Received in the last 10 days.",
      ar: "عملاء لديهم مستحقات أقدم من 120 يوماً ولم يُستلم منهم مبلغ خلال آخر 10 أيام.",
    },
    filename: "potential-bad-debts",
    sheet: "Potential bad debts",
    moduleKey: "potentialBadDebts",
    otherHref: "/management/legal-transfers",
    otherLabel: { en: "Customers transferred to legal", ar: "العملاء المحولون للقانوني" },
  },
  legal: {
    title: { en: "Customers Transferred to Legal", ar: "عملاء محولون للقانوني" },
    subtitle: {
      en: "Customers currently marked as transferred to legal, with their outstanding balance.",
      ar: "العملاء المحولون حالياً إلى القانوني مع رصيدهم المستحق.",
    },
    filename: "legal-transfers",
    sheet: "Legal transfers",
    moduleKey: "legalTransfers",
    otherHref: "/management/potential-bad-debts",
    otherLabel: { en: "Potential bad debts", ar: "ديون محتملة معدومة" },
  },
};

const TEXT = {
  back: { en: "← Management", ar: "← الإدارة" },
  loading: { en: "Loading report...", ar: "جاري تحميل التقرير..." },
  refresh: { en: "Refresh", ar: "تحديث" },
  code: { en: "Code", ar: "الكود" },
  customer: { en: "Customer", ar: "العميل" },
  salesman: { en: "Salesman", ar: "المندوب" },
  cityArea: { en: "City / Area", ar: "المدينة / المنطقة" },
  above120: { en: ">120", ar: ">120" },
  totalOutstanding: { en: "Total outstanding", ar: "إجمالي المستحقات" },
  received: { en: "Received last 10 days", ar: "المستلم آخر 10 أيام" },
  oldestInvoiceDays: { en: "Oldest invoice days", ar: "أقدم فاتورة بالأيام" },
  lastPaymentDate: { en: "Last payment date", ar: "تاريخ آخر دفعة" },
  lastPaymentAmount: { en: "Last payment amt", ar: "مبلغ آخر دفعة" },
  lastVisit: { en: "Last visit", ar: "آخر زيارة" },
  visitPerson: { en: "Visit person", ar: "اسم الزائر" },
  remarks: { en: "Remarks", ar: "الملاحظات" },
  legal: { en: "Transferred to legal", ar: "محول للقانوني" },
  transferredOn: { en: "Transferred on", ar: "تاريخ التحويل" },
  transferredBy: { en: "Transferred by", ar: "حوّله" },
  note: { en: "Legal note", ar: "ملاحظة القانوني" },
  yes: { en: "Yes", ar: "نعم" },
  no: { en: "No", ar: "لا" },
  total: { en: "Total", ar: "الإجمالي" },
  customers: { en: "Customers", ar: "العملاء" },
  shown: { en: "shown", ar: "ظاهر" },
  asOf: { en: "As of", ar: "حتى" },
  noRows: { en: "No customers match this report.", ar: "لا يوجد عملاء في هذا التقرير." },
  accessDenied: {
    en: "Only admin, manager, or invoice maker can open this report.",
    ar: "هذا التقرير للمدير أو الأدمن أو معد الفواتير.",
  },
  signIn: { en: "Please login again.", ar: "يرجى تسجيل الدخول مرة أخرى." },
};

function formatAmount(value) {
  return Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(value) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return text || "-";
  const [year, month, day] = text.split("-");
  return `${day}/${month}/${year}`;
}

function filterKeysFor(view) {
  const keys = [
    "code",
    "customer",
    "salesman",
    "cityArea",
    "above120",
    "totalOutstanding",
    "received",
    "lastPaymentDate",
    "lastPaymentAmount",
    "oldestInvoiceDays",
    "lastVisit",
    "visitPerson",
    "remarks",
    "legal",
  ];
  if (view === "legal") keys.push("transferredOn", "transferredBy", "note");
  else keys.push("transferredOn", "note");
  return keys;
}

function rowFilterValue(row, key, yesLabel, noLabel) {
  if (key === "code") return excelFilterCellText(row.customerCode);
  if (key === "customer") return excelFilterCellText(row.customerName);
  if (key === "salesman") return excelFilterCellText(row.salesman || "-");
  if (key === "cityArea") return excelFilterCellText(row.cityArea || "-");
  if (key === "above120") return formatAmount(row.outstandingAbove120);
  if (key === "totalOutstanding") return formatAmount(row.totalOutstanding);
  if (key === "received") return formatAmount(row.receivedLast10Days);
  if (key === "lastPaymentDate") return formatDate(row.lastPaymentDate);
  if (key === "lastPaymentAmount") {
    return String(row.lastPaymentDate || "").trim() ? formatAmount(row.lastPaymentAmount) : "-";
  }
  if (key === "oldestInvoiceDays") return row.oldestInvoiceDays ? String(row.oldestInvoiceDays) : "-";
  if (key === "lastVisit") return formatDate(row.lastVisitDate);
  if (key === "visitPerson") return excelFilterCellText(row.lastVisitPerson || "-");
  if (key === "remarks") return excelFilterCellText(row.lastVisitRemark || "-");
  if (key === "legal") return row.transferredToLegal ? yesLabel : noLabel;
  if (key === "transferredOn") return formatDate(row.transferredAt);
  if (key === "transferredBy") return excelFilterCellText(row.transferredBy || "-");
  if (key === "note") return excelFilterCellText(row.legalNote || "-");
  return "-";
}

export default function DebtReportView({ view = "bad-debts" }) {
  const copy = COPY[view] || COPY["bad-debts"];
  const { language, dir, setLanguage } = useAppLanguage();
  const t = translate(language, TEXT);
  const title = translate(language, { title: copy.title, subtitle: copy.subtitle, other: copy.otherLabel });
  const supabaseClient = getSupabaseClient();
  const { access, loading: accessLoading } = useModuleAccess();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [asOf, setAsOf] = useState("");

  const filterKeys = useMemo(() => filterKeysFor(view), [view]);
  const valueOf = useCallback(
    (row, key) => rowFilterValue(row, key, t("yes"), t("no")),
    [t],
  );
  const { filters, options, visibleRows, setFilter } = useBiExcelFilters(rows, filterKeys, valueOf);
  const visibleSummary = useMemo(() => visibleRows.reduce((totals, row) => ({
    above120: totals.above120 + Number(row.outstandingAbove120 || 0),
    total: totals.total + Number(row.totalOutstanding || 0),
    received: totals.received + Number(row.receivedLast10Days || 0),
    legal: totals.legal + (row.transferredToLegal ? 1 : 0),
  }), { above120: 0, total: 0, received: 0, legal: 0 }), [visibleRows]);

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const supabase = getSupabaseClient();
      const session = await resolveAuthSession(supabase);
      const token = session?.access_token || "";
      if (!token) throw new Error("SIGN_IN");
      const response = await fetch(`/api/bad-debt-reports?view=${view}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const payload = await response.json();
      if (response.status === 401) throw new Error("SIGN_IN");
      if (response.status === 403) throw new Error("DENIED");
      if (!response.ok || !payload.success) throw new Error(payload.error || "Unable to load the report.");
      setRows(Array.isArray(payload.rows) ? payload.rows : []);
      setSummary(payload.summary || null);
      setAsOf(payload.asOf || "");
    } catch (err) {
      setRows([]);
      setSummary(null);
      setError(err.message || "Unable to load the report.");
    } finally {
      setLoading(false);
    }
  }, [view]);

  useEffect(() => {
    if (accessLoading) return;
    if (!access.canAccess(copy.moduleKey)) {
      setLoading(false);
      setError("DENIED");
      return;
    }
    void loadReport();
  }, [access, accessLoading, copy.moduleKey, loadReport]);

  if (!supabaseClient) {
    return (
      <SupabaseUnavailable
        title={`${copy.title.en} unavailable`}
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
              <h1>{title("title")}</h1>
              <p className="moduleSubtitle">{title("subtitle")}</p>
            </div>
            <div className="moduleHeaderMeta">
              <AppLanguageSwitch language={language} setLanguage={setLanguage} />
              <Link href={copy.otherHref} className="moduleBackLink">{title("other")}</Link>
              <Link href="/management" className="moduleBackLink">{t("back")}</Link>
            </div>
          </div>

          {denied || signedOut ? (
            <p className="moduleHint">{signedOut ? t("signIn") : t("accessDenied")}</p>
          ) : (
            <section className="moduleSection">
              <div className="moduleSectionHeader">
                <h2>{title("title")}</h2>
                <span>
                  {visibleRows.length} {t("shown")} / {rows.length}
                  {asOf ? ` · ${t("asOf")} ${formatDate(asOf)}` : ""}
                </span>
                <button type="button" className="moduleInlineButton" onClick={loadReport}>{t("refresh")}</button>
              </div>
              {summary ? (
                <p className="moduleHint">
                  {t("customers")}: {summary.customers}
                  {" · "}
                  {t("above120")}: {formatAmount(summary.outstandingAbove120)}
                  {" · "}
                  {t("totalOutstanding")}: {formatAmount(summary.totalOutstanding)}
                  {view === "bad-debts" ? ` · ${t("legal")}: ${summary.transferredToLegal}` : ""}
                </p>
              ) : null}
              {error && !denied && !signedOut ? <p className="moduleHint">{error}</p> : null}
              {loading || accessLoading ? (
                <div className="moduleLoading">{t("loading")}</div>
              ) : showTable && rows.length === 0 ? (
                <div className="moduleHint">{t("noRows")}</div>
              ) : showTable ? (
                <ExportableTable filename={copy.filename} sheetName={copy.sheet} className="moduleTableWrap moduleBiTableWrap">
                  <table className="moduleTable moduleBiTable">
                    <thead>
                      <tr>
                        <BiExcelHead label={t("code")} filterKey="code" options={options} filters={filters} onChange={setFilter} />
                        <BiExcelHead label={t("customer")} filterKey="customer" options={options} filters={filters} onChange={setFilter} />
                        <BiExcelHead label={t("salesman")} filterKey="salesman" options={options} filters={filters} onChange={setFilter} />
                        <BiExcelHead label={t("cityArea")} filterKey="cityArea" options={options} filters={filters} onChange={setFilter} />
                        <BiExcelHead label={t("above120")} filterKey="above120" options={options} filters={filters} onChange={setFilter} className="moduleBiTotalCol" />
                        <BiExcelHead label={t("totalOutstanding")} filterKey="totalOutstanding" options={options} filters={filters} onChange={setFilter} className="moduleBiTotalCol" />
                        <BiExcelHead label={t("received")} filterKey="received" options={options} filters={filters} onChange={setFilter} />
                        <BiExcelHead label={t("lastPaymentDate")} filterKey="lastPaymentDate" options={options} filters={filters} onChange={setFilter} />
                        <BiExcelHead label={t("lastPaymentAmount")} filterKey="lastPaymentAmount" options={options} filters={filters} onChange={setFilter} />
                        <BiExcelHead label={t("oldestInvoiceDays")} filterKey="oldestInvoiceDays" options={options} filters={filters} onChange={setFilter} />
                        <BiExcelHead label={t("lastVisit")} filterKey="lastVisit" options={options} filters={filters} onChange={setFilter} />
                        <BiExcelHead label={t("visitPerson")} filterKey="visitPerson" options={options} filters={filters} onChange={setFilter} />
                        <BiExcelHead label={t("remarks")} filterKey="remarks" options={options} filters={filters} onChange={setFilter} />
                        <BiExcelHead label={t("legal")} filterKey="legal" options={options} filters={filters} onChange={setFilter} />
                        <BiExcelHead label={t("transferredOn")} filterKey="transferredOn" options={options} filters={filters} onChange={setFilter} />
                        {view === "legal" ? (
                          <BiExcelHead label={t("transferredBy")} filterKey="transferredBy" options={options} filters={filters} onChange={setFilter} />
                        ) : null}
                        <BiExcelHead label={t("note")} filterKey="note" options={options} filters={filters} onChange={setFilter} />
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRows.map((row) => (
                        <tr key={`${row.customerCode}-${row.transferredAt}`}>
                          <td>{row.customerCode}</td>
                          <td>{row.customerName}</td>
                          <td>{row.salesman || "-"}</td>
                          <td>{row.cityArea || "-"}</td>
                          <td className="moduleBiTotalCol moduleBiMonthCell--down">{formatAmount(row.outstandingAbove120)}</td>
                          <td className="moduleBiTotalCol">{formatAmount(row.totalOutstanding)}</td>
                          <td>{formatAmount(row.receivedLast10Days)}</td>
                          <td>{formatDate(row.lastPaymentDate)}</td>
                          <td>{String(row.lastPaymentDate || "").trim() ? formatAmount(row.lastPaymentAmount) : "-"}</td>
                          <td>{row.oldestInvoiceDays || "-"}</td>
                          <td>{formatDate(row.lastVisitDate)}</td>
                          <td>{row.lastVisitPerson || "-"}</td>
                          <td>{row.lastVisitRemark || "-"}</td>
                          <td className={row.transferredToLegal ? "moduleBiMonthCell--down" : ""}>
                            {row.transferredToLegal ? t("yes") : t("no")}
                          </td>
                          <td>{formatDate(row.transferredAt)}</td>
                          {view === "legal" ? <td>{row.transferredBy || "-"}</td> : null}
                          <td>{row.legalNote || "-"}</td>
                        </tr>
                      ))}
                      {visibleRows.length === 0 ? (
                        <tr>
                          <td colSpan={view === "legal" ? 17 : 16}>{t("noRows")}</td>
                        </tr>
                      ) : null}
                    </tbody>
                    {visibleRows.length > 0 ? (
                      <tfoot>
                        <tr>
                          <td><strong>{t("total")}</strong></td>
                          <td><strong>{visibleRows.length}</strong></td>
                          <td />
                          <td />
                          <td className="moduleBiTotalCol"><strong>{formatAmount(visibleSummary.above120)}</strong></td>
                          <td className="moduleBiTotalCol"><strong>{formatAmount(visibleSummary.total)}</strong></td>
                          <td><strong>{formatAmount(visibleSummary.received)}</strong></td>
                          <td />
                          <td />
                          <td />
                          <td />
                          <td />
                          <td />
                          <td><strong>{visibleSummary.legal}</strong></td>
                          <td colSpan={view === "legal" ? 3 : 2} />
                        </tr>
                      </tfoot>
                    ) : null}
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
