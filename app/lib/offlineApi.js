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

export async function postFormDataResilient({
  url,
  formData,
  headers = {},
  metadata = {},
  onQueued,
  timeoutMs = FORM_UPLOAD_TIMEOUT_MS,
}) {
  const payload = await formDataToOfflinePayload(formData);

  if (typeof navigator !== "undefined" && !navigator.onLine) {
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
    return {
      success: true,
      queued: true,
      offline: true,
      queueId: queued.id,
      message: "Saved on device. It will sync automatically when you are back online.",
    };
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
    if (!isOfflineLikeError(error)) {
      throw error;
    }

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
    return {
      success: true,
      queued: true,
      offline: true,
      queueId: queued.id,
      message: "Saved on device. It will sync automatically when you are back online.",
    };
  }
}

export async function postJsonResilient({
  url,
  jsonBody,
  headers = {},
  metadata = {},
  onQueued,
  timeoutMs = ONLINE_PROBE_TIMEOUT_MS,
}) {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    const queued = await enqueueOfflineRequest({
      url,
      method: "POST",
      headers,
      bodyType: "json",
      jsonBody,
      metadata,
    });
    onQueued?.(queued);
    return {
      success: true,
      queued: true,
      offline: true,
      queueId: queued.id,
      message: "Saved on device. It will sync automatically when you are back online.",
    };
  }

  try {
    const response = await fetchWithTimeout(url, {
      method: "POST",
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

    if (isFetchAbortError(error) && typeof navigator !== "undefined" && navigator.onLine) {
      throw toFriendlyFetchError(error);
    }

    const queued = await enqueueOfflineRequest({
      url,
      method: "POST",
      headers,
      bodyType: "json",
      jsonBody,
      metadata,
    });
    onQueued?.(queued);
    return {
      success: true,
      queued: true,
      offline: true,
      queueId: queued.id,
      message: "Saved on device. It will sync automatically when you are back online.",
    };
  }
}

export { processOfflineQueue };
