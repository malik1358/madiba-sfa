import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";

import { createFakeAdmin } from "./helpers/fakeSupabaseAdmin.mjs";
import {
  ATTACHMENT_BUCKETS,
  ATTACHMENT_CATEGORIES,
  bucketRelativePath,
  buildCollectionCopyKey,
  buildCustomerDocumentKey,
  buildOrderInvoiceKey,
  parseLegacySupabaseUrl,
  splitObjectKey,
} from "../app/lib/storage/attachmentKeys.js";
import {
  ACTIVE_STORAGE_PROVIDER,
  SIGNED_URL_TTL_SECONDS,
  deleteObject,
  getSignedReadUrl,
  headObject,
  putObject,
  resolveStorageProvider,
} from "../app/lib/storage/attachmentStorage.js";
import {
  collectionVisitAttachmentSummary,
  createAttachmentRecord,
  getAttachmentById,
  readOrderInvoiceFile,
  resolveOrderInvoiceObject,
  storeAttachment,
} from "../app/lib/storage/attachmentRecords.js";
import { authorizeAttachmentRead, resolveAttachmentTarget } from "../app/lib/storage/attachmentAccess.js";
import { attachmentUrlPath, fetchAttachmentUrl } from "../app/lib/openAttachment.js";
import { buildOptimisticLatestCollection } from "../app/lib/collectionOffline.js";

const NOW = Date.parse("2026-10-02T09:00:00.000Z");
const SUPABASE_URL = "https://project.supabase.co";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

// ---------- keys ----------
test("collection copy keys keep the existing payment-collections layout", () => {
  assert.equal(
    buildCollectionCopyKey({ kind: "receipt", customerCode: "1114C", extension: "jpg", now: NOW }),
    `payment-collections/receipt-copies/1114C-${NOW}-receipt.jpg`,
  );
  assert.equal(
    buildCollectionCopyKey({ kind: "payment", customerCode: "1114C", extension: ".PDF", now: NOW }),
    `payment-collections/payment-copies/1114C-${NOW}-payment.pdf`,
  );
  assert.throws(() => buildCollectionCopyKey({ kind: "other", customerCode: "X" }), /receipt or payment/);
  assert.throws(() => buildCollectionCopyKey({ kind: "receipt", customerCode: " " }), /Customer code/);
});

test("invoice and customer document keys keep their legacy bucket-relative paths", () => {
  const invoiceKey = buildOrderInvoiceKey({ customerCode: "1114c", orderId: 378, fileName: "Inv #1.pdf", now: NOW });
  assert.equal(invoiceKey, `order-invoices/1114C/378/${NOW}-Inv_1.pdf`);
  assert.equal(bucketRelativePath(invoiceKey, ATTACHMENT_BUCKETS.orderInvoices), `1114C/378/${NOW}-Inv_1.pdf`);

  const documentKey = buildCustomerDocumentKey({ customerCode: "1114C", documentType: "CR", fileName: "cr copy.pdf", now: NOW });
  assert.equal(documentKey, `customer-documents/1114C/CR/${NOW}-cr_copy.pdf`);
  assert.throws(() => bucketRelativePath(documentKey, ATTACHMENT_BUCKETS.orderInvoices), /order-invoices/);
});

test("object keys split into bucket and path and parse historical public URLs", () => {
  assert.deepEqual(splitObjectKey("payment-collections/receipt-copies/a.jpg"), {
    bucket: "payment-collections",
    path: "receipt-copies/a.jpg",
  });
  assert.throws(() => splitObjectKey("no-path"), /bucket and a path/);

  const key = "payment-collections/receipt-copies/1114C-1-receipt.jpg";
  const url = `${SUPABASE_URL}/storage/v1/object/public/${key}`;
  assert.equal(parseLegacySupabaseUrl(url).key, key);
  assert.deepEqual(
    parseLegacySupabaseUrl("http://127.0.0.1:54321/storage/v1/object/public/payment-collections/receipt-copies/A%20B-1-receipt.jpg?x=1"),
    { bucket: "payment-collections", path: "receipt-copies/A B-1-receipt.jpg", key: "payment-collections/receipt-copies/A B-1-receipt.jpg" },
  );
  assert.equal(parseLegacySupabaseUrl("https://elsewhere.example/file.jpg"), null);
});

