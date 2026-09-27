import { ensureNamedUploadFile, resolveUploadContentType } from "./collectionUploadFile.js";

const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 2000;
const IMAGE_LOAD_TIMEOUT_MS = 12000;
const CANVAS_BLOB_TIMEOUT_MS = 12000;
const HEADER_SNIFF_TIMEOUT_MS = 3000;
const MAX_STORAGE_UPLOAD_BYTES = 20 * 1024 * 1024;

function withTimeout(promise, timeoutMs, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]);
}

async function readUploadHeader(file) {
  try {
    if (!file || typeof file.slice !== "function") return null;
    const buffer = await withTimeout(
      file.slice(0, 16).arrayBuffer(),
      HEADER_SNIFF_TIMEOUT_MS,
      "Reading the attached file timed out. Try a smaller PDF/photo or retake the receipt.",
    );
    return new Uint8Array(buffer);
  } catch {
    return null;
  }
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    const timer = setTimeout(() => {
      URL.revokeObjectURL(url);
      image.onload = null;
      image.onerror = null;
      image.src = "";
      reject(new Error("Reading this photo timed out. Retake it or choose a smaller JPG/PNG/PDF."));
    }, IMAGE_LOAD_TIMEOUT_MS);

    image.onload = () => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      reject(new Error("Unable to read this photo. Retake it or choose JPG/PNG/PDF."));
    };
    image.src = url;
  });
}

function canvasToJpegBlob(canvas, quality) {
  return withTimeout(
    new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("Unable to compress this photo. Retake it or choose a smaller JPG/PNG file."));
          return;
        }
        resolve(blob);
      }, "image/jpeg", quality);
    }),
    CANVAS_BLOB_TIMEOUT_MS,
    "Compressing this photo timed out. Retake it or choose a smaller JPG/PNG/PDF.",
  );
}

async function compressImageFile(file) {
  const image = await loadImageFromFile(file);
  const scale = Math.min(
    1,
    MAX_IMAGE_DIMENSION / Math.max(image.width, image.height, 1),
  );
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Unable to compress this photo in the browser.");

  context.drawImage(image, 0, 0, width, height);

  let quality = 0.88;
  let blob = await canvasToJpegBlob(canvas, quality);
  while (blob.size > MAX_UPLOAD_BYTES && quality > 0.45) {
    quality -= 0.08;
    blob = await canvasToJpegBlob(canvas, quality);
  }

  if (blob.size > MAX_UPLOAD_BYTES) {
    throw new Error("Photo is still too large after compression. Retake the photo closer or use PDF.");
  }

  const baseName = String(file.name || "upload").replace(/\.[^.]+$/, "") || "upload";
  return new File([blob], `${baseName}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
}

export async function prepareUploadFile(file) {
  if (!file || typeof File === "undefined" || !(file instanceof Blob)) return file;

  const headerBuffer = await readUploadHeader(file);
  const mime = String(file.type || "").toLowerCase();
  const name = String(file.name || "").toLowerCase();
  const resolvedType = resolveUploadContentType(
    { name: file.name, type: file.type },
    headerBuffer,
  );

  if (resolvedType === "application/pdf" || mime === "application/pdf" || name.endsWith(".pdf")) {
    if (file.size > 10 * 1024 * 1024) {
      throw new Error("PDF file is too large. Choose a file under 10 MB, or upload a JPG/PNG photo of the certificate.");
    }
    return ensureNamedUploadFile(file, "receipt-copy.pdf", headerBuffer);
  }

  if (!mime.startsWith("image/") && resolvedType !== "image/jpeg" && resolvedType !== "image/png" && resolvedType !== "image/webp") {
    return ensureNamedUploadFile(file, "attachment.jpg", headerBuffer);
  }

  if (file.size <= MAX_UPLOAD_BYTES && !mime.includes("heic") && !mime.includes("heif") && !resolvedType.includes("heic") && !resolvedType.includes("heif")) {
    return ensureNamedUploadFile(file, "attachment.jpg", headerBuffer);
  }

  try {
    return await compressImageFile(file);
  } catch (error) {
    // Some Android WebViews never fire Image onload/onerror for camera HEIC/JPEG.
    // Fall back to the original bytes when storage can still accept them.
    if (Number(file.size || 0) > 0 && Number(file.size || 0) <= MAX_STORAGE_UPLOAD_BYTES) {
      return ensureNamedUploadFile(file, "attachment.jpg", headerBuffer);
    }
    throw error;
  }
}
