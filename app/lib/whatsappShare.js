import { wrapShareText } from "./catalogueShareCard.js";
import { normalizeWhatsappNumber } from "./paymentCollections.js";

export function buildWhatsappShareUrl(text, phoneNumber = "") {
  const message = String(text || "").trim();
  if (!message) return "";

  const encoded = encodeURIComponent(message);
  const normalizedPhone = normalizeWhatsappNumber(phoneNumber);
  if (normalizedPhone) {
    return `https://wa.me/${normalizedPhone}?text=${encoded}`;
  }

  return `https://api.whatsapp.com/send?text=${encoded}`;
}

export function buildWhatsappAppUrl(text) {
  const message = String(text || "").trim();
  if (!message) return "";
  return `whatsapp://send?text=${encodeURIComponent(message)}`;
}

function openUrlWithoutLeaving(url) {
  if (!url || typeof window === "undefined") {
    return { success: false, reason: "unavailable" };
  }

  try {
    const opened = window.open(url, "_blank");
    if (opened) {
      return { success: true, method: "whatsapp-url" };
    }
  } catch {
    // Fall through to an anchor click, which iOS allows from a tap.
  }

  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    return { success: true, method: "whatsapp-url" };
  } catch {
    return { success: false, reason: "unavailable" };
  }
}

export function openWhatsappDirect(text, options = {}) {
  const message = String(text || "").trim();
  if (!message) {
    return { success: false, reason: "empty" };
  }
  if (typeof window === "undefined") {
    return { success: false, reason: "unavailable" };
  }

  const phoneNumber = options.shareComposerOnly
    ? ""
    : String(options.phoneNumber || process.env.NEXT_PUBLIC_COLLECTION_WHATSAPP_NUMBER || "").trim();
  const appUrl = buildWhatsappAppUrl(message);
  const webUrl = buildWhatsappShareUrl(message, phoneNumber);
  const launched = openUrlWithoutLeaving(appUrl);
  if (launched.success) {
    return launched;
  }
  return openUrlWithoutLeaving(webUrl);
}

export async function isNativeMobilePlatform() {
  if (typeof window === "undefined") return false;

  try {
    const { Capacitor } = await import("@capacitor/core");
    const platform = Capacitor.getPlatform();
    return Capacitor.isNativePlatform() && (platform === "android" || platform === "ios");
  } catch {
    return false;
  }
}

export function toWhatsappShareFile(file, fallbackName = "attachment.jpg") {
  if (!(file instanceof Blob)) return null;
  if (typeof File !== "undefined" && file instanceof File && String(file.name || "").trim()) {
    return file;
  }

  const type = String(file.type || "image/jpeg").trim() || "image/jpeg";
  const ext = type.includes("pdf") ? "pdf" : type.includes("png") ? "png" : "jpg";
  const rawName = String(file.name || fallbackName || `attachment.${ext}`).trim() || `attachment.${ext}`;
  const name = rawName.replace(/[^\w.-]+/g, "_");
  if (typeof File === "undefined") return file;
  return new File([file], name, { type, lastModified: Date.now() });
}

function normalizeShareFiles(files = []) {
  return (files || [])
    .map((file, index) => toWhatsappShareFile(file, `attachment-${index + 1}.jpg`))
    .filter(Boolean);
}

export function shouldOmitWebShareText(userAgent = "") {
  return /android/i.test(String(userAgent || ""));
}

export function whatsappCacheFileName(file, index = 0) {
  const type = String(file?.type || "").toLowerCase();
  const name = String(file?.name || "").toLowerCase();
  const ext = type.includes("pdf") || name.endsWith(".pdf")
    ? "pdf"
    : type.includes("png") || name.endsWith(".png")
      ? "png"
      : type.includes("webp") || name.endsWith(".webp")
        ? "webp"
        : "jpg";
  return `attachment-${index + 1}.${ext}`;
}

function isWhatsappImageFile(file) {
  const type = String(file?.type || "").toLowerCase();
  const name = String(file?.name || "").toLowerCase();
  return type.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif)$/.test(name);
}

function bytesToBase64(bytes) {
  const chunkSize = 0x8000;
  let binary = "";
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const slice = bytes.subarray(index, Math.min(index + chunkSize, bytes.length));
    binary += String.fromCharCode.apply(null, Array.from(slice));
  }
  return btoa(binary);
}

async function blobToBase64(blob) {
  if (typeof FileReader !== "undefined") {
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(reader.error || new Error("file-read-failed"));
        reader.readAsDataURL(blob);
      });
      const comma = dataUrl.indexOf(",");
      const encoded = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
      if (encoded) return encoded;
    } catch {
      // Fall through to the chunked encoder.
    }
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());
  return bytesToBase64(bytes);
}

