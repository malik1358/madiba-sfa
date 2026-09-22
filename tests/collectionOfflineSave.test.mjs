import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("payment collections queue select includes mobile for offline saves", () => {
  const source = fs.readFileSync(new URL("../app/api/payment-collections/route.js", import.meta.url), "utf8");
  assert.match(source, /CUSTOMER_COLLECTION_SELECT = "[^"]*mobile[^"]*"/);
  assert.match(source, /mobile: customer\.mobile \|\| ""/);
});

test("collection save path uses local customer data and resilient offline helpers", () => {
  const source = fs.readFileSync(
    new URL("../app/management/payment-collections/PaymentCollectionsView.jsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /sendJsonResilient/);
  assert.match(source, /customer: row/);
  assert.match(source, /skipReverseGeocode: offline/);
  assert.match(source, /scope: salesScope/);
  assert.match(source, /queueFirst: offline \|\| !hasAttachments/);
  assert.match(source, /timeoutMs: hasAttachments \? 45000 : 12000/);
  assert.match(source, /skipTimeline: true/);
  assert.match(source, /row\.avg_days_to_pay/);
  assert.match(source, /COLLECTION_TRANSLATE_TIMEOUT_MS = 2500/);
  assert.doesNotMatch(source, /loadCustomerAvgDaysToPay/);
  assert.match(source, /receipt-copy\.pdf/);
  assert.match(source, /setSavingCustomerCode\(""\);/);
  assert.match(source, /void loadQueue\(rowKey\(row\)\);/);
  assert.match(source, /attachmentSelected/);
});

test("online collection uploads skip IndexedDB serialization until queueing", () => {
  const source = fs.readFileSync(new URL("../app/lib/offlineApi.js", import.meta.url), "utf8");
  assert.match(source, /Only serialize files into IndexedDB when we actually need to queue/);
  assert.match(source, /async function queueForSync\(\) \{\s*const payload = await formDataToOfflinePayload\(formData\);/s);
});

test("photo prepare path bounds image load and canvas compression", () => {
  const source = fs.readFileSync(new URL("../app/lib/compressUploadFile.js", import.meta.url), "utf8");
  assert.match(source, /IMAGE_LOAD_TIMEOUT_MS/);
  assert.match(source, /CANVAS_BLOB_TIMEOUT_MS/);
  assert.match(source, /readUploadHeader/);
  assert.match(source, /Fall back to the original bytes/);
});

test("payment-collections bucket MIME refresh must not block uploads", () => {
  const source = fs.readFileSync(new URL("../app/api/payment-collections/route.js", import.meta.url), "utf8");
  assert.match(source, /Never block attachment saves if updateBucket/);
  assert.match(source, /sniffUploadHeader/);
  assert.match(source, /image\/jpg/);
});

test("legal remove uses a long PATCH timeout and skips office GPS", () => {
  const viewSource = fs.readFileSync(
    new URL("../app/management/payment-collections/PaymentCollectionsView.jsx", import.meta.url),
    "utf8",
  );
  const apiSource = fs.readFileSync(
    new URL("../app/api/payment-collections/route.js", import.meta.url),
    "utf8",
  );
  assert.match(viewSource, /timeoutMs: 60000/);
  assert.match(viewSource, /skipGpsForOfficeRemove/);
  assert.match(apiSource, /shouldRequireGpsAccessGate\(scope\.userRole\)/);
  assert.match(apiSource, /Skip rebuilding the full outstanding queue/);
});

test("visit distance metrics skip supabase timeline while offline", () => {
  const source = fs.readFileSync(new URL("../app/lib/visitDistanceWhatsapp.js", import.meta.url), "utf8");
  assert.match(source, /navigator\.onLine === false/);
  assert.match(source, /if \(!offline && !skipTimeline\)/);
  assert.match(source, /skipTimeline = false/);
  assert.match(source, /timelineTimeoutMs = 0/);
});

test("collection saves are offline-first without attachments", () => {
  const source = fs.readFileSync(
    new URL("../app/management/payment-collections/PaymentCollectionsView.jsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /Text-only visits: save on-device first/);
  assert.match(source, /queueFirst: offline \|\| !hasAttachments/);
});
