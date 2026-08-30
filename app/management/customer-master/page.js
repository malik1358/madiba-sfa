"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";
import MorningAttendanceGate from "../../components/MorningAttendanceGate";
import MostVisitedPages from "../../components/MostVisitedPages";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";
import { translate, useAppLanguage } from "../../lib/appLanguage";
import { resolveCustomerMasterExportFields } from "../../lib/customerCode.js";
import { normalizeCustomerMasterSearch } from "../../lib/customerMasterQuery.js";
import { resolveAuthSession } from "../../lib/authSession";
import { getSupabaseClient } from "../../lib/supabase";
import { usePopupMessages } from "../../hooks/usePopupMessages";
import { useAppPopup } from "../../components/AppPopupProvider";
import CustomerDocumentsPanel from "./CustomerDocumentsPanel";

const TEXT = {
  title: { en: "Customer Master", ar: "سجل العملاء" },
  subtitle: {
    en: "View and maintain customer GPS locations for visit distance checks",
    ar: "عرض وتحديث مواقع GPS للعملاء لفحص مسافة الزيارة",
  },
  back: { en: "← Management", ar: "← الإدارة" },
  loading: { en: "Loading customers...", ar: "جاري تحميل العملاء..." },
  search: { en: "Search code or name", ar: "بحث بالكود أو الاسم" },
  missingGps: { en: "Missing GPS only", ar: "بدون GPS فقط" },
  gpsFilter: { en: "GPS filter", ar: "تصفية GPS" },
  gpsAll: { en: "All customers", ar: "كل العملاء" },
  gpsWith: { en: "With GPS", ar: "مع GPS" },
  gpsWithout: { en: "Without GPS", ar: "بدون GPS" },
  refresh: { en: "Refresh", ar: "تحديث" },
  import: { en: "Import GPS Excel", ar: "استيراد GPS من Excel" },
  importHint: {
    en: "Select the Excel file with columns Party Name, Lattitude, Longitutde, then click Upload.",
    ar: "اختر ملف Excel بأعمدة Party Name و Lattitude و Longitutde ثم اضغط رفع.",
  },
  chooseFile: { en: "Choose file", ar: "اختر ملف" },
  upload: { en: "Upload GPS", ar: "رفع GPS" },
  uploading: { en: "Uploading...", ar: "جاري الرفع..." },
  clearFile: { en: "Clear", ar: "إلغاء" },
  selectedFile: { en: "Selected file", ar: "الملف المختار" },
  noFileSelected: { en: "No file selected yet.", ar: "لم يتم اختيار ملف بعد." },
  code: { en: "Code", ar: "الكود" },
  customer: { en: "Customer", ar: "العميل" },
  salesman: { en: "Salesman", ar: "المندوب" },
  cityArea: { en: "City / Area", ar: "المدينة / المنطقة" },
  latitude: { en: "Latitude", ar: "خط العرض" },
  longitude: { en: "Longitude", ar: "خط الطول" },
  status: { en: "Status", ar: "الحالة" },
  actions: { en: "Actions", ar: "الإجراءات" },
  save: { en: "Save", ar: "حفظ" },
  audit: { en: "Audit", ar: "مراجعة" },
  active: { en: "Active", ar: "نشط" },
  inactive: { en: "Inactive", ar: "غير نشط" },
  hasGps: { en: "GPS saved", ar: "GPS محفوظ" },
  noGps: { en: "Missing GPS", ar: "بدون GPS" },
  noRows: { en: "No customers found.", ar: "لا يوجد عملاء." },
  accessDenied: { en: "Only admin or manager can access customer master.", ar: "فقط المدير أو الأدمن يمكنه الوصول لسجل العملاء." },
  page: { en: "Page", ar: "صفحة" },
  of: { en: "of", ar: "من" },
  prev: { en: "Previous", ar: "السابق" },
  next: { en: "Next", ar: "التالي" },
  showing: { en: "Showing", ar: "عرض" },
  filterWithGps: { en: "with GPS", ar: "مع GPS" },
  filterWithoutGps: { en: "without GPS", ar: "بدون GPS" },
  filterAll: { en: "all customers", ar: "كل العملاء" },
  activeFilter: { en: "Status filter", ar: "تصفية الحالة" },
  activeAll: { en: "All statuses", ar: "كل الحالات" },
  activeOnly: { en: "Active only", ar: "نشط فقط" },
  inactiveOnly: { en: "Inactive only", ar: "غير نشط فقط" },
  outstandingFilter: { en: "Outstanding filter", ar: "تصفية المستحقات" },
  outstandingAll: { en: "All balances", ar: "كل الأرصدة" },
  outstandingWith: { en: "With outstanding", ar: "مع مستحقات" },
  outstandingWithout: { en: "No outstanding", ar: "بدون مستحقات" },
  outstanding: { en: "Outstanding", ar: "المستحقات" },
  filterActive: { en: "active", ar: "نشط" },
  filterInactive: { en: "inactive", ar: "غير نشط" },
  filterWithOutstanding: { en: "with outstanding", ar: "مع مستحقات" },
  filterWithoutOutstanding: { en: "no outstanding", ar: "بدون مستحقات" },
  exportExcel: { en: "Export Excel", ar: "تصدير Excel" },
  exporting: { en: "Exporting...", ar: "جاري التصدير..." },
  documents: { en: "Documents", ar: "المستندات" },
  documentsTitle: { en: "Customer documents", ar: "مستندات العميل" },
  closeDocuments: { en: "Close", ar: "إغلاق" },
  documentsHint: {
    en: "Compulsory: CR, VAT, and national address. Optional: Balady license and credit application. Files are linked on CR National Number.",
    ar: "إلزامي: السجل التجاري وضريبة القيمة المضافة والعنوان الوطني. اختياري: رخصة بلدي وطلب التسهيلات. الربط برقم السجل الوطني.",
  },
  missingCompulsory: { en: "Missing compulsory documents", ar: "مستندات إلزامية ناقصة" },
  compulsoryComplete: { en: "Compulsory documents are on file.", ar: "المستندات الإلزامية موجودة." },
  creditExpiry: { en: "Credit application expiry", ar: "انتهاء طلب التسهيلات" },
  creditExpired: { en: "Expired", ar: "منتهٍ" },
  creditMissing: { en: "No credit application on file (optional, used for order approval).", ar: "لا يوجد طلب تسهيلات (اختياري، يُستخدم لاعتماد الطلب)." },
  loadingDocuments: { en: "Loading documents...", ar: "جاري تحميل المستندات..." },
  compulsory: { en: "Compulsory", ar: "إلزامي" },
  optional: { en: "Optional", ar: "اختياري" },
  issueDate: { en: "Issue date", ar: "تاريخ الإصدار" },
  expiryDate: { en: "Expiry date", ar: "تاريخ الانتهاء" },
  datesRequired: { en: "Enter issue date and expiry date before uploading.", ar: "أدخل تاريخ الإصدار وتاريخ الانتهاء قبل الرفع." },
  openFile: { en: "Open file", ar: "فتح الملف" },
  noFileYet: { en: "No file uploaded yet.", ar: "لم يُرفع ملف بعد." },
  creditCr: { en: "CR on the form", ar: "رقم السجل في النموذج" },
  vatNumber: { en: "VAT registration number", ar: "الرقم الضريبي" },
  uploadDocument: { en: "Upload", ar: "رفع" },
  uploadingDocument: { en: "Uploading...", ar: "جاري الرفع..." },
};

