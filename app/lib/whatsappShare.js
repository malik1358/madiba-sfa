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
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (opened) {
      return { success: true, method: "whatsapp-url" };
    }
  } catch {
    // Fall through to a hidden launch that does not replace MADIBA.
  }

  try {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("hidden", "");
    iframe.src = url;
    document.body.appendChild(iframe);
    window.setTimeout(() => {
      iframe.remove();
    }, 1500);
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

  const phoneNumber = String(options.phoneNumber || process.env.NEXT_PUBLIC_COLLECTION_WHATSAPP_NUMBER || "").trim();
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

async function blobToBase64(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

async function shareFilesViaCapacitor(files, text, dialogTitle, title) {
  const { Filesystem, Directory } = await import("@capacitor/filesystem");
  const { Share } = await import("@capacitor/share");
  const uris = [];

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const fileName = String(file.name || `receipt-${index + 1}.jpg`).replace(/[^\w.-]+/g, "_");
    const path = `whatsapp-share/${Date.now()}-${index}-${fileName}`;
    await Filesystem.writeFile({
      path,
      data: await blobToBase64(file),
      directory: Directory.Cache,
      recursive: true,
    });
    const { uri } = await Filesystem.getUri({
      path,
      directory: Directory.Cache,
    });
    uris.push(uri);
  }

  await Share.share({
    title: String(title || text || "WhatsApp share").trim(),
    text: String(text || "").trim(),
    dialogTitle,
    files: uris,
  });
}

export async function copyTextToClipboard(text) {
  const value = String(text || "").trim();
  if (!value || typeof document === "undefined") return false;

  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
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

  if (await isNativeMobilePlatform()) {
    try {
      await shareFilesViaCapacitor(shareFiles, message, dialogTitle, title);
      return { success: true, method: "capacitor-share-files" };
    } catch (error) {
      const cancelled = String(error?.message || error || "").toLowerCase().includes("cancel");
      if (cancelled) {
        return { success: false, reason: "cancelled" };
      }
    }
  }

  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      const payload = {
        title,
        text: message,
        files: shareFiles,
      };
      if (navigator.canShare && !navigator.canShare({ files: shareFiles }) && !navigator.canShare(payload)) {
        throw new Error("files-not-supported");
      }
      await navigator.share(payload);
      return { success: true, method: "web-share-files" };
    } catch (error) {
      if (error?.name === "AbortError") {
        return { success: false, reason: "cancelled" };
      }
    }
  }

  return { success: false, reason: "files-not-supported" };
}
