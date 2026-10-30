/** Browser-side OCR for Import Collection Remarks (avoids Vercel serverless Tesseract failures). */

const MAX_OCR_EDGE = 2200;

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Unable to open the selected image."));
    };
    image.src = url;
  });
}

async function downscaleImageForOcr(file) {
  if (typeof document === "undefined") return file;
  try {
    const image = await loadImageFromFile(file);
    const longest = Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height);
    const scale = longest > MAX_OCR_EDGE ? MAX_OCR_EDGE / longest : 1;
    const width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
    const height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png", 0.92));
    if (!blob) return file;
    return blob;
  } catch {
    return file;
  }
}

/**
 * OCR an image File/Blob in the browser with tesseract.js.
 * Returns plain text (may be empty).
 */
export async function ocrCollectionRemarkImageInBrowser(file, { onProgress } = {}) {
  if (!file) return "";
  const prepared = await downscaleImageForOcr(file);
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng", 1, {
    logger: (message) => {
      if (typeof onProgress === "function" && message?.status === "recognizing text") {
        const progress = Number(message.progress);
        if (Number.isFinite(progress)) onProgress(progress);
      }
    },
  });
  try {
    const result = await worker.recognize(prepared);
    return String(result?.data?.text || "").trim();
  } finally {
    try {
      await worker.terminate();
    } catch {
      // ignore
    }
  }
}
