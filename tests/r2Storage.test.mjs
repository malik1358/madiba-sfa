import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

import { createFakeAdmin } from "./helpers/fakeSupabaseAdmin.mjs";
import {
  DEVELOPMENT_R2_BUCKET,
  PRODUCTION_R2_BUCKET,
  assertR2BucketAllowed,
  isProductionR2Bucket,
  normalizeR2Endpoint,
  readR2Config,
} from "../app/lib/storage/r2Guard.js";
import {
  clampSignedUrlTtl,
  getObject,
  getSignedReadUrl,
  headObject,
  putObject,
  readAttachmentStorageConfig,
} from "../app/lib/storage/attachmentStorage.js";
import {
  ATTACHMENT_CATEGORIES,
  KEY_LAYOUTS,
  buildAttachmentKey,
} from "../app/lib/storage/attachmentKeys.js";
import { readOrderInvoiceFile, storeAttachment } from "../app/lib/storage/attachmentRecords.js";

const { handleAttachmentUrlRequest } = await import("../app/api/attachments/[id]/url/route.js");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");

const ACCOUNT = "0123456789abcdef0123456789abcdef";
const SECRET = "test-secret-access-key-never-log-me";
const R2_ENV = {
  R2_ACCOUNT_ID: ACCOUNT,
  R2_ACCESS_KEY_ID: "AKIDTESTR2",
  R2_SECRET_ACCESS_KEY: SECRET,
  R2_BUCKET: DEVELOPMENT_R2_BUCKET,
  R2_ENDPOINT: "",
};
const NOW = Date.parse("2026-10-02T09:00:00.000Z");
const UUID = "6f9619ff-8b86-4011-b42d-00cf4fc964ff";
const R2_CONFIG = { writeProvider: "r2", dualWrite: false, forceSupabaseReads: false, signedUrlTtlSeconds: 300 };

// ---------- fake R2 (S3 API) behind global fetch ----------
const r2 = { objects: new Map(), requests: [], failPut: 0, throwPut: false };
const savedEnv = {};
const savedFetch = globalThis.fetch;
const logs = [];
const savedConsole = { error: console.error, warn: console.warn, log: console.log };

before(() => {
  for (const [name, value] of Object.entries(R2_ENV)) {
    savedEnv[name] = process.env[name];
    process.env[name] = value;
  }
  for (const name of ["VERCEL", "VERCEL_ENV", "ATTACHMENT_WRITE_PROVIDER", "ATTACHMENT_DUAL_WRITE", "ATTACHMENT_FORCE_SUPABASE_READS", "ATTACHMENT_SIGNED_URL_TTL_SECONDS"]) {
    savedEnv[name] = process.env[name];
    delete process.env[name];
  }
  for (const level of ["error", "warn", "log"]) {
    console[level] = (...args) => logs.push(args.map((value) => (typeof value === "string" ? value : JSON.stringify(value))).join(" "));
  }

  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    const headers = Object.fromEntries(request.headers.entries());
    const body = ["PUT", "POST"].includes(request.method) ? Buffer.from(await request.arrayBuffer()) : null;
    r2.requests.push({ method: request.method, url, headers, body });

    assert.equal(url.hostname, `${ACCOUNT}.r2.cloudflarestorage.com`);
    const [, bucket, ...rest] = url.pathname.split("/");
    assert.equal(bucket, DEVELOPMENT_R2_BUCKET);
    const key = rest.map(decodeURIComponent).join("/");

    if (request.method === "PUT") {
      if (r2.throwPut) throw new TypeError("fetch failed");
      if (r2.failPut > 0) {
        r2.failPut -= 1;
        return new Response("boom", { status: 500 });
      }
      if (headers["if-none-match"] === "*" && r2.objects.has(key)) return new Response("", { status: 412 });
      const metadata = Object.fromEntries(Object.entries(headers).filter(([name]) => name.startsWith("x-amz-meta-")));
      r2.objects.set(key, { body, contentType: headers["content-type"], metadata });
      return new Response("", { status: 200, headers: { etag: '"etag-1"' } });
    }
    const object = r2.objects.get(key);
    if (!object) return new Response("", { status: 404 });
    const responseHeaders = {
      "content-type": object.contentType,
      "content-length": String(object.body.length),
      ...object.metadata,
    };
    if (request.method === "HEAD") return new Response(null, { status: 200, headers: responseHeaders });
    return new Response(object.body, { status: 200, headers: responseHeaders });
  };
});

