"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CUSTOMER_DOCUMENT_TYPES, addYearsToIsoDate, validateDocumentDates } from "../../lib/customerDocumentParse";
import { prepareUploadFile } from "../../lib/compressUploadFile";
import { fetchJsonWithTimeout, resolveAuthSession } from "../../lib/authSession";
import { getSupabaseClient } from "../../lib/supabase";

export default function CustomerDocumentsPanel({ customer, t, onClose }) {
  const [loading, setLoading] = useState(true);
  const [uploadingType, setUploadingType] = useState("");
  const [error, setError] = useState("");
  const [payload, setPayload] = useState(null);
  const [issueDates, setIssueDates] = useState({});
  const [expiryDates, setExpiryDates] = useState({});
  const [manualCr, setManualCr] = useState({});
  const [manualVat, setManualVat] = useState({});
  const todayIso = new Date().toISOString().slice(0, 10);

  const customerCode = customer?.customer_code || "";

  const loadDocuments = useCallback(async () => {
    const supabase = getSupabaseClient();
    if (!supabase || !customerCode) return;

    setLoading(true);
    setError("");
    try {
      const session = await resolveAuthSession(supabase, 8000);
      if (!session?.access_token) throw new Error("Please login again.");
      const { response, payload: body } = await fetchJsonWithTimeout(
        `/api/customer-documents?customerCode=${encodeURIComponent(customerCode)}`,
        { headers: { Authorization: `Bearer ${session.access_token}` } },
        20000,
      );
      if (!response.ok || !body.success) throw new Error(body.error || "Unable to load documents.");
      setPayload(body);
    } catch (err) {
      setError(err.message || "Unable to load documents.");
    } finally {
      setLoading(false);
    }
  }, [customerCode]);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  const latestByType = payload?.compliance?.latestByType || {};
  const missingCompulsory = payload?.compliance?.missingCompulsory || [];

  const slots = useMemo(() => CUSTOMER_DOCUMENT_TYPES.map((type) => ({
    ...type,
    current: latestByType[type.id] || null,
  })), [latestByType]);

  async function uploadDocument(typeId, file) {
    const supabase = getSupabaseClient();
    if (!supabase || !file) return;

    setUploadingType(typeId);
    setError("");
    try {
      if ((typeId === "CR" || typeId === "CREDIT_APPLICATION") && (!issueDates[typeId] || !expiryDates[typeId])) {
        throw new Error(t("datesRequired"));
      }
      const dates = validateDocumentDates({
        issueDate: issueDates[typeId],
        expiryDate: expiryDates[typeId],
        todayIso,
      });
      if (!dates.ok) throw new Error(dates.error);

      const session = await resolveAuthSession(supabase, 8000);
      if (!session?.access_token) throw new Error("Please login again.");

      const prepared = await prepareUploadFile(file);
      const formData = new FormData();
      formData.append("customerCode", customerCode);
      formData.append("documentType", typeId);
      formData.append("file", prepared);
      if (issueDates[typeId]) formData.append("issueDate", issueDates[typeId]);
      if (expiryDates[typeId]) formData.append("expiryDate", expiryDates[typeId]);
      if (manualCr[typeId]) formData.append("crNumber", manualCr[typeId]);
      if (manualVat[typeId]) formData.append("vatNumber", manualVat[typeId]);

      const { response, payload: body } = await fetchJsonWithTimeout("/api/customer-documents", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: formData,
      }, 90000);
      if (!response.ok || !body.success) throw new Error(body.error || "Unable to upload document.");
      setPayload(body);
    } catch (err) {
      setError(err.message || "Unable to upload document.");
    } finally {
      setUploadingType("");
    }
  }

  const credit = payload?.compliance?.creditApplication;

  return (
    <section id="customer-documents-panel" className="moduleSection" style={{ marginTop: "12px" }}>
      <div className="moduleSectionHeader">
        <h2>{t("documentsTitle")} — {customer.customer_code} {customer.customer_name}</h2>
        <button type="button" className="moduleInlineButton moduleActionButton" onClick={onClose}>
          {t("closeDocuments")}
        </button>
      </div>

      <div className="moduleHint">
        {t("documentsHint")}
        {payload?.customer?.cr_number ? ` · CR ${payload.customer.cr_number}` : ""}
        {payload?.customer?.vat_number ? ` · VAT ${payload.customer.vat_number}` : ""}
      </div>

      {missingCompulsory.length > 0 ? (
        <div className="moduleHint" style={{ color: "#9b1c1c", fontWeight: 700 }}>
          {t("missingCompulsory")}: {missingCompulsory
            .map((typeId) => CUSTOMER_DOCUMENT_TYPES.find((entry) => entry.id === typeId)?.labelEn || typeId)
            .join(", ")}
        </div>
      ) : (
        <div className="moduleHint">{t("compulsoryComplete")}</div>
      )}

      {credit?.present ? (
        <div className="moduleHint">
          {t("creditExpiry")}: {credit.expiryDate || "-"}
          {credit.expired ? ` · ${t("creditExpired")}` : ""}
        </div>
      ) : (
        <div className="moduleHint">{t("creditMissing")}</div>
      )}

      {error ? <div className="moduleHint" style={{ color: "#9b1c1c" }}>{error}</div> : null}
      {loading ? <div className="moduleLoading">{t("loadingDocuments")}</div> : null}

      <div className="moduleCollectorFilterGrid" style={{ marginTop: "12px" }}>
        {slots.map((slot) => {
          const current = slot.current;
          const mismatch = current?.link_status === "MISMATCH";
          return (
            <div key={slot.id} className="moduleSection" style={{ margin: 0 }}>
              <div className="moduleSectionHeader">
                <h3 style={{ margin: 0, fontSize: "1rem" }}>
                  {slot.id}
                  {slot.compulsory ? ` · ${t("compulsory")}` : ` · ${t("optional")}`}
                </h3>
              </div>
              <div className="moduleHint">{slot.labelEn}</div>
              {current ? (
                <>
                  <div className="moduleHint">
                    {current.original_file_name || current.file_path}
                    {current.parsed_cr_number ? ` · CR ${current.parsed_cr_number}` : ""}
                    {current.parsed_vat_number ? ` · VAT ${current.parsed_vat_number}` : ""}
                    {current.extracted_json?.companyName ? ` · ${current.extracted_json.companyName}` : ""}
                    {current.extracted_json?.address ? ` · ${current.extracted_json.address}` : ""}
                    {current.extracted_json?.licenseNumber ? ` · ${current.extracted_json.licenseNumber}` : ""}
                    {current.issue_date ? ` · ${t("issueDate")} ${current.issue_date}` : ""}
                    {(current.expiry_date || (slot.id === "CREDIT_APPLICATION" && credit?.expiryDate))
                      ? ` · ${t("expiryDate")} ${current.expiry_date || credit?.expiryDate}`
                      : ""}
                    {validateDocumentDates({
                      issueDate: current.issue_date,
                      expiryDate: current.expiry_date || (slot.id === "CREDIT_APPLICATION" ? credit?.expiryDate : ""),
                      todayIso,
                    }).ok === false ? ` · ${t("creditExpired")}` : ""}
                  </div>
                  <div className="moduleHint" style={{ color: mismatch ? "#9b1c1c" : undefined, fontWeight: mismatch ? 700 : 400 }}>
                    {current.link_message || current.link_status || ""}
                  </div>
                  {current.file_url ? (
                    <a className="moduleInlineButton moduleActionButton" href={current.file_url} target="_blank" rel="noreferrer">
                      {t("openFile")}
                    </a>
                  ) : null}
                </>
              ) : (
                <div className="moduleHint">{t("noFileYet")}</div>
              )}

              {(slot.id === "CREDIT_APPLICATION" || slot.id === "CR") ? (
                <>
                  <label className="moduleHint" style={{ display: "block", marginTop: "8px" }}>
                    {t("issueDate")}
                    <input
                      className="moduleInput"
                      type="date"
                      max={todayIso}
                      value={issueDates[slot.id] || ""}
                      onChange={(event) => {
                        const issueDate = event.target.value;
                        setIssueDates((currentDates) => ({
                          ...currentDates,
                          [slot.id]: issueDate,
                        }));
                        if (slot.id === "CREDIT_APPLICATION" && issueDate && !expiryDates[slot.id]) {
                          const nextExpiry = addYearsToIsoDate(issueDate, 1);
                          if (nextExpiry && nextExpiry >= todayIso) {
                            setExpiryDates((currentDates) => ({
                              ...currentDates,
                              [slot.id]: nextExpiry,
                            }));
                          }
                        }
                      }}
                    />
                  </label>
                  <label className="moduleHint" style={{ display: "block", marginTop: "8px" }}>
                    {t("expiryDate")}
                    <input
                      className="moduleInput"
                      type="date"
                      min={todayIso}
                      value={expiryDates[slot.id] || ""}
                      onChange={(event) => setExpiryDates((currentDates) => ({
                        ...currentDates,
                        [slot.id]: event.target.value,
                      }))}
                    />
                  </label>
                </>
              ) : null}

              {slot.id === "VAT" ? (
                <label className="moduleHint" style={{ display: "block", marginTop: "8px" }}>
                  {t("vatNumber")}
                  <input
                    className="moduleInput"
                    value={manualVat[slot.id] || ""}
                    onChange={(event) => setManualVat((currentVat) => ({
                      ...currentVat,
                      [slot.id]: event.target.value,
                    }))}
                    placeholder="314787395400003"
                  />
                </label>
              ) : null}

              {(slot.id === "CREDIT_APPLICATION" || slot.id === "CR") ? (
                <label className="moduleHint" style={{ display: "block", marginTop: "8px" }}>
                  {t("creditCr")}
                  <input
                    className="moduleInput"
                    value={manualCr[slot.id] || ""}
                    onChange={(event) => setManualCr((currentCr) => ({
                      ...currentCr,
                      [slot.id]: event.target.value,
                    }))}
                    placeholder="7043111504"
                  />
                </label>
              ) : null}

              <input
                id={`customer-doc-${slot.id}`}
                type="file"
                accept="application/pdf,image/*"
                disabled={Boolean(uploadingType)}
                style={{ display: "none" }}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) uploadDocument(slot.id, file);
                }}
              />
              <label
                htmlFor={`customer-doc-${slot.id}`}
                className="moduleInlineButton moduleActionButton"
                style={{ marginTop: "8px", cursor: uploadingType ? "not-allowed" : "pointer" }}
              >
                {uploadingType === slot.id ? t("uploadingDocument") : t("uploadDocument")}
              </label>
            </div>
          );
        })}
      </div>
    </section>
  );
}
