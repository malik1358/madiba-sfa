import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  buildCollectionVisitReplayResponse,
  createClientSubmissionId,
  findCollectionVisitBySubmissionId,
  isMissingClientSubmissionColumnError,
  isUniqueViolationError,
  parseClientSubmissionId,
} from "../app/lib/collectionSubmission.js";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ---- Minimal persistent IndexedDB stand-in (survives module re-import = app restart) ----
const idbBacking = new Map();

function later(fn) {
  setTimeout(fn, 0);
}

function makeRequest(run) {
  const request = { onsuccess: null, onerror: null, result: undefined, error: null };
  later(() => {
    try {
      request.result = run();
      request.onsuccess?.({ target: request });
    } catch (error) {
      request.error = error;
      request.onerror?.({ target: request });
    }
  });
  return request;
}

function makeStoreApi(storeState) {
  const keyOf = (value) => value[storeState.keyPath];
  return {
    put: (value) => makeRequest(() => {
      storeState.rows.set(keyOf(value), structuredClone(value));
      return keyOf(value);
    }),
    get: (key) => makeRequest(() => structuredClone(storeState.rows.get(key))),
    delete: (key) => makeRequest(() => storeState.rows.delete(key)),
    index: (indexName) => ({
      getAll: (value) => makeRequest(() => [...storeState.rows.values()]
        .filter((row) => row[storeState.indexes.get(indexName)] === value)
        .map((row) => structuredClone(row))),
    }),
    createIndex: (indexName, keyPath) => {
      storeState.indexes.set(indexName, keyPath);
    },
  };
}

function makeDb(dbState) {
  return {
    objectStoreNames: { contains: (name) => dbState.stores.has(name) },
    createObjectStore(name, { keyPath }) {
      const storeState = { keyPath, rows: new Map(), indexes: new Map() };
      dbState.stores.set(name, storeState);
      return makeStoreApi(storeState);
    },
    transaction(storeName) {
      return { onerror: null, objectStore: () => makeStoreApi(dbState.stores.get(storeName)) };
    },
  };
}

globalThis.indexedDB = {
  open(name) {
    const request = { onsuccess: null, onerror: null, onupgradeneeded: null, result: null };
    later(() => {
      const isNew = !idbBacking.has(name);
      if (isNew) idbBacking.set(name, { stores: new Map() });
      request.result = makeDb(idbBacking.get(name));
      if (isNew) request.onupgradeneeded?.({ target: request });
      request.onsuccess?.({ target: request });
    });
    return request;
  },
};

Object.defineProperty(globalThis, "navigator", {
  value: { onLine: true },
  configurable: true,
  writable: true,
});

let restartCount = 0;
async function loadQueueModule() {
  restartCount += 1;
  return import(`../app/lib/offlineSyncQueue.js?restart=${restartCount}`);
}

// ---- Fake /api/payment-collections that follows the route's replay-before-upload order ----
const server = {
  visits: [],
  uploads: 0,
  loseNextResponse: false,
  failNextWithServerError: false,
  requests: [],
};

beforeEach(() => {
  Object.assign(server, {
    visits: [],
    uploads: 0,
    loseNextResponse: false,
    failNextWithServerError: false,
    requests: [],
  });
});

globalThis.fetch = async (url, options = {}) => {
  const body = options.body;
  const submission = parseClientSubmissionId(body.get("clientSubmissionId"));
  server.requests.push({ url, clientSubmissionId: submission.id, files: ["paymentCopy", "receiptCopy"].filter((key) => body.get(key)) });

  if (server.failNextWithServerError) {
    server.failNextWithServerError = false;
    return new Response(JSON.stringify({ success: false, error: "Temporary failure" }), { status: 500 });
  }
  if (!submission.valid) {
    return new Response(JSON.stringify({ success: false, error: "Invalid collection submission id." }), { status: 400 });
  }

  const existing = submission.id
    ? server.visits.find((visit) => visit.client_submission_id === submission.id)
    : null;
  if (existing) {
    return new Response(JSON.stringify(buildCollectionVisitReplayResponse(existing)), { status: 200 });
  }

  for (const key of ["paymentCopy", "receiptCopy"]) {
    if (body.get(key)) server.uploads += 1;
  }
  const visit = {
    id: server.visits.length + 1,
    customer_code: body.get("customerCode"),
    client_submission_id: submission.id || null,
    summary_text: body.get("summaryText") || null,
    visit_number_for_day: 3,
    latitude: 24.7,
    longitude: 46.7,
  };
  server.visits.push(visit);

  if (server.loseNextResponse) {
    server.loseNextResponse = false;
    throw new TypeError("Failed to fetch");
  }
  return new Response(JSON.stringify({ success: true, visitId: visit.id }), { status: 200 });
};

