function sanitizePdfFileName(fileName) {
  const trimmed = String(fileName || "order.pdf").trim();
  const withExt = trimmed.toLowerCase().endsWith(".pdf") ? trimmed : `${trimmed}.pdf`;
  return withExt.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function readPdfBase64(doc) {
  const dataUri = doc.output("datauristring");
  if (typeof dataUri === "string" && dataUri.includes(",")) {
    return dataUri.split(",")[1];
  }
  return arrayBufferToBase64(doc.output("arraybuffer"));
}

export function isMissingNativePluginError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return (
    message.includes("not implemented")
    || message.includes("plugin is not implemented")
    || message.includes("\"filesystem\" plugin")
    || message.includes("\"share\" plugin")
  );
}

export function isShareCancelledError(error) {
  if (error?.name === "AbortError") return true;
  return String(error?.message || error || "").toLowerCase().includes("cancel");
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

export async function canUseNativeFileShare() {
  if (!(await isNativeMobilePlatform())) return false;

  try {
    const { Capacitor } = await import("@capacitor/core");
    return Capacitor.isPluginAvailable("Filesystem") && Capacitor.isPluginAvailable("Share");
  } catch {
    return false;
  }
}

function triggerBrowserDownload(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function saveOrShareViaCapacitor(doc, safeName, options) {
  const { Filesystem, Directory } = await import("@capacitor/filesystem");
  const { Share } = await import("@capacitor/share");

  const path = `orders/${Date.now()}-${safeName}`;
  await Filesystem.writeFile({
    path,
    data: readPdfBase64(doc),
    directory: Directory.Cache,
    recursive: true,
  });

  const { uri } = await Filesystem.getUri({
    path,
    directory: Directory.Cache,
  });

  const canShareFiles = await Share.canShare().catch(() => ({ value: true }));
  if (!canShareFiles?.value) {
    throw new Error("Sharing is not available on this device.");
  }

  await Share.share({
    title: options.title,
    text: options.text,
    dialogTitle: options.dialogTitle,
    files: [uri],
  });

  return { method: "share", fileName: safeName };
}

async function saveOrShareViaBrowser(doc, safeName, options) {
  const blob = doc.output("blob");
  const file = new File([blob], safeName, { type: "application/pdf" });

  if (!options.forceDownload && typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      if (!navigator.canShare || navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: options.title,
          text: options.text,
          files: [file],
        });
        return { method: "share", fileName: safeName };
      }
    } catch (error) {
      if (isShareCancelledError(error)) {
        return { method: "cancelled", fileName: safeName };
      }
    }
  }

  triggerBrowserDownload(blob, safeName);
  return { method: "download", fileName: safeName };
}

export async function saveOrShareOrderPdf(doc, fileName, options = {}) {
  const safeName = sanitizePdfFileName(fileName);
  const shareOptions = {
    title: String(options.title || "MADIBA Sales Order").trim(),
    text: String(options.text || "").trim(),
    dialogTitle: String(options.dialogTitle || "Save or share order PDF").trim(),
    forceDownload: Boolean(options.forceDownload),
  };

  if (await canUseNativeFileShare()) {
    try {
      return await saveOrShareViaCapacitor(doc, safeName, shareOptions);
    } catch (error) {
      if (isShareCancelledError(error)) {
        return { method: "cancelled", fileName: safeName };
      }
      // Outdated APKs or incomplete Cap sync surface "Filesystem/Share plugin is not
      // implemented on android". Fall through to the browser download path instead of
      // blocking the salesman with a hard error dialog.
      if (!isMissingNativePluginError(error) && !String(error?.message || "").includes("Sharing is not available")) {
        // Still fall through for other share/write failures so PDF delivery is not blocked.
      }
    }
  }

  return saveOrShareViaBrowser(doc, safeName, shareOptions);
}

export function buildOrderPdfFileName({ orderId, customerCode, savedAtIso, pendingSync = false }) {
  const safeCustomer = String(customerCode || "customer").replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeDate = String(savedAtIso || new Date().toISOString())
    .slice(0, 19)
    .replace(/[:T]/g, "-");
  return `order-${orderId}${pendingSync ? "-pending-sync" : ""}-${safeCustomer}-${safeDate}.pdf`;
}
