import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCollectionVisitSummary,
  isPriorityCollectionVisit,
  patchCollectionVisitSummaryEnglishRemark,
  patchCollectionVisitSummaryVisitDistance,
  patchCollectionVisitSummaryVisitNumber,
} from "../app/lib/collectionVisitSummary.js";

test("isPriorityCollectionVisit marks high and medium probability as priority", () => {
  assert.equal(isPriorityCollectionVisit({ probabilityLabel: "High" }).isPriority, true);
  assert.equal(isPriorityCollectionVisit({ probabilityLabel: "Medium" }).isPriority, true);
  assert.equal(isPriorityCollectionVisit({ probabilityLabel: "Low" }).isPriority, false);
  assert.equal(isPriorityCollectionVisit({ queuePriority: 4 }).isPriority, true);
});

test("buildCollectionVisitSummary includes queue priority and outstanding buckets", () => {
  const summary = buildCollectionVisitSummary(
    {
      customer_name: "Acme Trading",
      customer_code: "1009",
      salesman_name: "Junaid",
      outstanding_0_30: 1000,
      outstanding_30_60: 2000,
      outstanding_61_90: 0,
      outstanding_91_120: 0,
      outstanding_above_120: 0,
    },
    {
      visitOutcome: "FUNDS_RECEIVED",
      amountReceived: "500",
      receiptMode: "CASH",
      nextVisitAt: "2026-08-30",
      remarkArabic: "",
      remarkEnglish: "",
    },
    { queuePriority: 3, visitNumberForDay: 2 },
  );

  assert.match(summary, /Queue priority: 3/);
  assert.match(summary, /Customer: Acme Trading/);
  assert.match(summary, /0-30: 1,000/);
  assert.match(summary, /Visit number today: 2/);
  assert.match(summary, />120: 0\n\nGPS: -/);
  assert.match(summary, /Distance from customer: -/);
  assert.match(summary, /Est. waiting: -/);
});

test("buildCollectionVisitSummary includes last visit date, outcome, remarks, and amount when present", () => {
  const summary = buildCollectionVisitSummary(
    {
      customer_name: "1071C ART MART LIMITED",
      customer_code: "1071C",
      salesman_name: "Ahmed Nabil",
      outstanding_0_30: 0,
      outstanding_30_60: 0,
      outstanding_61_90: 0,
      outstanding_91_120: 0,
      outstanding_above_120: 1609.65,
    },
    {
      visitOutcome: "ASKED_COME_LATER",
      amountReceived: "0",
      receiptMode: "",
      nextVisitAt: "2026-09-14",
      remarkArabic: "سوف يتم التحويل اليوم باذن الله",
      remarkEnglish: "The transfer will be done today, God willing",
    },
    {
      visitNumberForDay: 33,
      probabilityLabel: "Medium",
      lastVisit: {
        saved_at: "2026-09-10T10:00:00.000Z",
        visit_outcome: "FUNDS_RECEIVED",
        amount_received: 250,
        remark_arabic: "تم التحصيل جزئياً",
        remark_english: "Partial collection completed",
      },
    },
  );

  assert.match(summary, /Last visit date: 10\/09\/2026/);
  assert.match(summary, /Last visit outcome: Funds received/);
  assert.match(summary, /Last visit amount received: 250/);
  assert.match(summary, /Last visit remark \(Arabic\): تم التحصيل جزئياً/);
  assert.match(summary, /Last visit remark \(English\): Partial collection completed/);
  assert.match(summary, /Visit number today: 33\./);
  assert.match(summary, /Est\. waiting: -\n\nLast visit date:/);
  assert.doesNotMatch(summary, /Visit number today: 33\.\nLast visit date:/);
  assert.doesNotMatch(summary, /Last visit date:[\s\S]*Outstanding:/);
});

test("buildCollectionVisitSummary places last visit after GPS as a separate trailing block", () => {
  const summary = buildCollectionVisitSummary(
    {
      customer_name: "1094 BLUE CRYSTAL STATIONERY",
      customer_code: "1094",
      salesman_name: "Junaid",
      outstanding_0_30: 0,
      outstanding_30_60: 0,
      outstanding_61_90: 2961.25,
      outstanding_91_120: 228.8,
      outstanding_above_120: 0,
    },
    {
      visitOutcome: "FUNDS_RECEIVED",
      amountReceived: "3190",
      receiptMode: "CASH",
      nextVisitAt: "2026-09-14",
    },
    {
      visitNumberForDay: 11,
      queuePriority: 10,
      probabilityLabel: "Medium",
      lastVisit: {
        saved_at: "2026-09-13T10:00:00.000Z",
        visit_outcome: "FUNDS_RECEIVED",
        amount_received: 3190,
      },
      visitDistance: {
        latitude: 24.674411,
        longitude: 46.728291,
        distanceFromCustomerKm: 0.15,
        distanceFromPreviousKm: 0.02,
        waitingMinutes: 1,
      },
    },
  );

  const visitNumberIndex = summary.indexOf("Visit number today: 11.");
  const outstandingIndex = summary.indexOf("Outstanding:");
  const gpsIndex = summary.indexOf("GPS:");
  const lastVisitIndex = summary.indexOf("Last visit date:");

  assert.ok(visitNumberIndex > 0);
  assert.ok(outstandingIndex > visitNumberIndex);
  assert.ok(gpsIndex > outstandingIndex);
  assert.ok(lastVisitIndex > gpsIndex);
  assert.match(summary, /Est\. waiting: 1 min\n\nLast visit date: 13\/09\/2026\./);
});

