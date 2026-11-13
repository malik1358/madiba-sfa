import test from "node:test";
import assert from "node:assert/strict";
import { resolveMisCatalogs } from "../app/lib/misReportServer.js";

test("resolveMisCatalogs returns embedded report catalogs without network", () => {
  const embedded = { categories: ["A", "B"], salesmen: [{ code: "S1" }] };
  assert.deepEqual(resolveMisCatalogs({ catalogs: embedded }), embedded);
  assert.deepEqual(resolveMisCatalogs({ headline: {} }), {});
  assert.deepEqual(resolveMisCatalogs(null), {});
  assert.deepEqual(resolveMisCatalogs({ catalogs: [] }), {});
});