// ---------- storage facade ----------
test("only the Supabase provider is active in Phase 1", async () => {
  assert.equal(ACTIVE_STORAGE_PROVIDER, "supabase");
  assert.ok(resolveStorageProvider("supabase"));
  assert.throws(() => resolveStorageProvider("r2"), /not available/);
  await assert.rejects(deleteObject(), /not enabled/);
  const source = read("../app/lib/storage/attachmentStorage.js") + read("../app/lib/storage/providers/supabaseProvider.js");
  assert.doesNotMatch(source, /aws4fetch|R2_|r2Provider/);
});

test("putObject uploads without overwrite and returns size and checksums", async () => {
  const admin = createFakeAdmin();
  const bytes = new TextEncoder().encode("receipt-bytes");
  const stored = await putObject(admin, {
    key: "payment-collections/receipt-copies/1114C-1-receipt.jpg",
    body: new Blob([bytes]),
    contentType: "image/jpeg",
  });

  assert.equal(stored.provider, "supabase");
  assert.equal(stored.key, "payment-collections/receipt-copies/1114C-1-receipt.jpg");
  assert.equal(stored.size, bytes.byteLength);
  assert.equal(stored.sha256, createHash("sha256").update(bytes).digest("hex"));
  assert.equal(stored.md5, createHash("md5").update(bytes).digest("hex"));
  assert.deepEqual(admin.calls.uploads[0].options, { contentType: "image/jpeg", upsert: false });
  await assert.rejects(
    putObject(admin, { key: stored.key, body: bytes, contentType: "image/jpeg" }),
    /already exists/,
  );
});

test("signed read URLs default to 300 seconds and are clamped", async () => {
  const admin = createFakeAdmin();
  const signed = await getSignedReadUrl(admin, { key: "order-invoices/1114C/378/x.pdf" });
  assert.equal(SIGNED_URL_TTL_SECONDS, 300);
  assert.equal(signed.expiresIn, 300);
  assert.match(signed.url, /ttl=300$/);
  assert.equal(admin.calls.signed[0].bucket, "order-invoices");
  assert.equal(admin.calls.signed[0].path, "1114C/378/x.pdf");

  const long = await getSignedReadUrl(admin, { key: "order-invoices/a/b.pdf", expiresIn: 60 * 60 * 24 * 30, downloadName: "b.pdf" });
  assert.equal(long.expiresIn, 900);
  assert.deepEqual(admin.calls.signed[1].options, { download: "b.pdf" });
});

test("headObject reports missing objects without throwing", async () => {
  const admin = createFakeAdmin({ objects: { "order-invoices/a/b.pdf": { body: new Uint8Array(5), contentType: "application/pdf" } } });
  assert.deepEqual(await headObject(admin, { key: "order-invoices/a/b.pdf" }), { exists: true, size: 5, contentType: "application/pdf" });
  assert.deepEqual(await headObject(admin, { key: "order-invoices/a/missing.pdf" }), { exists: false });
});

// ---------- records ----------
test("storeAttachment uploads and records receipt, payment, invoice, and document attachments", async () => {
  const admin = createFakeAdmin();
  const cases = [
    { category: ATTACHMENT_CATEGORIES.receiptCopy, key: buildCollectionCopyKey({ kind: "receipt", customerCode: "1114C", now: NOW }) },
    { category: ATTACHMENT_CATEGORIES.paymentCopy, key: buildCollectionCopyKey({ kind: "payment", customerCode: "1114C", now: NOW }) },
    { category: ATTACHMENT_CATEGORIES.orderInvoice, key: buildOrderInvoiceKey({ customerCode: "1114C", orderId: 378, fileName: "i.pdf", now: NOW }), entityType: "sales_order", entityId: 378 },
    { category: ATTACHMENT_CATEGORIES.customerDocument, key: buildCustomerDocumentKey({ customerCode: "1114C", documentType: "CR", fileName: "cr.pdf", now: NOW }) },
  ];

  for (const entry of cases) {
    const result = await storeAttachment(admin, {
      ...entry,
      body: new Uint8Array([1, 2, 3]),
      contentType: "application/pdf",
      originalFileName: "original name.pdf",
      customerCode: "1114C",
      uploadedBy: "user-1",
    });
    assert.ok(result.attachmentId, entry.category);
    assert.equal(result.supported, true);
    const row = admin.data.attachments.find((attachment) => attachment.id === result.attachmentId);
    assert.equal(row.category, entry.category);
    assert.equal(row.storage_provider, "supabase");
    assert.equal(row.object_key, entry.key);
    assert.equal(row.size_bytes, 3);
    assert.equal(row.content_type, "application/pdf");
    assert.equal(row.original_file_name, "original name.pdf");
    assert.equal(row.customer_code, "1114C");
    assert.equal(row.uploaded_by, "user-1");
    assert.equal(row.entity_id, entry.entityId ? String(entry.entityId) : null);
    assert.ok(admin.storage.objects.has(entry.key));
  }
});