function loadShareImage(file) {
  return new Promise((resolve, reject) => {
    if (typeof Image === "undefined" || typeof URL === "undefined") {
      reject(new Error("image-unavailable"));
      return;
    }
    const url = URL.createObjectURL(file);
    const image = new Image();
    const timer = setTimeout(() => {
      URL.revokeObjectURL(url);
      reject(new Error("image-load-timeout"));
    }, 8000);
    image.onload = () => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      reject(new Error("image-load-failed"));
    };
    image.src = url;
  });
}

const SUMMARY_FONT_FAMILY = '"Segoe UI", "Noto Naskh Arabic", "Noto Sans Arabic", Tahoma, Arial, sans-serif';
const SUMMARY_LINE_HEIGHT = 34;
const SUMMARY_FONT_SIZE = 28;
const SUMMARY_SIDE_PAD = 36;
const SUMMARY_TOP_PAD = 28;
const SUMMARY_MAX_LINES = 48;
const SHARE_IMAGE_MAX_WIDTH = 1400;
const SHARE_IMAGE_MAX_HEIGHT = 6000;

export function wrapWhatsappSummaryLines(text, maxWidth, measure) {
  const width = Number(maxWidth);
  const paragraphs = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const lines = [];
  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trimEnd();
    if (!trimmed.trim()) {
      lines.push("");
      continue;
    }
    const wrapped = wrapShareText(trimmed.trim(), width, measure);
    if (wrapped.length) lines.push(...wrapped);
    else lines.push(trimmed.trim());
  }
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function canvasToJpegFile(canvas, fileName) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        resolve(null);
        return;
      }
      resolve(new File([blob], fileName, {
        type: "image/jpeg",
        lastModified: Date.now(),
      }));
    }, "image/jpeg", 0.84);
  });
}

async function stackShareImages(files, {
  document: doc = globalThis.document,
  loadImage = loadShareImage,
  maxWidth = SHARE_IMAGE_MAX_WIDTH,
  maxHeight = SHARE_IMAGE_MAX_HEIGHT,
  gap = 12,
} = {}) {
  if (!doc?.createElement || !files?.length) return null;
  const images = [];
  for (const file of files) {
    images.push(await loadImage(file));
  }

  const targetWidth = Math.max(
    1,
    ...images.map((image) => Math.min(maxWidth, image.width || maxWidth)),
  );
  const heights = images.map((image) => {
    const scale = targetWidth / Math.max(image.width || targetWidth, 1);
    return Math.max(1, Math.round((image.height || targetWidth) * scale));
  });
  let totalHeight = heights.reduce((sum, height) => sum + height, 0) + gap * Math.max(0, images.length - 1);
  let scaleDown = 1;
  if (totalHeight > maxHeight) {
    scaleDown = maxHeight / totalHeight;
    totalHeight = maxHeight;
  }

  const canvas = doc.createElement("canvas");
  canvas.width = Math.max(1, Math.round(targetWidth * scaleDown));
  canvas.height = Math.max(1, Math.round(totalHeight));
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);

  let offsetY = 0;
  images.forEach((image, index) => {
    const height = Math.max(1, Math.round(heights[index] * scaleDown));
    context.drawImage(image, 0, offsetY, canvas.width, height);
    offsetY += height + Math.round(gap * scaleDown);
  });

  return { canvas, context, width: canvas.width, height: canvas.height };
}

async function combineImageFilesForWhatsapp(files, options = {}) {
  if (files.length < 2) return files[0] || null;
  try {
    const stacked = await stackShareImages(files, options);
    if (!stacked?.canvas) return null;
    return canvasToJpegFile(stacked.canvas, "collection-attachments.jpg");
  } catch {
    return null;
  }
}

/**
 * Build one JPEG with receipt/payment photos and the visit summary underneath.
 * Android WhatsApp often drops either the file or the caption when both are
 * shared separately; embedding the summary keeps them in one message.
 */
