"use client";

import { useEffect, useState } from "react";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";
import MorningAttendanceGate from "../../components/MorningAttendanceGate";
import { translate, useAppLanguage } from "../../lib/appLanguage";
import { getSupabaseClient } from "../../lib/supabase";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";
import { usePopupMessages } from "../../hooks/usePopupMessages";
import { formatKsaDateTime } from "../../lib/workdayActivity";
import { invalidateOutstandingCache } from "../../lib/mobileDataCache";

const TEXT = {
  title: { en: "Upload Sales Data", ar: "رفع بيانات المبيعات" },
  subtitle: { en: "Upload a sales Excel file to refresh only the transaction dates found in that file. All other dates stay unchanged.", ar: "ارفع ملف مبيعات إكسل لتحديث تواريخ المعاملات الموجودة في الملف فقط. باقي التواريخ تبقى كما هي." },
  dashboard: { en: "← Dashboard", ar: "← الرئيسية" },
  lastSalesUpload: { en: "Last sales upload", ar: "آخر رفع للمبيعات" },
  lastOutstandingUpload: { en: "Last outstanding upload", ar: "آخر رفع للمتأخرات" },
  lastReceiptUpload: { en: "Last receipt upload", ar: "آخر رفع للسندات" },
  noSalesUploadYet: { en: "No sales upload yet.", ar: "لا يوجد رفع للمبيعات بعد." },
  noOutstandingUploadYet: { en: "No outstanding upload yet.", ar: "لا يوجد رفع للمتأخرات بعد." },
  noReceiptUploadYet: { en: "No receipt upload yet.", ar: "لا يوجد رفع للسندات بعد." },
  loadingLastUploads: { en: "Loading last upload dates...", ar: "جاري تحميل تواريخ آخر رفع..." },
  downloadFile: { en: "Download file", ar: "تحميل الملف" },
  downloadingFile: { en: "Downloading...", ar: "جاري التحميل..." },
};

function formatUploadTimestamp(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return formatKsaDateTime(value);
}

