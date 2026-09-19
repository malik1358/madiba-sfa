import test from "node:test";
import assert from "node:assert/strict";

import {
  ensureNamedUploadFile,
  isGenericUploadMimeType,
  resolveUploadContentType,
  storageExtensionFromUpload,
} from "../app/lib/collectionUploadFile.js";

test("treats Android octet-stream PDFs as application/pdf by filename", () => {
  assert.equal(isGenericUploadMimeType("application/octet-stream"), true);
  assert.equal(
    resolveUploadContentType({ name: "receipt (1).pdf", type: "application/octet-stream" }),
    "application/pdf",
  );
  assert.equal(storageExtensionFromUpload({ name: "receipt (1).pdf", type: "application/octet-stream" }), "pdf");
});

test("sniffs PDF magic bytes when MIME and extension are missing", () => {
  const buffer = new TextEncoder().encode("%PDF-1.4 sample");
  assert.equal(
    resolveUploadContentType({ name: "document", type: "application/octet-stream" }, buffer),
    "application/pdf",
  );
});

test("keeps real image MIME types", () => {
  assert.equal(
    resolveUploadContentType({ name: "photo.jpg", type: "image/jpeg" }),
    "image/jpeg",
  );
  assert.equal(
    resolveUploadContentType({ name: "scan.png", type: "application/octet-stream" }),
    "image/png",
  );
});

test("ensureNamedUploadFile rewrites octet-stream PDF files", () => {
  const raw = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "bank-slip.pdf", {
    type: "application/octet-stream",
  });
  const normalized = ensureNamedUploadFile(raw, "receipt-copy.pdf");
  assert.equal(normalized.type, "application/pdf");
  assert.equal(normalized.name, "bank-slip.pdf");
});
