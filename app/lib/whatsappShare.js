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

async function combineImageFilesForWhatsapp(files) {
  if (typeof document === "undefined" || files.length < 2) return null;
  const images = [];
  for (const file of files) {
    images.push(await loadShareImage(file));
  }

  const maxWidth = 1400;
  const gap = 12;
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
  const maxHeight = 6000;
  if (totalHeight > maxHeight) {
    scaleDown = maxHeight / totalHeight;
    totalHeight = maxHeight;
  }

  const canvas = document.createElement("canvas");
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

  const blob = await new Promise((resolve) => {
    canvas.toBlob((value) => resolve(value), "image/jpeg", 0.82);
  });
  if (!blob) return null;
  return new File([blob], "collection-attachments.jpg", {
    type: "image/jpeg",
    lastModified: Date.now(),
  });
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
  const message = String(text || "").trim();
  const shareFiles = normalizeShareFiles(files);

  if (!message && shareFiles.length === 0) {
    return { success: false, reason: "empty" };
  }

  if (shareFiles.length === 0) {
    return shareTextOnWhatsapp(message, options);
  }

  if (message) {
    await copyTextToClipboard(message);
  }

  const dialogTitle = String(options.dialogTitle || "Share receipt and summary on WhatsApp").trim();
  const title = String(options.title || "Collection visit").trim();
  const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const omitWebText = shouldOmitWebShareText(userAgent);
  const nativeFiles = await filesForNativeWhatsappShare(shareFiles);

  function cancelledShare(error) {
    return String(error?.name || "") === "AbortError"
      || String(error?.message || error || "").toLowerCase().includes("cancel");
  }

  // Several files make Android's share plugin use */*, and WhatsApp then keeps
  // only the summary. Send those files through the web share sheet first.
  if (
    nativeFiles.length > 1
    && omitWebText
    && typeof navigator !== "undefined"
    && typeof navigator.share === "function"
  ) {
    try {
      await sharePreparedFilesOnWeb(nativeFiles, { title, message, includeText: false });
      return { success: true, method: "web-share-files", textCopied: Boolean(message) };
    } catch (error) {
      if (cancelledShare(error)) {
        return { success: false, reason: "cancelled" };
      }
    }
  }

  if (await canUseNativeFileShare() && (nativeFiles.length === 1 || !omitWebText)) {
    try {
      await shareFilesViaCapacitor(nativeFiles, message, dialogTitle, title);
      return { success: true, method: "capacitor-share-files" };
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
        message,
        includeText: !omitWebText,
      });
      return {
        success: true,
        method: "web-share-files",
        textCopied: omitWebText && Boolean(message),
      };
    } catch (error) {
      if (cancelledShare(error)) {
        return { success: false, reason: "cancelled" };
      }
    }
  }

  // Native/Web Share could not attach files (outdated APK, WebView limits, etc.).
  // Still open WhatsApp with the summary text; callers show the attach-manually hint.
  if (!message) {
    return { success: false, reason: "files-not-supported" };
  }

  const textResult = await shareTextOnWhatsapp(message, {
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
