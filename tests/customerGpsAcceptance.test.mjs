import test from "node:test";
import assert from "node:assert/strict";
import { applyCustomerLocationUpdateFromPrompt } from "../app/lib/customerLocation.js";
import { CUSTOMER_GPS_SOURCE, gpsSourceLabel } from "../app/lib/customerGpsHistory.js";

test("confirmed overwrites retain acceptance while automatic promotions do not", async () => {
  const originalFetch = globalThis.fetch;
  const payloads = [];
  globalThis.fetch = async (url, options) => {
    payloads.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ success: true, customer: {} }) };
  };
  try {
    for (const autoPromote of [false, true]) {
      await applyCustomerLocationUpdateFromPrompt({
        accessToken: "test-session",
        customerCode: "1415",
        updatePayload: { latitude: 24.7, longitude: 46.6 },
        autoPromote,
      });
    }
    assert.equal(payloads[0].locationUpdateAccepted, true);
    assert.equal(payloads[1].locationUpdateAccepted, false);
    assert.equal(gpsSourceLabel(CUSTOMER_GPS_SOURCE.salesmanAccepted), "Salesman accepted");
  } finally {
    globalThis.fetch = originalFetch;
  }
});