test("storeAttachment still uploads when the attachments migration is not applied", async () => {
  const admin = createFakeAdmin({ missingTables: ["attachments"] });
  const result = await storeAttachment(admin, {
    category: ATTACHMENT_CATEGORIES.receiptCopy,
    key: "payment-collections/receipt-copies/X-1-receipt.jpg",
    body: new Uint8Array([1]),
    contentType: "image/jpeg",
  });
  assert.equal(result.attachmentId, null);
  assert.equal(result.supported, false);
  assert.ok(admin.storage.objects.has("payment-collections/receipt-copies/X-1-receipt.jpg"));
});

test("createAttachmentRecord rejects unknown categories and getAttachmentById ignores bad ids", async () => {
  const admin = createFakeAdmin();
  await assert.rejects(
    createAttachmentRecord(admin, { category: "avatar", stored: { provider: "supabase", key: "a/b" } }),
    /Unknown attachment category/,
  );
  assert.equal(await getAttachmentById(admin, "not-a-uuid"), null);
  assert.equal(await getAttachmentById(createFakeAdmin({ missingTables: ["attachments"] }), "6f9619ff-8b86-4011-b42d-00cf4fc964ff"), null);
});

test("queue visits expose attachment ids and presence flags but never stored URLs", () => {
  const summary = collectionVisitAttachmentSummary({
    id: 5,
    customer_code: "1114C",
    receipt_copy_url: "https://project.supabase.co/storage/v1/object/public/payment-collections/receipt-copies/a.jpg",
    payment_copy_url: null,
  });
  assert.equal(summary.receipt_copy_url, undefined);
  assert.equal(summary.payment_copy_url, undefined);
  assert.equal(summary.has_receipt_copy, true);
  assert.equal(summary.has_payment_copy, false);

  const modern = collectionVisitAttachmentSummary({ id: 6, receipt_attachment_id: "r-id", payment_attachment_id: "p-id" });
  assert.equal(modern.has_receipt_copy, true);
  assert.equal(modern.has_payment_copy, true);
});

test("an optimistic offline visit never shows the previous visit's attachments", () => {
  const optimistic = buildOptimisticLatestCollection(
    { latest_collection: { id: 9, has_receipt_copy: true, receipt_attachment_id: "old" } },
    { visitOutcome: "FUNDS_RECEIVED", amountReceived: 10 },
  );
  assert.equal(optimistic.id, null);
  assert.equal(optimistic.receipt_attachment_id, null);
  assert.equal(optimistic.has_receipt_copy, false);
  assert.equal(optimistic.pending_sync, true);
});

test("invoice readers prefer invoiceAttachmentId and fall back to invoiceFilePath", async () => {
  const admin = createFakeAdmin({
    objects: {
      "order-invoices/1114C/378/new.pdf": { body: new TextEncoder().encode("NEW") },
      "order-invoices/1114C/378/old.pdf": { body: new TextEncoder().encode("OLD") },
    },
  });
  const { attachmentId } = await storeAttachment(admin, {
    category: ATTACHMENT_CATEGORIES.orderInvoice,
    key: "order-invoices/1114C/378/attached.pdf",
    body: new TextEncoder().encode("ATTACHED"),
    contentType: "application/pdf",
    entityType: "sales_order",
    entityId: 378,
  });

  const decode = (buffer) => new TextDecoder().decode(buffer);
  assert.equal(decode(await readOrderInvoiceFile(admin, { invoiceFilePath: "1114C/378/old.pdf", invoiceAttachmentId: attachmentId })), "ATTACHED");
  assert.equal(decode(await readOrderInvoiceFile(admin, { invoiceFilePath: "1114C/378/old.pdf" })), "OLD");
  assert.equal(decode(await readOrderInvoiceFile(admin, "1114C/378/new.pdf")), "NEW");
  assert.deepEqual(await resolveOrderInvoiceObject(admin, { invoiceFilePath: "" }), null);
  await assert.rejects(readOrderInvoiceFile(admin, {}), /Invoice file is missing/);
});

