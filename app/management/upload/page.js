"use client";

import { useEffect, useState } from "react";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";
import MorningAttendanceGate from "../../components/MorningAttendanceGate";
import MostVisitedPages from "../../components/MostVisitedPages";
import { translate, useAppLanguage } from "../../lib/appLanguage";
import { getSupabaseClient } from "../../lib/supabase";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";

const TEXT = {
  title: { en: "Upload Sales Data", ar: "رفع بيانات المبيعات" },
  subtitle: { en: "Replace the current sales snapshot with the latest complete Excel export.", ar: "استبدال لقطة المبيعات الحالية بآخر ملف إكسل كامل." },
  dashboard: { en: "← Dashboard", ar: "← الرئيسية" },
  lastSalesUpload: { en: "Last sales upload", ar: "آخر رفع للمبيعات" },
  lastOutstandingUpload: { en: "Last outstanding upload", ar: "آخر رفع للمتأخرات" },
  noSalesUploadYet: { en: "No sales upload yet.", ar: "لا يوجد رفع للمبيعات بعد." },
  noOutstandingUploadYet: { en: "No outstanding upload yet.", ar: "لا يوجد رفع للمتأخرات بعد." },
  loadingLastUploads: { en: "Loading last upload dates...", ar: "جاري تحميل تواريخ آخر رفع..." },
};

function formatUploadTimestamp(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("en-GB");
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
  const [lastSalesUpload, setLastSalesUpload] = useState(null);
  const [lastOutstandingUpload, setLastOutstandingUpload] = useState(null);
  const [loadingLastUploads, setLoadingLastUploads] = useState(true);

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
        return;
      }

      const [salesBatchResult, outstandingResponse] = await Promise.all([
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
      ]);

      if (salesBatchResult.error) throw salesBatchResult.error;

      setLastSalesUpload(salesBatchResult.data ? {
        fileName: salesBatchResult.data.file_name || "",
        uploadedAt: salesBatchResult.data.completed_at || salesBatchResult.data.started_at || "",
        rowsCount: salesBatchResult.data.total_rows || 0,
        customersCount: salesBatchResult.data.customer_count || 0,
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
            }
          : null,
      );
    } catch {
      setLastSalesUpload(null);
      setLastOutstandingUpload(null);
    } finally {
      setLoadingLastUploads(false);
    }
  }

  useEffect(() => {
    loadLastUploadInfo();
  }, []);

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
      await loadLastUploadInfo();
    } catch (err) {
      setOutstandingError(err.message || "Outstanding upload failed.");
    } finally {
      setOutstandingUploading(false);
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

          <div className="moduleHeaderMeta"><AppLanguageSwitch language={language} setLanguage={setLanguage} /><MostVisitedPages /><a href="/" className="backButton">{t("dashboard")}</a></div>
        </div>

        <div className="uploadWarning">
          <strong>Full Snapshot Upload</strong>
          <p>
            Upload the complete sales history Excel file.
            The existing live dataset will only be replaced
            after the new file has been successfully processed.
          </p>
        </div>

        <div className="uploadMeta">
          {loadingLastUploads ? (
            <p>{t("loadingLastUploads")}</p>
          ) : lastSalesUpload ? (
            <p>
              <strong>{t("lastSalesUpload")}:</strong>{" "}
              {formatUploadTimestamp(lastSalesUpload.uploadedAt)}
              {lastSalesUpload.fileName ? ` | ${lastSalesUpload.fileName}` : ""}
              {lastSalesUpload.rowsCount ? ` | ${Number(lastSalesUpload.rowsCount).toLocaleString()} rows` : ""}
            </p>
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
              : "Validate & Replace Sales Data"}
          </button>

          {uploading && (
            <div className="processingBox">
              <div className="spinner"></div>

              <div>
                <strong>
                  Please keep this page open
                </strong>
                <p>
                  Reading Excel, validating transactions and
                  preparing the new sales snapshot.
                </p>
              </div>
            </div>
          )}

          {error && (
            <div className="uploadError">
              <strong>Upload Failed</strong>
              <p>{error}</p>
              <p>
                The previous live dataset has not been
                replaced.
              </p>
            </div>
          )}

          {result && (
            <div className="uploadSuccess">

              <div className="successTitle">
                <div className="successTick">✓</div>

                <div>
                  <strong>
                    Sales Data Updated Successfully
                  </strong>
                  <p>{result.fileName}</p>
                </div>
              </div>

              <div className="resultGrid">

                <div>
                  <span>Rows Loaded</span>
                  <strong>
                    {Number(
                      result.rows
                    ).toLocaleString()}
                  </strong>
                </div>

                <div>
                  <span>Customers</span>
                  <strong>
                    {Number(
                      result.customers
                    ).toLocaleString()}
                  </strong>
                </div>

                <div>
                  <span>Items</span>
                  <strong>
                    {Number(
                      result.items
                    ).toLocaleString()}
                  </strong>
                </div>

                <div>
                  <span>Salesmen</span>
                  <strong>
                    {Number(
                      result.salesmen
                    ).toLocaleString()}
                  </strong>
                </div>

                <div>
                  <span>First Transaction</span>
                  <strong>
                    {result.minDate || "-"}
                  </strong>
                </div>

                <div>
                  <span>Latest Transaction</span>
                  <strong>
                    {result.maxDate || "-"}
                  </strong>
                </div>

              </div>

              <div className="snapshotActivated">
                ✓ New dataset is now LIVE
              </div>

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
              <p>
                <strong>{t("lastOutstandingUpload")}:</strong>{" "}
                {formatUploadTimestamp(lastOutstandingUpload.uploadedAt)}
                {lastOutstandingUpload.fileName ? ` | ${lastOutstandingUpload.fileName}` : ""}
                {lastOutstandingUpload.rowsCount ? ` | ${Number(lastOutstandingUpload.rowsCount).toLocaleString()} customers` : ""}
              </p>
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

          {outstandingError && (
            <div className="uploadError">
              <strong>Outstanding Upload Failed</strong>
              <p>{outstandingError}</p>
            </div>
          )}

          {outstandingResult && (
            <div className="uploadSuccess">
              <div className="successTitle">
                <div className="successTick">✓</div>
                <div>
                  <strong>Outstanding Data Updated Successfully</strong>
                  <p>{outstandingResult.fileName || "Outstanding file"}</p>
                </div>
              </div>

              <div className="resultGrid">
                <div>
                  <span>Customers Loaded</span>
                  <strong>{Number(outstandingResult.rowsCount || 0).toLocaleString()}</strong>
                </div>
                <div>
                  <span>Uploaded At</span>
                  <strong>{outstandingResult.uploadedAt ? new Date(outstandingResult.uploadedAt).toLocaleString("en-GB") : "-"}</strong>
                </div>
              </div>
            </div>
          )}
        </div>

      </div>
    </main>
    </MorningAttendanceGate>
  );
}
