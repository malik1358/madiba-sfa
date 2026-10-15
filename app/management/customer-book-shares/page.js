"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";
import MorningAttendanceGate from "../../components/MorningAttendanceGate";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";
import ExportableTable from "../../components/ExportableTable";
import { translate, useAppLanguage } from "../../lib/appLanguage";
import { fetchJsonWithTimeout, resolveAuthSession } from "../../lib/authSession";
import { invalidateSalesScopeCache } from "../../lib/mobileDataCache";
import { getSupabaseClient } from "../../lib/supabase";
import { usePopupMessages } from "../../hooks/usePopupMessages";

const TEXT = {
  title: { en: "Customer Book Shares", ar: "مشاركة دفاتر العملاء" },
  subtitle: {
    en: "Share a full salesman book, or only selected customers, with another salesman who is not on the same team. Bosses already see subordinates by hierarchy.",
    ar: "شارك دفتر مندوب كاملاً أو عملاء محددين فقط مع مندوب آخر ليس في نفس الفريق. الرؤساء يرون المرؤوسين تلقائياً من الهيكل.",
  },
  back: { en: "← Management", ar: "← الإدارة" },
  hierarchy: { en: "Salesman Hierarchy", ar: "هيكل المندوبين" },
  loading: { en: "Loading customer book shares...", ar: "جاري تحميل مشاركات دفاتر العملاء..." },
  createTitle: { en: "Share full book", ar: "مشاركة الدفتر كاملاً" },
  source: { en: "Whose customers", ar: "عملاء من" },
  viewer: { en: "Can be seen by", ar: "يظهر لدى" },
  add: { en: "Add share", ar: "إضافة مشاركة" },
  adding: { en: "Adding...", ar: "جاري الإضافة..." },
  existing: { en: "Full book shares", ar: "مشاركات الدفتر الكاملة" },
  status: { en: "Status", ar: "الحالة" },
  active: { en: "Active", ar: "نشط" },
  inactive: { en: "Inactive", ar: "غير نشط" },
  remove: { en: "Remove", ar: "حذف" },
  removing: { en: "Removing...", ar: "جاري الحذف..." },
  empty: { en: "No shares yet. Add one above.", ar: "لا توجد مشاركات بعد. أضف واحدة أعلاه." },
  chooseSource: { en: "Select salesman...", ar: "اختر المندوب..." },
  chooseViewer: { en: "Select viewer...", ar: "اختر من يرى..." },
  note: {
    en: "Full-book shares are one-way: the viewer sees every customer of the source. Selected customer shares below leave ownership unchanged and only grant visibility.",
    ar: "مشاركة الدفتر الكامل باتجاه واحد: يرى المشاهد كل عملاء المصدر. مشاركة عملاء محددين أدناه لا تغيّر الملكية وتمنح الرؤية فقط.",
  },
  saved: { en: "Share saved. Viewers should reopen My Day / Collection online.", ar: "تم حفظ المشاركة. يجب على المشاهدين إعادة فتح يومي / التحصيل وهم متصلون." },
  deleted: { en: "Share removed.", ar: "تم حذف المشاركة." },
  selectedTitle: { en: "Share selected customers", ar: "مشاركة عملاء محددين" },
  selectedNote: {
    en: "Pick individual customers for another salesman to see on My Day, Collection, Visit without order, and New order. Ownership (current salesman) stays the same.",
    ar: "اختر عملاء فرديين ليراهم مندوب آخر في يومي والتحصيل والزيارة بدون طلب والطلب الجديد. تبقى الملكية (المندوب الحالي) كما هي.",
  },
  customerSearch: { en: "Search customer code or name", ar: "ابحث بكود أو اسم العميل" },
  chooseCustomer: { en: "Select a customer from search…", ar: "اختر عميلاً من البحث…" },
  owner: { en: "Owner", ar: "المالك" },
  customer: { en: "Customer", ar: "العميل" },
  addSelected: { en: "Share customer", ar: "شارك العميل" },
  existingSelected: { en: "Selected customer shares", ar: "مشاركات العملاء المحددين" },
  emptySelected: { en: "No selected customer shares yet.", ar: "لا توجد مشاركات لعملاء محددين بعد." },
  selectedTableMissing: {
    en: "Selected customer shares need migration 20261015120000_customer_shares.sql applied in Supabase first.",
    ar: "مشاركات العملاء المحددين تحتاج تطبيق الهجرة 20261015120000_customer_shares.sql في Supabase أولاً.",
  },
  searching: { en: "Searching…", ar: "جاري البحث…" },
  noMatches: { en: "No matching customers.", ar: "لا يوجد عملاء مطابقون." },
};