// ---------- authorization ----------
const USER = { id: "user-1" };
const OTHER_VISIT_CREATOR = "collector-9";

function accessDeps(overrides = {}) {
  return {
    async getCollectionScope() {
      return { hasAllAccess: false, canSeeAllSchedulers: false, visibleSchedulerUserIds: [USER.id] };
    },
    async collectionCustomerInScope() {
      return false;
    },
    async getSalesScope() {
      return { hasAllAccess: false };
    },
    async customerVisibleToSalesScope() {
      return false;
    },
    async getOrderScope() {
      return { hasAllAccess: false, visibleUserIds: [USER.id], visibleSalesmanCodes: ["S1"] };
    },
    async canSeeOrder(order, scope) {
      return scope.hasAllAccess || scope.visibleUserIds.includes(order.created_by);
    },
    ...overrides,
  };
}

async function seededAdmin() {
  const admin = createFakeAdmin({
    users: { "token-1": USER },
    tables: {
      collection_visits: [
        { id: 1, customer_code: "1114C", created_by: OTHER_VISIT_CREATOR, receipt_copy_url: `${SUPABASE_URL}/storage/v1/object/public/payment-collections/receipt-copies/1114C-1-receipt.jpg`, payment_copy_url: null },
      ],
      sales_orders: [
        { id: 378, customer_code: "1114C", created_by: USER.id, salesman_code: "S1" },
        { id: 379, customer_code: "2000C", created_by: "someone-else", salesman_code: "S9" },
      ],
      customer_documents: [
        { id: 41, customer_code: "1114C", file_path: "1114C/CR/1-cr.pdf", original_file_name: "cr.pdf" },
      ],
      system_settings: [
        { setting_key: "order_invoice_meta:378", setting_value: JSON.stringify({ orderId: "378", invoiceFilePath: "1114C/378/old.pdf" }) },
      ],
    },
  });

  const receipt = await storeAttachment(admin, {
    category: ATTACHMENT_CATEGORIES.receiptCopy,
    key: buildCollectionCopyKey({ kind: "receipt", customerCode: "1114C", now: NOW }),
    body: new Uint8Array([1]),
    contentType: "image/jpeg",
    customerCode: "1114C",
    uploadedBy: OTHER_VISIT_CREATOR,
  });
  const payment = await storeAttachment(admin, {
    category: ATTACHMENT_CATEGORIES.paymentCopy,
    key: buildCollectionCopyKey({ kind: "payment", customerCode: "1114C", now: NOW }),
    body: new Uint8Array([1]),
    contentType: "image/jpeg",
    customerCode: "1114C",
    uploadedBy: OTHER_VISIT_CREATOR,
  });
  admin.data.collection_visits.push({
    id: 2,
    customer_code: "1114C",
    created_by: OTHER_VISIT_CREATOR,
    receipt_copy_url: null,
    payment_copy_url: null,
    receipt_attachment_id: receipt.attachmentId,
    payment_attachment_id: payment.attachmentId,
  });

  const invoice = await storeAttachment(admin, {
    category: ATTACHMENT_CATEGORIES.orderInvoice,
    key: buildOrderInvoiceKey({ customerCode: "2000C", orderId: 379, fileName: "i.pdf", now: NOW }),
    body: new Uint8Array([1]),
    contentType: "application/pdf",
    entityType: "sales_order",
    entityId: 379,
  });
  const document = await storeAttachment(admin, {
    category: ATTACHMENT_CATEGORIES.customerDocument,
    key: buildCustomerDocumentKey({ customerCode: "1114C", documentType: "VAT", fileName: "vat.pdf", now: NOW }),
    body: new Uint8Array([1]),
    contentType: "application/pdf",
  });
  admin.data.customer_documents.push({ id: 42, customer_code: "1114C", file_path: "1114C/VAT/x.pdf", attachment_id: document.attachmentId });

  const orphan = await storeAttachment(admin, {
    category: ATTACHMENT_CATEGORIES.receiptCopy,
    key: "payment-collections/receipt-copies/ORPHAN-1-receipt.jpg",
    body: new Uint8Array([1]),
    uploadedBy: USER.id,
  });

  return { admin, ids: { receipt: receipt.attachmentId, payment: payment.attachmentId, invoice: invoice.attachmentId, document: document.attachmentId, orphan: orphan.attachmentId } };
}

