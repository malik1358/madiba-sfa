"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";
import MorningAttendanceGate from "../../components/MorningAttendanceGate";
import MostVisitedPages from "../../components/MostVisitedPages";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";
import { translate, useAppLanguage } from "../../lib/appLanguage";
import { normalizeCustomerMasterSearch } from "../../lib/customerMasterQuery.js";
import { resolveAuthSession } from "../../lib/authSession";
import { getSupabaseClient } from "../../lib/supabase";
import { usePopupMessages } from "../../hooks/usePopupMessages";
import { useAppPopup } from "../../components/AppPopupProvider";
import ExportableTable from "../../components/ExportableTable";

const TEXT = {
  title: { en: "Outstanding Without GPS", ar: "مستحقات بدون GPS" },
  subtitle: {
    en: "Customers with an outstanding balance and no saved GPS on the customer master. Zia, Asrar Ahmed, and legal transfers are excluded.",
    ar: "العملاء الذين لديهم رصيد مستحق وبدون موقع GPS في سجل العميل. زيا وأسرار أحمد والمحولون للقانوني مستثنون.",
  },
  back: { en: "← Management", ar: "← الإدارة" },
  loading: { en: "Loading customers...", ar: "جاري تحميل العملاء..." },
  search: { en: "Search code or name", ar: "بحث بالكود أو الاسم" },
  salesman: { en: "Salesman", ar: "المندوب" },
  allSalesmen: { en: "All salesmen", ar: "كل المندوبين" },
  sort: { en: "Sort by", ar: "ترتيب حسب" },
  sortOutstanding: { en: "Outstanding amount", ar: "مبلغ المستحقات" },
  sortInvoice: { en: "Last invoice date", ar: "تاريخ آخر فاتورة" },
  sortVisit: { en: "Last visit date", ar: "تاريخ آخر زيارة" },
  sortName: { en: "Customer name", ar: "اسم العميل" },
  refresh: { en: "Refresh", ar: "تحديث" },
  exportExcel: { en: "Export Excel", ar: "تصدير Excel" },
  exporting: { en: "Exporting...", ar: "جاري التصدير..." },
  code: { en: "Code", ar: "الكود" },
  customer: { en: "Customer", ar: "العميل" },
  lastInvoice: { en: "Last invoice", ar: "آخر فاتورة" },
  lastVisit: { en: "Last visit", ar: "آخر زيارة" },
  outstanding: { en: "Outstanding", ar: "المستحقات" },
  cityArea: { en: "City / Area", ar: "المدينة / المنطقة" },
  actions: { en: "Actions", ar: "الإجراءات" },
  saveGps: { en: "Save GPS", ar: "حفظ GPS" },
  noRows: { en: "No outstanding customers without GPS.", ar: "لا يوجد عملاء بمستحقات وبدون GPS." },
  accessDenied: { en: "Only admin or manager can access this report.", ar: "فقط المدير أو الأدمن يمكنه الوصول لهذا التقرير." },
  page: { en: "Page", ar: "صفحة" },
  of: { en: "of", ar: "من" },
  prev: { en: "Previous", ar: "السابق" },
  next: { en: "Next", ar: "التالي" },
  showing: { en: "Showing", ar: "عرض" },
  totalOutstanding: { en: "Total outstanding", ar: "إجمالي المستحقات" },
  hint: {
    en: "Last visit does not copy GPS onto the customer. A visit or collection can be saved (sometimes without location if GPS was blocked or the role does not require it) while the customer master still has no coordinates. Save GPS here from Customer Master.",
    ar: "آخر زيارة لا تنسخ GPS إلى سجل العميل. يمكن حفظ زيارة أو تحصيل (وأحياناً بدون موقع إذا مُنع GPS أو الدور لا يطلبه) بينما يبقى سجل العميل بدون إحداثيات. احفظ GPS من سجل العملاء.",
  },
};