function collectionFormData({ clientSubmissionId, withFiles = false } = {}) {
  const formData = new FormData();
  if (clientSubmissionId !== undefined) formData.append("clientSubmissionId", clientSubmissionId);
  formData.append("customerCode", "1114C");
  formData.append("visitOutcome", "FUNDS_RECEIVED");
  formData.append("summaryText", "summary");
  if (withFiles) {
    formData.append("paymentCopy", new File([new Uint8Array(10)], "payment-copy.jpg", { type: "image/jpeg" }));
    formData.append("receiptCopy", new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], "receipt-copy.pdf", { type: "application/pdf" }));
  }
  return formData;
}

async function enqueue(queue, formData) {
  const payload = await queue.formDataToOfflinePayload(formData);
  return queue.enqueueOfflineRequest({
    url: "/api/payment-collections",
    method: "POST",
    headers: {},
    bodyType: "form",
    fields: payload.fields,
    files: payload.files,
    metadata: { type: "collection_visit", customerCode: "1114C", clientSubmissionId: payload.fields.clientSubmissionId },
  });
}

async function drainQueue(queue) {
  for (const status of ["pending", "failed"]) {
    for (const item of await queue.listOfflineQueue(status)) {
      await queue.processOfflineQueue(async () => "token");
      void item;
    }
  }
}

// ---- Pure helpers ----
test("createClientSubmissionId returns a v4 UUID, with and without crypto.randomUUID", () => {
  assert.match(createClientSubmissionId(), UUID_V4);
  const fallback = createClientSubmissionId({ getRandomValues: (bytes) => bytes.fill(171) });
  assert.match(fallback, UUID_V4);
  assert.notEqual(createClientSubmissionId(), createClientSubmissionId());
});

test("parseClientSubmissionId accepts UUIDs, treats absence as legacy, rejects garbage", () => {
  const id = createClientSubmissionId();
  assert.deepEqual(parseClientSubmissionId(id), { id, valid: true });
  assert.deepEqual(parseClientSubmissionId(id.toUpperCase()), { id, valid: true });
  assert.deepEqual(parseClientSubmissionId(null), { id: "", valid: true });
  assert.deepEqual(parseClientSubmissionId(""), { id: "", valid: true });
  assert.deepEqual(parseClientSubmissionId("sync-123"), { id: "", valid: false });
  assert.deepEqual(parseClientSubmissionId("'; drop table x; --"), { id: "", valid: false });
});

test("unique violation and missing-column detection", () => {
  assert.equal(isUniqueViolationError({ code: "23505" }), true);
  assert.equal(isUniqueViolationError({ message: "duplicate key value violates unique constraint \"collection_visits_client_submission_id_key\"" }), true);
  assert.equal(isUniqueViolationError({ code: "23503" }), false);
  assert.equal(isMissingClientSubmissionColumnError({ code: "42703", message: "column collection_visits.client_submission_id does not exist" }), true);
  assert.equal(isMissingClientSubmissionColumnError({ code: "PGRST204", message: "Could not find the 'client_submission_id' column of 'collection_visits' in the schema cache" }), true);
  assert.equal(isMissingClientSubmissionColumnError({ code: "42703", message: "column collection_visits.summary_text does not exist" }), false);
});

function fakeAdmin(responses) {
  const calls = [];
  return {
    calls,
    from(table) {
      const call = { table, filters: [] };
      calls.push(call);
      const builder = {
        select(columns) { call.columns = columns; return builder; },
        eq(column, value) { call.filters.push([column, value]); return builder; },
        async maybeSingle() { return responses.shift(); },
      };
      return builder;
    },
  };
}

test("findCollectionVisitBySubmissionId scopes the lookup to the caller", async () => {
  const admin = fakeAdmin([{ data: { id: 7, customer_code: "1114C" }, error: null }]);
  const result = await findCollectionVisitBySubmissionId(admin, "abc", "user-1");
  assert.deepEqual(result, { row: { id: 7, customer_code: "1114C" }, supported: true });
  assert.deepEqual(admin.calls[0].filters, [["client_submission_id", "abc"], ["created_by", "user-1"]]);
});

test("findCollectionVisitBySubmissionId is a no-op before the migration is applied", async () => {
  const admin = fakeAdmin([{ data: null, error: { code: "42703", message: "column collection_visits.client_submission_id does not exist" } }]);
  assert.deepEqual(await findCollectionVisitBySubmissionId(admin, "abc", "user-1"), { row: null, supported: false });
});