test("buildCollectionVisitSummary omits last visit amount when zero and skips empty last visit", () => {
  const withoutAmount = buildCollectionVisitSummary(
    {
      customer_name: "Acme",
      customer_code: "1009",
      salesman_name: "Junaid",
      outstanding_0_30: 0,
      outstanding_30_60: 0,
      outstanding_61_90: 0,
      outstanding_91_120: 0,
      outstanding_above_120: 0,
    },
    {
      visitOutcome: "ASKED_COME_LATER",
      amountReceived: "0",
      nextVisitAt: "2026-09-14",
    },
    {
      lastVisit: {
        saved_at: "2026-09-01T08:00:00.000Z",
        visit_outcome: "ASKED_COME_LATER",
        amount_received: 0,
        remark_arabic: "لاحقاً",
        remark_english: "Later",
      },
    },
  );

  assert.match(withoutAmount, /Last visit date: 01\/09\/2026/);
  assert.match(withoutAmount, /Last visit outcome: Asked to come later/);
  assert.doesNotMatch(withoutAmount, /Last visit amount received/);
  assert.match(withoutAmount, /Last visit remark \(Arabic\): لاحقاً/);

  const withoutLastVisit = buildCollectionVisitSummary(
    {
      customer_name: "Acme",
      customer_code: "1009",
      salesman_name: "Junaid",
      outstanding_0_30: 0,
      outstanding_30_60: 0,
      outstanding_61_90: 0,
      outstanding_91_120: 0,
      outstanding_above_120: 0,
    },
    {
      visitOutcome: "ASKED_COME_LATER",
      amountReceived: "0",
      nextVisitAt: "2026-09-14",
    },
    {},
  );

  assert.doesNotMatch(withoutLastVisit, /Last visit date/);
});

test("patchCollectionVisitSummaryVisitNumber replaces stale visit numbers in stored summaries", () => {
  const stored = `Customer: Khaled Waleed Bin Salem Al Mahri Electronic Est.
Queue priority: 12.
Payment probability: High.
Code: 1164C
Salesman: Abdul Rehman
Outcome: Funds received
Amount received: 1,500.
Receipt mode: Cash.
Next visit: 31/08/2026.
Visit number today: 1.
Outstanding:
0-30: 0
31-60: 0
61-90: 0
91-120: 0
>120: 5,311`;

  const patched = patchCollectionVisitSummaryVisitNumber(stored, 11);
  assert.match(patched, /^Visit number today: 11\.$/m);
  assert.doesNotMatch(patched, /^Visit number today: 1\.$/m);
});

test("patchCollectionVisitSummaryVisitDistance replaces wrong waiting with report value", () => {
  const stored = `Customer: 1216C Qaryah Sweileh Trading Company
Queue priority: 1.
Payment probability: High.
Code: 1216C
Salesman: Osama
Outcome: Asked to come later
Next visit: 12/09/2026.
Visit number today: 6.
Outstanding:
0-30: 0
31-60: 0
61-90: 0
91-120: 0
>120: 13,332.97

Distance from customer: 0.34 km
Distance from previous: 27.69 km
Est. waiting: 4h 22m

Last visit date: 10/09/2026.
Last visit outcome: Funds received.`;

  const patched = patchCollectionVisitSummaryVisitDistance(stored, {
    distanceFromCustomerKm: 0.34,
    distanceFromPreviousKm: 0.34,
    waitingMinutes: 39,
  });

  assert.match(patched, /Distance from customer: 0\.34 km/);
  assert.match(patched, /Distance from previous: 0\.34 km/);
  assert.match(patched, /Est\. waiting: 39 min/);
  assert.doesNotMatch(patched, /4h 22m/);
  assert.doesNotMatch(patched, /27\.69 km/);
  assert.match(patched, /Est\. waiting: 39 min\n\nLast visit date: 10\/09\/2026\./);
  assert.match(patched, /Last visit outcome: Funds received\./);
});

test("patchCollectionVisitSummaryEnglishRemark replaces stale English remarks", () => {
  const stored = `Customer: 1204C  News Gate Trading Company
Queue priority: 61.
Payment probability: High.
Code: 1204C
Salesman: Junaid
Outcome: Asked to come later
Remark (Arabic): السبب وهو استاذ يوسف صاحب الشركة عنده حالة وفاة حالياً والمكتب الاداري مقفل الحين وسوف يتم الدوام مرة اخرى يوم الاربعاء ان شاء الله.
Remark (English): Will transfer today.
Next visit: 09/09/2026.
Visit number today: 1.
Outstanding:
0-30: 0
31-60: 10,028.85
61-90: 2,850.28
91-120: 0
>120: 0`;

  const corrected = "The reason is Mr. Youssef, the owner of the company, currently has a death case and the administrative office is closed now, and it will be open again on Wednesday, God willing.";
  const patched = patchCollectionVisitSummaryEnglishRemark(stored, corrected);

  assert.match(patched, new RegExp(`^Remark \\(English\\): ${corrected.replace(/\.+$/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.$`, "m"));
  assert.doesNotMatch(patched, /Remark \(English\): Will transfer today\./);
  assert.doesNotMatch(patched, /\.\.$/m);
  assert.match(patched, /Remark \(Arabic\): السبب وهو استاذ يوسف/);
});