export default function UploadSalesPage() {
  const { language, dir, setLanguage } = useAppLanguage();
  const t = translate(language, TEXT);
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [outstandingFile, setOutstandingFile] = useState(null);
  const [outstandingUploading, setOutstandingUploading] = useState(false);
  const [outstandingResult, setOutstandingResult] = useState(null);
  const [outstandingError, setOutstandingError] = useState("");
  const [receiptFile, setReceiptFile] = useState(null);
  const [receiptUploading, setReceiptUploading] = useState(false);
  const [receiptResult, setReceiptResult] = useState(null);
  const [receiptError, setReceiptError] = useState("");
  const [itemUnitFile, setItemUnitFile] = useState(null);
  const [itemUnitUploading, setItemUnitUploading] = useState(false);
  const [itemUnitResult, setItemUnitResult] = useState(null);
  const [itemUnitError, setItemUnitError] = useState("");
  const [lastSalesUpload, setLastSalesUpload] = useState(null);
  const [lastOutstandingUpload, setLastOutstandingUpload] = useState(null);
  const [lastReceiptUpload, setLastReceiptUpload] = useState(null);
  const [lastItemUnitUpload, setLastItemUnitUpload] = useState(null);
  const [loadingLastUploads, setLoadingLastUploads] = useState(true);
  const [downloadingKind, setDownloadingKind] = useState("");

  const uploadSuccessMessage = result
    ? String(result.message || result.fileName || "Sales data updated successfully.").trim()
    : "";
  const outstandingSuccessMessage = outstandingResult
    ? String(outstandingResult.message || outstandingResult.fileName || "Outstanding data updated successfully.").trim()
    : "";
  const receiptSuccessMessage = receiptResult
    ? String(receiptResult.message || receiptResult.fileName || "Receipt register updated successfully.").trim()
    : "";
  const itemUnitSuccessMessage = itemUnitResult
    ? String(itemUnitResult.message || itemUnitResult.fileName || "Item master units updated successfully.").trim()
    : "";

  usePopupMessages({
    error: error || outstandingError || receiptError || itemUnitError,
    message: uploadSuccessMessage || outstandingSuccessMessage || receiptSuccessMessage || itemUnitSuccessMessage,
  });

  const supabaseClient = getSupabaseClient();

  async function loadLastUploadInfo() {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setLoadingLastUploads(false);
      return;
    }

    setLoadingLastUploads(true);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        setLastSalesUpload(null);
        setLastOutstandingUpload(null);
        setLastReceiptUpload(null);
        setLastItemUnitUpload(null);
        return;
      }

      const [salesBatchResult, outstandingResponse, salesFileMetaResponse, receiptResponse, itemUnitResponse] = await Promise.all([
        supabase
          .from("import_batches")
          .select("file_name,completed_at,started_at,status,customer_count,total_rows")
          .eq("status", "ACTIVE")
          .order("completed_at", { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle(),
        fetch("/api/outstanding", {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        }),
        fetch("/api/upload-files?kind=sales&meta=1", {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        }),
        fetch("/api/receipts", {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        }),
        fetch("/api/tally-item-units", {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        }),
      ]);

      if (salesBatchResult.error) throw salesBatchResult.error;

      const salesFileMeta = await salesFileMetaResponse.json().catch(() => ({}));

      setLastSalesUpload(salesBatchResult.data ? {
        fileName: salesBatchResult.data.file_name || "",
        uploadedAt: salesBatchResult.data.completed_at || salesBatchResult.data.started_at || "",
        rowsCount: salesBatchResult.data.total_rows || 0,
        customersCount: salesBatchResult.data.customer_count || 0,
        canDownload: Boolean(salesFileMetaResponse.ok && salesFileMeta.success && salesFileMeta.available),
      } : null);

      const outstandingPayload = await outstandingResponse.json().catch(() => ({}));
      setLastOutstandingUpload(
        outstandingResponse.ok
        && outstandingPayload.success
        && outstandingPayload.uploadedAt
          ? {
              fileName: outstandingPayload.fileName || "",
              uploadedAt: outstandingPayload.uploadedAt,
              rowsCount: outstandingPayload.rowsCount || 0,
              canDownload: Boolean(outstandingPayload.canDownload),
            }
          : null,
      );

      const receiptPayload = await receiptResponse.json().catch(() => ({}));
      setLastReceiptUpload(
        receiptResponse.ok
        && receiptPayload.success
        && receiptPayload.uploadedAt
          ? {
              fileName: receiptPayload.fileName || "",
              uploadedAt: receiptPayload.uploadedAt,
              rowsCount: receiptPayload.rowsCount || 0,
              matchedCount: receiptPayload.matchedCount || 0,
            }
          : null,
      );

      const itemUnitPayload = await itemUnitResponse.json().catch(() => ({}));
      setLastItemUnitUpload(
        itemUnitResponse.ok
        && itemUnitPayload.success
        && !itemUnitPayload.setupRequired
          ? {
              unitsCount: Number(itemUnitPayload.unitsCount || 0),
              uploadedAt: itemUnitPayload.updatedAt || "",
            }
          : null,
      );
    } catch {
      setLastSalesUpload(null);
      setLastOutstandingUpload(null);
      setLastReceiptUpload(null);
      setLastItemUnitUpload(null);
    } finally {
      setLoadingLastUploads(false);
    }
  }

  useEffect(() => {
    loadLastUploadInfo();
  }, []);

  async function downloadUploadedFile(kind, fallbackName) {
    const normalizedKind = String(kind || "").trim().toLowerCase();
    if (!["sales", "outstanding"].includes(normalizedKind) || downloadingKind) return;

    setDownloadingKind(normalizedKind);
    setError("");
    setOutstandingError("");

    try {
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error("Supabase is not configured.");

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Your login session has expired. Please login again.");
      }

      const response = await fetch(`/api/upload-files?kind=${normalizedKind}`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Unable to download uploaded file.");
      }

      const blob = await response.blob();
      const headerName = response.headers.get("Content-Disposition") || "";
      const matchedName = headerName.match(/filename="([^"]+)"/i)?.[1];
      const fileName = matchedName || fallbackName || `${normalizedKind}.xlsx`;
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      if (normalizedKind === "outstanding") {
        setOutstandingError(err.message || "Unable to download uploaded file.");
      } else {
        setError(err.message || "Unable to download uploaded file.");
      }
    } finally {
      setDownloadingKind("");
    }
  }

  if (!supabaseClient) {
    return (
      <SupabaseUnavailable
        title="Upload unavailable"
        message="The upload page requires Supabase credentials to authenticate and process sales files."
      />
    );
  }

  async function uploadFile() {
    if (!file) {
      setError("Please select an Excel file first.");
      return;
    }

    setUploading(true);
    setError("");
    setResult(null);

    try {
      const supabase = getSupabaseClient();

      if (!supabase) {
        throw new Error("Supabase is not configured.");
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        throw new Error(
          "Your login session has expired. Please login again."
        );
      }

      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/import-sales", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        body: formData,
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.success) {
        throw new Error(
          data.error || "Sales data upload failed."
        );
      }

      setResult(data);
      await loadLastUploadInfo();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function uploadOutstandingFile() {
    if (!outstandingFile) {
      setOutstandingError("Please select an outstanding Excel file first.");
      return;
    }

    setOutstandingUploading(true);
    setOutstandingError("");
    setOutstandingResult(null);

    try {
      const supabase = getSupabaseClient();

      if (!supabase) {
        throw new Error("Supabase is not configured.");
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Your login session has expired. Please login again.");
      }

      const formData = new FormData();
      formData.append("file", outstandingFile);

      const response = await fetch("/api/outstanding", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        body: formData,
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Outstanding upload failed.");
      }

      setOutstandingResult(data);
      await invalidateOutstandingCache();
      await loadLastUploadInfo();
    } catch (err) {
      setOutstandingError(err.message || "Outstanding upload failed.");
    } finally {
      setOutstandingUploading(false);
    }
  }

  async function uploadReceiptFile() {
    if (!receiptFile) {
      setReceiptError("Please select a receipt Excel file first.");
      return;
    }

    setReceiptUploading(true);
    setReceiptError("");
    setReceiptResult(null);

    try {
      const supabase = getSupabaseClient();

      if (!supabase) {
        throw new Error("Supabase is not configured.");
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Your login session has expired. Please login again.");
      }

      const formData = new FormData();
      formData.append("file", receiptFile);

      const response = await fetch("/api/receipts", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        body: formData,
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Receipt register upload failed.");
      }

      setReceiptResult(data);
      await loadLastUploadInfo();
    } catch (err) {
      setReceiptError(err.message || "Receipt register upload failed.");
    } finally {
      setReceiptUploading(false);
    }
  }

  async function uploadItemUnitFile() {
    if (!itemUnitFile) {
      setItemUnitError("Please select an ITEM MASTER Excel file first.");
      return;
    }

    setItemUnitUploading(true);
    setItemUnitError("");
    setItemUnitResult(null);

    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        throw new Error("Supabase is not configured.");
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Your login session has expired. Please login again.");
      }

      const formData = new FormData();
      formData.append("file", itemUnitFile);

      const response = await fetch("/api/tally-item-units", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        body: formData,
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        const detail = String(data.error || data.message || "").trim();
        throw new Error(
          detail
          || (response.status === 404
            ? "Item master unit API is not deployed yet. Wait for the latest release, then retry."
            : response.status === 403
              ? "Only admin, manager, or invoice maker can import item master units."
              : `Item master unit upload failed (HTTP ${response.status}).`),
        );
      }

      setItemUnitResult(data);
      await loadLastUploadInfo();
    } catch (err) {
      setItemUnitError(err.message || "Item master unit upload failed.");
    } finally {
      setItemUnitUploading(false);
    }
  }

  return (
    <MorningAttendanceGate>
    <main className="uploadPage" dir={dir}>
      <div className="uploadContainer">

        <div className="uploadHeader">
          <div>
            <p className="uploadEyebrow">MADIBA SFA</p>
            <h1>{t("title")}</h1>
            <p>{t("subtitle")}</p>
          </div>

          <div className="moduleHeaderMeta"><AppLanguageSwitch language={language} setLanguage={setLanguage} /><a href="/" className="backButton">{t("dashboard")}</a></div>
        </div>

        <div className="uploadWarning">
          <strong>Incremental Date Upload</strong>
          <p>
            Upload a sales Excel export for the dates you want to refresh.
            Only those transaction dates are replaced. The rest of the live
            sales history stays intact, so you do not need to upload the full
            history every time.
          </p>
        </div>

        <div className="uploadMeta">
          {loadingLastUploads ? (
            <p>{t("loadingLastUploads")}</p>
          ) : lastSalesUpload ? (
            <div className="uploadMetaRow">
              <p>
                <strong>{t("lastSalesUpload")}:</strong>{" "}
                {formatUploadTimestamp(lastSalesUpload.uploadedAt)}
                {lastSalesUpload.fileName ? ` | ${lastSalesUpload.fileName}` : ""}
                {lastSalesUpload.rowsCount ? ` | ${Number(lastSalesUpload.rowsCount).toLocaleString()} rows` : ""}
              </p>
              {lastSalesUpload.canDownload ? (
                <button
                  type="button"
                  className="uploadDownloadButton"
                  onClick={() => downloadUploadedFile("sales", lastSalesUpload.fileName)}
                  disabled={Boolean(downloadingKind)}
                >
                  {downloadingKind === "sales" ? t("downloadingFile") : t("downloadFile")}
                </button>
              ) : null}
            </div>
          ) : (
            <p>{t("noSalesUploadYet")}</p>
          )}
        </div>

        <div className="uploadCard">

          <label className="fileDrop">

            <div className="fileIcon">📊</div>

            <strong>
              {file
                ? file.name
                : "Choose Excel Sales File"}
            </strong>

            <span>
              {file
                ? `${(file.size / 1024 / 1024).toFixed(
                    2
                  )} MB`
                : ".xlsx or .xls"}
            </span>

            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => {
                setFile(e.target.files?.[0] || null);
                setResult(null);
                setError("");
              }}
            />

          </label>

          <button
            className="replaceButton"
            onClick={uploadFile}
            disabled={!file || uploading}
          >
            {uploading
              ? "Processing Sales Data..."
              : "Validate & Update Sales Data"}
          </button>

          {uploading && (
            <div className="processingBox">
              <div className="spinner"></div>

              <div>
                <strong>
                  Please keep this page open
                </strong>
                <p>
                  Reading Excel, validating transactions, updating only the
                  dates found in the file, and refreshing customer assignments.
                </p>
              </div>
            </div>
          )}

          {result && (
            <div className="uploadSuccess">
              <div className="resultGrid">

                <div>
                  <span>Rows In File</span>
                  <strong>
                    {Number(
                      result.rows
                    ).toLocaleString()}
                  </strong>
                </div>

                <div>
                  <span>Dates Updated</span>
                  <strong>
                    {Number(
                      result.datesUpdated || (Array.isArray(result.uploadDates) ? result.uploadDates.length : 0)
                    ).toLocaleString()}
                  </strong>
                </div>

                <div>
                  <span>Customers In File</span>
                  <strong>
                    {Number(
                      result.customers
                    ).toLocaleString()}
                  </strong>
                </div>

                <div>
                  <span>Live Rows</span>
                  <strong>
                    {Number(
                      result.liveRows ?? result.rows
                    ).toLocaleString()}
                  </strong>
                </div>

                <div>
                  <span>Live Customers</span>
                  <strong>
                    {Number(
                      result.liveCustomers ?? result.customers
                    ).toLocaleString()}
                  </strong>
                </div>

                <div>
                  <span>Live Date Range</span>
                  <strong>
                    {(result.liveMinDate || result.minDate || "-")}
                    {" -> "}
                    {(result.liveMaxDate || result.maxDate || "-")}
                  </strong>
                </div>

              </div>

              <div className="snapshotActivated">
                {result.mergedIntoExisting
                  ? `✓ Updated ${Number(result.datesUpdated || 0).toLocaleString()} date(s) in the live dataset`
                  : "✓ New sales dataset is now LIVE"}
              </div>

              {Number(result.profitRows || 0) > 0 ? (
                <p>
                  Profit read from {result.profitColumn || "GP"} on{" "}
                  {Number(result.profitRows).toLocaleString()} rows.
                </p>
              ) : (
                <p className="uploadWarning">
                  No profit/GP amount was found. Add a GP, Gross Profit, Profit,
                  or Margin amount column (not %) and upload again. Headers in
                  this file: {(result.excelHeaders || []).join(", ") || "none"}
                </p>
              )}

            </div>
          )}

        </div>

        <div className="uploadCard" style={{ marginTop: "18px" }}>
          <div className="uploadWarning">
            <strong>Outstanding Customerwise Upload</strong>
            <p>
              Upload the evening outstanding file. Previous outstanding data is cleared and replaced with this file.
            </p>
          </div>

          <div className="uploadMeta">
            {loadingLastUploads ? (
              <p>{t("loadingLastUploads")}</p>
            ) : lastOutstandingUpload ? (
              <div className="uploadMetaRow">
                <p>
                  <strong>{t("lastOutstandingUpload")}:</strong>{" "}
                  {formatUploadTimestamp(lastOutstandingUpload.uploadedAt)}
                  {lastOutstandingUpload.fileName ? ` | ${lastOutstandingUpload.fileName}` : ""}
                  {lastOutstandingUpload.rowsCount ? ` | ${Number(lastOutstandingUpload.rowsCount).toLocaleString()} customers` : ""}
                </p>
                {lastOutstandingUpload.canDownload ? (
                  <button
                    type="button"
                    className="uploadDownloadButton"
                    onClick={() => downloadUploadedFile("outstanding", lastOutstandingUpload.fileName)}
                    disabled={Boolean(downloadingKind)}
                  >
                    {downloadingKind === "outstanding" ? t("downloadingFile") : t("downloadFile")}
                  </button>
                ) : null}
              </div>
            ) : (
              <p>{t("noOutstandingUploadYet")}</p>
            )}
          </div>

          <label className="fileDrop">
            <div className="fileIcon">📁</div>
            <strong>{outstandingFile ? outstandingFile.name : "Choose Outstanding Excel File"}</strong>
            <span>{outstandingFile ? `${(outstandingFile.size / 1024 / 1024).toFixed(2)} MB` : ".xlsx or .xls"}</span>

            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => {
                setOutstandingFile(e.target.files?.[0] || null);
                setOutstandingResult(null);
                setOutstandingError("");
              }}
            />
          </label>

          <button
            className="replaceButton"
            onClick={uploadOutstandingFile}
            disabled={!outstandingFile || outstandingUploading}
          >
            {outstandingUploading ? "Uploading Outstanding..." : "Upload & Replace Outstanding Data"}
          </button>

          {outstandingResult && (
            <div className="uploadSuccess">
              <div className="resultGrid">
                <div>
                  <span>Customers Loaded</span>
                  <strong>{Number(outstandingResult.rowsCount || 0).toLocaleString()}</strong>
                </div>
                <div>
                  <span>Uploaded At</span>
                  <strong>{formatUploadTimestamp(outstandingResult.uploadedAt)}</strong>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="uploadCard" style={{ marginTop: "18px" }}>
          <div className="uploadWarning">
            <strong>Receipt Register Upload</strong>
            <p>
              Upload the receipt Excel export (columns: TRANSACTIONDATE, VOUCHERTYPENAME,
              VOUCHERNUMBER, LEDGERNAME, Cr). Receipt and JV-Collection rows are imported.
              Only the receipt dates found in this file are replaced. Other dates stay unchanged,
              same as sales uploads. Ledger names are mapped to customers by code/name.
            </p>
          </div>

          <div className="uploadMeta">
            {loadingLastUploads ? (
              <p>{t("loadingLastUploads")}</p>
            ) : lastReceiptUpload ? (
              <p>
                <strong>{t("lastReceiptUpload")}:</strong>{" "}
                {formatUploadTimestamp(lastReceiptUpload.uploadedAt)}
                {lastReceiptUpload.fileName ? ` | ${lastReceiptUpload.fileName}` : ""}
                {lastReceiptUpload.rowsCount ? ` | ${Number(lastReceiptUpload.rowsCount).toLocaleString()} receipts` : ""}
                {lastReceiptUpload.matchedCount ? ` | ${Number(lastReceiptUpload.matchedCount).toLocaleString()} mapped` : ""}
              </p>
            ) : (
              <p>{t("noReceiptUploadYet")}</p>
            )}
          </div>

          <label className="fileDrop">
            <div className="fileIcon">🧾</div>
            <strong>{receiptFile ? receiptFile.name : "Choose Receipt Excel File"}</strong>
            <span>{receiptFile ? `${(receiptFile.size / 1024 / 1024).toFixed(2)} MB` : ".xlsx or .xls"}</span>

            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => {
                setReceiptFile(e.target.files?.[0] || null);
                setReceiptResult(null);
                setReceiptError("");
              }}
            />
          </label>

          <button
            className="replaceButton"
            onClick={uploadReceiptFile}
            disabled={!receiptFile || receiptUploading}
          >
            {receiptUploading ? "Uploading Receipt Register..." : "Validate & Update Receipt Register"}
          </button>

          {receiptUploading && (
            <div className="processingBox">
              <div className="spinner"></div>
              <div>
                <strong>Please keep this page open</strong>
                <p>
                  Reading receipt rows (Receipt + JV-Collection), mapping ledger names to customers,
                  and updating only the dates found in the file.
                </p>
              </div>
            </div>
          )}

          {receiptResult && (
            <div className="uploadSuccess">
              <div className="resultGrid">
                <div>
                  <span>Rows In File</span>
                  <strong>{Number(receiptResult.rows || 0).toLocaleString()}</strong>
                </div>
                <div>
                  <span>Dates Updated</span>
                  <strong>{Number(receiptResult.datesUpdated || 0).toLocaleString()}</strong>
                </div>
                <div>
                  <span>Mapped To Customers</span>
                  <strong>{Number(receiptResult.matchedCount || 0).toLocaleString()}</strong>
                </div>
                <div>
                  <span>Unmapped Rows</span>
                  <strong>{Number(receiptResult.unmatchedCount || 0).toLocaleString()}</strong>
                </div>
                <div>
                  <span>Live Receipts</span>
                  <strong>{Number(receiptResult.liveRows || receiptResult.rowsCount || 0).toLocaleString()}</strong>
                </div>
              </div>
              <div className="snapshotActivated">
                {receiptResult.mergedIntoExisting
                  ? `✓ Updated ${Number(receiptResult.datesUpdated || 0).toLocaleString()} date(s) in the live receipt register`
                  : "✓ Receipt register is now LIVE"}
              </div>
            </div>
          )}
        </div>

        <div className="uploadCard" style={{ marginTop: "18px" }}>
          <div className="uploadMeta">
            {loadingLastUploads ? (
              <p>{t("loadingLastUploads")}</p>
            ) : lastItemUnitUpload ? (
              <p>
                <strong>Last item master units:</strong>{" "}
                {formatUploadTimestamp(lastItemUnitUpload.uploadedAt)}
                {lastItemUnitUpload.unitsCount
                  ? ` | ${Number(lastItemUnitUpload.unitsCount).toLocaleString()} items with units`
                  : ""}
              </p>
            ) : (
              <p>No item master units imported yet.</p>
            )}
          </div>

          <label className="fileDrop">
            <div className="fileIcon">📦</div>
            <strong>{itemUnitFile ? itemUnitFile.name : "Choose ITEM MASTER Excel"}</strong>
            <span>
              {itemUnitFile
                ? `${(itemUnitFile.size / 1024 / 1024).toFixed(2)} MB`
                : "Columns: TALLY ITEM NAME, MASTER UNIT (.xlsx/.xls)"}
            </span>
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => {
                setItemUnitFile(e.target.files?.[0] || null);
                setItemUnitResult(null);
                setItemUnitError("");
              }}
            />
          </label>

          <button
            className="replaceButton"
            onClick={uploadItemUnitFile}
            disabled={!itemUnitFile || itemUnitUploading}
          >
            {itemUnitUploading ? "Importing Item Units..." : "Import Item Master Units"}
          </button>

          {itemUnitUploading && (
            <div className="processingBox">
              <div className="spinner"></div>
              <div>
                <strong>Please keep this page open</strong>
                <p>
                  Reading Tally item names and master units, then updating the catalog
                  used by pending-order Tally Excel export.
                </p>
              </div>
            </div>
          )}

          {itemUnitResult && (
            <div className="uploadSuccess">
              <div className="resultGrid">
                <div>
                  <span>Parsed Rows</span>
                  <strong>{Number(itemUnitResult.parsed || 0).toLocaleString()}</strong>
                </div>
                <div>
                  <span>Updated</span>
                  <strong>{Number(itemUnitResult.updated || 0).toLocaleString()}</strong>
                </div>
                <div>
                  <span>Created</span>
                  <strong>{Number(itemUnitResult.created || 0).toLocaleString()}</strong>
                </div>
                <div>
                  <span>Unmatched Codes</span>
                  <strong>{Number(itemUnitResult.skipped || 0).toLocaleString()}</strong>
                </div>
                <div>
                  <span>Units In Master</span>
                  <strong>{Number(itemUnitResult.unitsCount || 0).toLocaleString()}</strong>
                </div>
              </div>
              <div className="snapshotActivated">
                ✓ Item master units are ready for Tally Excel export
              </div>
            </div>
          )}
        </div>

      </div>
    </main>
    </MorningAttendanceGate>
  );
}