test("findCollectionVisitBySubmissionId retries with minimal columns when meta columns are missing", async () => {
  const admin = fakeAdmin([
    { data: null, error: { code: "42703", message: "column collection_visits.summary_text does not exist" } },
    { data: { id: 9, customer_code: "1114C", created_by: "user-1" }, error: null },
  ]);
  const result = await findCollectionVisitBySubmissionId(admin, "abc", "user-1");
  assert.equal(result.row.id, 9);
  assert.equal(admin.calls[1].columns, "id,customer_code,created_by");
});

test("findCollectionVisitBySubmissionId surfaces unexpected database errors", async () => {
  const admin = fakeAdmin([{ data: null, error: { code: "57014", message: "statement timeout" } }]);
  await assert.rejects(findCollectionVisitBySubmissionId(admin, "abc", "user-1"), (error) => error.code === "57014");
});

test("findCollectionVisitBySubmissionId skips lookups for legacy requests", async () => {
  const admin = fakeAdmin([]);
  assert.deepEqual(await findCollectionVisitBySubmissionId(admin, "", "user-1"), { row: null, supported: true });
  assert.equal(admin.calls.length, 0);
});

test("replay response matches the normal success shape", () => {
  assert.deepEqual(
    buildCollectionVisitReplayResponse({ id: 12, latitude: 24.1, longitude: 46.2, summary_text: "S", visit_number_for_day: 4 }),
    { success: true, duplicate: true, message: "Collection visit already saved", visitId: 12, gpsCaptured: true, summaryText: "S", visitNumberForDay: 4 },
  );
  assert.equal(buildCollectionVisitReplayResponse({ id: 1, latitude: null, longitude: null }).gpsCaptured, false);
  assert.equal(buildCollectionVisitReplayResponse({ id: 1 }).visitNumberForDay, null);
});

// ---- Offline queue end-to-end with the fake server ----
test("normal online save (queue-first) sends the id once and creates one visit", async () => {
  const queue = await loadQueueModule();
  const id = createClientSubmissionId();
  await enqueue(queue, collectionFormData({ clientSubmissionId: id }));

  const result = await queue.processOfflineQueue(async () => "token");

  assert.equal(result.processed, 1);
  assert.equal(server.visits.length, 1);
  assert.equal(server.visits[0].client_submission_id, id);
  assert.equal(await queue.countPendingOfflineQueue(), 0);
});

test("offline save keeps the id in IndexedDB and syncs once after reconnect", async () => {
  const queue = await loadQueueModule();
  const id = createClientSubmissionId();
  navigator.onLine = false;
  await enqueue(queue, collectionFormData({ clientSubmissionId: id }));
  const offlineResult = await queue.processOfflineQueue(async () => "token");
  assert.equal(offlineResult.processed, 0);
  assert.equal(server.requests.length, 0);

  const [stored] = await queue.listOfflineQueue("pending");
  assert.equal(stored.fields.clientSubmissionId, id);
  assert.equal(stored.metadata.clientSubmissionId, id);

  navigator.onLine = true;
  await queue.processOfflineQueue(async () => "token");
  assert.equal(server.visits.length, 1);
  assert.equal(server.requests[0].clientSubmissionId, id);
});

test("response lost after a successful insert: retry of the same item returns the existing visit", async () => {
  const queue = await loadQueueModule();
  const id = createClientSubmissionId();
  await enqueue(queue, collectionFormData({ clientSubmissionId: id, withFiles: true }));

  server.loseNextResponse = true;
  const first = await queue.processOfflineQueue(async () => "token");
  assert.equal(first.failed, 1);
  assert.equal(server.visits.length, 1);
  assert.equal(server.uploads, 2);
  assert.equal(await queue.countPendingOfflineQueue(), 1);

  const second = await queue.processOfflineQueue(async () => "token");
  assert.equal(second.processed, 1);
  assert.equal(server.visits.length, 1, "retry must not create a second collection_visits row");
  assert.equal(server.uploads, 2, "replay must not upload payment/receipt again");
  assert.deepEqual(server.requests.map((request) => request.clientSubmissionId), [id, id]);
  assert.deepEqual(server.requests[1].files, ["paymentCopy", "receiptCopy"]);
  assert.equal(await queue.countPendingOfflineQueue(), 0);
});