after(() => {
  globalThis.fetch = savedFetch;
  Object.assign(console, savedConsole);
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  assert.equal(logs.some((line) => line.includes("X-Amz-Signature") || line.includes(SECRET)), false, "no signed URL or secret was logged");
});

beforeEach(() => {
  r2.objects.clear();
  r2.requests.length = 0;
  r2.failPut = 0;
  r2.throwPut = false;
  logs.length = 0;
});

function failingSupabase(admin) {
  admin.storage.from = () => ({
    async upload() {
      return { data: null, error: { statusCode: 503, message: "Supabase storage unavailable" } };
    },
  });
  return admin;
}

// ---------- configuration ----------
test("Supabase is the default write provider; only an explicit r2 selects R2", () => {
  assert.deepEqual(readAttachmentStorageConfig({}), {
    writeProvider: "supabase",
    dualWrite: false,
    forceSupabaseReads: false,
    signedUrlTtlSeconds: 300,
  });
  assert.equal(readAttachmentStorageConfig({ ATTACHMENT_WRITE_PROVIDER: " R2 " }).writeProvider, "r2");
  assert.equal(readAttachmentStorageConfig({ ATTACHMENT_WRITE_PROVIDER: "cloudflare" }).writeProvider, "supabase");
  assert.equal(readAttachmentStorageConfig({ ATTACHMENT_WRITE_PROVIDER: "supabase", ATTACHMENT_DUAL_WRITE: "1" }).dualWrite, false);
  assert.equal(readAttachmentStorageConfig({ ATTACHMENT_WRITE_PROVIDER: "r2", ATTACHMENT_DUAL_WRITE: "0" }).dualWrite, false);
  assert.equal(readAttachmentStorageConfig({ ATTACHMENT_WRITE_PROVIDER: "r2", ATTACHMENT_DUAL_WRITE: "1" }).dualWrite, true);
  assert.equal(readAttachmentStorageConfig({ ATTACHMENT_FORCE_SUPABASE_READS: "true" }).forceSupabaseReads, true);
});

test("signed URL TTL defaults to 300 s and is clamped to 30..900 s", () => {
  assert.equal(clampSignedUrlTtl(undefined), 300);
  assert.equal(clampSignedUrlTtl("abc"), 300);
  assert.equal(clampSignedUrlTtl(5000), 900);
  assert.equal(clampSignedUrlTtl(5), 30);
  assert.equal(readAttachmentStorageConfig({ ATTACHMENT_SIGNED_URL_TTL_SECONDS: "600" }).signedUrlTtlSeconds, 600);
  assert.equal(readAttachmentStorageConfig({ ATTACHMENT_SIGNED_URL_TTL_SECONDS: "86400" }).signedUrlTtlSeconds, 900);
});

// ---------- guard ----------
const PROD_SUPABASE = "https://ynmtlzyqvmurpmfretji.supabase.co";

