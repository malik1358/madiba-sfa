import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createFakeAdmin } from "./helpers/fakeSupabaseAdmin.mjs";
import * as attachmentKeys from "../app/lib/storage/attachmentKeys.js";
import {
  ATTACHMENT_BUCKET_SETTINGS,
  ensureBucket,
} from "../app/lib/storage/providers/supabaseProvider.js";
import { ensureAttachmentBucket } from "../app/lib/storage/attachmentStorage.js";
import {
  legacyCollectionCopyRef,
  storeAttachment,
} from "../app/lib/storage/attachmentRecords.js";
import { resolveAttachmentTarget } from "../app/lib/storage/attachmentAccess.js";

const { ATTACHMENT_BUCKETS, ATTACHMENT_CATEGORIES, buildCollectionCopyKey, parseStoredObjectReference } = attachmentKeys;
const { handleAttachmentUrlRequest, GET } = await import("../app/api/attachments/[id]/url/route.js");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");
const SUPABASE_URL = "https://project.supabase.co";
const PUBLIC_MARKER = "/storage/v1/object/public/";
const USER = { id: "user-1" };

function listFiles(dir, extensions) {
  const out = [];
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(relative, extensions));
    else if (extensions.some((ext) => entry.name.endsWith(ext))) out.push(relative);
  }
  return out;
}

const APP_FILES = listFiles("app", [".js", ".jsx"]);

function denyAllDeps(overrides = {}) {
  return {
    getCollectionScope: async () => ({ hasAllAccess: false, visibleSchedulerUserIds: [] }),
    collectionCustomerInScope: async () => false,
    getSalesScope: async () => ({ hasAllAccess: false }),
    customerVisibleToSalesScope: async () => false,
    getOrderScope: async () => ({ hasAllAccess: false, visibleUserIds: [], visibleSalesmanCodes: [] }),
    canSeeOrder: async () => false,
    ...overrides,
  };
}

// ---------- bucket provisioning ----------
test("every attachment bucket is configured private", () => {
  for (const bucket of Object.values(ATTACHMENT_BUCKETS)) {
    assert.equal(ATTACHMENT_BUCKET_SETTINGS[bucket].public, false, bucket);
  }
});

test("a missing attachment bucket is created private", async () => {
  for (const bucket of Object.values(ATTACHMENT_BUCKETS)) {
    const admin = createFakeAdmin();
    await ensureAttachmentBucket(admin, bucket);
    assert.equal(admin.calls.bucketCreates.length, 1);
    assert.equal(admin.calls.bucketCreates[0].settings.public, false);
    assert.equal(admin.storage.buckets.get(bucket).public, false);
  }
});

test("uploads never update an existing bucket, so they cannot make it public", async () => {
  const admin = createFakeAdmin({
    buckets: {
      [ATTACHMENT_BUCKETS.collections]: { public: false },
      [ATTACHMENT_BUCKETS.customerDocuments]: { public: false },
    },
  });
  await ensureAttachmentBucket(admin, ATTACHMENT_BUCKETS.collections);
  await ensureAttachmentBucket(admin, ATTACHMENT_BUCKETS.customerDocuments);
  await storeAttachment(admin, {
    category: ATTACHMENT_CATEGORIES.receiptCopy,
    key: buildCollectionCopyKey({ kind: "receipt", customerCode: "1114C", now: 1 }),
    body: new Uint8Array([1]),
    contentType: "image/jpeg",
  });

  assert.equal(admin.calls.bucketUpdates.length, 0);
  assert.equal(admin.calls.bucketCreates.length, 0);
  assert.equal(admin.storage.buckets.get(ATTACHMENT_BUCKETS.collections).public, false);
});

test("a still-public bucket (before the privacy SQL) is left untouched rather than changed by the app", async () => {
  const admin = createFakeAdmin({ buckets: { [ATTACHMENT_BUCKETS.collections]: { public: true } } });
  await ensureAttachmentBucket(admin, ATTACHMENT_BUCKETS.collections);
  assert.equal(admin.calls.bucketUpdates.length, 0);
  assert.equal(admin.calls.bucketCreates.length, 0);
});

test("ensureBucket rejects unknown buckets and surfaces unexpected storage errors", async () => {
  await assert.rejects(ensureBucket(createFakeAdmin(), "avatars"), /Unknown attachment bucket/);
  const admin = createFakeAdmin();
  admin.storage.getBucket = async () => ({ data: null, error: { message: "permission denied" } });
  await assert.rejects(ensureBucket(admin, ATTACHMENT_BUCKETS.collections), /permission denied/);
});

