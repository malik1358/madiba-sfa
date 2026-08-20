"use client";

const PRICE_CACHE_API = "/api/pricing/cache";

const PAGE_VERSION = "Quick Order V5";
const TEXT = {
  title: { en: "Customer Details", ar: "تفاصيل العميل" },
  subtitle: { en: "Management sales history validation", ar: "مراجعة سجل مبيعات العملاء" },
  home: { en: "← Home", ar: "← الرئيسية" },
  customers: { en: "← Customers", ar: "← العملاء" },
  loadingCustomer: { en: "Loading customer history...", ar: "جاري تحميل سجل العميل..." },
  cacheRefreshing: { en: "Showing saved data. Refreshing in background...", ar: "عرض البيانات المحفوظة. جاري التحديث في الخلفية..." },
};

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";
import MostVisitedPages from "../../components/MostVisitedPages";
import MorningAttendanceGate from "../../components/MorningAttendanceGate";
import { translate, useAppLanguage } from "../../lib/appLanguage";
import { getSupabaseClient } from "../../lib/supabase";
import { PRICE_CACHE_KEY } from "../../lib/priceApiConfig";
import { loadPricePayload } from "../../lib/pricePayload";
import { resolveOverdueDaysFromDueDate, sortBucketLabels, toNumber as parseOutstandingNumber, visibleOutstandingBucketLabels } from "../../lib/outstanding";
import { fetchOutstandingCached } from "../../lib/mobileDataCache";

import { shortDate } from "./lib/format";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";

import CustomerList from "./components/CustomerList";
import CustomerHeader from "./components/CustomerHeader";
import MonthlyPerformance from "./components/MonthlyPerformance";
import CategoryPerformance from "./components/CategoryPerformance";
import QuickOrder from "./components/QuickOrder";
import FullItemList from "./components/FullItemList";
import OrderBar from "./components/OrderBar";
import OrderReview from "./components/OrderReview";
import TransactionHistory from "./components/TransactionHistory";
import LoadingScreen from "./components/LoadingScreen";
import EmptyState from "./components/EmptyState";
import { useCustomerData } from "./hooks/useCustomerData";
import { useAnalytics } from "./hooks/useAnalytics";
import { useQuickOrder } from "./hooks/useQuickOrder";
import { useOrder } from "./hooks/useOrder";