async function authorize(admin, target, deps) {
  return authorizeAttachmentRead(admin, { user: USER, token: "token-1", target, deps });
}

test("receipt and payment copies: creator, subordinate scope, all-access and queue scope are allowed", async () => {
  const { admin, ids } = await seededAdmin();
  for (const id of [ids.receipt, ids.payment]) {
    const target = await resolveAttachmentTarget(admin, { id });
    assert.equal(target.status, 200);
    assert.equal(target.owner.id, 2);

    assert.equal((await authorize(admin, target, accessDeps())).allowed, false, "out-of-scope user is denied");
    assert.equal((await authorize(admin, target, accessDeps({
      getCollectionScope: async () => ({ visibleSchedulerUserIds: [USER.id, OTHER_VISIT_CREATOR] }),
    }))).allowed, true, "visit created by a subordinate");
    assert.equal((await authorize(admin, target, accessDeps({
      getCollectionScope: async () => ({ hasAllAccess: true }),
    }))).allowed, true, "collector/admin all-access");
    assert.equal((await authorize(admin, target, accessDeps({
      collectionCustomerInScope: async (_admin, _scope, code) => code === "1114C",
    }))).allowed, true, "customer in the caller's collection queue");
    assert.equal((await authorize(admin, target, accessDeps({
      customerVisibleToSalesScope: async (_admin, _scope, code) => code === "1114C",
    }))).allowed, true, "customer visible through sales scope");
  }

  const ownVisit = await resolveAttachmentTarget(admin, { id: ids.receipt });
  ownVisit.owner = { ...ownVisit.owner, created_by: USER.id };
  assert.equal((await authorize(admin, ownVisit, accessDeps())).allowed, true, "visit creator");
});

test("order invoices reuse order scope (canSeeOrder)", async () => {
  const { admin, ids } = await seededAdmin();
  const target = await resolveAttachmentTarget(admin, { id: ids.invoice });
  assert.equal(target.owner.id, 379);
  assert.equal((await authorize(admin, target, accessDeps())).allowed, false);
  assert.equal((await authorize(admin, target, accessDeps({
    getOrderScope: async () => ({ hasAllAccess: true, visibleUserIds: [] }),
  }))).allowed, true);
});

test("customer documents are no longer open to every authenticated user", async () => {
  const { admin, ids } = await seededAdmin();
  const target = await resolveAttachmentTarget(admin, { id: ids.document });
  assert.equal(target.owner.customer_code, "1114C");
  assert.equal((await authorize(admin, target, accessDeps())).allowed, false, "out-of-scope salesman");
  assert.equal((await authorize(admin, target, accessDeps({
    getSalesScope: async () => ({ hasAllAccess: true }),
  }))).allowed, true, "admin/manager/invoice-maker");
  assert.equal((await authorize(admin, target, accessDeps({
    customerVisibleToSalesScope: async (_admin, _scope, code) => code === "1114C",
  }))).allowed, true, "salesman whose scope includes the customer");
});

test("unlinked attachments are readable only by the uploader, and failures deny access", async () => {
  const { admin, ids } = await seededAdmin();
  const target = await resolveAttachmentTarget(admin, { id: ids.orphan });
  assert.equal(target.owner, null);
  assert.equal((await authorize(admin, target, accessDeps())).allowed, true);
  assert.equal((await authorizeAttachmentRead(admin, { user: { id: "x" }, target, deps: accessDeps() })).allowed, false);

  const receipt = await resolveAttachmentTarget(admin, { id: ids.receipt });
  const failing = accessDeps({ getCollectionScope: async () => { throw new Error("db down"); } });
  assert.equal((await authorize(admin, receipt, failing)).allowed, false);
  assert.equal((await authorizeAttachmentRead(admin, { user: null, target: receipt, deps: accessDeps() })).allowed, false);
});