function formatOutstanding(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "0";
  return number.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function formatDateOnly(value) {
  const input = String(value || "").trim();
  if (!input) return "-";
  if (/^\d{4}-\d{2}-\d{2}/.test(input)) {
    const [year, month, day] = input.slice(0, 10).split("-");
    return `${day}/${month}/${year}`;
  }
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("en-GB");
}

export default function OutstandingNoGpsPage() {
  const { language, dir, setLanguage } = useAppLanguage();
  const t = translate(language, TEXT);
  const { showPopup } = useAppPopup();
  const supabaseClient = getSupabaseClient();

  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [accessDenied, setAccessDenied] = useState(false);
  const [customers, setCustomers] = useState([]);
  const [salesmen, setSalesmen] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 1 });
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [salesmanFilter, setSalesmanFilter] = useState("");
  const [sort, setSort] = useState("outstanding");

  usePopupMessages({ error });

  useEffect(() => {
    if (!accessDenied) return;
    showPopup({ message: t("accessDenied"), variant: "error" });
  }, [accessDenied, showPopup, t]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(normalizeCustomerMasterSearch(search));
    }, 400);
    return () => window.clearTimeout(timer);
  }, [search]);

  const loadCustomers = useCallback(async (page = 1) => {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const session = await resolveAuthSession(supabase, 8000);
      if (!session?.access_token) throw new Error("Please login again.");

      const params = new URLSearchParams({
        page: String(page),
        limit: "50",
        sort,
      });
      if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
      if (salesmanFilter) params.set("salesman", salesmanFilter);

      const response = await fetch(`/api/admin/outstanding-no-gps?${params.toString()}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const payload = await response.json().catch(() => ({}));

      if (response.status === 403) {
        setAccessDenied(true);
        setCustomers([]);
        return;
      }

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Unable to load customers.");
      }

      setCustomers(Array.isArray(payload.customers) ? payload.customers : []);
      setSalesmen(Array.isArray(payload.salesmen) ? payload.salesmen : []);
      setPagination(payload.pagination || { page: 1, limit: 50, total: 0, totalPages: 1 });
    } catch (err) {
      setError(err.message || "Unable to load customers.");
      setCustomers([]);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, salesmanFilter, sort]);

  useEffect(() => {
    loadCustomers(1);
  }, [loadCustomers]);

  const pageTotalOutstanding = useMemo(
    () => customers.reduce((sum, row) => sum + Number(row.total_outstanding || 0), 0),
    [customers],
  );

  async function exportExcel() {
    const supabase = getSupabaseClient();
    if (!supabase) return;

    setExporting(true);
    setError("");

    try {
      const session = await resolveAuthSession(supabase, 8000);
      if (!session?.access_token) throw new Error("Please login again.");

      const params = new URLSearchParams({ format: "xlsx", sort });
      if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
      if (salesmanFilter) params.set("salesman", salesmanFilter);

      const response = await fetch(`/api/admin/outstanding-no-gps?${params.toString()}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (response.status === 403) {
        setAccessDenied(true);
        return;
      }

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Unable to export Excel.");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "outstanding-no-gps.xlsx";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message || "Unable to export Excel.");
    } finally {
      setExporting(false);
    }
  }

  if (!supabaseClient) {
    return (
      <SupabaseUnavailable
        title="Outstanding without GPS unavailable"
        message="Supabase credentials are required for this report."
      />
    );
  }

  if (accessDenied) {
    return (
      <main className="modulePage" dir={dir}>
        <div className="moduleShell" />
      </main>
    );
  }

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
              <MostVisitedPages />
              <Link href="/management" className="moduleBackLink">{t("back")}</Link>
            </div>
          </div>

          <section className="moduleSection">
            <div className="moduleSectionHeader">
              <h2>{t("title")}</h2>
              <span>{pagination.total || 0}</span>
            </div>

            <div className="moduleHint" style={{ marginBottom: "12px" }}>{t("hint")}</div>

            <div className="moduleFilterRow" style={{ marginBottom: "12px" }}>
              <input
                className="moduleInput"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("search")}
              />
              <select
                className="moduleInput"
                value={salesmanFilter}
                onChange={(event) => setSalesmanFilter(event.target.value)}
                aria-label={t("salesman")}
              >
                <option value="">{t("allSalesmen")}</option>
                {salesmen.map((row) => (
                  <option key={row.salesman_code || row.salesman_display} value={row.salesman_code || row.salesman_name}>
                    {row.salesman_display}
                  </option>
                ))}
              </select>
              <select
                className="moduleInput"
                value={sort}
                onChange={(event) => setSort(event.target.value)}
                aria-label={t("sort")}
              >
                <option value="outstanding">{t("sortOutstanding")}</option>
                <option value="invoice">{t("sortInvoice")}</option>
                <option value="visit">{t("sortVisit")}</option>
                <option value="name">{t("sortName")}</option>
              </select>
              <button type="button" className="moduleInlineButton" onClick={() => loadCustomers(pagination.page || 1)}>
                {t("refresh")}
              </button>
              <button type="button" className="moduleInlineButton" onClick={exportExcel} disabled={exporting}>
                {exporting ? t("exporting") : t("exportExcel")}
              </button>
            </div>

            {loading ? (
              <div className="moduleLoading">{t("loading")}</div>
            ) : customers.length === 0 ? (
              <div className="moduleHint">{t("noRows")}</div>
            ) : (
              <>
                <div className="moduleHint" style={{ marginBottom: "8px" }}>
                  {t("showing")} {customers.length} · {t("totalOutstanding")}: {formatOutstanding(pageTotalOutstanding)}
                </div>
                <ExportableTable filename="outstanding-no-gps" sheetName="Outstanding No GPS" className="moduleTableWrap moduleCustomerMasterTableWrap">
                  <table className="moduleTable moduleCustomerMasterTable">
                    <thead>
                      <tr>
                        <th className="moduleCustomerMasterSticky moduleCustomerMasterCode">{t("code")}</th>
                        <th className="moduleCustomerMasterSticky moduleCustomerMasterName">{t("customer")}</th>
                        <th>{t("salesman")}</th>
                        <th>{t("outstanding")}</th>
                        <th>{t("lastInvoice")}</th>
                        <th>{t("lastVisit")}</th>
                        <th>{t("cityArea")}</th>
                        <th>{t("actions")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customers.map((row) => (
                        <tr key={row.customer_code || row.customer_name} className="moduleCustomerMasterRow">
                          <td data-label={t("code")} className="moduleCustomerMasterSticky moduleCustomerMasterCode">
                            {row.customer_code || "-"}
                          </td>
                          <td data-label={t("customer")} className="moduleCustomerMasterSticky moduleCustomerMasterName">
                            {row.customer_name || "-"}
                          </td>
                          <td data-label={t("salesman")}>{row.salesman_display || row.current_salesman_code || "-"}</td>
                          <td data-label={t("outstanding")}>{formatOutstanding(row.total_outstanding)}</td>
                          <td data-label={t("lastInvoice")}>{formatDateOnly(row.last_invoice_date)}</td>
                          <td data-label={t("lastVisit")}>{formatDateOnly(row.last_visit_date)}</td>
                          <td data-label={t("cityArea")}>{`${row.city || "-"} / ${row.area || "-"}`}</td>
                          <td data-label={t("actions")}>
                            <Link
                              href={`/management/customer-master?search=${encodeURIComponent(row.customer_code || "")}`}
                              className="moduleInlineButton"
                            >
                              {t("saveGps")}
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ExportableTable>

                <div className="moduleFilterRow" style={{ marginTop: "12px" }}>
                  <button
                    type="button"
                    className="moduleInlineButton"
                    disabled={pagination.page <= 1}
                    onClick={() => loadCustomers(pagination.page - 1)}
                  >
                    {t("prev")}
                  </button>
                  <span>
                    {t("page")} {pagination.page} {t("of")} {pagination.totalPages}
                  </span>
                  <button
                    type="button"
                    className="moduleInlineButton"
                    disabled={pagination.page >= pagination.totalPages}
                    onClick={() => loadCustomers(pagination.page + 1)}
                  >
                    {t("next")}
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      </main>
    </MorningAttendanceGate>
  );
}
