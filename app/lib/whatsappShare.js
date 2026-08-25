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

export async function shareTextOnWhatsapp(text, options = {}) {
  const message = String(text || "").trim();
  if (!message) {
    return { success: false, reason: "empty" };
  }

  const phoneNumber = String(options.phoneNumber || process.env.NEXT_PUBLIC_COLLECTION_WHATSAPP_NUMBER || "").trim();
  const dialogTitle = String(options.dialogTitle || "Share collection visit on WhatsApp").trim();

  if (typeof navigator !== "undefined" && typeof navigator.share === "function" && options.preferNativeShare !== false) {
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

  if (await isNativeMobilePlatform()) {
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

  if (isMobileUserAgent()) {
    window.location.assign(url);
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
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