test("legacy references resolve historical files and prefer attachment ids when present", async () => {
  const { admin, ids } = await seededAdmin();

  const legacyReceipt = await resolveAttachmentTarget(admin, { id: "legacy", legacyKind: "receipt_copy", legacyRef: "1" });
  assert.equal(legacyReceipt.status, 200);
  assert.equal(legacyReceipt.legacy, true);
  assert.deepEqual(legacyReceipt.object, { provider: "supabase", key: "payment-collections/receipt-copies/1114C-1-receipt.jpg" });

  const modernViaLegacy = await resolveAttachmentTarget(admin, { id: "legacy", legacyKind: "receipt_copy", legacyRef: "2" });
  assert.equal(modernViaLegacy.record.id, ids.receipt);

  assert.equal((await resolveAttachmentTarget(admin, { id: "legacy", legacyKind: "payment_copy", legacyRef: "1" })).status, 404);

  const legacyDocument = await resolveAttachmentTarget(admin, { id: "legacy", legacyKind: "customer_document", legacyRef: "41" });
  assert.equal(legacyDocument.object.key, "customer-documents/1114C/CR/1-cr.pdf");

  const legacyInvoice = await resolveAttachmentTarget(admin, { id: "legacy", legacyKind: "order_invoice", legacyRef: "378" });
  assert.equal(legacyInvoice.object.key, "order-invoices/1114C/378/old.pdf");
  assert.equal(legacyInvoice.owner.id, 378);

  assert.equal((await resolveAttachmentTarget(admin, { id: "legacy", legacyKind: "avatar", legacyRef: "1" })).status, 400);
  assert.equal((await resolveAttachmentTarget(admin, { id: "legacy", legacyKind: "receipt_copy", legacyRef: "1 or 1=1" })).status, 400);
  assert.equal((await resolveAttachmentTarget(admin, { id: "legacy", legacyKind: "receipt_copy", legacyRef: "999" })).status, 404);
});

test("legacy resolution works before the attachments migration is applied", async () => {
  const admin = createFakeAdmin({
    missingTables: ["attachments"],
    missingColumns: { collection_visits: ["receipt_attachment_id", "payment_attachment_id"] },
    tables: {
      collection_visits: [
        { id: 7, customer_code: "1114C", created_by: USER.id, receipt_copy_url: `${SUPABASE_URL}/storage/v1/object/public/payment-collections/receipt-copies/old.jpg` },
      ],
    },
  });
  const target = await resolveAttachmentTarget(admin, { id: "legacy", legacyKind: "receipt_copy", legacyRef: "7" });
  assert.equal(target.status, 200);
  assert.equal(target.object.key, "payment-collections/receipt-copies/old.jpg");
  assert.equal((await resolveAttachmentTarget(admin, { id: "6f9619ff-8b86-4011-b42d-00cf4fc964ff" })).status, 404);
});

// ---------- signed URL endpoint ----------
const { handleAttachmentUrlRequest } = await import("../app/api/attachments/[id]/url/route.js");

function params(entries = {}) {
  return new URLSearchParams(entries);
}

test("endpoint requires a valid bearer token", async () => {
  const { admin, ids } = await seededAdmin();
  assert.equal((await handleAttachmentUrlRequest({ admin, token: "", id: ids.receipt, searchParams: params() })).status, 401);
  assert.equal((await handleAttachmentUrlRequest({ admin, token: "bad", id: ids.receipt, searchParams: params() })).status, 401);
});

test("endpoint returns 404 for unknown attachments and 400 for malformed legacy refs", async () => {
  const { admin } = await seededAdmin();
  const missing = await handleAttachmentUrlRequest({ admin, token: "token-1", id: "6f9619ff-8b86-4011-b42d-00cf4fc964ff", searchParams: params(), deps: accessDeps() });
  assert.equal(missing.status, 404);
  const junk = await handleAttachmentUrlRequest({ admin, token: "token-1", id: "../../etc", searchParams: params(), deps: accessDeps() });
  assert.equal(junk.status, 404);
  const malformed = await handleAttachmentUrlRequest({ admin, token: "token-1", id: "legacy", searchParams: params({ kind: "receipt_copy", ref: "abc" }), deps: accessDeps() });
  assert.equal(malformed.status, 400);
});

