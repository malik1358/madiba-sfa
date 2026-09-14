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
  assert.match(source, /queueFirst: typeof navigator !== "undefined" && navigator\.onLine === false/);
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
  assert.match(source, /if \(!offline\)/);
});
