const ATTACHMENT_URL_TIMEOUT_MS = 20000;

export function attachmentUrlPath({ attachmentId = "", legacyKind = "", legacyRef = "", download = false } = {}) {
  const params = new URLSearchParams();
  let id = String(attachmentId || "").trim();
  if (!id) {
    id = "legacy";
    params.set("kind", String(legacyKind || "").trim());
    params.set("ref", String(legacyRef ?? "").trim());
  }
  if (download) params.set("download", "1");
  const query = params.toString();
  return `/api/attachments/${encodeURIComponent(id)}/url${query ? `?${query}` : ""}`;
}

export async function fetchAttachmentUrl({ accessToken, fetchImpl = fetch, ...reference }) {
  if (!accessToken) throw new Error("Please login again.");
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), ATTACHMENT_URL_TIMEOUT_MS) : null;
  try {
    const response = await fetchImpl(attachmentUrlPath(reference), {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
      signal: controller?.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body?.success || !body?.url) {
      throw new Error(body?.error || "Unable to open attachment.");
    }
    return body;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isNativeShell() {
  return typeof window !== "undefined" && Boolean(window.Capacitor?.isNativePlatform?.());
}

function openWithAnchor(url) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}

// Call directly from a click handler: the placeholder tab must open before any await (iOS popup rules).
export async function openAttachment({ getAccessToken, ...reference }) {
  const native = isNativeShell();
  const popup = !native && typeof window !== "undefined" ? window.open("", "_blank") : null;
  if (popup) {
    try {
      popup.document.title = "Opening attachment…";
      popup.document.body.textContent = "Opening attachment…";
    } catch {
      // Some browsers block writing to the placeholder tab; it still navigates below.
    }
  }

  try {
    const accessToken = await getAccessToken?.();
    const { url } = await fetchAttachmentUrl({ accessToken, ...reference });
    if (popup && !popup.closed) {
      popup.opener = null;
      popup.location.replace(url);
      return { opened: true, method: "popup" };
    }
    openWithAnchor(url);
    return { opened: true, method: "anchor" };
  } catch (error) {
    if (popup && !popup.closed) popup.close();
    throw error;
  }
}