test("endpoint signs only after authorization succeeds", async () => {
  const { admin, ids } = await seededAdmin();
  let signCalls = 0;
  const signUrl = async (...args) => {
    signCalls += 1;
    return getSignedReadUrl(...args);
  };

  const denied = await handleAttachmentUrlRequest({ admin, token: "token-1", id: ids.receipt, searchParams: params(), deps: accessDeps(), signUrl });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.url, undefined);
  assert.equal(signCalls, 0);

  const allowed = await handleAttachmentUrlRequest({
    admin,
    token: "token-1",
    id: ids.receipt,
    searchParams: params(),
    deps: accessDeps({ getCollectionScope: async () => ({ hasAllAccess: true }) }),
    signUrl,
  });
  assert.equal(allowed.status, 200);
  assert.equal(signCalls, 1);
  assert.match(allowed.body.url, /^https:\/\/signed\.example\/payment-collections\/receipt-copies\/.+ttl=300$/);
  assert.equal(allowed.body.category, "receipt_copy");
  assert.ok(Date.parse(allowed.body.expiresAt) > Date.now());
  assert.equal(admin.calls.inserts.filter((entry) => JSON.stringify(entry.row).includes("signed.example")).length, 0, "signed URLs are never stored");
});

test("endpoint serves legacy historical receipts through the same authorization", async () => {
  const { admin } = await seededAdmin();
  const allowed = await handleAttachmentUrlRequest({
    admin,
    token: "token-1",
    id: "legacy",
    searchParams: params({ kind: "receipt_copy", ref: "1", download: "1" }),
    deps: accessDeps({ collectionCustomerInScope: async () => true }),
  });
  assert.equal(allowed.status, 200);
  assert.equal(admin.calls.signed.at(-1).path, "receipt-copies/1114C-1-receipt.jpg");
  assert.deepEqual(admin.calls.signed.at(-1).options, { download: "1114C-1-receipt.jpg" });

  const denied = await handleAttachmentUrlRequest({ admin, token: "token-1", id: "legacy", searchParams: params({ kind: "receipt_copy", ref: "1" }), deps: accessDeps() });
  assert.equal(denied.status, 403);
});

// ---------- client helper ----------
test("openAttachment builds attachment and legacy endpoint paths and surfaces API errors", async () => {
  assert.equal(attachmentUrlPath({ attachmentId: "abc" }), "/api/attachments/abc/url");
  assert.equal(attachmentUrlPath({ legacyKind: "receipt_copy", legacyRef: 12 }), "/api/attachments/legacy/url?kind=receipt_copy&ref=12");
  assert.equal(attachmentUrlPath({ attachmentId: "abc", download: true }), "/api/attachments/abc/url?download=1");

  const seen = [];
  const ok = await fetchAttachmentUrl({
    accessToken: "t",
    attachmentId: "abc",
    fetchImpl: async (url, options) => {
      seen.push({ url, auth: options.headers.Authorization });
      return new Response(JSON.stringify({ success: true, url: "https://signed" }), { status: 200 });
    },
  });
  assert.equal(ok.url, "https://signed");
  assert.deepEqual(seen, [{ url: "/api/attachments/abc/url", auth: "Bearer t" }]);

  await assert.rejects(fetchAttachmentUrl({
    accessToken: "t",
    attachmentId: "abc",
    fetchImpl: async () => new Response(JSON.stringify({ success: false, error: "You do not have access to this order." }), { status: 403 }),
  }), /do not have access/);
  await assert.rejects(fetchAttachmentUrl({ accessToken: "", attachmentId: "abc" }), /login again/);
});