export async function buildReceiptSummaryShareImage(files, summaryText, options = {}) {
  const message = String(summaryText || "").trim();
  const imageFiles = normalizeShareFiles(files).filter(isWhatsappImageFile);
  if (!message || imageFiles.length === 0) return null;

  const doc = options.document || globalThis.document;
  if (!doc?.createElement) return null;

  try {
    const stacked = await stackShareImages(imageFiles, {
      document: doc,
      loadImage: options.loadImage || loadShareImage,
      maxWidth: options.maxWidth || SHARE_IMAGE_MAX_WIDTH,
      maxHeight: Math.max(1200, (options.maxHeight || SHARE_IMAGE_MAX_HEIGHT) - 800),
      gap: 12,
    });
    if (!stacked?.canvas) return null;

    const measureCanvas = doc.createElement("canvas");
    const measure = measureCanvas.getContext("2d");
    if (!measure) return null;
    measure.font = `500 ${SUMMARY_FONT_SIZE}px ${SUMMARY_FONT_FAMILY}`;
    const textWidth = Math.max(120, stacked.width - SUMMARY_SIDE_PAD * 2);
    let lines = wrapWhatsappSummaryLines(message, textWidth, (value) => measure.measureText(value).width);
    if (lines.length > SUMMARY_MAX_LINES) {
      lines = lines.slice(0, SUMMARY_MAX_LINES);
      lines[SUMMARY_MAX_LINES - 1] = `${String(lines[SUMMARY_MAX_LINES - 1] || "").replace(/[.\s…]+$/g, "")}…`;
    }

    const footerHeight = SUMMARY_TOP_PAD
      + (lines.length * SUMMARY_LINE_HEIGHT)
      + SUMMARY_TOP_PAD;
    const canvas = doc.createElement("canvas");
    canvas.width = stacked.width;
    canvas.height = stacked.height + footerHeight;
    const context = canvas.getContext("2d");
    if (!context) return null;

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(stacked.canvas, 0, 0);
    context.fillStyle = "#0f4c5c";
    context.fillRect(0, stacked.height, canvas.width, footerHeight);
    context.fillStyle = "#ffffff";
    context.font = `500 ${SUMMARY_FONT_SIZE}px ${SUMMARY_FONT_FAMILY}`;
    context.textAlign = "left";
    context.textBaseline = "top";
    context.direction = "ltr";
    let y = stacked.height + SUMMARY_TOP_PAD;
    for (const line of lines) {
      if (line) context.fillText(line, SUMMARY_SIDE_PAD, y);
      y += SUMMARY_LINE_HEIGHT;
    }

    return canvasToJpegFile(canvas, "collection-receipt-summary.jpg");
  } catch {
    return null;
  }
}

async function filesForNativeWhatsappShare(files) {
  if (files.length <= 1 || !files.every(isWhatsappImageFile)) return files;
  try {
    const combined = await combineImageFilesForWhatsapp(files);
    return combined ? [combined] : files;
  } catch {
    return files;
  }
}

/**
 * Share the receipt photo as an image and the visit summary as text.
 * Several photos are stacked into one JPEG so Android WhatsApp does not drop them.
 */
export async function prepareWhatsappAttachmentShare(text, files = []) {
  const message = String(text || "").trim();
  const shareFiles = normalizeShareFiles(files);

  return {
    message,
    files: shareFiles.length <= 1 ? shareFiles : await filesForNativeWhatsappShare(shareFiles),
    embeddedSummary: false,
    textCopied: false,
  };
}

async function canUseNativeFileShare() {
  if (!(await isNativeMobilePlatform())) return false;

  try {
    const { Capacitor } = await import("@capacitor/core");
    return Capacitor.isPluginAvailable("Filesystem") && Capacitor.isPluginAvailable("Share");
  } catch {
    return false;
  }
}

async function shareFilesViaCapacitor(files, text, dialogTitle, title) {
  const { Filesystem, Directory } = await import("@capacitor/filesystem");
  const { Share } = await import("@capacitor/share");
  const uris = [];

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const fileName = whatsappCacheFileName(file, index);
    const path = `whatsapp-share/${Date.now()}-${fileName}`;
    const written = await Filesystem.writeFile({
      path,
      data: await blobToBase64(file),
      directory: Directory.Cache,
      recursive: true,
    });
    let uri = String(written?.uri || "");
    if (!uri.startsWith("file:")) {
      const located = await Filesystem.getUri({
        path,
        directory: Directory.Cache,
      });
      uri = String(located?.uri || "");
    }
    if (!uri.startsWith("file:")) {
      throw new Error("share-uri-unavailable");
    }
    uris.push(uri);
  }

  const shareText = String(text || "").trim();
  await Share.share({
    title: String(title || "Collection visit").trim(),
    ...(shareText ? { text: shareText } : {}),
    dialogTitle,
    files: uris,
  });
}

async function sharePreparedFilesOnWeb(files, { title, message, includeText }) {
  const payload = {
    title,
    files,
  };
  if (includeText && message) payload.text = message;

  if (typeof navigator.canShare === "function") {
    let filesOk = false;
    let payloadOk = false;
    try {
      filesOk = navigator.canShare({ files });
    } catch {
      filesOk = false;
    }
    try {
      payloadOk = navigator.canShare(payload);
    } catch {
      payloadOk = false;
    }
    if (!filesOk && !payloadOk) {
      throw new Error("files-not-supported");
    }
    if (payload.text && filesOk && !payloadOk) {
      delete payload.text;
    }
  }

  await navigator.share(payload);
}

