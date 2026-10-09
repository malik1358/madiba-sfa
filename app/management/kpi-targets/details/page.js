"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import AppLanguageSwitch from "../../../components/AppLanguageSwitch";
import MorningAttendanceGate from "../../../components/MorningAttendanceGate";
import SupabaseUnavailable from "../../../components/SupabaseUnavailable";
import { translate, useAppLanguage } from "../../../lib/appLanguage";
import { fetchJsonWithTimeout, resolveAuthSession } from "../../../lib/authSession";
import { usePopupMessages } from "../../../hooks/usePopupMessages";
import { getSupabaseClient } from "../../../lib/supabase";
import { formatPerformanceKpiValue } from "../../../lib/performanceKpis";
import ExportableTable from "../../../components/ExportableTable";

const TEXT = {
  title: { en: "KPI actual details", ar: "تفاصيل فعلي مؤشرات الأداء" },
  back: { en: "← KPI Targets", ar: "← أهداف الأداء" },
  loading: { en: "Loading transactions...", ar: "جاري تحميل المعاملات..." },
  date: { en: "Date", ar: "التاريخ" },
  reference: { en: "Reference", ar: "المرجع" },
  customer: { en: "Customer", ar: "العميل" },
  salesman: { en: "Salesman", ar: "المندوب" },
  description: { en: "Transaction / allocation", ar: "المعاملة / التخصيص" },
  amount: { en: "Contribution", ar: "المساهمة" },
  total: { en: "Total actual", ar: "إجمالي الفعلي" },
  noRows: { en: "No contributing transactions for this KPI.", ar: "لا توجد معاملات مساهمة لهذا المؤشر." },
};

const KPI_LABELS = {
  officeSupplies: { en: "Sales of office supplies", ar: "مبيعات مستلزمات المكتب" },
  otherSales: { en: "Others", ar: "أخرى" },
  totalSales: { en: "Total sales", ar: "إجمالي المبيعات" },
  collection: { en: "Collection", ar: "التحصيل" },
  cashCollection: { en: "Cash collection (info)", ar: "تحصيل النقد (معلومات)" },
  newCustomers: { en: "New customers", ar: "عملاء جدد" },
  repeatCustomers: { en: "Repeat customers", ar: "عملاء متكررون" },
};

function KpiDetailsContent() {
  const { language, dir, setLanguage } = useAppLanguage();
  const t = translate(language, TEXT);
  const params = useSearchParams();
  const month = params.get("month") || "";
  const kpiKey = params.get("kpi") || "";
  const salesmanCodes = params.get("salesmanCodes") || "";
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [report, setReport] = useState({ rows: [], actual: 0 });
  usePopupMessages({ error });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const supabase = getSupabaseClient();
      if (!supabase) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError("");
      try {
        const session = await resolveAuthSession(supabase);
        if (!session?.access_token) throw new Error("Please login again.");
        const query = new URLSearchParams({ month, kpi: kpiKey, salesmanCodes });
        const { response, payload } = await fetchJsonWithTimeout(
          `/api/admin/kpi-targets/details?${query.toString()}`,
          { headers: { Authorization: `Bearer ${session.access_token}` } },
          60000,
        );
        if (!response.ok || !payload.success) throw new Error(payload.error || "Unable to load KPI details.");
        if (!cancelled) setReport(payload);
      } catch (err) {
        if (!cancelled) setError(err.message || "Unable to load KPI details.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [month, kpiKey, salesmanCodes]);

  const supabaseClient = getSupabaseClient();
  if (!supabaseClient) {
    return <SupabaseUnavailable title="KPI details unavailable" message="Set the Supabase browser configuration to view KPI details." />;
  }

  const amountLabel = kpiKey === "newCustomers" || kpiKey === "repeatCustomers"
    ? (value) => String(Math.round(Number(value || 0)))
    : (value) => formatPerformanceKpiValue(kpiKey, value);
  const backHref = `/management/kpi-targets?month=${encodeURIComponent(month)}`;
  return (
    <MorningAttendanceGate>
      <main className="modulePage" dir={dir}>
        <div className="moduleShell">
          <div className="moduleHeader">
            <div>
              <p className="moduleEyebrow">MADIBA SFA - {month}</p>
              <h1>{t("title")}</h1>
              <p className="moduleSubtitle">{KPI_LABELS[kpiKey]?.[language] || KPI_LABELS[kpiKey]?.en || kpiKey}</p>
            </div>
            <div className="moduleHeaderMeta">
              <AppLanguageSwitch language={language} setLanguage={setLanguage} />
              <Link href={backHref} className="moduleBackLink">{t("back")}</Link>
            </div>
          </div>
          {error ? <div className="moduleError">{error}</div> : null}
          {loading ? <div className="moduleLoading">{t("loading")}</div> : (
            <ExportableTable filename={`kpi-${kpiKey}-${month}-details`} sheetName="KPI Details" className="moduleTableWrap">
              <table className="moduleTable">
                <thead>
                  <tr>
                    <th>{t("date")}</th>
                    <th>{t("reference")}</th>
                    <th>{t("customer")}</th>
                    <th>{t("salesman")}</th>
                    <th>{t("description")}</th>
                    <th>{t("amount")}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.length === 0 ? (
                    <tr><td colSpan={6} className="moduleHint">{t("noRows")}</td></tr>
                  ) : report.rows.map((row, index) => (
                    <tr key={`${row.salesmanCode}-${row.date}-${row.reference}-${index}`}>
                      <td>{row.date}</td>
                      <td>{row.reference}</td>
                      <td>{[row.customerCode, row.customerName].filter(Boolean).join(" | ")}</td>
                      <td>{row.salesmanCode}</td>
                      <td>{row.description}</td>
                      <td>{amountLabel(row.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="moduleKpiTotalsRow">
                    <td colSpan={5}><strong>{t("total")}</strong></td>
                    <td><strong>{amountLabel(report.actual)}</strong></td>
                  </tr>
                </tfoot>
              </table>
            </ExportableTable>
          )}
        </div>
      </main>
    </MorningAttendanceGate>
  );
}

export default function KpiActualDetailsPage() {
  return <Suspense fallback={<main className="modulePage"><div className="moduleShell"><div className="moduleLoading">Loading...</div></div></main>}><KpiDetailsContent /></Suspense>;
}