test("app/browser restart before retry keeps the same id", async () => {
  const before = await loadQueueModule();
  const id = createClientSubmissionId();
  await enqueue(before, collectionFormData({ clientSubmissionId: id, withFiles: true }));
  server.loseNextResponse = true;
  await before.processOfflineQueue(async () => "token");

  const afterRestart = await loadQueueModule();
  const [stored] = await afterRestart.listOfflineQueue("pending");
  assert.equal(stored.fields.clientSubmissionId, id);
  assert.equal(stored.attempts, 1);

  await afterRestart.processOfflineQueue(async () => "token");
  assert.equal(server.visits.length, 1);
  assert.deepEqual(server.requests.map((request) => request.clientSubmissionId), [id, id]);
  assert.equal(await afterRestart.countPendingOfflineQueue(), 0);
});

test("server error then retry reuses the same id without duplicating", async () => {
  const queue = await loadQueueModule();
  const id = createClientSubmissionId();
  await enqueue(queue, collectionFormData({ clientSubmissionId: id }));
  server.failNextWithServerError = true;
  await queue.processOfflineQueue(async () => "token");
  await queue.processOfflineQueue(async () => "token");
  assert.equal(server.visits.length, 1);
  assert.deepEqual(server.requests.map((request) => request.clientSubmissionId), [id, id]);
});

test("two queue items with the same id (duplicate submission) still create one visit", async () => {
  const queue = await loadQueueModule();
  const id = createClientSubmissionId();
  await enqueue(queue, collectionFormData({ clientSubmissionId: id }));
  await enqueue(queue, collectionFormData({ clientSubmissionId: id }));
  await drainQueue(queue);
  assert.equal(server.visits.length, 1);
  assert.equal(server.requests.length, 2);
  assert.equal(await queue.countPendingOfflineQueue(), 0);
});

test("old queued item without clientSubmissionId still syncs (legacy behavior)", async () => {
  const queue = await loadQueueModule();
  await enqueue(queue, collectionFormData({ withFiles: true }));
  const result = await queue.processOfflineQueue(async () => "token");
  assert.equal(result.processed, 1);
  assert.equal(server.visits.length, 1);
  assert.equal(server.visits[0].client_submission_id, null);
  assert.equal(server.uploads, 2);
});

// ---- Source guards for the real route/client wiring ----
test("route replays before validation and uploads, and stores client_submission_id", () => {
  const source = fs.readFileSync(new URL("../app/api/payment-collections/route.js", import.meta.url), "utf8");
  const postStart = source.indexOf("export async function POST(");
  const post = source.slice(postStart, source.indexOf("export async function PATCH("));
  const replayAt = post.indexOf("findCollectionVisitBySubmissionId(admin, clientSubmissionId, user.id)");
  assert.ok(replayAt > 0);
  assert.ok(replayAt < post.indexOf("validateNextVisitDate("), "replay must run before next-visit validation");
  assert.ok(replayAt < post.indexOf("getSalesScope(admin, user.id)"), "replay must run before scope rebuild");
  assert.ok(replayAt < post.indexOf('formData.get("receiptCopy")'), "replay must run before uploads");
  assert.match(post, /client_submission_id: clientSubmissionId/);
  assert.match(post, /isUniqueViolationError\(insertError\)/);
  assert.match(post, /isMissingClientSubmissionColumnError\(insertError\)/);
  assert.match(post, /status: 409/);
  assert.equal((post.match(/const admin = createClient\(/g) || []).length, 1);
});

test("collection save generates the id before queueing and sends it as a form field", () => {
  const source = fs.readFileSync(
    new URL("../app/management/payment-collections/PaymentCollectionsView.jsx", import.meta.url),
    "utf8",
  );
  const idAt = source.indexOf("const clientSubmissionId = createClientSubmissionId();");
  assert.ok(idAt > 0);
  assert.ok(idAt < source.search(/url: "\/api\/payment-collections",\s+formData,/));
  assert.match(source, /formData\.append\("clientSubmissionId", clientSubmissionId\);/);
  assert.match(source, /queueFirst: true/);
});

test("migration adds a nullable uuid with a partial unique index", () => {
  const migration = fs.readFileSync(
    new URL("../supabase/migrations/20261002120000_collection_visit_client_submission_id.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /ADD COLUMN IF NOT EXISTS client_submission_id uuid;/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS collection_visits_client_submission_id_key\s+ON public\.collection_visits \(client_submission_id\)\s+WHERE client_submission_id IS NOT NULL;/);
  assert.doesNotMatch(migration, /NOT NULL DEFAULT|SET NOT NULL/);
});