test("no app code forces a bucket public or calls updateBucket", () => {
  for (const file of APP_FILES) {
    const source = read(file);
    assert.doesNotMatch(source, /public:\s*true/, file);
    assert.doesNotMatch(source, /updateBucket/, file);
    assert.doesNotMatch(source, /getPublicUrl/, file);
    assert.doesNotMatch(source, /publicUrlFor/, file);
  }
  const creators = APP_FILES.filter((file) => /createBucket\(/.test(read(file)));
  assert.deepEqual(creators.map((file) => file.replace(/\\/g, "/")).sort(), [
    "app/lib/storage/providers/supabaseProvider.js",
    "app/lib/uploadFilesStorage.js",
  ]);
  assert.match(read("app/lib/uploadFilesStorage.js"), /public:\s*false/);
});

// ---------- no public URLs for new attachments ----------
test("no code path builds a Supabase public object URL", () => {
  assert.equal(attachmentKeys.legacySupabasePublicUrl, undefined);
  for (const file of APP_FILES) {
    const source = read(file);
    const mentions = source.split(PUBLIC_MARKER).length - 1;
    if (file.replace(/\\/g, "/") === "app/lib/storage/attachmentKeys.js") {
      assert.equal(mentions, 1, "only the legacy parser constant");
    } else {
      assert.equal(mentions, 0, file);
    }
  }
});

test("pre-migration collection fallback stores an object key, never a URL", () => {
  const source = read("app/api/payment-collections/route.js");
  assert.match(source, /copy && !copy\.attachmentId \? copy\.key : null/);
  assert.match(source, /payment_copy_url: paymentCopy\?\.key \|\| null/);
  assert.match(source, /receipt_copy_url: receiptCopy\?\.key \|\| null/);
});

test("stored references parse from historical URLs or bare keys and reject foreign values", () => {
  const key = "payment-collections/receipt-copies/1114C-1-receipt.jpg";
  assert.equal(parseStoredObjectReference(`${SUPABASE_URL}${PUBLIC_MARKER}${key}`, ATTACHMENT_BUCKETS.collections).key, key);
  assert.equal(parseStoredObjectReference(key, ATTACHMENT_BUCKETS.collections).key, key);
  assert.equal(parseStoredObjectReference("https://evil.example/x.jpg", ATTACHMENT_BUCKETS.collections), null);
  assert.equal(parseStoredObjectReference("customer-documents/1114C/CR/x.pdf", ATTACHMENT_BUCKETS.collections), null);
  assert.equal(parseStoredObjectReference("payment-collections/../order-invoices/x.pdf", ATTACHMENT_BUCKETS.collections), null);
  assert.deepEqual(legacyCollectionCopyRef({ receipt_copy_url: key }, "receipt"), { provider: "supabase", key });
});

// ---------- historical files are signed privately ----------
async function historicalAdmin() {
  return createFakeAdmin({
    users: { "token-1": USER },
    buckets: {
      [ATTACHMENT_BUCKETS.collections]: { public: false },
      [ATTACHMENT_BUCKETS.customerDocuments]: { public: false },
      [ATTACHMENT_BUCKETS.orderInvoices]: { public: false },
    },
    tables: {
      collection_visits: [
        {
          id: 1,
          customer_code: "1114C",
          created_by: "collector-9",
          receipt_copy_url: `${SUPABASE_URL}${PUBLIC_MARKER}payment-collections/receipt-copies/1114C-1-receipt.jpg`,
          payment_copy_url: `${SUPABASE_URL}${PUBLIC_MARKER}payment-collections/payment-copies/1114C-1-payment.pdf`,
        },
        { id: 3, customer_code: "1114C", created_by: USER.id, receipt_copy_url: "payment-collections/receipt-copies/1114C-3-receipt.jpg" },
      ],
      customer_documents: [{ id: 41, customer_code: "2000C", file_path: "2000C/CR/1-cr.pdf", original_file_name: "cr.pdf" }],
      sales_orders: [{ id: 378, customer_code: "2000C", created_by: "someone", salesman_code: "S9" }],
      system_settings: [
        { setting_key: "order_invoice_meta:378", setting_value: JSON.stringify({ orderId: "378", invoiceFilePath: "2000C/378/i.pdf" }) },
      ],
    },
  });
}

const query = (entries) => new URLSearchParams(entries);

test("historical receipt and payment URLs are returned as private signed URLs, never the public URL", async () => {
  const admin = await historicalAdmin();
  const deps = denyAllDeps({ collectionCustomerInScope: async () => true });

  for (const kind of ["receipt_copy", "payment_copy"]) {
    const result = await handleAttachmentUrlRequest({ admin, token: "token-1", id: "legacy", searchParams: query({ kind, ref: "1" }), deps });
    assert.equal(result.status, 200, kind);
    assert.doesNotMatch(result.body.url, /\/object\/public\//);
    assert.match(result.body.url, /^https:\/\/signed\.example\/payment-collections\//);
  }
  assert.deepEqual(admin.calls.signed.map((call) => [call.bucket, call.path, call.expiresIn]), [
    ["payment-collections", "receipt-copies/1114C-1-receipt.jpg", 300],
    ["payment-collections", "payment-copies/1114C-1-payment.pdf", 300],
  ]);
});

test("pre-migration key references resolve and sign the same way", async () => {
  const admin = await historicalAdmin();
  const result = await handleAttachmentUrlRequest({ admin, token: "token-1", id: "legacy", searchParams: query({ kind: "receipt_copy", ref: "3" }), deps: denyAllDeps() });
  assert.equal(result.status, 200, "visit creator");
  assert.equal(admin.calls.signed[0].path, "receipt-copies/1114C-3-receipt.jpg");
});

test("historical customer documents sign file_path only for in-scope users", async () => {
  const admin = await historicalAdmin();
  const params = query({ kind: "customer_document", ref: "41" });
  const denied = await handleAttachmentUrlRequest({ admin, token: "token-1", id: "legacy", searchParams: params, deps: denyAllDeps() });
  assert.equal(denied.status, 403);
  assert.equal(admin.calls.signed.length, 0);

  const allowed = await handleAttachmentUrlRequest({
    admin,
    token: "token-1",
    id: "legacy",
    searchParams: params,
    deps: denyAllDeps({ customerVisibleToSalesScope: async (_admin, _scope, code) => code === "2000C" }),
  });
  assert.equal(allowed.status, 200);
  assert.deepEqual([admin.calls.signed[0].bucket, admin.calls.signed[0].path], ["customer-documents", "2000C/CR/1-cr.pdf"]);
});

test("invoice links require order access", async () => {
  const admin = await historicalAdmin();
  const params = query({ kind: "order_invoice", ref: "378" });
  assert.equal((await handleAttachmentUrlRequest({ admin, token: "token-1", id: "legacy", searchParams: params, deps: denyAllDeps() })).status, 403);
  const allowed = await handleAttachmentUrlRequest({ admin, token: "token-1", id: "legacy", searchParams: params, deps: denyAllDeps({ canSeeOrder: async () => true }) });
  assert.equal(allowed.status, 200);
  assert.equal(admin.calls.signed[0].bucket, "order-invoices");
});

test("payment collection scope: out-of-scope users get 403 and nothing is signed", async () => {
  const admin = await historicalAdmin();
  const result = await handleAttachmentUrlRequest({ admin, token: "token-1", id: "legacy", searchParams: query({ kind: "receipt_copy", ref: "1" }), deps: denyAllDeps() });
  assert.equal(result.status, 403);
  assert.equal(result.body.url, undefined);
  assert.equal(admin.calls.signed.length, 0);
});

test("anonymous -> 401, unknown -> 404", async () => {
  const admin = await historicalAdmin();
  assert.equal((await handleAttachmentUrlRequest({ admin, token: "", id: "legacy", searchParams: query({ kind: "receipt_copy", ref: "1" }) })).status, 401);
  assert.equal((await handleAttachmentUrlRequest({ admin, token: "token-1", id: "6f9619ff-8b86-4011-b42d-00cf4fc964ff", searchParams: query({}), deps: denyAllDeps() })).status, 404);
  assert.equal((await resolveAttachmentTarget(admin, { id: "legacy", legacyKind: "receipt_copy", legacyRef: "404" })).status, 404);
});

test("attachment URL responses are private/no-store even on errors", async () => {
  const response = await GET(new Request("http://localhost/api/attachments/x/url"), { params: Promise.resolve({ id: "x" }) });
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const source = read("app/api/attachments/[id]/url/route.js");
  assert.match(source, /\{ status, headers \}/);
});

test("signed URLs are never logged", () => {
  const files = [
    "app/api/attachments/[id]/url/route.js",
    ...listFiles("app/lib/storage", [".js"]),
    "app/lib/openAttachment.js",
  ];
  for (const file of files) {
    for (const line of read(file).split(/\r?\n/).filter((entry) => /console\.(log|info|warn|error|debug)/.test(entry))) {
      assert.doesNotMatch(line, /url|signed/i, `${file}: ${line.trim()}`);
    }
  }
});

// ---------- no direct client storage access ----------
test("client components never touch Supabase Storage or the server storage modules", () => {
  const clientFiles = APP_FILES.filter((file) => {
    const normalized = file.replace(/\\/g, "/");
    const source = read(file);
    return /^\s*["']use client["']/.test(source)
      || normalized.startsWith("app/management/")
      || normalized.startsWith("app/components/")
      || normalized.startsWith("app/hooks/")
      || normalized === "app/lib/openAttachment.js";
  });
  assert.ok(clientFiles.length > 20);
  for (const file of clientFiles) {
    const source = read(file);
    assert.doesNotMatch(source, /\.storage\s*\.\s*(from|getBucket|createBucket|updateBucket|listBuckets)/, file);
    assert.doesNotMatch(source, /createSignedUrl|getPublicUrl/, file);
    assert.doesNotMatch(source, /lib\/storage\//, file);
  }
  const storageCallers = APP_FILES.filter((file) => /\.storage\s*\.\s*(from|getBucket|createBucket)/.test(read(file)))
    .map((file) => file.replace(/\\/g, "/"))
    .sort();
  assert.deepEqual(storageCallers, ["app/lib/storage/providers/supabaseProvider.js", "app/lib/uploadFilesStorage.js"]);
});

// ---------- SQL ----------
const ATTACHMENT_BUCKET_PATTERN = /payment-collections|customer-documents/;

test("repository SQL never grants anon read or browser insert on attachment buckets", () => {
  const sqlFiles = [...listFiles("sql", [".sql"]), ...listFiles("supabase/migrations", [".sql"])];
  for (const file of sqlFiles) {
    const statements = read(file).split(";");
    for (const statement of statements) {
      if (!/CREATE POLICY/i.test(statement) || !ATTACHMENT_BUCKET_PATTERN.test(statement)) continue;
      assert.fail(`${file} still creates a storage policy for an attachment bucket: ${statement.trim().slice(0, 120)}`);
    }
    for (const statement of statements) {
      if (/INSERT INTO storage\.buckets/i.test(statement) && ATTACHMENT_BUCKET_PATTERN.test(statement)) {
        assert.match(statement, /'(payment-collections|customer-documents)',\s*(\n\s*)?'\1',\s*(\n\s*)?false/, `${file} must create the bucket private`);
      }
    }
  }
});

test("Phase 2 step 1 drops every known browser policy and grants nothing", () => {
  const sql = read("sql/attachment_storage_phase2_step1_drop_browser_policies.sql");
  for (const name of [
    "Public read payment collection files",
    "Authenticated upload payment collection files",
    "Public read customer document files",
    "Authenticated upload customer document files",
  ]) {
    assert.match(sql, new RegExp(`DROP POLICY IF EXISTS "${name}" ON storage\\.objects;`));
  }
  assert.doesNotMatch(sql, /CREATE POLICY|GRANT|storage\.buckets/i);
  assert.match(sql, /FROM pg_policies/);
});

test("Phase 2 step 2 makes attachment buckets private and leaves upload-files alone", () => {
  const sql = read("sql/attachment_storage_phase2_step2_private_buckets.sql");
  for (const bucket of ["payment-collections", "customer-documents", "order-invoices"]) {
    assert.match(sql, new RegExp(`SET public = false[\\s\\S]*?WHERE id = '${bucket}';`));
  }
  assert.doesNotMatch(sql, /public\s*=\s*true/i);
  assert.doesNotMatch(sql, /WHERE id = 'upload-files'/);
  assert.doesNotMatch(sql, /DELETE|DROP|storage\.objects/i);
});

test("Phase 2 storage SQL is not an auto-run migration", () => {
  const migrations = listFiles("supabase/migrations", [".sql"]).map((file) => read(file)).join("\n");
  assert.doesNotMatch(migrations, /UPDATE storage\.buckets/i);
});
