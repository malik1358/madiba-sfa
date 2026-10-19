const SYNC_DB_NAME = "madiba-sfa-sync";
const SYNC_DB_VERSION = 1;
const QUEUE_STORE = "sync_queue";
const BLOB_STORE = "sync_blobs";

let syncDbPromise = null;

function hasIndexedDb() {
  return typeof indexedDB !== "undefined";
}

function openSyncDb() {
  if (!hasIndexedDb()) {
    return Promise.reject(new Error("IndexedDB unavailable"));
  }

  if (!syncDbPromise) {
    syncDbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(SYNC_DB_NAME, SYNC_DB_VERSION);
      request.onerror = () => reject(request.error || new Error("Unable to open sync IndexedDB"));
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(QUEUE_STORE)) {
          const store = db.createObjectStore(QUEUE_STORE, { keyPath: "id" });
          store.createIndex("createdAt", "createdAt", { unique: false });
          store.createIndex("status", "status", { unique: false });
        }
        if (!db.objectStoreNames.contains(BLOB_STORE)) {
          db.createObjectStore(BLOB_STORE, { keyPath: "id" });
        }
      };
    });
  }

  return syncDbPromise;
}

function runTransaction(storeName, mode, handler) {
  return openSyncDb().then((db) => new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    handler(store, resolve, reject);
    transaction.onerror = () => reject(transaction.error);
  }));
}

function createQueueId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `sync-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function isOfflineLikeError(error) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const message = String(error?.message || error || "").toLowerCase();
  return message.includes("failed to fetch")
    || message.includes("network")
    || message.includes("load failed")
    || message.includes("networkerror")
    || message.includes("timed out")
    || message.includes("timeout")
    || message.includes("abort");
}

async function storeBlobParts(files = []) {
  const storedFiles = [];

  for (const file of files) {
    const blobId = createQueueId();
    await runTransaction(BLOB_STORE, "readwrite", (store, resolve, reject) => {
      const request = store.put({
        id: blobId,
        buffer: file.buffer,
        mimeType: file.mimeType,
        fileName: file.fileName,
      });
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });

    storedFiles.push({
      name: file.name,
      blobId,
      fileName: file.fileName,
      mimeType: file.mimeType,
    });
  }

  return storedFiles;
}

async function readBlobPart(blobId) {
  return runTransaction(BLOB_STORE, "readonly", (store, resolve, reject) => {
    const request = store.get(blobId);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function deleteBlobParts(blobIds = []) {
  for (const blobId of blobIds) {
    await runTransaction(BLOB_STORE, "readwrite", (store, resolve, reject) => {
      const request = store.delete(blobId);
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }
}

export async function enqueueOfflineRequest(entry) {
  const id = entry.id || createQueueId();
  const storedFiles = await storeBlobParts(entry.files || []);
  const queueItem = {
    id,
    url: entry.url,
    method: entry.method || "POST",
    headers: entry.headers || {},
    bodyType: entry.bodyType || "form",
    fields: entry.fields || {},
    jsonBody: entry.jsonBody || null,
    files: storedFiles,
    metadata: entry.metadata || {},
    status: "pending",
    attempts: 0,
    lastError: "",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  await runTransaction(QUEUE_STORE, "readwrite", (store, resolve, reject) => {
    const request = store.put(queueItem);
    request.onsuccess = () => resolve(queueItem);
    request.onerror = () => reject(request.error);
  });

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("madiba-offline-queue-changed"));
  }

  return queueItem;
}

export async function listOfflineQueue(status = "pending") {
  return runTransaction(QUEUE_STORE, "readonly", (store, resolve, reject) => {
    const request = store.index("status").getAll(status);
    request.onsuccess = () => {
      const rows = Array.isArray(request.result) ? request.result : [];
      resolve(rows.sort((left, right) => left.createdAt - right.createdAt));
    };
    request.onerror = () => reject(request.error);
  });
}

export async function countPendingOfflineQueue() {
  const rows = await listOfflineQueue("pending");
  return rows.length;
}

async function markQueueItem(item, patch) {
  const next = {
    ...item,
    ...patch,
    updatedAt: Date.now(),
  };

  await runTransaction(QUEUE_STORE, "readwrite", (store, resolve, reject) => {
    const request = store.put(next);
    request.onsuccess = () => resolve(next);
    request.onerror = () => reject(request.error);
  });

  return next;
}

async function removeQueueItem(item) {
  await deleteBlobParts((item.files || []).map((file) => file.blobId));
  await runTransaction(QUEUE_STORE, "readwrite", (store, resolve, reject) => {
    const request = store.delete(item.id);
    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
  });

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("madiba-offline-queue-changed"));
  }
}

async function rebuildFormData(item) {
  const formData = new FormData();
  Object.entries(item.fields || {}).forEach(([key, value]) => {
    formData.append(key, String(value ?? ""));
  });

  for (const file of item.files || []) {
    const stored = await readBlobPart(file.blobId);
    if (!stored?.buffer) continue;
    const blob = new Blob([stored.buffer], { type: stored.mimeType || file.mimeType || "application/octet-stream" });
    formData.append(file.name, blob, stored.fileName || file.fileName || `${file.name}.bin`);
  }

  return formData;
}

import { SYNC_UPLOAD_TIMEOUT_MS } from "./offlineSyncQueueConstants.js";

async function fetchWithSyncTimeout(url, options = {}, timeoutMs = SYNC_UPLOAD_TIMEOUT_MS) {
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

export async function processOfflineQueue(getAccessToken, options = {}) {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { processed: 0, failed: 0, pending: await countPendingOfflineQueue() };
  }

  const accessToken = await getAccessToken?.();
  if (!accessToken) {
    return { processed: 0, failed: 0, pending: await countPendingOfflineQueue(), skipped: true };
  }

  const pending = await listOfflineQueue("pending");
  let processed = 0;
  let failed = 0;

  for (const item of pending) {
    try {
      const headers = {
        ...(item.headers || {}),
        Authorization: `Bearer ${accessToken}`,
      };

      let response;
      if (item.bodyType === "json") {
        response = await fetchWithSyncTimeout(item.url, {
          method: item.method || "POST",
          headers: {
            ...headers,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(item.jsonBody || {}),
        });
      } else {
        const body = await rebuildFormData(item);
        response = await fetchWithSyncTimeout(item.url, {
          method: item.method || "POST",
          headers,
          body,
        });
      }

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.success === false) {
        throw new Error(payload.error || `Sync failed (${response.status})`);
      }

      await removeQueueItem(item);
      options.onSynced?.(item, payload);
      processed += 1;
    } catch (error) {
      failed += 1;
      await markQueueItem(item, {
        attempts: Number(item.attempts || 0) + 1,
        lastError: String(error?.message || error || "Sync failed"),
        status: Number(item.attempts || 0) >= 4 ? "failed" : "pending",
      });
    }
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("madiba-offline-queue-changed"));
  }

  return {
    processed,
    failed,
    pending: await countPendingOfflineQueue(),
  };
}

export async function formDataToOfflinePayload(formData) {
  const fields = {};
  const files = [];

  for (const [key, value] of formData.entries()) {
    if (value instanceof Blob && "name" in value && value.name) {
      const buffer = await value.arrayBuffer();
      files.push({
        name: key,
        fileName: value.name,
        mimeType: value.type || "application/octet-stream",
        buffer,
      });
    } else {
      fields[key] = String(value ?? "");
    }
  }

  return { fields, files };
}
