const GENERIC_MIME_TYPES = new Set([
  "",
  "application/octet-stream",
  "binary/octet-stream",
  "application/x-download",
  "application/download",
]);

function headerLooksLikePdf(buffer) {
  if (!buffer || buffer.byteLength < 4) return false;
  const bytes = buffer instanceof Uint8Array
    ? buffer.subarray(0, 5)
    : new Uint8Array(buffer.slice(0, 5));
  return bytes[0] === 0x25
    && bytes[1] === 0x50
    && bytes[2] === 0x44
    && bytes[3] === 0x46;
}

export function isGenericUploadMimeType(mimeType) {
  return GENERIC_MIME_TYPES.has(String(mimeType || "").trim().toLowerCase());
}

export function storageExtensionFromUpload(file = {}) {
  const name = String(file?.name || file?.fileName || "").toLowerCase();
  if (name.endsWith(".pdf")) return "pdf";
  if (name.endsWith(".png")) return "png";
  if (name.endsWith(".webp")) return "webp";
  if (name.endsWith(".heic")) return "heic";
  if (name.endsWith(".heif")) return "heif";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "jpg";

  const mime = String(file?.type || file?.mimeType || "").toLowerCase();
  if (mime === "application/pdf") return "pdf";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/heic") return "heic";
  if (mime === "image/heif") return "heif";
  if (mime === "image/jpeg" || mime === "image/jpg") return "jpg";
  return "jpg";
}

export function resolveUploadContentType(file = {}, buffer = null) {
  const name = String(file?.name || file?.fileName || "").toLowerCase();
  const mime = String(file?.type || file?.mimeType || "").trim().toLowerCase();

  if (mime === "application/pdf" || name.endsWith(".pdf") || headerLooksLikePdf(buffer)) {
    return "application/pdf";
  }
  if (mime === "image/jpg" || mime === "image/pjpeg") {
    return "image/jpeg";
  }
  if (!isGenericUploadMimeType(mime)) {
    return mime;
  }

  const ext = storageExtensionFromUpload(file);
  if (ext === "pdf") return "application/pdf";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "heic") return "image/heic";
  if (ext === "heif") return "image/heif";
  return "image/jpeg";
}

export function ensureNamedUploadFile(file, fallbackName = "attachment.jpg", buffer = null) {
  if (!file || typeof File === "undefined" || !(file instanceof Blob)) return file;

  const contentType = resolveUploadContentType({
    name: file.name || fallbackName,
    type: file.type,
  }, buffer);
  const ext = contentType === "application/pdf"
    ? "pdf"
    : contentType === "image/png"
      ? "png"
      : contentType === "image/webp"
        ? "webp"
        : contentType === "image/heic"
          ? "heic"
          : contentType === "image/heif"
            ? "heif"
            : "jpg";
  const rawName = String(file.name || fallbackName || `attachment.${ext}`).trim() || `attachment.${ext}`;
  const baseName = rawName.replace(/\.[^.]+$/, "") || "attachment";
  const nextName = `${baseName}.${ext}`;

  if (
    typeof File !== "undefined"
    && file instanceof File
    && file.name === nextName
    && file.type === contentType
  ) {
    return file;
  }

  if (typeof File === "undefined") return file;
  return new File([file], nextName, {
    type: contentType,
    lastModified: Number(file.lastModified) || Date.now(),
  });
}