function hasSavedGps(row) {
  const lat = Number(row?.latitude);
  const lng = Number(row?.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0;
}

function formatCoordinate(value) {
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : "";
}

function formatOutstanding(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "0";
  return number.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export default function CustomerMasterPage() {
  const { language, dir, setLanguage } = useAppLanguage();
  const t = translate(language, TEXT);
  const { showPopup } = useAppPopup();
  const supabaseClient = getSupabaseClient();

  const [loading, setLoading] = useState(true);
  const [savingCode, setSavingCode] = useState("");
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [importSummary, setImportSummary] = useState("");
  const [accessDenied, setAccessDenied] = useState(false);
  const [customers, setCustomers] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 1 });
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [gpsFilter, setGpsFilter] = useState("all");
  const [activeFilter, setActiveFilter] = useState("all");
  const [outstandingFilter, setOutstandingFilter] = useState("all");
  const [drafts, setDrafts] = useState({});
  const [documentsCustomer, setDocumentsCustomer] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);

  usePopupMessages({ error, message: importSummary });

  useEffect(() => {
    if (!accessDenied) return;
    showPopup({ message: t("accessDenied"), variant: "error" });
  }, [accessDenied, showPopup, t]);

  useEffect(() => {
    if (!documentsCustomer) return;
    window.requestAnimationFrame(() => {
      document.getElementById("customer-documents-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [documentsCustomer]);

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
      });
      if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
      if (gpsFilter !== "all") params.set("gpsFilter", gpsFilter);
      if (activeFilter !== "all") params.set("activeFilter", activeFilter);
      if (outstandingFilter !== "all") params.set("outstandingFilter", outstandingFilter);

      const response = await fetch(`/api/admin/customers?${params.toString()}`, {
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
      setPagination(payload.pagination || { page: 1, limit: 50, total: 0, totalPages: 1 });
      setDrafts({});
    } catch (err) {
      setError(err.message || "Unable to load customers.");
      setCustomers([]);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, gpsFilter, activeFilter, outstandingFilter]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(normalizeCustomerMasterSearch(search));
    }, 400);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    loadCustomers(1);
  }, [loadCustomers]);

  const filterLabel = useMemo(() => {
    const parts = [];
    if (gpsFilter === "with") parts.push(t("filterWithGps"));
    else if (gpsFilter === "without") parts.push(t("filterWithoutGps"));
    else parts.push(t("filterAll"));

    if (activeFilter === "active") parts.push(t("filterActive"));
    else if (activeFilter === "inactive") parts.push(t("filterInactive"));

    if (outstandingFilter === "with") parts.push(t("filterWithOutstanding"));
    else if (outstandingFilter === "without") parts.push(t("filterWithoutOutstanding"));

    return parts.join(" · ");
  }, [activeFilter, gpsFilter, outstandingFilter, t]);

  const rows = useMemo(() => customers, [customers]);

  async function saveCustomerLocation(customer) {
    const supabase = getSupabaseClient();
    if (!supabase) return;

    const draft = drafts[customer.customer_code] || {};
    const latitude = draft.latitude ?? formatCoordinate(customer.latitude);
    const longitude = draft.longitude ?? formatCoordinate(customer.longitude);

    setSavingCode(customer.customer_code);
    setError("");

    try {
      const session = await resolveAuthSession(supabase, 8000);
      if (!session?.access_token) throw new Error("Please login again.");

      const response = await fetch("/api/admin/customers", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          customerCode: customer.customer_code,
          latitude,
          longitude,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Unable to save customer location.");
      }

      setCustomers((current) => current.map((row) => (
        row.customer_code === customer.customer_code ? payload.customer : row
      )));
      setDrafts((current) => {
        const next = { ...current };
        delete next[customer.customer_code];
        return next;
      });
    } catch (err) {
      setError(err.message || "Unable to save customer location.");
    } finally {
      setSavingCode("");
    }
  }

  async function exportCustomersToExcel() {
    const supabase = getSupabaseClient();
    if (!supabase) return;

    setExporting(true);
    setError("");

    try {
      const session = await resolveAuthSession(supabase, 8000);
      if (!session?.access_token) throw new Error("Please login again.");

      const params = new URLSearchParams();
      if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
      if (gpsFilter !== "all") params.set("gpsFilter", gpsFilter);
      if (activeFilter !== "all") params.set("activeFilter", activeFilter);
      if (outstandingFilter !== "all") params.set("outstandingFilter", outstandingFilter);

      const response = await fetch(`/api/admin/customers/export?${params.toString()}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Unable to export customers.");
      }

      const blob = await response.blob();
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      const filename = `customer-master-${gpsFilter}-${stamp}.xlsx`;
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message || "Unable to export customers.");
    } finally {
      setExporting(false);
    }
  }

  async function importLocations(file) {
    const supabase = getSupabaseClient();
    if (!supabase || !file) return;

    setImporting(true);
    setError("");
    setImportSummary("");

    try {
      const session = await resolveAuthSession(supabase, 8000);
      if (!session?.access_token) throw new Error("Please login again.");

      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/admin/customers/locations", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: formData,
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Unable to import customer locations.");
      }

      const summary = payload.summary || {};
      setImportSummary(
        `Updated ${summary.updated || 0} of ${summary.matched || 0} matched rows. `
        + `Skipped invalid: ${summary.skippedInvalid || 0}. Not found: ${summary.notFound || 0}.`,
      );
      setSelectedFile(null);
      await loadCustomers(pagination.page || 1);
    } catch (err) {
      setError(err.message || "Unable to import customer locations.");
    } finally {
      setImporting(false);
    }
  }

  if (!supabaseClient) {
    return (
      <SupabaseUnavailable
        title="Customer master unavailable"
        message="Supabase credentials are required for customer master."
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

            <div className="moduleFilterRow" style={{ marginBottom: "12px" }}>
              <input
                className="moduleInput"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("search")}
              />
              <label>
                {t("gpsFilter")}
                <select
                  className="moduleInput"
                  value={gpsFilter}
                  onChange={(event) => setGpsFilter(event.target.value)}
                >
                  <option value="all">{t("gpsAll")}</option>
                  <option value="with">{t("gpsWith")}</option>
                  <option value="without">{t("gpsWithout")}</option>
                </select>
              </label>
              <label>
                {t("activeFilter")}
                <select
                  className="moduleInput"
                  value={activeFilter}
                  onChange={(event) => setActiveFilter(event.target.value)}
                >
                  <option value="all">{t("activeAll")}</option>
                  <option value="active">{t("activeOnly")}</option>
                  <option value="inactive">{t("inactiveOnly")}</option>
                </select>
              </label>
              <label>
                {t("outstandingFilter")}
                <select
                  className="moduleInput"
                  value={outstandingFilter}
                  onChange={(event) => setOutstandingFilter(event.target.value)}
                >
                  <option value="all">{t("outstandingAll")}</option>
                  <option value="with">{t("outstandingWith")}</option>
                  <option value="without">{t("outstandingWithout")}</option>
                </select>
              </label>
              <button type="button" className="moduleInlineButton moduleActionButton" onClick={() => loadCustomers(pagination.page || 1)}>
                {t("refresh")}
              </button>
              <button
                type="button"
                className="moduleInlineButton moduleActionButton"
                disabled={exporting || loading}
                onClick={exportCustomersToExcel}
              >
                {exporting ? t("exporting") : t("exportExcel")}
              </button>
            </div>

            <div className="moduleHint" style={{ marginBottom: "12px" }}>
              {t("showing")} {rows.length} / {pagination.total || 0} ({filterLabel})
              {debouncedSearch ? ` · "${debouncedSearch}"` : ""}
            </div>

            <div className="moduleSection" style={{ marginBottom: "12px" }}>
              <div className="moduleSectionHeader">
                <h2>{t("import")}</h2>
              </div>
              <div className="moduleHint">{t("importHint")}</div>
              <div className="moduleInlineStack moduleActionStack" style={{ marginTop: "8px", alignItems: "center" }}>
                <input
                  id="customer-master-gps-file"
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  disabled={importing}
                  style={{ display: "none" }}
                  onChange={(event) => {
                    setSelectedFile(event.target.files?.[0] || null);
                    setImportSummary("");
                  }}
                />
                <label htmlFor="customer-master-gps-file" className="moduleInlineButton moduleActionButton" style={{ cursor: importing ? "not-allowed" : "pointer" }}>
                  {t("chooseFile")}
                </label>
                <button
                  type="button"
                  className="modulePrimaryButton"
                  disabled={!selectedFile || importing}
                  onClick={() => {
                    if (selectedFile) importLocations(selectedFile);
                  }}
                >
                  {importing ? t("uploading") : t("upload")}
                </button>
                {selectedFile ? (
                  <button
                    type="button"
                    className="moduleInlineButton moduleActionButton"
                    disabled={importing}
                    onClick={() => {
                      setSelectedFile(null);
                      const input = document.getElementById("customer-master-gps-file");
                      if (input) input.value = "";
                    }}
                  >
                    {t("clearFile")}
                  </button>
                ) : null}
              </div>
              <div className="moduleHint" style={{ marginTop: "8px" }}>
                {selectedFile
                  ? `${t("selectedFile")}: ${selectedFile.name}`
                  : t("noFileSelected")}
              </div>
            </div>

            {documentsCustomer ? (
              <CustomerDocumentsPanel
                customer={documentsCustomer}
                t={t}
                onClose={() => setDocumentsCustomer(null)}
              />
            ) : null}

            <div className="moduleTableWrap moduleCustomerMasterTableWrap">
              <table className="moduleTable moduleCustomerMasterTable">
                <thead>
                  <tr>
                    <th className="moduleCustomerMasterSticky moduleCustomerMasterCode">{t("code")}</th>
                    <th className="moduleCustomerMasterSticky moduleCustomerMasterName">{t("customer")}</th>
                    <th>{t("salesman")}</th>
                    <th>{t("cityArea")}</th>
                    <th>{t("outstanding")}</th>
                    <th>{t("latitude")}</th>
                    <th>{t("longitude")}</th>
                    <th>{t("status")}</th>
                    <th>{t("actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const draft = drafts[row.customer_code] || {};
                    const display = resolveCustomerMasterExportFields(row);
                    const customerCode = display.customer_code || row.customer_code || "-";
                    const customerName = display.customer_name || row.customer_name || "-";
                    return (
                      <tr key={row.customer_code || customerName} className="moduleCustomerMasterRow">
                        <td data-label={t("code")} className="moduleCustomerMasterSticky moduleCustomerMasterCode">{customerCode}</td>
                        <td data-label={t("customer")} className="moduleCustomerMasterSticky moduleCustomerMasterName">{customerName}</td>
                        <td data-label={t("salesman")}>{row.current_salesman_code || "-"}</td>
                        <td data-label={t("cityArea")}>{`${row.city || "-"} / ${row.area || "-"}`}</td>
                        <td data-label={t("outstanding")}>{formatOutstanding(row.total_outstanding)}</td>
                        <td data-label={t("latitude")}>
                          <input
                            className="moduleInput"
                            value={draft.latitude ?? formatCoordinate(row.latitude)}
                            onChange={(event) => setDrafts((current) => ({
                              ...current,
                              [row.customer_code]: {
                                ...current[row.customer_code],
                                latitude: event.target.value,
                              },
                            }))}
                          />
                        </td>
                        <td data-label={t("longitude")}>
                          <input
                            className="moduleInput"
                            value={draft.longitude ?? formatCoordinate(row.longitude)}
                            onChange={(event) => setDrafts((current) => ({
                              ...current,
                              [row.customer_code]: {
                                ...current[row.customer_code],
                                longitude: event.target.value,
                              },
                            }))}
                          />
                        </td>
                        <td data-label={t("status")}>
                          <div>{row.is_active ? t("active") : t("inactive")}</div>
                          <div className="moduleHint">{hasSavedGps(row) ? t("hasGps") : t("noGps")}</div>
                        </td>
                        <td data-label={t("actions")} className="moduleCustomerMasterActions">
                          <div className="moduleInlineStack moduleActionStack">
                            <button
                              type="button"
                              className="moduleInlineButton moduleActionButton"
                              disabled={savingCode === row.customer_code}
                              onClick={() => saveCustomerLocation(row)}
                            >
                              {savingCode === row.customer_code ? "..." : t("save")}
                            </button>
                            <Link
                              href={`/management/customer-audit?customer_code=${encodeURIComponent(row.customer_code || "")}`}
                              className="moduleInlineButton moduleActionButton"
                            >
                              {t("audit")}
                            </Link>
                            <button
                              type="button"
                              className="moduleInlineButton moduleActionButton"
                              onClick={() => setDocumentsCustomer(row)}
                            >
                              {t("documents")}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {!loading && rows.length === 0 ? <div className="moduleHint">{t("noRows")}</div> : null}
            {loading ? <div className="moduleLoading">{t("loading")}</div> : null}

            <div className="moduleInlineStack moduleActionStack" style={{ marginTop: "12px" }}>
              <button
                type="button"
                className="moduleInlineButton moduleActionButton"
                disabled={pagination.page <= 1 || loading}
                onClick={() => loadCustomers(pagination.page - 1)}
              >
                {t("prev")}
              </button>
              <span className="moduleHint">
                {t("page")} {pagination.page} {t("of")} {pagination.totalPages}
              </span>
              <button
                type="button"
                className="moduleInlineButton moduleActionButton"
                disabled={pagination.page >= pagination.totalPages || loading}
                onClick={() => loadCustomers(pagination.page + 1)}
              >
                {t("next")}
              </button>
            </div>
          </section>
        </div>
      </main>
    </MorningAttendanceGate>
  );
}
