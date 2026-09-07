import {
  enqueueOfflineRequest,
  formDataToOfflinePayload,
  isOfflineLikeError,
  processOfflineQueue,
} from "./offlineSyncQueue.js";

const ONLINE_PROBE_TIMEOUT_MS = 4000;
const FORM_UPLOAD_TIMEOUT_MS = 90000;

function isFetchAbortError(error) {
  if (!error) return false;
  if (error.name === "AbortError") return true;
  const message = String(error?.message || "").toLowerCase();
  return message.includes("aborted") || message.includes("abort");
}

function toFriendlyFetchError(error, fallback = "Request failed.") {
  if (isFetchAbortError(error)) {
    return new Error("Request timed out. Please check your connection and try again.");
  }
  return error instanceof Error ? error : new Error(fallback);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = ONLINE_PROBE_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } catch (error) {
    throw toFriendlyFetchError(error);
  } finally {
    clearTimeout(timer);
  }
}

function accessTokenFromHeaders(headers = {}) {
  const authorization = String(headers.Authorization || headers.authorization || "").trim();
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || "";
}

function kickBackgroundSync(headers = {}) {
  const accessToken = accessTokenFromHeaders(headers);
  Promise.resolve()
    .then(() => processOfflineQueue(async () => accessToken))
    .catch(() => undefined);
}

export async function postFormDataResilient({
  url,
  formData,
  headers = {},
  metadata = {},
  onQueued,
  timeoutMs = FORM_UPLOAD_TIMEOUT_MS,
  queueOnTimeout = true,
  queueFirst = false,
}) {
  const payload = await formDataToOfflinePayload(formData);

  async function queueForSync() {
    const queued = await enqueueOfflineRequest({
      url,
      method: "POST",
      headers,
      bodyType: "form",
      fields: payload.fields,
      files: payload.files,
      metadata,
    });
    onQueued?.(queued);
    kickBackgroundSync(headers);
    return {
      success: true,
      queued: true,
      offline: typeof navigator !== "undefined" && navigator.onLine === false,
      queueId: queued.id,
      message: "Saved on this device. Syncing to the server in the background.",
    };
  }

  if (queueFirst || (typeof navigator !== "undefined" && !navigator.onLine)) {
    return queueForSync();
  }

  try {
    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers,
      body: formData,
    }, timeoutMs);
    const body = await response.json().catch(() => ({}));

    if (!response.ok || body.success === false) {
      throw new Error(body.error || `Request failed (${response.status})`);
    }

    return {
      success: true,
      queued: false,
      offline: false,
      payload: body,
    };
  } catch (error) {
    if (queueOnTimeout && isFetchAbortError(error)) {
      return queueForSync();
    }

    if (!isOfflineLikeError(error)) {
      throw error;
    }

    return queueForSync();
  }
}

export async function sendJsonResilient({
  url,
  method = "POST",
  jsonBody,
  headers = {},
  metadata = {},
  onQueued,
  queueFirst = false,
  timeoutMs = ONLINE_PROBE_TIMEOUT_MS,
}) {
  async function queueForSync() {
    const queued = await enqueueOfflineRequest({
      url,
      method,
      headers,
      bodyType: "json",
      jsonBody,
      metadata,
    });
    onQueued?.(queued);
    kickBackgroundSync(headers);
    return {
      success: true,
      queued: true,
      offline: typeof navigator !== "undefined" && navigator.onLine === false,
      queueId: queued.id,
      message: "Saved on this device. Syncing to the server in the background.",
    };
  }

  if (queueFirst || (typeof navigator !== "undefined" && navigator.onLine === false)) {
    return queueForSync();
  }

  try {
    const response = await fetchWithTimeout(url, {
      method,
      headers: {
        ...headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(jsonBody || {}),
    }, timeoutMs);
    const body = await response.json().catch(() => ({}));

    if (!response.ok || body.success === false) {
      throw new Error(body.error || `Request failed (${response.status})`);
    }

    return {
      success: true,
      queued: false,
      offline: false,
      payload: body,
    };
  } catch (error) {
    if (!isOfflineLikeError(error) && !isFetchAbortError(error)) {
      throw error;
    }

    if (isFetchAbortError(error) && typeof navigator !== "undefined" && navigator.onLine && !queueFirst) {
      throw toFriendlyFetchError(error);
    }

    return queueForSync();
  }
}

export async function postJsonResilient(options = {}) {
  return sendJsonResilient({ ...options, method: options.method || "POST" });
}

export { processOfflineQueue };
