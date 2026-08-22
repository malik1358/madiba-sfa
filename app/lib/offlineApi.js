import {
  enqueueOfflineRequest,
  formDataToOfflinePayload,
  isOfflineLikeError,
  processOfflineQueue,
} from "./offlineSyncQueue.js";

const ONLINE_PROBE_TIMEOUT_MS = 4000;

async function fetchWithTimeout(url, options = {}, timeoutMs = ONLINE_PROBE_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
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
    });
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
    if (!isOfflineLikeError(error)) {
      throw error;
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
