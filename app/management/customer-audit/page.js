"use client";

const PRICE_API =
  "https://script.google.com/macros/s/AKfycbzXPREoz0tUgern-5LhpEPBMY_ed2hO1fgYpIVfzG2-BU9HbjOklKCBFVMtsw64Uff5/exec";

const PAGE_VERSION = "Quick Order V5";
const CUSTOMER_DOCUMENT_TYPES = ["CR", "VAT", "ID", "CREDIT_APPLICATION", "OTHER"];

import { useEffect, useMemo, useState } from "react";
import { getSupabaseClient } from "../../lib/supabase";

import { shortDate } from "./lib/format";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";

import CustomerList from "./components/CustomerList";
import CustomerHeader from "./components/CustomerHeader";
import MonthlyPerformance from "./components/MonthlyPerformance";
import CategoryPerformance from "./components/CategoryPerformance";
import QuickOrder from "./components/QuickOrder";
import OrderBar from "./components/OrderBar";
import OrderReview from "./components/OrderReview";
import TransactionHistory from "./components/TransactionHistory";
import LoadingScreen from "./components/LoadingScreen";
import EmptyState from "./components/EmptyState";
import { useCustomerData } from "./hooks/useCustomerData";
import { useAnalytics } from "./hooks/useAnalytics";
import { useQuickOrder } from "./hooks/useQuickOrder";
import { useOrder } from "./hooks/useOrder";


