import test from "node:test";
import assert from "node:assert/strict";

import {
  CUSTOMER_LOCATION_UPDATE_REPORT_ONLY,
  evaluateCustomerLocationUpdatePrompt,
  maybePromptCustomerLocationUpdate,
} from "../app/lib/customerLocation.js";
import {
  classifyCustomerGpsWriteBlock,
  buildCustomerGpsReportOnlyMessage,
} from "../app/lib/customerGpsWriteGuard.js";
import {
  MADIBA_STORE_LATITUDE,
  MADIBA_STORE_LONGITUDE,
} from "../app/lib/madibaStoreLocation.js";

const STORE = {
  latitude: MADIBA_STORE_LATITUDE,
  longitude: MADIBA_STORE_LONGITUDE,
};

test("classifyCustomerGpsWriteBlock flags store and nearby home pins", () => {
  assert.equal(classifyCustomerGpsWriteBlock(STORE, [])?.reason, "store");
  assert.equal(
    classifyCustomerGpsWriteBlock(
      { latitude: 24.7, longitude: 46.7 },
      [{ latitude: 24.70001, longitude: 46.70001 }],
    )?.reason,
    "home",
  );
  assert.equal(
    classifyCustomerGpsWriteBlock(
      { latitude: 24.71, longitude: 46.71 },
      [{ latitude: 24.7, longitude: 46.7 }],
    ),
    null,
  );
});

test("evaluateCustomerLocationUpdatePrompt warns for store without saving", async () => {
  const prompt = await evaluateCustomerLocationUpdatePrompt({
    customerCode: "1278",
    customerName: "seven hill",
    entryLocation: STORE,
    accessToken: "token",
    language: "en",
    customer: { customer_code: "1278", latitude: null, longitude: null },
    skipReverseGeocode: true,
  });

  assert.equal(prompt.reportOnlyBlocked, true);
  assert.equal(prompt.autoPromote, false);
  assert.equal(prompt.updatePayload, null);
  assert.match(prompt.message, /report/i);
  assert.match(prompt.message, /MADIBA store/i);
});

test("maybePromptCustomerLocationUpdate returns report_only for store GPS", async () => {
  let seen = null;
  const choice = await maybePromptCustomerLocationUpdate({
    customerCode: "1278",
    entryLocation: STORE,
    accessToken: "token",
    language: "en",
    customer: { customer_code: "1278", latitude: null, longitude: null },
    skipReverseGeocode: true,
    promptChoice: async (details) => {
      seen = details;
      return CUSTOMER_LOCATION_UPDATE_REPORT_ONLY;
    },
  });

  assert.equal(choice, CUSTOMER_LOCATION_UPDATE_REPORT_ONLY);
  assert.equal(seen?.reportOnlyBlocked, true);
});

test("report-only copy covers home and store", () => {
  assert.match(buildCustomerGpsReportOnlyMessage({ reason: "home" }), /home location/i);
  assert.match(buildCustomerGpsReportOnlyMessage({ reason: "store", language: "ar" }), /ماديبا/);
});