function formatAmount(value) {
  return Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function formatCount(value) {
  return Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}


function CustomerAuditPageContent() {
  const { language, dir, setLanguage } = useAppLanguage();
  const t = translate(language, TEXT);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [priceList, setPriceList] = useState({});
  const [priceSheetItems, setPriceSheetItems] = useState([]);
  const [requestedCustomerCode, setRequestedCustomerCode] = useState("");
  const [outstandingLoading, setOutstandingLoading] = useState(false);
  const [outstandingInfo, setOutstandingInfo] = useState({
    uploadedAt: "",
    fileName: "",
    bucketLabels: [],
    customer: null,
    customerInvoices: [],
    needsInvoiceRowsReupload: false,
  });

  const {
    customers,
    salesmen,
    selectedSalesman,
    setSelectedSalesman,
    search,
    setSearch,
    selectedCustomer,
    transactions,
    peerTransactions,
    itemMaster,
    itemMasterStatus,
    loading,
    loadingCustomer,
    refreshing,
    expandedCategories,
    toggleCategory,
    openCustomer,
    closeCustomer,
    accessScope,
  } = useCustomerData({ setError, setMessage });

  const analytics = useAnalytics(transactions);
  const quickOrderSuggestions = useQuickOrder({ analytics, transactions, peerTransactions, itemMaster });
  const {
    orderItems,
    orderSummary,
    orderQuantities,
    setOrderQuantities,
    savingOrder,
    submittingOrder,
    showOrderReview,
    setShowOrderReview,
    updateQty,
    increaseQty,
    decreaseQty,
    saveDraft,
    submitOrder,
    draftOrderId,
  } = useOrder({
    analytics,
    quickOrderAllItems: [
      ...quickOrderSuggestions.newItems,
      ...quickOrderSuggestions.notBoughtRecently,
      ...quickOrderSuggestions.buyingLess,
    ],
    catalogItems: itemMaster,
    selectedCustomer,
    priceList,
    setError,
    setMessage,
    accessScope,
  });

  useEffect(() => {
    async function loadOutstanding() {
      if (!selectedCustomer) {
        setOutstandingInfo({ uploadedAt: "", fileName: "", bucketLabels: [], customer: null, customerInvoices: [], needsInvoiceRowsReupload: false });
        return;
      }

      const supabase = getSupabaseClient();
      if (!supabase) return;

      setOutstandingLoading(true);
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session?.access_token) throw new Error("Please login again.");

        const outstandingResult = await fetchOutstandingCached(
          session.access_token,
          selectedCustomer.customer_code,
          selectedCustomer.customer_name,
          {
            onUpdate: (fresh) => {
              setOutstandingInfo({
                uploadedAt: String(fresh.uploadedAt || ""),
                fileName: String(fresh.fileName || ""),
                bucketLabels: sortBucketLabels(fresh.bucketLabels || []),
                customer: fresh.customer || null,
                customerInvoices: Array.isArray(fresh.customerInvoices) ? fresh.customerInvoices : [],
                needsInvoiceRowsReupload: Boolean(fresh.needsInvoiceRowsReupload),
              });
            },
          },
        );

        const payload = outstandingResult.data;
        setOutstandingInfo({
          uploadedAt: String(payload.uploadedAt || ""),
          fileName: String(payload.fileName || ""),
          bucketLabels: sortBucketLabels(payload.bucketLabels || []),
          customer: payload.customer || null,
          customerInvoices: Array.isArray(payload.customerInvoices) ? payload.customerInvoices : [],
          needsInvoiceRowsReupload: Boolean(payload.needsInvoiceRowsReupload),
        });
      } catch (err) {
        setOutstandingInfo({ uploadedAt: "", fileName: "", bucketLabels: [], customer: null, customerInvoices: [], needsInvoiceRowsReupload: false });
        setError(err.message || "Unable to load outstanding data.");
      } finally {
        setOutstandingLoading(false);
      }
    }

    loadOutstanding();
  }, [selectedCustomer, setError]);

  const visibleOutstandingBuckets = useMemo(
    () => visibleOutstandingBucketLabels(
      outstandingInfo.bucketLabels,
      outstandingInfo.customer?.buckets
    ),
    [outstandingInfo.bucketLabels, outstandingInfo.customer]
  );

  useEffect(() => {
    async function loadPrices() {
      try {
        const parsed = await loadPricePayload(PRICE_CACHE_API, PRICE_CACHE_KEY);
        setPriceList(parsed.priceMap || {});
        setPriceSheetItems(parsed.sheetItems || []);
      } catch {
        // Keep previous prices if fresh fetch fails.
      }
    }

    loadPrices();
  }, []);

  const filteredCustomers = useMemo(() => {
    const q = search.trim().toLowerCase();

    return customers.filter((customer) => {
      const salesmanOK = selectedSalesman === "ALL" || customer.current_salesman_code === selectedSalesman;
      if (!salesmanOK) return false;
      if (!q) return true;

      return (
        String(customer.customer_code || "").toLowerCase().includes(q) ||
        String(customer.customer_name || "").toLowerCase().includes(q)
      );
    });
  }, [customers, selectedSalesman, search]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    setRequestedCustomerCode(String(params.get("customer_code") || "").trim().toUpperCase());
  }, []);

  function handleOpenCustomer(customer) {
    setOrderQuantities({});
    setShowOrderReview(false);
    openCustomer(customer);
  }

  function handleCloseCustomer() {
    closeCustomer();
    setOrderQuantities({});
    setShowOrderReview(false);
    setMessage("");
    setError("");
  }

  useEffect(() => {
    if (!requestedCustomerCode || loading || selectedCustomer) return;
    if (!customers.length) return;

    const target = customers.find(
      (customer) => String(customer.customer_code || "").trim().toUpperCase() === requestedCustomerCode
    );

    if (target) {
      handleOpenCustomer(target);
    }
  }, [requestedCustomerCode, loading, selectedCustomer, customers, handleOpenCustomer]);

  const supabaseClient = getSupabaseClient();
  if (!supabaseClient) {
    return (
      <SupabaseUnavailable
        title="Customer details unavailable"
        message="The customer details screen needs Supabase credentials to load customer and sales data."
      />
    );
  }

  if (loading) {
    return <LoadingScreen title={t("title")} subtitle="Loading customer data..." />;
  }

  if (!selectedCustomer) {
    return (
      <main className="auditPage" dir={dir}>
        <div className="auditShell">
          <div className="auditTop">
            <div>
              <div className="auditBrand">MADIBA SFA</div>
              <h1>{t("title")}</h1>
              <p className="auditSubtitle">{t("subtitle")}</p>
            </div>
            <div className="moduleHeaderMeta"><AppLanguageSwitch language={language} setLanguage={setLanguage} /><MostVisitedPages /><a href="/management" className="auditHomeButton">{t("home")}</a></div>
          </div>

          {error && <div className="auditError">{error}</div>}
          {error && error.toLowerCase().includes("login") ? (
            <div style={{ marginTop: "8px" }}>
              <Link href="/" className="moduleInlineButton">Go to login</Link>
            </div>
          ) : null}
          {refreshing && <div className="moduleHint">{t("cacheRefreshing")}</div>}

          <CustomerList
            customers={filteredCustomers}
            selectedSalesman={selectedSalesman}
            setSelectedSalesman={setSelectedSalesman}
            search={search}
            setSearch={setSearch}
            salesmen={salesmen}
            openCustomer={handleOpenCustomer}
          />

          <div className="auditVersion">Page updated: {PAGE_VERSION}</div>
        </div>
      </main>
    );
  }

  if (loadingCustomer) {
    return (
      <main className="auditPage" dir={dir}>
        <div className="auditShell">
          <div className="auditTop">
            <div>
              <div className="auditBrand">MADIBA SFA</div>
              <h1>{t("title")}</h1>
              <p className="auditSubtitle">{t("loadingCustomer")}</p>
            </div>
            <div className="moduleHeaderMeta"><AppLanguageSwitch language={language} setLanguage={setLanguage} /><MostVisitedPages /><a href="/management" className="auditHomeButton">{t("home")}</a></div>
          </div>
          <button type="button" className="auditBackButton" onClick={handleCloseCustomer}>{t("customers")}</button>
        </div>
      </main>
    );
  }

  if (!analytics) {
    return (
      <main className="auditPage" dir={dir}>
        <div className="auditShell">
          <div className="auditTop">
            <div>
              <div className="auditBrand">MADIBA SFA</div>
              <h1>{t("title")}</h1>
              <p className="auditSubtitle">{t("subtitle")}</p>
            </div>
            <div className="moduleHeaderMeta"><AppLanguageSwitch language={language} setLanguage={setLanguage} /><MostVisitedPages /><a href="/management" className="auditHomeButton">{t("home")}</a></div>
          </div>
          <button type="button" className="auditBackButton" onClick={handleCloseCustomer}>{t("customers")}</button>
          {error && <div className="auditError">{error}</div>}
          <EmptyState title="No sales history" message={`No sales history was found for ${selectedCustomer.customer_name}.`} />
          <div className="auditVersion">Page updated: {PAGE_VERSION}</div>
        </div>
      </main>
    );
  }

  return (
    <MorningAttendanceGate>
    <main className="auditPage" dir={dir}>
      <div className="auditShell">
        <div className="auditTop">
          <div>
            <div className="auditBrand">MADIBA SFA</div>
            <h1>{t("title")}</h1>
            <p className="auditSubtitle">{t("subtitle")}</p>
          </div>
          <div className="moduleHeaderMeta"><AppLanguageSwitch language={language} setLanguage={setLanguage} /><MostVisitedPages /><a href="/management" className="auditHomeButton">{t("home")}</a></div>
        </div>

        <button type="button" className="auditBackButton" onClick={handleCloseCustomer}>{t("customers")}</button>

        {message && <div className="auditSuccess">{message}</div>}
        {error && <div className="auditError">{error}</div>}

        <CustomerHeader customer={selectedCustomer} analytics={analytics} />

        <section className="auditSection">
          <div className="auditTransactionHeader">
            <div>
              <h3>Outstanding Customerwise</h3>
              <p className="auditSectionNote">
                {outstandingInfo.uploadedAt
                  ? `Latest upload: ${new Date(outstandingInfo.uploadedAt).toLocaleString("en-GB")}`
                  : "No outstanding upload yet"}
              </p>
            </div>
          </div>

          {outstandingLoading && <div className="auditEmpty">Loading outstanding buckets...</div>}

          {!outstandingLoading && outstandingInfo.customer && (
            <>
              <div className="moduleTableWrap" style={{ marginTop: "10px" }}>
                <table className="moduleTable">
                  <thead>
                    <tr>
                      <th>Customer</th>
                      {visibleOutstandingBuckets.map((label) => (
                        <th key={`audit-out-bucket-${label}`}>{label} days</th>
                      ))}
                      <th>Open Invoices</th>
                      <th>Total Outstanding</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>{selectedCustomer.customer_code} - {selectedCustomer.customer_name}</td>
                      {visibleOutstandingBuckets.map((label) => (
                        <td key={`audit-out-val-${label}`}>{formatAmount(parseOutstandingNumber(outstandingInfo.customer?.buckets?.[label]))}</td>
                      ))}
                      <td>{formatCount(parseOutstandingNumber(outstandingInfo.customer?.open_invoices))}</td>
                      <td>{formatAmount(parseOutstandingNumber(outstandingInfo.customer?.total_outstanding))}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="moduleTableWrap" style={{ marginTop: "10px" }}>
                <table className="moduleTable">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Ref. No.</th>
                      <th>Pending Amount</th>
                      <th>Due Date</th>
                      <th>Overdue Days</th>
                      <th>Invoice Day</th>
                      <th>Salesman</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(outstandingInfo.customerInvoices || []).map((invoice, index) => (
                      <tr key={`${invoice.ref_no || "no-ref"}-${invoice.due_date || "no-due"}-${index}`}>
                        <td>{invoice.invoice_date || "-"}</td>
                        <td>{invoice.ref_no || "-"}</td>
                        <td>{formatAmount(parseOutstandingNumber(invoice.pending_amount))}</td>
                        <td>{invoice.due_date || "-"}</td>
                        <td>{formatCount(resolveOverdueDaysFromDueDate(invoice))}</td>
                        <td>{formatCount(parseOutstandingNumber(invoice.invoice_day))}</td>
                        <td>{invoice.salesman || "-"}</td>
                      </tr>
                    ))}
                    {(!Array.isArray(outstandingInfo.customerInvoices) || outstandingInfo.customerInvoices.length === 0) && (
                      <tr>
                        <td colSpan={7}>
                          {outstandingInfo.needsInvoiceRowsReupload
                            ? "Invoice-level rows are missing in current dataset. Re-upload the outstanding file once to include Ref No and invoice row details."
                            : "No invoice-level rows found for this customer in the latest upload."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {!outstandingLoading && !outstandingInfo.customer && (
            <div className="auditEmpty">No outstanding row found for this customer in latest upload.</div>
          )}
        </section>

        <section className="auditSection">
          <div className="auditTransactionHeader">
            <div>
              <h3>Price Status</h3>
              <p className="auditSectionNote">Current price load for the order workflow.</p>
            </div>
            <button type="button" className="auditTransactionToggle" onClick={() => window.print()}>Print / Save PDF</button>
          </div>
          <div className="auditEmpty" style={{ marginTop: "8px" }}>
            Loaded {Object.keys(priceList).length} prices • Item master {itemMasterStatus}
          </div>
        </section>

        <MonthlyPerformance analytics={analytics} />

        <CategoryPerformance
          analytics={analytics}
          itemCatalog={itemMaster}
          expandedCategories={expandedCategories}
          toggleCategory={toggleCategory}
          orderQuantities={orderQuantities}
          decreaseOrderQty={decreaseQty}
          increaseOrderQty={increaseQty}
          changeOrderQty={updateQty}
          priceList={priceList}
        />

        <QuickOrder
          quickOrderSuggestions={quickOrderSuggestions}
          orderQuantities={orderQuantities}
          decreaseOrderQty={decreaseQty}
          increaseOrderQty={increaseQty}
          changeOrderQty={updateQty}
          priceList={priceList}
        />

        <FullItemList
          itemCatalog={itemMaster}
          priceSheetItems={priceSheetItems}
          orderQuantities={orderQuantities}
          decreaseOrderQty={decreaseQty}
          increaseOrderQty={increaseQty}
          changeOrderQty={updateQty}
          priceList={priceList}
        />

        <OrderBar
          orderItems={orderItems}
          orderSummary={orderSummary}
          savingOrder={savingOrder}
          submittingOrder={submittingOrder}
          saveDraft={saveDraft}
          setShowOrderReview={setShowOrderReview}
          priceList={priceList}
          draftOrderId={draftOrderId}
        />

        <OrderReview
          showOrderReview={showOrderReview}
          orderItems={orderItems}
          orderSummary={orderSummary}
          priceList={priceList}
          savingOrder={savingOrder}
          submittingOrder={submittingOrder}
          saveDraft={saveDraft}
          submitOrder={submitOrder}
          setShowOrderReview={setShowOrderReview}
          draftOrderId={draftOrderId}
          decreaseOrderQty={decreaseQty}
          increaseOrderQty={increaseQty}
          changeOrderQty={updateQty}
        />

        {draftOrderId && (
          <div className="auditDraftNotice">
            <span>Draft Order</span>
            <small>Changes are not final until the order is submitted.</small>
          </div>
        )}

        <TransactionHistory
          transactions={transactions}
          analytics={analytics}
        />

        <div className="auditVersion">Page updated: {PAGE_VERSION}</div>
        <div className="auditPageFooter">
          <span>
            Latest sales data: <strong>{shortDate(analytics.latestDate)}</strong>
          </span>
          <span>
            Customer: <strong>{selectedCustomer.customer_code}</strong>
          </span>
        </div>
      </div>
    </main>
    </MorningAttendanceGate>
  );
}

export default function CustomerAuditPage() {
  return (
    <Suspense fallback={<LoadingScreen title="Customer Details" subtitle="Loading customer data..." />}>
      <CustomerAuditPageContent />
    </Suspense>
  );
}