// ---------- wiring guards ----------
test("business modules no longer call Supabase Storage directly for attachment files", () => {
  const files = [
    "../app/api/payment-collections/route.js",
    "../app/api/order-invoice/route.js",
    "../app/api/customer-documents/route.js",
    "../app/lib/orderInvoiceComparison.js",
    "../app/lib/prospectInvoiceLink.js",
    "../app/lib/dailySupplierOrderEmailServer.js",
  ];
  for (const file of files) {
    const source = read(file);
    assert.doesNotMatch(source, /storage\s*\.from\(/, file);
    assert.doesNotMatch(source, /createSignedUrl|\.download\(|\/storage\/v1\/object\/public/, file);
  }
  // Bucket provisioning lives in the provider (private only); upload-files is unchanged.
  assert.doesNotMatch(read("../app/api/payment-collections/route.js"), /public: true/);
  assert.match(read("../app/lib/uploadFilesStorage.js"), /storage\.from\(UPLOAD_FILES_BUCKET\)/);
});

test("collection uploads record attachment ids and leave copy URLs null when the migration exists", () => {
  const source = read("../app/api/payment-collections/route.js");
  assert.match(source, /storeAttachment\(admin, \{\s*category: kind === "receipt" \? ATTACHMENT_CATEGORIES\.receiptCopy : ATTACHMENT_CATEGORIES\.paymentCopy/);
  assert.match(source, /copy && !copy\.attachmentId \? copy\.key : null/);
  assert.match(source, /payment_attachment_id: paymentCopy\.attachmentId/);
  assert.match(source, /receipt_attachment_id: receiptCopy\.attachmentId/);
  assert.match(source, /isMissingAttachmentSchemaError\(insertError\)/);
  assert.match(source, /entityType: ATTACHMENT_ENTITY_TYPES\.collectionVisit/);
  assert.match(source, /\.map\(collectionVisitAttachmentSummary\)/);
});

test("invoice upload keeps invoiceFilePath and replaces invoiceAttachmentId", () => {
  const source = read("../app/api/order-invoice/route.js");
  assert.match(source, /category: ATTACHMENT_CATEGORIES\.orderInvoice/);
  assert.match(source, /invoiceFilePath: storagePath/);
  assert.match(source, /const \{ invoiceAttachmentId: _previousAttachmentId, \.\.\.existing \}/);
  assert.match(source, /\.\.\.\(invoiceAttachmentId \? \{ invoiceAttachmentId \} : \{\}\)/);
  assert.doesNotMatch(source, /invoiceFileUrl: signed/);
  assert.match(source, /export function canSeeOrder/);
  assert.match(source, /export async function resolveOrderInvoiceScope/);
});

test("customer document uploads store attachment_id and responses omit storage paths", async () => {
  const source = read("../app/api/customer-documents/route.js");
  assert.match(source, /category: ATTACHMENT_CATEGORIES\.customerDocument/);
  assert.match(source, /attachment_id: documentAttachmentId/);
  assert.doesNotMatch(source, /file_url/);
});

test("UI opens attachments through the authorized endpoint, not stored URLs", () => {
  const collections = read("../app/management/payment-collections/PaymentCollectionsView.jsx");
  assert.doesNotMatch(collections, /href=\{row\.latest_collection\??\.(receipt|payment)_copy_url\}/);
  assert.match(collections, /legacyKind: `\$\{kind\}_copy`/);
  const invoices = read("../app/management/pending-orders/page.js");
  assert.doesNotMatch(invoices, /invoiceFileUrl/);
  assert.match(invoices, /legacyKind: "order_invoice"/);
  const documents = read("../app/management/customer-master/CustomerDocumentsPanel.jsx");
  assert.doesNotMatch(documents, /file_url/);
  assert.match(documents, /legacyKind: "customer_document"/);
});

test("attachments migration creates the table, nullable owner columns and no browser policies", () => {
  const migration = read("../supabase/migrations/20261002130000_attachments.sql");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.attachments/);
  assert.match(migration, /CHECK \(category IN \('receipt_copy', 'payment_copy', 'order_invoice', 'customer_document'\)\)/);
  assert.match(migration, /UNIQUE \(storage_provider, object_key\)/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(migration, /CREATE POLICY/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS receipt_attachment_id uuid REFERENCES public\.attachments \(id\)/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS payment_attachment_id uuid REFERENCES public\.attachments \(id\)/);
  assert.match(migration, /ALTER TABLE public\.customer_documents\s+ADD COLUMN IF NOT EXISTS attachment_id uuid/);
  assert.doesNotMatch(migration, /storage\.(buckets|objects)|UPDATE public\.collection_visits|DROP /);
});
