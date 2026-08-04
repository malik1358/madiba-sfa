"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";
import MorningAttendanceGate from "../../components/MorningAttendanceGate";
import { translate, useAppLanguage } from "../../lib/appLanguage";
import { getSupabaseClient } from "../../lib/supabase";
import { fetchSalesScope } from "../../lib/salesScope";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";
import { detectTable } from "../../lib/schemaGuards";

const TEXT = {
  title: { en: "New Customer", ar: "عميل جديد" },
  subtitle: { en: "Prospect registration", ar: "تسجيل عميل محتمل" },
  dashboard: { en: "← Dashboard", ar: "← الرئيسية" },
  loading: { en: "Loading prospect registration...", ar: "جاري تحميل تسجيل العميل المحتمل..." },
};

const INITIAL_FORM = {
  customer_name: "",
  shop_name: "",
  owner_name: "",
  mobile: "",
  whatsapp: "",
  email: "",
  city: "",
  area: "",
  national_address: "",
  gps_location: "",
  customer_type: "Retail",
  salesman_code: "",
  notes: "",
};

const DOCUMENT_TYPES = ["CR", "VAT", "ID", "CREDIT_APPLICATION", "OTHER"];

export default function NewCustomerPage() {
  const router = useRouter();
  const { language, dir, setLanguage } = useAppLanguage();
  const t = translate(language, TEXT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [schemaWarning, setSchemaWarning] = useState("");
  const [prospectsEnabled, setProspectsEnabled] = useState(true);
  const [salesmen, setSalesmen] = useState([]);
  const [recent, setRecent] = useState([]);
  const [form, setForm] = useState(INITIAL_FORM);
  const [documents, setDocuments] = useState([]);
  const [selectedDocumentType, setSelectedDocumentType] = useState("CR");
  const [gpsStatus, setGpsStatus] = useState("GPS is required before saving.");

  useEffect(() => {
    async function load() {
      const supabase = getSupabaseClient();
      if (!supabase) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError("");

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session?.user) {
          throw new Error("Please login again.");
        }

        const prospectsCheck = await detectTable(supabase, "prospects");
        const scope = await fetchSalesScope();
        setProspectsEnabled(prospectsCheck.available);
        setSchemaWarning(
          prospectsCheck.available
            ? ""
            : `${prospectsCheck.reason}. Create the prospects table to enable prospect registration.`
        );

        let salesmenQuery = supabase
          .from("profiles")
          .select("id,salesman_code,salesman_name,role")
          .in("role", ["salesman", "manager", "admin"])
          .order("salesman_name");

        if (!scope.hasAllAccess) {
          salesmenQuery = salesmenQuery.in("salesman_code", scope.visibleSalesmanCodes);
        }

        let recentQuery = Promise.resolve({ data: [], error: null });
        if (prospectsCheck.available) {
          let query = supabase
            .from("prospects")
            .select("id,shop_name,owner_name,mobile,city,area,created_at,status,created_by,salesman_code")
            .order("created_at", { ascending: false })
            .limit(10);

          if (!scope.hasAllAccess) {
            query = query.in("salesman_code", scope.visibleSalesmanCodes);
          }

          recentQuery = query;
        }

        const [salesmenRes, recentRes] = await Promise.all([
          salesmenQuery,
          recentQuery,
        ]);

        if (salesmenRes.error) throw salesmenRes.error;
        if (recentRes.error) throw recentRes.error;

        const salesmanRows = salesmenRes.data || [];
        setSalesmen(salesmanRows);
        setRecent(recentRes.data || []);

        if (salesmanRows.length > 0) {
          setForm((current) => ({
            ...current,
            salesman_code: current.salesman_code || salesmanRows[0].salesman_code || "",
          }));
        }
      } catch (err) {
        setError(err.message || "Unable to load setup data.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  async function captureLocation() {
    if (!navigator.geolocation) {
      setError("Geolocation is not supported on this device.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude.toFixed(6);
        const lng = position.coords.longitude.toFixed(6);
        setForm((current) => ({ ...current, gps_location: `${lat}, ${lng}` }));
        setGpsStatus(`Captured ${lat}, ${lng}`);
      },
      () => {
        setError("Unable to read GPS location.");
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  function handleDocumentPick(event) {
    const file = event.target.files?.[0] || null;
    if (!file) return;

    setDocuments((current) => [
      ...current,
      {
        type: selectedDocumentType,
        name: file.name,
        size: file.size,
        mimeType: file.type,
      },
    ]);

    event.target.value = "";
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (!prospectsEnabled) {
      setError("Prospect registration is disabled until the prospects table is available.");
      return;
    }

    if (!form.gps_location) {
      setError("GPS location is required for new customer saving.");
      return;
    }

    const supabase = getSupabaseClient();
    if (!supabase) {
      setError("Supabase is not configured.");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) {
        throw new Error("Please login again.");
      }

      const payload = {
        customer_name: form.customer_name,
        shop_name: form.shop_name,
        owner_name: form.owner_name,
        mobile: form.mobile,
        whatsapp: form.whatsapp || null,
        email: form.email || null,
        city: form.city,
        area: form.area,
        gps_location: form.gps_location || null,
        customer_type: form.customer_type,
        salesman_code: form.salesman_code,
        notes: [
          form.national_address ? `National Address: ${form.national_address}` : "",
          form.notes,
          documents.length ? `Documents: ${JSON.stringify(documents)}` : "",
        ].filter(Boolean).join("\n") || null,
        status: "PENDING",
        created_by: session.user.id,
      };

      const { data, error: insertError } = await supabase
        .from("prospects")
        .insert(payload)
        .select("id,customer_name,shop_name,salesman_code")
        .single();

      if (insertError) throw insertError;

      const { data: latest, error: latestError } = await supabase
        .from("prospects")
        .select("id,shop_name,owner_name,mobile,city,area,created_at,status")
        .eq("salesman_code", form.salesman_code)
        .order("created_at", { ascending: false })
        .limit(10);

      if (latestError) throw latestError;
      setRecent(latest || []);

      const customerCode = `PROSPECT-${data.id}`;
      const customerName = data.customer_name || data.shop_name || `Prospect ${data.id}`;
      const params = new URLSearchParams({
        customer_code: customerCode,
        customer_name: customerName,
        salesman_code: form.salesman_code,
        source: "prospect",
      });

      router.push(`/management/new-order?${params.toString()}`);
    } catch (err) {
      setError(err.message || "Unable to register prospect.");
    } finally {
      setSaving(false);
    }
  }

  const supabaseClient = getSupabaseClient();
  if (!supabaseClient) {
    return (
      <SupabaseUnavailable
        title="New Customer unavailable"
        message="Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to register prospects."
      />
    );
  }

  if (loading) {
    return (
      <main className="modulePage" dir={dir}>
        <div className="moduleShell">
          <div className="moduleLoading">{t("loading")}</div>
        </div>
      </main>
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
          <div className="moduleHeaderMeta"><AppLanguageSwitch language={language} setLanguage={setLanguage} /><Link href="/" className="moduleBackLink">{t("dashboard")}</Link></div>
        </div>

        {error && <div className="moduleError">{error}</div>}
        {message && <div className="moduleSuccess">{message}</div>}
        {schemaWarning && <div className="moduleWarning">{schemaWarning}</div>}

        <section className="moduleSection">
          <div className="moduleSectionHeader">
            <h2>Prospect Form</h2>
          </div>

          <form className="moduleFormGrid" onSubmit={handleSubmit}>
            <label>
              Customer Name
              <input className="moduleInput" required value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} />
            </label>
            <label>
              Shop Name
              <input className="moduleInput" required value={form.shop_name} onChange={(e) => setForm({ ...form, shop_name: e.target.value })} />
            </label>
            <label>
              Owner
              <input className="moduleInput" required value={form.owner_name} onChange={(e) => setForm({ ...form, owner_name: e.target.value })} />
            </label>
            <label>
              Mobile
              <input className="moduleInput" required value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} />
            </label>
            <label>
              WhatsApp
              <input className="moduleInput" value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} />
            </label>
            <label>
              Email
              <input className="moduleInput" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </label>
            <label>
              City
              <input className="moduleInput" required value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            </label>
            <label>
              Area
              <input className="moduleInput" required value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} />
            </label>
            <label className="moduleFieldFull">
              National Address
              <textarea className="moduleTextArea" rows={3} value={form.national_address} onChange={(e) => setForm({ ...form, national_address: e.target.value })} placeholder="Building, street, district, city, postal code, additional number" />
            </label>
            <label>
              Customer Type
              <select className="moduleInput" value={form.customer_type} onChange={(e) => setForm({ ...form, customer_type: e.target.value })}>
                <option>Retail</option>
                <option>Wholesale</option>
                <option>Key Account</option>
                <option>HORECA</option>
              </select>
            </label>
            <label>
              Salesman
              <select className="moduleInput" required value={form.salesman_code} onChange={(e) => setForm({ ...form, salesman_code: e.target.value })}>
                <option value="">Select salesman</option>
                {salesmen.map((salesman) => (
                  <option key={salesman.id} value={salesman.salesman_code || ""}>
                    {(salesman.salesman_name || salesman.id) + (salesman.salesman_code ? ` (${salesman.salesman_code})` : "")}
                  </option>
                ))}
              </select>
            </label>
            <label className="moduleGpsRow">
              GPS Location
              <div className="moduleGpsControls">
                <input className="moduleInput" required value={form.gps_location} onChange={(e) => setForm({ ...form, gps_location: e.target.value })} placeholder="24.774265, 46.738586" />
                <button type="button" className="moduleInlineButton" onClick={captureLocation}>Capture</button>
              </div>
              <small className="moduleHint">{gpsStatus}</small>
            </label>
            <div className="moduleFieldFull">
              <div className="moduleSectionHeader">
                <h2>Documents</h2>
                <span>CR, VAT, ID, and other supporting files</span>
              </div>
              <div className="moduleDocumentRow">
                <select className="moduleInput" value={selectedDocumentType} onChange={(e) => setSelectedDocumentType(e.target.value)}>
                  {DOCUMENT_TYPES.map((type) => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
                <input className="moduleInput" type="file" onChange={handleDocumentPick} />
              </div>
              {documents.length > 0 && (
                <ul className="moduleList">
                  {documents.map((document, index) => (
                    <li key={`${document.type}-${document.name}-${index}`}>
                      <strong>{document.type}</strong>
                      <span>{document.name}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <label className="moduleFieldFull">
              Notes
              <textarea className="moduleTextArea" rows={4} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </label>
            <div className="moduleFieldFull">
              <button className="modulePrimaryButton" type="submit" disabled={saving || !prospectsEnabled}>
                {saving ? "Saving..." : "Save Prospect"}
              </button>
            </div>
          </form>
        </section>

        <section className="moduleSection">
          <div className="moduleSectionHeader">
            <h2>Recent Prospects</h2>
          </div>
          <div className="moduleTableWrap">
            <table className="moduleTable">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Shop</th>
                  <th>Owner</th>
                  <th>Mobile</th>
                  <th>Area</th>
                  <th>Status</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((row) => (
                  <tr key={row.id}>
                    <td>{row.id}</td>
                    <td>{row.shop_name || "-"}</td>
                    <td>{row.owner_name || "-"}</td>
                    <td>{row.mobile || "-"}</td>
                    <td>{`${row.city || "-"} / ${row.area || "-"}`}</td>
                    <td>{row.status || "-"}</td>
                    <td>{row.created_at ? new Date(row.created_at).toLocaleString("en-GB") : "-"}</td>
                  </tr>
                ))}
                {recent.length === 0 && (
                  <tr>
                    <td colSpan={7}>No prospects created yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
    </MorningAttendanceGate>
  );
}