test("production bucket is blocked locally, in preview, and without production Supabase", () => {
  assert.equal(isProductionR2Bucket(PRODUCTION_R2_BUCKET), true);
  assert.equal(isProductionR2Bucket("madiba-prod-files"), true);
  assert.equal(isProductionR2Bucket(DEVELOPMENT_R2_BUCKET), false);

  assert.throws(() => assertR2BucketAllowed(PRODUCTION_R2_BUCKET, { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" }), /blocked outside Vercel production/);
  assert.throws(() => assertR2BucketAllowed(PRODUCTION_R2_BUCKET, { NEXT_PUBLIC_SUPABASE_URL: PROD_SUPABASE }), /blocked/);
  assert.throws(() => assertR2BucketAllowed(PRODUCTION_R2_BUCKET, { VERCEL: "1", VERCEL_ENV: "preview", NEXT_PUBLIC_SUPABASE_URL: PROD_SUPABASE }), /blocked/);
  assert.throws(() => assertR2BucketAllowed(PRODUCTION_R2_BUCKET, { VERCEL: "1", VERCEL_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "https://otherproject.supabase.co" }), /blocked/);
  assert.throws(() => assertR2BucketAllowed(PRODUCTION_R2_BUCKET, { MADIBA_ALLOW_PRODUCTION_SUPABASE: "1", NEXT_PUBLIC_SUPABASE_URL: PROD_SUPABASE }), /blocked/, "no override flag");

  assert.doesNotThrow(() => assertR2BucketAllowed(PRODUCTION_R2_BUCKET, { VERCEL: "1", VERCEL_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: PROD_SUPABASE }));
  assert.doesNotThrow(() => assertR2BucketAllowed(DEVELOPMENT_R2_BUCKET, { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" }));
  assert.throws(() => assertR2BucketAllowed(DEVELOPMENT_R2_BUCKET, { VERCEL_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: PROD_SUPABASE }), /must use the production R2 bucket/);
});

test("only the private S3 API endpoint is accepted (no r2.dev, custom domain, http or bucket path)", () => {
  assert.equal(normalizeR2Endpoint("", ACCOUNT), `https://${ACCOUNT}.r2.cloudflarestorage.com`);
  assert.equal(normalizeR2Endpoint(`https://${ACCOUNT}.eu.r2.cloudflarestorage.com/`, ACCOUNT), `https://${ACCOUNT}.eu.r2.cloudflarestorage.com`);
  assert.throws(() => normalizeR2Endpoint("https://pub-123.r2.dev", ACCOUNT), /r2\.cloudflarestorage\.com/);
  assert.throws(() => normalizeR2Endpoint("https://files.madiba.example", ACCOUNT), /r2\.cloudflarestorage\.com/);
  assert.throws(() => normalizeR2Endpoint(`http://${ACCOUNT}.r2.cloudflarestorage.com`, ACCOUNT), /https/);
  assert.throws(() => normalizeR2Endpoint(`https://${ACCOUNT}.r2.cloudflarestorage.com/madiba-attachments-dev`, ACCOUNT), /without a bucket/);
  assert.throws(() => normalizeR2Endpoint(`https://${"f".repeat(32)}.r2.cloudflarestorage.com`, ACCOUNT), /does not match/);
});

test("missing R2 config lists variable names, never values", () => {
  assert.throws(() => readR2Config({ R2_SECRET_ACCESS_KEY: SECRET }), (error) => {
    assert.match(error.message, /R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_BUCKET/);
    assert.doesNotMatch(error.message, new RegExp(SECRET));
    return true;
  });
  assert.throws(() => readR2Config({ ...R2_ENV, R2_BUCKET: "Bad_Bucket" }), /valid bucket/);
});

// ---------- provider ----------
test("R2 PUT is SigV4-signed, non-overwriting, hash-checked, with MIME and safe metadata", async () => {
  const key = buildAttachmentKey(ATTACHMENT_CATEGORIES.receiptCopy, { customerCode: "1114C", extension: "jpg", now: NOW, uuid: UUID }, KEY_LAYOUTS.immutable);
  const bytes = Buffer.from("jpeg-bytes");
  const stored = await putObject(null, {
    provider: "r2",
    key,
    body: bytes,
    contentType: "image/jpeg",
    metadata: { category: "receipt_copy", customerName: "Al Noor Trading", amount: "1500", "entity-type": "collection_visit" },
  });

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  assert.equal(stored.provider, "r2");
  assert.equal(stored.key, key);
  assert.equal(stored.sha256, sha256);

  const [request] = r2.requests;
  assert.equal(request.method, "PUT");
  assert.equal(request.url.pathname, `/${DEVELOPMENT_R2_BUCKET}/payment-collections/receipt-copies/2026/10/1114C/20261002-${UUID}.jpg`);
  assert.match(request.headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKIDTESTR2\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=[^,]*host[^,]*, Signature=[0-9a-f]{64}$/);
  assert.equal(request.headers["if-none-match"], "*");
  assert.equal(request.headers["x-amz-content-sha256"], sha256);
  assert.equal(request.headers["content-type"], "image/jpeg");
  assert.equal(request.headers["x-amz-meta-sha256"], sha256);
  assert.equal(request.headers["x-amz-meta-category"], "receipt_copy");
  assert.equal(request.headers["x-amz-meta-entity-type"], "collection_visit");
  assert.equal(Object.keys(request.headers).some((name) => /customer|amount/i.test(name)), false, "no business data in metadata");
  assert.deepEqual(request.body, bytes);

  await assert.rejects(putObject(null, { provider: "r2", key, body: bytes, contentType: "image/jpeg" }), /already exists/);
});

test("R2 GET returns identical bytes and HEAD reports size, type and sha256", async () => {
  const key = "order-invoices/1114C/378/1-uuid-invoice.pdf";
  const bytes = Buffer.from("%PDF-1.7 test");
  await putObject(null, { provider: "r2", key, body: bytes, contentType: "application/pdf" });

  assert.deepEqual(Buffer.from(await getObject(null, { provider: "r2", key })), bytes);
  const head = await headObject(null, { provider: "r2", key });
  assert.equal(head.exists, true);
  assert.equal(head.size, bytes.length);
  assert.equal(head.contentType, "application/pdf");
  assert.equal(head.sha256, createHash("sha256").update(bytes).digest("hex"));
  assert.deepEqual(await headObject(null, { provider: "r2", key: "order-invoices/missing.pdf" }), { exists: false });
});

test("R2 signed GET URLs use the private endpoint, 300 s default, 900 s cap, and carry no secret", async () => {
  const key = "customer-documents/1114C/CR/1-uuid-cr copy.pdf";
  const signed = await getSignedReadUrl(null, { provider: "r2", key, config: R2_CONFIG });
  const url = new URL(signed.url);
  assert.equal(url.hostname, `${ACCOUNT}.r2.cloudflarestorage.com`);
  assert.equal(url.pathname, `/${DEVELOPMENT_R2_BUCKET}/customer-documents/1114C/CR/1-uuid-cr%20copy.pdf`);
  assert.equal(url.searchParams.get("X-Amz-Expires"), "300");
  assert.equal(url.searchParams.get("X-Amz-Algorithm"), "AWS4-HMAC-SHA256");
  assert.match(url.searchParams.get("X-Amz-Signature"), /^[0-9a-f]{64}$/);
  assert.equal(signed.url.includes(SECRET), false);
  assert.equal(r2.requests.length, 0, "signing makes no network request");

  const capped = await getSignedReadUrl(null, { provider: "r2", key, expiresIn: 86400, downloadName: "cr.pdf", config: R2_CONFIG });
  const cappedUrl = new URL(capped.url);
  assert.equal(cappedUrl.searchParams.get("X-Amz-Expires"), "900");
  assert.equal(cappedUrl.searchParams.get("response-content-disposition"), 'attachment; filename="cr.pdf"');
});

// ---------- keys ----------
test("immutable keys are collision-resistant and keep the bucket folders", () => {
  const input = { customerCode: "1114 c/../x", extension: "PDF", now: NOW, uuid: UUID };
  assert.equal(
    buildAttachmentKey(ATTACHMENT_CATEGORIES.paymentCopy, input, KEY_LAYOUTS.immutable),
    `payment-collections/payment-copies/2026/10/1114_C_.._X/20261002-${UUID}.pdf`,
  );
  assert.equal(
    buildAttachmentKey(ATTACHMENT_CATEGORIES.orderInvoice, { customerCode: "1114c", orderId: 378, fileName: "Inv 1.pdf", now: NOW, uuid: UUID }, KEY_LAYOUTS.immutable),
    `order-invoices/1114C/378/${NOW}-${UUID}-Inv_1.pdf`,
  );
  assert.equal(
    buildAttachmentKey(ATTACHMENT_CATEGORIES.customerDocument, { customerCode: "1114C", documentType: "vat", fileName: "v.pdf", now: NOW, uuid: UUID }, KEY_LAYOUTS.immutable),
    `customer-documents/1114C/VAT/${NOW}-${UUID}-v.pdf`,
  );
  const first = buildAttachmentKey(ATTACHMENT_CATEGORIES.receiptCopy, { customerCode: "1114C", now: NOW }, KEY_LAYOUTS.immutable);
  const second = buildAttachmentKey(ATTACHMENT_CATEGORIES.receiptCopy, { customerCode: "1114C", now: NOW }, KEY_LAYOUTS.immutable);
  assert.notEqual(first, second, "same customer, same millisecond -> different keys");
  assert.equal(
    buildAttachmentKey(ATTACHMENT_CATEGORIES.receiptCopy, { customerCode: "1114C", extension: "jpg", now: NOW }, KEY_LAYOUTS.legacy),
    `payment-collections/receipt-copies/1114C-${NOW}-receipt.jpg`,
    "Supabase writes keep the legacy layout",
  );
});

// ---------- write paths ----------
const RECEIPT = { category: ATTACHMENT_CATEGORIES.receiptCopy, keyInput: { customerCode: "1114C", extension: "jpg" }, body: Buffer.from("receipt"), contentType: "image/jpeg", customerCode: "1114C" };

test("default config writes Supabase with the legacy layout and never calls R2", async () => {
  const admin = createFakeAdmin();
  const result = await storeAttachment(admin, { ...RECEIPT, config: readAttachmentStorageConfig({}) });
  assert.equal(result.stored.provider, "supabase");
  assert.match(result.stored.key, /^payment-collections\/receipt-copies\/1114C-\d+-receipt\.jpg$/);
  assert.equal(admin.data.attachments[0].storage_provider, "supabase");
  assert.equal(r2.requests.length, 0);
});

test("R2 primary success records storage_provider=r2 with an immutable key", async () => {
  const admin = createFakeAdmin();
  const result = await storeAttachment(admin, { ...RECEIPT, config: R2_CONFIG });
  const row = admin.data.attachments.find((entry) => entry.id === result.attachmentId);
  assert.equal(row.storage_provider, "r2");
  assert.match(row.object_key, /^payment-collections\/receipt-copies\/\d{4}\/\d{2}\/1114C\/\d{8}-[0-9a-f-]{36}\.jpg$/);
  assert.equal(row.content_type, "image/jpeg");
  assert.ok(r2.objects.has(row.object_key));
  assert.equal(admin.calls.uploads.length, 0, "no Supabase copy when dual write is off");
  assert.equal(result.fallbackError, null);
});

test("R2 failure falls back to Supabase and the row says supabase", async () => {
  const admin = createFakeAdmin();
  r2.failPut = 5;
  const result = await storeAttachment(admin, { ...RECEIPT, contentType: "application/pdf", keyInput: { customerCode: "1114C", extension: "pdf" }, config: R2_CONFIG });
  const row = admin.data.attachments.find((entry) => entry.id === result.attachmentId);
  assert.equal(row.storage_provider, "supabase");
  assert.equal(row.content_type, "application/pdf");
  assert.ok(admin.storage.objects.has(row.object_key));
  assert.equal(r2.objects.size, 0);
  assert.equal(result.fallbackError.status, 500);
  assert.ok(logs.some((line) => line.includes("R2 write failed; falling back to Supabase")));
});

test("R2 network error also falls back to Supabase", async () => {
  const admin = createFakeAdmin();
  r2.throwPut = true;
  const result = await storeAttachment(admin, { ...RECEIPT, config: R2_CONFIG });
  assert.equal(result.stored.provider, "supabase");
  assert.match(result.fallbackError.message, /fetch failed/);
});

test("both providers failing aborts the save and records no attachment row", async () => {
  const admin = failingSupabase(createFakeAdmin());
  r2.failPut = 5;
  await assert.rejects(storeAttachment(admin, { ...RECEIPT, config: R2_CONFIG }), /Unable to store the attachment/);
  assert.equal((admin.data.attachments || []).length, 0);
  assert.ok(logs.some((line) => line.includes("Supabase fallback write failed")));
});

test("dual write: R2 success + Supabase safety-copy failure keeps R2 and reports the failure", async () => {
  const admin = failingSupabase(createFakeAdmin());
  const result = await storeAttachment(admin, { ...RECEIPT, config: { ...R2_CONFIG, dualWrite: true } });
  const row = admin.data.attachments.find((entry) => entry.id === result.attachmentId);
  assert.equal(row.storage_provider, "r2");
  assert.equal(result.secondary.ok, false);
  assert.equal(result.secondary.error.status, 503);
  assert.ok(logs.some((line) => line.includes("Supabase safety copy failed; R2 copy kept")));
});

test("dual write: both copies at the same key, row still describes the R2 primary", async () => {
  const admin = createFakeAdmin();
  const result = await storeAttachment(admin, { ...RECEIPT, config: { ...R2_CONFIG, dualWrite: true } });
  assert.equal(result.stored.provider, "r2");
  assert.equal(result.secondary.ok, true);
  assert.ok(r2.objects.has(result.stored.key));
  assert.ok(admin.storage.objects.has(result.stored.key));
  assert.equal(admin.data.attachments.length, 1);
});

test("R2 mode stays on Supabase when the attachments migration is missing", async () => {
  const admin = createFakeAdmin({ missingTables: ["attachments"] });
  const result = await storeAttachment(admin, { ...RECEIPT, config: R2_CONFIG });
  assert.equal(result.stored.provider, "supabase");
  assert.match(result.stored.key, /-receipt\.jpg$/);
  assert.equal(r2.requests.length, 0);
});

// ---------- reads ----------
test("reads follow the attachment row provider, not the current write provider", async () => {
  const admin = createFakeAdmin({ users: { token: { id: "user-1" } } });
  const stored = await storeAttachment(admin, { ...RECEIPT, uploadedBy: "user-1", config: R2_CONFIG });
  process.env.ATTACHMENT_WRITE_PROVIDER = "supabase";
  try {
    const response = await handleAttachmentUrlRequest({
      admin,
      token: "token",
      id: stored.attachmentId,
      searchParams: new URLSearchParams(),
    });
    assert.equal(response.status, 200, "unlinked upload is readable by its uploader");
    assert.equal(new URL(response.body.url).hostname, `${ACCOUNT}.r2.cloudflarestorage.com`);
    assert.equal(admin.calls.signed.length, 0, "Supabase was not asked to sign an R2 object");
    assert.equal(JSON.stringify(admin.data).includes("X-Amz-Signature"), false, "signed URLs are not stored");
  } finally {
    delete process.env.ATTACHMENT_WRITE_PROVIDER;
  }

  process.env.ATTACHMENT_FORCE_SUPABASE_READS = "1";
  try {
    const forced = await getSignedReadUrl(admin, { provider: "r2", key: stored.stored.key });
    assert.match(forced.url, /^https:\/\/signed\.example\/payment-collections\//, "rollback switch reads the Supabase copy");
  } finally {
    delete process.env.ATTACHMENT_FORCE_SUPABASE_READS;
  }
});

test("server-side invoice reads return the same bytes from R2", async () => {
  const admin = createFakeAdmin();
  const pdf = Buffer.from("%PDF-1.4 invoice 378");
  const { attachmentId, stored } = await storeAttachment(admin, {
    category: ATTACHMENT_CATEGORIES.orderInvoice,
    keyInput: { customerCode: "1114C", orderId: 378, fileName: "inv.pdf" },
    body: pdf,
    contentType: "application/pdf",
    entityType: "sales_order",
    entityId: 378,
    config: R2_CONFIG,
  });
  assert.equal(stored.provider, "r2");
  const bytes = await readOrderInvoiceFile(admin, { invoiceFilePath: "ignored/legacy.pdf", invoiceAttachmentId: attachmentId });
  assert.deepEqual(Buffer.from(bytes), pdf);

  for (const file of ["app/lib/orderInvoiceComparison.js", "app/lib/prospectInvoiceLink.js", "app/lib/dailySupplierOrderEmailServer.js"]) {
    assert.match(read(file), /readOrderInvoiceFile/, file);
  }
});

// ---------- client / config hygiene ----------
function listFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(relative));
    else if (/\.(js|jsx|mjs)$/.test(entry.name)) out.push(relative);
  }
  return out;
}

test("no R2 secret, aws4fetch or storage module reaches client code, and nothing is NEXT_PUBLIC", () => {
  for (const file of listFiles("app")) {
    const source = read(file);
    assert.doesNotMatch(source, /NEXT_PUBLIC_(R2|ATTACHMENT)/, file);
    const normalized = file.replace(/\\/g, "/");
    const isClient = /^\s*["']use client["']/.test(source)
      || normalized.startsWith("app/management/")
      || normalized.startsWith("app/components/")
      || normalized.startsWith("app/hooks/")
      || normalized === "app/lib/openAttachment.js";
    if (!isClient) continue;
    assert.doesNotMatch(source, /R2_|aws4fetch|r2Provider|r2Guard|lib\/storage\//, file);
  }
  const r2Readers = listFiles("app").filter((file) => /process\.env\.R2_|env\.R2_/.test(read(file))).map((file) => file.replace(/\\/g, "/"));
  assert.deepEqual(r2Readers, ["app/lib/storage/r2Guard.js"]);
});

test(".env.example lists the server-only names with empty values", () => {
  const example = read(".env.example");
  for (const name of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "R2_ENDPOINT", "ATTACHMENT_FORCE_SUPABASE_READS", "ATTACHMENT_SIGNED_URL_TTL_SECONDS"]) {
    assert.match(example, new RegExp(`^${name}=$`, "m"), name);
  }
  assert.match(example, /^ATTACHMENT_WRITE_PROVIDER=supabase$/m);
  assert.match(example, /^ATTACHMENT_DUAL_WRITE=0$/m);
  assert.doesNotMatch(example, /NEXT_PUBLIC_R2|NEXT_PUBLIC_ATTACHMENT/);
});

test("aws4fetch is the only new storage dependency", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.ok(pkg.dependencies.aws4fetch);
  assert.equal(Object.keys(pkg.dependencies).some((name) => name.startsWith("@aws-sdk/")), false);
});
