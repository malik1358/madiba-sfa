"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";
import MorningAttendanceGate from "../../components/MorningAttendanceGate";
import MostVisitedPages from "../../components/MostVisitedPages";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";
import { usePopupMessages } from "../../hooks/usePopupMessages";
import { translate, useAppLanguage } from "../../lib/appLanguage";
import { fetchJsonWithTimeout, resolveAuthSession, startReportSafetyTimer } from "../../lib/authSession";
import { currentMonthDateRange } from "../../lib/salesInvoices";
import { getSupabaseClient } from "../../lib/supabase";
import { getKsaDateString } from "../../lib/workdayActivity";

const TEXT = {
  title: { en: "My Sales Invoices", ar: "فواتير المبيعات" },
  subtitle: {
    en: "Your sales invoices by customer, with line items for each voucher",
    ar: "فواتير مبيعاتك حسب العميل، مع أصناف كل سند",
  },
  dashboard: { en: "← Dashboard", ar: "← الرئيسية" },
  loading: { en: "Loading sales invoices...", ar: "جاري تحميل فواتير المبيعات..." },
  fromDate: { en: "From", ar: "من" },
  toDate: { en: "To", ar: "إلى" },
  salesman: { en: "Salesman", ar: "المندوب" },
  allSalesmen: { en: "All salesmen", ar: "كل المندوبين" },
  refresh: { en: "Refresh", ar: "تحديث" },
  searchCustomer: { en: "Search customer or voucher", ar: "ابحث بالعميل أو رقم السند" },
  invoices: { en: "Invoices", ar: "الفواتير" },
  totalSales: { en: "Total sales", ar: "إجمالي المبيعات" },
  customers: { en: "Customers", ar: "العملاء" },
  date: { en: "Date", ar: "التاريخ" },
  voucher: { en: "Invoice", ar: "الفاتورة" },
  customer: { en: "Customer", ar: "العميل" },
  amount: { en: "Amount", ar: "المبلغ" },
  items: { en: "Items", ar: "الأصناف" },
  actions: { en: "Actions", ar: "الإجراءات" },
  open: { en: "Open items", ar: "عرض الأصناف" },
  close: { en: "Close", ar: "إغلاق" },
  itemCode: { en: "Item code", ar: "رمز الصنف" },
  itemName: { en: "Item", ar: "الصنف" },
  category: { en: "Category", ar: "التصنيف" },
  qty: { en: "Qty", ar: "الكمية" },
  rate: { en: "Rate", ar: "السعر" },
  noInvoices: { en: "No sales invoices found for this date range.", ar: "لا توجد فواتير مبيعات في هذا النطاق." },
  customerDetails: { en: "Customer Details", ar: "تفاصيل العميل" },
};

function formatAmount(value) {
  return Number(value || 0).toLocaleString("en-SA", { maximumFractionDigits: 2 });
}

function formatDate(value) {
  const input = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    const [year, month, day] = input.split("-");
    return `${day}/${month}/${year}`;
  }
  return input || "-";
}

function monthDefaults() {
  return currentMonthDateRange(getKsaDateString());
}