export default function CustomerBookSharesPage() {
  const { language, dir, setLanguage } = useAppLanguage();
  const t = translate(language, TEXT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingSelected, setSavingSelected] = useState(false);
  const [removingId, setRemovingId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [shares, setShares] = useState([]);
  const [customerShares, setCustomerShares] = useState([]);
  const [customerSharesTableMissing, setCustomerSharesTableMissing] = useState(false);
  const [salesmen, setSalesmen] = useState([]);
  const [sourceId, setSourceId] = useState("");
  const [viewerId, setViewerId] = useState("");
  const [selectedViewerId, setSelectedViewerId] = useState("");
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerMatches, setCustomerMatches] = useState([]);
  const [selectedCustomerCode, setSelectedCustomerCode] = useState("");
  const [searchingCustomers, setSearchingCustomers] = useState(false);

  usePopupMessages({ message, error });

  const salesmanOptions = useMemo(
    () => [...salesmen].sort((a, b) => String(a.label || "").localeCompare(String(b.label || ""))),
    [salesmen],
  );

  async function loadShares(showLoader = true) {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setLoading(false);
      return;
    }

    if (showLoader) setLoading(true);
    setError("");

    try {
      const session = await resolveAuthSession(supabase);
      if (!session?.access_token) throw new Error("Please login again.");

      const { response, payload } = await fetchJsonWithTimeout(
        "/api/admin/customer-book-shares",
        { headers: { Authorization: `Bearer ${session.access_token}` } },
        60000,
      );
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Unable to load customer book shares.");
      }

      setShares(payload.shares || []);
      setCustomerShares(payload.customerShares || []);
      setCustomerSharesTableMissing(Boolean(payload.customerSharesTableMissing));
      setSalesmen(payload.salesmen || []);
      if (payload.seeded > 0) {
        setMessage(`Loaded ${payload.seeded} default share${payload.seeded === 1 ? "" : "s"} from built-in mappings.`);
      }
    } catch (err) {
      setError(err.message || "Unable to load customer book shares.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadShares(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const needle = customerQuery.trim();
    if (needle.length < 2) {
      setCustomerMatches([]);
      setSearchingCustomers(false);
      return undefined;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const supabase = getSupabaseClient();
      if (!supabase) return;
      setSearchingCustomers(true);
      try {
        const session = await resolveAuthSession(supabase);
        if (!session?.access_token) return;
        const { response, payload } = await fetchJsonWithTimeout(
          `/api/admin/customer-book-shares?customerQ=${encodeURIComponent(needle)}`,
          { headers: { Authorization: `Bearer ${session.access_token}` } },
          30000,
        );
        if (cancelled) return;
        if (!response.ok || !payload.success) {
          setCustomerMatches([]);
          return;
        }
        setCustomerMatches(payload.customers || []);
      } catch {
        if (!cancelled) setCustomerMatches([]);
      } finally {
        if (!cancelled) setSearchingCustomers(false);
      }
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [customerQuery]);

  async function addShare(event) {
    event.preventDefault();
    const supabase = getSupabaseClient();
    if (!supabase) return;

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const session = await resolveAuthSession(supabase);
      if (!session?.access_token) throw new Error("Please login again.");

      const { response, payload } = await fetchJsonWithTimeout(
        "/api/admin/customer-book-shares",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            mode: "create",
            sourceSalesmanId: sourceId,
            viewerSalesmanId: viewerId,
          }),
        },
        60000,
      );
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Unable to save share.");
      }

      setSourceId("");
      setViewerId("");
      setMessage(t("saved"));
      invalidateSalesScopeCache();
      await loadShares(false);
    } catch (err) {
      setError(err.message || "Unable to save share.");
    } finally {
      setSaving(false);
    }
  }

  async function addCustomerShare(event) {
    event.preventDefault();
    const supabase = getSupabaseClient();
    if (!supabase) return;

    setSavingSelected(true);
    setError("");
    setMessage("");

    try {
      const session = await resolveAuthSession(supabase);
      if (!session?.access_token) throw new Error("Please login again.");

      const { response, payload } = await fetchJsonWithTimeout(
        "/api/admin/customer-book-shares",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            mode: "create-customer-share",
            customerCode: selectedCustomerCode,
            viewerSalesmanId: selectedViewerId,
          }),
        },
        60000,
      );
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Unable to save selected customer share.");
      }

      setSelectedCustomerCode("");
      setCustomerQuery("");
      setCustomerMatches([]);
      setSelectedViewerId("");
      setMessage(t("saved"));
      invalidateSalesScopeCache();
      await loadShares(false);
    } catch (err) {
      setError(err.message || "Unable to save selected customer share.");
    } finally {
      setSavingSelected(false);
    }
  }

  async function removeShare(shareId) {
    const supabase = getSupabaseClient();
    if (!supabase) return;

    setRemovingId(shareId);
    setError("");
    setMessage("");

    try {
      const session = await resolveAuthSession(supabase);
      if (!session?.access_token) throw new Error("Please login again.");

      const { response, payload } = await fetchJsonWithTimeout(
        "/api/admin/customer-book-shares",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ mode: "delete", shareId }),
        },
        60000,
      );
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Unable to remove share.");
      }

      setMessage(t("deleted"));
      invalidateSalesScopeCache();
      await loadShares(false);
    } catch (err) {
      setError(err.message || "Unable to remove share.");
    } finally {
      setRemovingId("");
    }
  }

  async function removeCustomerShare(shareId) {
    const supabase = getSupabaseClient();
    if (!supabase) return;

    setRemovingId(shareId);
    setError("");
    setMessage("");

    try {
      const session = await resolveAuthSession(supabase);
      if (!session?.access_token) throw new Error("Please login again.");

      const { response, payload } = await fetchJsonWithTimeout(
        "/api/admin/customer-book-shares",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ mode: "delete-customer-share", shareId }),
        },
        60000,
      );
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Unable to remove selected customer share.");
      }

      setMessage(t("deleted"));
      invalidateSalesScopeCache();
      await loadShares(false);
    } catch (err) {
      setError(err.message || "Unable to remove selected customer share.");
    } finally {
      setRemovingId("");
    }
  }

  const supabaseClient = getSupabaseClient();
  if (!supabaseClient) {
    return (
      <SupabaseUnavailable
        title="Customer book shares unavailable"
        message="Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to manage customer book shares."
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
              <Link href="/management/salesman-hierarchy" className="moduleInlineButton">{t("hierarchy")}</Link>
              <Link href="/management" className="moduleBackLink">{t("back")}</Link>
            </div>
          </div>

          <p className="moduleKpiMeta" style={{ marginBottom: "16px" }}>{t("note")}</p>

          <section className="moduleSection" style={{ marginBottom: "20px" }}>
            <h2 style={{ marginTop: 0 }}>{t("createTitle")}</h2>
            <form onSubmit={addShare} className="moduleFilterRow" style={{ gridTemplateColumns: "1fr 1fr auto", alignItems: "end" }}>
              <label className="moduleField">
                {t("source")}
                <select
                  className="moduleInput"
                  value={sourceId}
                  onChange={(event) => setSourceId(event.target.value)}
                  required
                >
                  <option value="">{t("chooseSource")}</option>
                  {salesmanOptions.map((row) => (
                    <option key={row.id} value={row.id}>{row.label}</option>
                  ))}
                </select>
              </label>
              <label className="moduleField">
                {t("viewer")}
                <select
                  className="moduleInput"
                  value={viewerId}
                  onChange={(event) => setViewerId(event.target.value)}
                  required
                >
                  <option value="">{t("chooseViewer")}</option>
                  {salesmanOptions.map((row) => (
                    <option key={row.id} value={row.id}>{row.label}</option>
                  ))}
                </select>
              </label>
              <button
                type="submit"
                className="moduleInlineButton moduleActionButton"
                disabled={saving || loading || !sourceId || !viewerId || sourceId === viewerId}
              >
                {saving ? t("adding") : t("add")}
              </button>
            </form>
          </section>

          <section className="moduleSection" style={{ marginBottom: "28px" }}>
            <h2 style={{ marginTop: 0 }}>{t("existing")}</h2>
            {loading ? (
              <div className="moduleLoading">{t("loading")}</div>
            ) : shares.length === 0 ? (
              <p className="moduleKpiMeta">{t("empty")}</p>
            ) : (
              <ExportableTable filename="customer-book-shares" sheetName="Shares" className="moduleTableWrap">
                <table className="moduleTable">
                  <thead>
                    <tr>
                      <th>{t("source")}</th>
                      <th>{t("viewer")}</th>
                      <th>{t("status")}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {shares.map((share) => (
                      <tr key={share.id}>
                        <td>
                          <strong>{share.source_label}</strong>
                          <div className="moduleKpiMeta">{share.source_salesman_code}</div>
                        </td>
                        <td>
                          <strong>{share.viewer_label}</strong>
                          <div className="moduleKpiMeta">{share.viewer_salesman_code}</div>
                        </td>
                        <td>{share.is_active ? t("active") : t("inactive")}</td>
                        <td>
                          <button
                            type="button"
                            className="moduleInlineButton"
                            onClick={() => removeShare(share.id)}
                            disabled={removingId === share.id}
                          >
                            {removingId === share.id ? t("removing") : t("remove")}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ExportableTable>
            )}
          </section>

          <section className="moduleSection" style={{ marginBottom: "20px" }}>
            <h2 style={{ marginTop: 0 }}>{t("selectedTitle")}</h2>
            <p className="moduleKpiMeta" style={{ marginBottom: "12px" }}>{t("selectedNote")}</p>
            {customerSharesTableMissing ? (
              <p className="moduleKpiMeta">{t("selectedTableMissing")}</p>
            ) : (
              <form
                onSubmit={addCustomerShare}
                className="moduleFilterRow"
                style={{ gridTemplateColumns: "1.4fr 1fr auto", alignItems: "end" }}
              >
                <label className="moduleField">
                  {t("customerSearch")}
                  <input
                    className="moduleInput"
                    type="search"
                    value={customerQuery}
                    onChange={(event) => {
                      setCustomerQuery(event.target.value);
                      setSelectedCustomerCode("");
                    }}
                    placeholder={t("chooseCustomer")}
                  />
                  {searchingCustomers ? (
                    <div className="moduleKpiMeta">{t("searching")}</div>
                  ) : null}
                  {!searchingCustomers && customerQuery.trim().length >= 2 && customerMatches.length === 0 ? (
                    <div className="moduleKpiMeta">{t("noMatches")}</div>
                  ) : null}
                  {customerMatches.length > 0 ? (
                    <select
                      className="moduleInput"
                      value={selectedCustomerCode}
                      onChange={(event) => setSelectedCustomerCode(event.target.value)}
                      required
                      style={{ marginTop: "8px" }}
                    >
                      <option value="">{t("chooseCustomer")}</option>
                      {customerMatches.map((row) => (
                        <option key={row.customer_code} value={row.customer_code}>
                          {row.customer_code} — {row.customer_name}
                          {row.current_salesman_code ? ` (${row.current_salesman_code})` : ""}
                        </option>
                      ))}
                    </select>
                  ) : null}
                </label>
                <label className="moduleField">
                  {t("viewer")}
                  <select
                    className="moduleInput"
                    value={selectedViewerId}
                    onChange={(event) => setSelectedViewerId(event.target.value)}
                    required
                  >
                    <option value="">{t("chooseViewer")}</option>
                    {salesmanOptions.map((row) => (
                      <option key={row.id} value={row.id}>{row.label}</option>
                    ))}
                  </select>
                </label>
                <button
                  type="submit"
                  className="moduleInlineButton moduleActionButton"
                  disabled={
                    savingSelected
                    || loading
                    || !selectedCustomerCode
                    || !selectedViewerId
                  }
                >
                  {savingSelected ? t("adding") : t("addSelected")}
                </button>
              </form>
            )}
          </section>

          <section className="moduleSection">
            <h2 style={{ marginTop: 0 }}>{t("existingSelected")}</h2>
            {loading ? (
              <div className="moduleLoading">{t("loading")}</div>
            ) : customerSharesTableMissing ? (
              <p className="moduleKpiMeta">{t("selectedTableMissing")}</p>
            ) : customerShares.length === 0 ? (
              <p className="moduleKpiMeta">{t("emptySelected")}</p>
            ) : (
              <ExportableTable filename="customer-selected-shares" sheetName="Selected" className="moduleTableWrap">
                <table className="moduleTable">
                  <thead>
                    <tr>
                      <th>{t("customer")}</th>
                      <th>{t("owner")}</th>
                      <th>{t("viewer")}</th>
                      <th>{t("status")}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {customerShares.map((share) => (
                      <tr key={share.id}>
                        <td>
                          <strong>{share.customer_code}</strong>
                          <div className="moduleKpiMeta">{share.customer_name}</div>
                        </td>
                        <td>{share.owner_salesman_code || "—"}</td>
                        <td>
                          <strong>{share.viewer_label}</strong>
                          <div className="moduleKpiMeta">{share.viewer_salesman_code}</div>
                        </td>
                        <td>{share.is_active ? t("active") : t("inactive")}</td>
                        <td>
                          <button
                            type="button"
                            className="moduleInlineButton"
                            onClick={() => removeCustomerShare(share.id)}
                            disabled={removingId === share.id}
                          >
                            {removingId === share.id ? t("removing") : t("remove")}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ExportableTable>
            )}
          </section>
        </div>
      </main>
    </MorningAttendanceGate>
  );
}
