export const UPLOAD_FILES_BUCKET = "upload-files";
export const SALES_UPLOAD_FILE_KEY = "sales_upload_file_v1";

const EXCEL_MIME_TYPES = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/octet-stream",
];

export function safeUploadFileName(name, fallback = "upload.xlsx") {
  return String(name || fallback)
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "") || fallback;
}

export function excelContentType(fileName) {
  const lower = String(fileName || "").toLowerCase();
  if (lower.endsWith(".xls")) return "application/vnd.ms-excel";
  return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
}

export function parseUploadFileMeta(value) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value || "null") : value;
    if (!parsed || typeof parsed !== "object") return null;
    const filePath = String(parsed.filePath || "").trim();
    if (!filePath) return null;
    return {
      filePath,
      fileName: String(parsed.fileName || "").trim(),
      uploadedAt: String(parsed.uploadedAt || "").trim(),
      kind: String(parsed.kind || "").trim(),
      batchId: parsed.batchId ?? null,
    };
  } catch {
    return null;
  }
}

export async function ensureUploadFilesBucket(admin) {
  const { data: bucket, error: bucketError } = await admin.storage.getBucket(UPLOAD_FILES_BUCKET);
  if (!bucketError && bucket) return;

  const { error: createError } = await admin.storage.createBucket(UPLOAD_FILES_BUCKET, {
    public: false,
    fileSizeLimit: 50 * 1024 * 1024,
    allowedMimeTypes: EXCEL_MIME_TYPES,
  });

  if (createError && !String(createError.message || "").toLowerCase().includes("already exists")) {
    throw createError;
  }
}

export async function storeUploadedExcel(admin, {
  kind,
  fileName,
  bytes,
  uploadedAt = new Date().toISOString(),
  batchId = null,
}) {
  const normalizedKind = String(kind || "").trim().toLowerCase();
  if (!["sales", "outstanding", "receipt"].includes(normalizedKind)) {
    throw new Error("Unsupported upload file kind.");
  }

  const safeName = safeUploadFileName(fileName, `${normalizedKind}.xlsx`);
  const stamp = String(uploadedAt || new Date().toISOString()).replace(/[:.]/g, "-");
  const filePath = `${normalizedKind}/${stamp}_${safeName}`;

  await ensureUploadFilesBucket(admin);

  const { error: uploadError } = await admin.storage
    .from(UPLOAD_FILES_BUCKET)
    .upload(filePath, bytes, {
      contentType: excelContentType(safeName),
      upsert: true,
    });

  if (uploadError) {
    throw new Error(`Could not store uploaded file: ${uploadError.message}`);
  }

  return {
    kind: normalizedKind,
    fileName: String(fileName || safeName).trim() || safeName,
    filePath,
    uploadedAt,
    batchId,
  };
}

export async function saveSalesUploadFileMeta(admin, meta) {
  const { error } = await admin.from("system_settings").upsert({
    setting_key: SALES_UPLOAD_FILE_KEY,
    setting_value: JSON.stringify(meta),
  }, { onConflict: "setting_key" });

  if (error) throw error;
  return meta;
}

export async function readSalesUploadFileMeta(admin) {
  const { data, error } = await admin
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", SALES_UPLOAD_FILE_KEY)
    .maybeSingle();

  if (error) throw error;
  return parseUploadFileMeta(data?.setting_value);
}

export async function downloadStoredUpload(admin, filePath) {
  const path = String(filePath || "").trim();
  if (!path) throw new Error("Uploaded file path is missing.");

  await ensureUploadFilesBucket(admin);

  const { data, error } = await admin.storage.from(UPLOAD_FILES_BUCKET).download(path);
  if (error || !data) {
    throw new Error(error?.message || "Uploaded file is not available.");
  }

  return data;
}
