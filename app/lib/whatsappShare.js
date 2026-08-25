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
