"use client";

import { useState } from "react";
import { getSupabaseClient } from "../../lib/supabase";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";

export default function UploadSalesPage() {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const supabaseClient = getSupabaseClient();

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

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(
          data.error || "Sales data upload failed."
        );
      }

      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <main className="uploadPage">
      <div className="uploadContainer">

        <div className="uploadHeader">
          <div>
            <p className="uploadEyebrow">MADIBA SFA</p>
            <h1>Upload Sales Data</h1>
            <p>
              Replace the current sales snapshot with the
              latest complete Excel export.
            </p>
          </div>

          <a href="/" className="backButton">
            ← Dashboard
          </a>
        </div>

        <div className="uploadWarning">
          <strong>Full Snapshot Upload</strong>
          <p>
            Upload the complete sales history Excel file.
            The existing live dataset will only be replaced
            after the new file has been successfully processed.
          </p>
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

      </div>
    </main>
  );
}
