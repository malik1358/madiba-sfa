import test from "node:test";
import assert from "node:assert/strict";

import {
  visitReportRowBackground,
  visitReportRowClassName,
  visitReportRowTone,
} from "../app/lib/visitReportRowColors.js";

test("visit report row tones follow transaction type", () => {
  assert.equal(visitReportRowTone({ transactionType: "MORNING_ATTENDANCE" }), "login");
  assert.equal(visitReportRowTone({ transactionType: "ORDER_SUBMITTED" }), "order");
  assert.equal(visitReportRowTone({ transactionType: "COLLECTION_VISIT" }), "collection");
  assert.equal(visitReportRowTone({ transactionType: "GPS_PING" }), "idle");
  assert.equal(
    visitReportRowTone(
      { transactionType: "GPS_PING", savedAt: "2026-09-01T10:00:00.000Z" },
      [{ fromAt: "2026-09-01T09:00:00.000Z", toAt: "2026-09-01T11:00:00.000Z" }],
    ),
    "unlogged-idle",
  );
  assert.equal(visitReportRowBackground({ transactionType: "VISIT_REPORT" }), "#dbeafe");
  assert.match(visitReportRowClassName({ transactionType: "COLLECTION_VISIT", isFarFromCustomer: true }), /visitReportRow-far/);
});
