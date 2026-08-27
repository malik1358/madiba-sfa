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

export function openWhatsappDirect(text, options = {}) {
  const message = String(text || "").trim();
  if (!message) {
    return { success: false, reason: "empty" };
  }
  if (typeof window === "undefined") {
    return { success: false, reason: "unavailable" };
  }

  const phoneNumber = String(options.phoneNumber || process.env.NEXT_PUBLIC_COLLECTION_WHATSAPP_NUMBER || "").trim();
  const url = buildWhatsappShareUrl(message, phoneNumber);
  if (!url) {
    return { success: false, reason: "unavailable" };
  }

  window.location.assign(url);
  return { success: true, method: "whatsapp-web" };
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

function isMobileUserAgent() {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");
}

function normalizeShareFiles(files = []) {
  return (files || []).filter((file) => file instanceof Blob);
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

async function shareFilesViaCapacitor(files, text, dialogTitle) {
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

  const url = buildWhatsappShareUrl(message, phoneNumber);
  if (!url || typeof window === "undefined") {
    return { success: false, reason: "unavailable" };
  }

  if (preferWhatsappUrl) {
    return openWhatsappDirect(message, { phoneNumber });
  }

  if (isMobileUserAgent()) {
    window.location.assign(url);
    return { success: true, method: "whatsapp-url" };
  }

  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (!opened) {
    return openWhatsappDirect(message, { phoneNumber });
  }

  return { success: true, method: "whatsapp-url" };
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

  const dialogTitle = String(options.dialogTitle || "Share receipt and summary on WhatsApp").trim();
  const title = String(options.title || "Collection visit").trim();
  const phoneNumber = String(options.phoneNumber || process.env.NEXT_PUBLIC_COLLECTION_WHATSAPP_NUMBER || "").trim();

  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      const payload = {
        title,
        text: message,
      };
      if (!navigator.canShare || navigator.canShare({ ...payload, files: shareFiles })) {
        payload.files = shareFiles;
      }
      await navigator.share(payload);
      return { success: true, method: "web-share-files" };
    } catch (error) {
      if (error?.name === "AbortError") {
        return { success: false, reason: "cancelled" };
      }
    }
  }

  if (await isNativeMobilePlatform()) {
    try {
      await shareFilesViaCapacitor(shareFiles, message, dialogTitle);
      return { success: true, method: "capacitor-share-files" };
    } catch (error) {
      const cancelled = String(error?.message || error || "").toLowerCase().includes("cancel");
      if (cancelled) {
        return { success: false, reason: "cancelled" };
      }
    }
  }

  const textResult = await shareTextOnWhatsapp(message, {
    ...options,
    preferNativeShare: false,
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