export async function copyTextToClipboard(text) {
  const value = String(text || "").trim();
  if (!value || typeof document === "undefined") return false;

  try {
    if (navigator?.clipboard?.writeText) {
      await Promise.race([
        navigator.clipboard.writeText(value),
        new Promise((_, reject) => {
          window.setTimeout(() => reject(new Error("clipboard timeout")), 1500);
        }),
      ]);
      return true;
    }
  } catch {
    // Fall back to execCommand below.
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "0";
    textarea.style.left = "0";
    textarea.style.width = "1px";
    textarea.style.height = "1px";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.appendChild(textarea);
    textarea.focus({ preventScroll: true });
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    return copied;
  } catch {
    return false;
  }
}

export async function shareTextOnWhatsapp(text, options = {}) {
  const message = String(text || "").trim();
  if (!message) {
    return { success: false, reason: "empty" };
  }

  const phoneNumber = String(options.phoneNumber || process.env.NEXT_PUBLIC_COLLECTION_WHATSAPP_NUMBER || "").trim();
  const dialogTitle = String(options.dialogTitle || "Share collection visit on WhatsApp").trim();
  const preferWhatsappUrl = options.preferWhatsappUrl === true;

  if (!preferWhatsappUrl && typeof navigator !== "undefined" && typeof navigator.share === "function" && options.preferNativeShare !== false) {
    try {
      await navigator.share({
        title: String(options.title || "Collection visit").trim(),
        text: message,
      });
      return { success: true, method: "web-share" };
    } catch (error) {
      if (error?.name === "AbortError") {
        return { success: false, reason: "cancelled" };
      }
    }
  }

  if (!preferWhatsappUrl && await isNativeMobilePlatform()) {
    try {
      const { Capacitor } = await import("@capacitor/core");
      if (!Capacitor.isPluginAvailable("Share")) {
        throw new Error("\"Share\" plugin is not implemented on android");
      }
      const { Share } = await import("@capacitor/share");
      await Share.share({
        text: message,
        dialogTitle,
      });
      return { success: true, method: "capacitor-share" };
    } catch (error) {
      const cancelled = String(error?.message || error || "").toLowerCase().includes("cancel");
      if (cancelled) {
        return { success: false, reason: "cancelled" };
      }
    }
  }

  return openWhatsappDirect(message, { phoneNumber });
}

export async function shareTextAndFilesOnWhatsapp(text, files = [], options = {}) {
  const originalMessage = String(text || "").trim();
  const incomingFiles = normalizeShareFiles(files);

  if (!originalMessage && incomingFiles.length === 0) {
    return { success: false, reason: "empty" };
  }

  if (incomingFiles.length === 0) {
    return shareTextOnWhatsapp(originalMessage, options);
  }

  if (originalMessage) {
    await copyTextToClipboard(originalMessage);
  }

  const dialogTitle = String(options.dialogTitle || "Share receipt and summary on WhatsApp").trim();
  const title = String(options.title || "Collection visit").trim();
  const prepared = await prepareWhatsappAttachmentShare(originalMessage, incomingFiles);
  const shareFiles = prepared.files;
  const shareMessage = prepared.message;

  function cancelledShare(error) {
    return String(error?.name || "") === "AbortError"
      || String(error?.message || error || "").toLowerCase().includes("cancel");
  }

  function successResult(method) {
    return {
      success: true,
      method,
      textCopied: Boolean(originalMessage),
      embeddedSummary: false,
    };
  }

  if (await canUseNativeFileShare()) {
    try {
      await shareFilesViaCapacitor(
        shareFiles,
        shareMessage,
        dialogTitle,
        title,
      );
      return successResult("capacitor-share-files");
    } catch (error) {
      if (cancelledShare(error)) {
        return { success: false, reason: "cancelled" };
      }
      // Missing native Filesystem/Share (outdated APK) falls through to Web Share / WhatsApp URL.
    }
  }

  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await sharePreparedFilesOnWeb(shareFiles, {
        title,
        message: shareMessage,
        includeText: Boolean(shareMessage),
      });
      return successResult("web-share-files");
    } catch (error) {
      if (cancelledShare(error)) {
        return { success: false, reason: "cancelled" };
      }
    }
  }

  // Native/Web Share could not attach files (outdated APK, WebView limits, etc.).
  // Still open WhatsApp with the summary text; callers show the attach-manually hint.
  if (!originalMessage) {
    return { success: false, reason: "files-not-supported" };
  }

  const textResult = await shareTextOnWhatsapp(originalMessage, {
    ...options,
    preferNativeShare: false,
    preferWhatsappUrl: true,
  });

  if (!textResult.success) {
    return textResult;
  }

  return {
    ...textResult,
    fallback: true,
    reason: "files-not-supported",
  };
}