export default function MySalesInvoicesPage() {
  const { language, dir, setLanguage } = useAppLanguage();
  const t = translate(language, TEXT);
  const defaults = useMemo(() => monthDefaults(), []);
  const [fromDate, setFromDate] = useState(defaults.from);
  const [toDate, setToDate] = useState(defaults.to);
  const [salesmanCode, setSalesmanCode] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [invoices, setInvoices] = useState([]);
  const [summary, setSummary] = useState({ invoiceCount: 0, totalAmount: 0, customerCount: 0 });
  const [salesmen, setSalesmen] = useState([]);
  const [activeInvoiceKey, setActiveInvoiceKey] = useState("");
  const [reloadToken, setReloadToken] = useState(0);

  usePopupMessages({ error });

  useEffect(() => {
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

        const params = new URLSearchParams({ from: fromDate, to: toDate });
        if (salesmanCode) params.set("salesmanCode", salesmanCode);

        const { response, payload } = await fetchJsonWithTimeout(
          `/api/sales-invoices?${params.toString()}`,
          {
            headers: {
              Authorization: `Bearer ${session.access_token}`,
            },
          },
          45000,
        );

        if (cancelled) return;
        if (!response.ok || !payload.success) {
          throw new Error(payload.error || "Unable to load sales invoices.");
        }

        setInvoices(payload.invoices || []);
        setSummary(payload.summary || { invoiceCount: 0, totalAmount: 0, customerCount: 0 });
        setSalesmen(payload.salesmen || []);
        setActiveInvoiceKey("");
      } catch (err) {
        if (cancelled) return;
        const message = String(err.message || "");
        if (message === "SESSION_TIMEOUT") {
          setError("Session check timed out. Please refresh the page or login again.");
        } else {
          setError(err.message || "Unable to load sales invoices.");
        }
        setInvoices([]);
        setSummary({ invoiceCount: 0, totalAmount: 0, customerCount: 0 });
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
  }, [fromDate, toDate, salesmanCode, reloadToken]);

  const visibleInvoices = useMemo(() => {
    const query = String(search || "").trim().toLowerCase();
    if (!query) return invoices;
    return invoices.filter((invoice) => [
      invoice.customer_name,
      invoice.customer_code,
      invoice.voucher_number,
    ].some((value) => String(value || "").toLowerCase().includes(query)));
  }, [invoices, search]);

  const supabaseClient = getSupabaseClient();
  if (!supabaseClient) {
    return (
      <SupabaseUnavailable
        title="Sales invoices unavailable"
        message="Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to view sales invoices."
      />
    );
  }

  return (
    <MorningAttendanceGate>
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
              <Link href="/" className="moduleBackLink">{t("dashboard")}</Link>
            </div>
          </div>

          {error && error.includes("login") ? (
            <div className="moduleActionRow" style={{ marginBottom: "12px" }}>
              <Link href="/" className="moduleInlineButton">Go to login</Link>
            </div>
          ) : null}

          <section className="moduleSection">
            <div className="moduleCollectorFilterGrid">
              <label className="moduleField">
                {t("fromDate")}
                <input
                  className="moduleInput"
                  type="date"
                  value={fromDate}
                  onChange={(event) => {
                    if (event.target.value) setFromDate(event.target.value);
                  }}
                />
              </label>
              <label className="moduleField">
                {t("toDate")}
                <input
                  className="moduleInput"
                  type="date"
                  value={toDate}
                  onChange={(event) => {
                    if (event.target.value) setToDate(event.target.value);
                  }}
                />
              </label>
              {salesmen.length > 1 ? (
                <label className="moduleField">
                  {t("salesman")}
                  <select
                    className="moduleInput"
                    value={salesmanCode}
                    onChange={(event) => setSalesmanCode(event.target.value)}
                  >
                    <option value="">{t("allSalesmen")}</option>
                    {salesmen.map((salesman) => (
                      <option key={salesman.salesman_code} value={salesman.salesman_code}>
                        {salesman.salesman_name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <button
                type="button"
                className="moduleInlineButton"
                onClick={() => setReloadToken((current) => current + 1)}
              >
                {t("refresh")}
              </button>
            </div>

            <div className="moduleMetricGrid" style={{ marginTop: "14px" }}>
              <div className="moduleMetricCard">
                <span>{t("invoices")}</span>
                <strong>{summary.invoiceCount}</strong>
              </div>
              <div className="moduleMetricCard">
                <span>{t("totalSales")}</span>
                <strong>{formatAmount(summary.totalAmount)}</strong>
              </div>
              <div className="moduleMetricCard">
                <span>{t("customers")}</span>
                <strong>{summary.customerCount}</strong>
              </div>
            </div>

            <input
              className="moduleInput"
              style={{ marginTop: "12px" }}
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("searchCustomer")}
            />
          </section>

          <section className="moduleSection">
            {loading ? (
              <div className="moduleLoading">{t("loading")}</div>
            ) : visibleInvoices.length === 0 ? (
              <div className="moduleHint">{t("noInvoices")}</div>
            ) : (
              <div className="moduleTableWrap">
                <table className="moduleTable">
                  <thead>
                    <tr>
                      <th>{t("date")}</th>
                      <th>{t("voucher")}</th>
                      <th>{t("customer")}</th>
                      {salesmen.length > 1 ? <th>{t("salesman")}</th> : null}
                      <th>{t("amount")}</th>
                      <th>{t("items")}</th>
                      <th>{t("actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleInvoices.map((invoice) => {
                      const isOpen = activeInvoiceKey === invoice.key;
                      const columnCount = salesmen.length > 1 ? 7 : 6;
                      return (
                        <Fragment key={invoice.key}>
                          <tr>
                            <td>{formatDate(invoice.transaction_date)}</td>
                            <td>{invoice.voucher_number || "-"}</td>
                            <td>
                              <div>{invoice.customer_name || invoice.customer_code || "-"}</div>
                              {invoice.customer_name && invoice.customer_code ? (
                                <div className="moduleHint">{invoice.customer_code}</div>
                              ) : null}
                            </td>
                            {salesmen.length > 1 ? (
                              <td>{invoice.salesman_name || invoice.salesman_code || "-"}</td>
                            ) : null}
                            <td>{formatAmount(invoice.total_amount)}</td>
                            <td>{invoice.item_count || invoice.items?.length || 0}</td>
                            <td>
                              <div className="moduleInlineStack moduleActionStack">
                                <button
                                  type="button"
                                  className="moduleInlineButton moduleActionButton"
                                  onClick={() => setActiveInvoiceKey(isOpen ? "" : invoice.key)}
                                >
                                  {isOpen ? t("close") : t("open")}
                                </button>
                                {invoice.customer_code ? (
                                  <Link
                                    href={`/management/customer-audit?customer_code=${encodeURIComponent(invoice.customer_code)}`}
                                    className="moduleInlineButton moduleActionButton"
                                  >
                                    {t("customerDetails")}
                                  </Link>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                          {isOpen ? (
                            <tr className="moduleCollectorDetailRow">
                              <td colSpan={columnCount}>
                                <div className="moduleTableWrap">
                                  <table className="moduleTable">
                                    <thead>
                                      <tr>
                                        <th>{t("itemCode")}</th>
                                        <th>{t("itemName")}</th>
                                        <th>{t("category")}</th>
                                        <th>{t("qty")}</th>
                                        <th>{t("rate")}</th>
                                        <th>{t("amount")}</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {(invoice.items || []).map((item, index) => (
                                        <tr key={item.id || `${invoice.key}-${index}`}>
                                          <td>{item.item_code || "-"}</td>
                                          <td>{item.item_name || "-"}</td>
                                          <td>{item.category || "-"}</td>
                                          <td>{Number(item.quantity || 0).toLocaleString("en-US")}</td>
                                          <td>{formatAmount(item.rate)}</td>
                                          <td>{formatAmount(item.sales_amount)}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </main>
    </MorningAttendanceGate>
  );
}