export default function CustomerAuditPage() {
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [priceList, setPriceList] = useState({});
  const [customerMeta, setCustomerMeta] = useState({ nationalAddress: "", documents: [] });
  const [customerMetaLoading, setCustomerMetaLoading] = useState(false);
  const [customerMetaSaving, setCustomerMetaSaving] = useState(false);
  const [customerDocType, setCustomerDocType] = useState("CR");

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
    showTransactions,
    setShowTransactions,
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
    selectedCustomer,
    priceList,
    setError,
    setMessage,
    accessScope,
  });

  useEffect(() => {
    async function loadPrices() {
      try {
        const response = await fetch(PRICE_API);
        const prices = await response.json();
        setPriceList(prices);
      } catch {
        // Ignore price lookup failures so the audit screen still renders.
      }
    }

    loadPrices();
  }, []);

  useEffect(() => {
    async function loadCustomerMeta() {
      if (!selectedCustomer?.customer_code) {
        setCustomerMeta({ nationalAddress: "", documents: [] });
        return;
      }

      const supabase = getSupabaseClient();
      if (!supabase) return;

      setCustomerMetaLoading(true);

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session?.access_token) {
          throw new Error("Please login again.");
        }

        const response = await fetch(`/api/customer-meta?customerCode=${encodeURIComponent(selectedCustomer.customer_code)}`, {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        });

        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || "Unable to load customer profile.");
        }

        setCustomerMeta({
          nationalAddress: String(data.value?.nationalAddress || ""),
          documents: Array.isArray(data.value?.documents) ? data.value.documents : [],
        });
      } catch (err) {
        setError(err.message || "Unable to load customer profile.");
      } finally {
        setCustomerMetaLoading(false);
      }
    }

    loadCustomerMeta();
  }, [selectedCustomer]);

  function handleExistingCustomerDocumentPick(event) {
    const file = event.target.files?.[0] || null;
    if (!file) return;

    setCustomerMeta((current) => ({
      ...current,
      documents: [
        ...(current.documents || []),
        {
          type: customerDocType,
          name: file.name,
          size: file.size,
          mimeType: file.type,
        },
      ],
    }));

    event.target.value = "";
  }

  async function saveCustomerMeta() {
    if (!selectedCustomer?.customer_code) return;

    const supabase = getSupabaseClient();
    if (!supabase) {
      setError("Supabase is not configured.");
      return;
    }

    setCustomerMetaSaving(true);
    setError("");

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Please login again.");
      }

      const response = await fetch("/api/customer-meta", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          customerCode: selectedCustomer.customer_code,
          nationalAddress: customerMeta.nationalAddress,
          documents: customerMeta.documents,
        }),
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Unable to save customer profile.");
      }

      setMessage(`Customer profile saved for ${selectedCustomer.customer_name}.`);
    } catch (err) {
      setError(err.message || "Unable to save customer profile.");
    } finally {
      setCustomerMetaSaving(false);
    }
  }

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

  const supabaseClient = getSupabaseClient();
  if (!supabaseClient) {
    return (
      <SupabaseUnavailable
        title="Customer audit unavailable"
        message="The customer audit screen needs Supabase credentials to load customer and sales data."
      />
    );
  }

  if (loading) {
    return <LoadingScreen title="Customer Audit" subtitle="Loading customer data..." />;
  }

  if (!selectedCustomer) {
    return (
      <main className="auditPage">
        <div className="auditShell">
          <div className="auditTop">
            <div>
              <div className="auditBrand">MADIBA SFA</div>
              <h1>Customer Audit</h1>
              <p className="auditSubtitle">Management sales history validation</p>
            </div>
            <a href="/management" className="auditHomeButton">← Home</a>
          </div>

          {error && <div className="auditError">{error}</div>}

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
      <main className="auditPage">
        <div className="auditShell">
          <div className="auditTop">
            <div>
              <div className="auditBrand">MADIBA SFA</div>
              <h1>Customer Audit</h1>
              <p className="auditSubtitle">Loading customer history...</p>
            </div>
            <a href="/management" className="auditHomeButton">← Home</a>
          </div>
          <button type="button" className="auditBackButton" onClick={handleCloseCustomer}>← Customers</button>
        </div>
      </main>
    );
  }

  if (!analytics) {
    return (
      <main className="auditPage">
        <div className="auditShell">
          <div className="auditTop">
            <div>
              <div className="auditBrand">MADIBA SFA</div>
              <h1>Customer Audit</h1>
              <p className="auditSubtitle">Management sales history validation</p>
            </div>
            <a href="/management" className="auditHomeButton">← Home</a>
          </div>
          <button type="button" className="auditBackButton" onClick={handleCloseCustomer}>← Customers</button>
          {error && <div className="auditError">{error}</div>}
          <EmptyState title="No sales history" message={`No sales history was found for ${selectedCustomer.customer_name}.`} />
          <div className="auditVersion">Page updated: {PAGE_VERSION}</div>
        </div>
      </main>
    );
  }

  return (
    <main className="auditPage">
      <div className="auditShell">
        <div className="auditTop">
          <div>
            <div className="auditBrand">MADIBA SFA</div>
            <h1>Customer Audit</h1>
            <p className="auditSubtitle">Management sales history validation</p>
          </div>
          <a href="/management" className="auditHomeButton">← Home</a>
        </div>

        <button type="button" className="auditBackButton" onClick={handleCloseCustomer}>← Customers</button>

        {message && <div className="auditSuccess">{message}</div>}
        {error && <div className="auditError">{error}</div>}

        <CustomerHeader customer={selectedCustomer} analytics={analytics} />

        <section className="moduleSection">
          <div className="moduleSectionHeader">
            <h2>Customer Profile</h2>
            <span>{selectedCustomer.customer_code}</span>
          </div>

          {customerMetaLoading ? (
            <div className="moduleLoading">Loading customer profile...</div>
          ) : (
            <div className="moduleFormGrid">
              <label className="moduleFieldFull">
                National Address
                <textarea
                  className="moduleTextArea"
                  rows={3}
                  value={customerMeta.nationalAddress}
                  onChange={(event) => setCustomerMeta((current) => ({ ...current, nationalAddress: event.target.value }))}
                  placeholder="Building, street, district, city, postal code, additional number"
                />
              </label>

              <div className="moduleFieldFull">
                <div className="moduleSectionHeader">
                  <h2>Customer Documents</h2>
                  <span>CR, VAT, ID, Credit Application, and other files</span>
                </div>
                <div className="moduleDocumentRow">
                  <select className="moduleInput" value={customerDocType} onChange={(event) => setCustomerDocType(event.target.value)}>
                    {CUSTOMER_DOCUMENT_TYPES.map((type) => (
                      <option key={type} value={type}>{type}</option>
                    ))}
                  </select>
                  <input className="moduleInput" type="file" onChange={handleExistingCustomerDocumentPick} />
                </div>

                {customerMeta.documents.length > 0 && (
                  <ul className="moduleList">
                    {customerMeta.documents.map((document, index) => (
                      <li key={`${document.type}-${document.name}-${index}`}>
                        <strong>{document.type}</strong>
                        <span>{document.name}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="moduleFieldFull">
                <button type="button" className="modulePrimaryButton" onClick={saveCustomerMeta} disabled={customerMetaSaving}>
                  {customerMetaSaving ? "Saving..." : "Save Customer Profile"}
                </button>
              </div>
            </div>
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
          showTransactions={showTransactions}
          setShowTransactions={setShowTransactions}
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
  );
}
