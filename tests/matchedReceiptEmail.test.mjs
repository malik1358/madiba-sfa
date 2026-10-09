import test from "node:test";
import assert from "node:assert/strict";
import { buildMatchedReceiptEmail } from "../app/lib/matchedReceiptEmail.js";
import { runMatchedReceiptEmailCycle } from "../app/lib/matchedReceiptEmailServer.js";
import { buildReceiptsNotInTallyReport, markReceiptAsMistake } from "../app/lib/receiptsNotInTallyServer.js";

const mailEnv = {
  SMTP_HOST: "smtp.example.com",
  SMTP_FROM: "noreply@example.com",
};

function sampleGroup() {
  return {
    salesman: {
      salesman_code: "S01",
      salesman_name: "Sales One",
      report_email: "reports@example.com",
      email: "profile@example.com",
    },
    rows: [
      {
        visit: {
          id: "visit-1",
          visit_date: "2026-10-08",
          saved_at: "2026-10-08T09:00:00Z",
          customer_code: "C1",
          customer_name: "Shop One",
          amount_received: 100,
          created_by: "collector-1",
          collector_name: "Collector One",
          salesman_code: "S01",
        },
        tally: { receipt_date: "2026-10-08", vch_no: "R-100", amount: 100 },
      },
    ],
  };
}

function createReportAdmin(ignoredValue = "{}") {
  const tableRows = {
    system_settings: [
      {
        setting_key: "receipt_register_dataset_v1",
        setting_value: JSON.stringify({ rows: [{
          receipt_date: "2026-10-08",
          customer_code: "C1",
          customer_name: "Shop One",
          amount: 100,
          vch_no: "R-100",
        }] }),
      },
      { setting_key: "receipts_not_in_tally_ignored_v1", setting_value: ignoredValue },
    ],
    collection_visits: [{
      id: 1,
      customer_code: "C1",
      visit_outcome: "FUNDS_RECEIVED",
      amount_received: 100,
      receipt_mode: "CASH",
      payment_status: "PAID",
      saved_at: "2026-10-08T09:00:00Z",
      created_by: "collector-1",
    }],
    customers: [{ customer_code: "C1", customer_name: "Shop One", current_salesman_code: "S01" }],
    profiles: [{ id: "collector-1", role: "collector", salesman_name: "Collector One" }],
  };

  return {
    from(table) {
      let rows = tableRows[table] || [];
      const filters = [];
      const query = {
        select() { return query; },
        eq(column, value) { filters.push((row) => row[column] === value); return query; },
        gt(column, value) { filters.push((row) => Number(row[column]) > Number(value)); return query; },
        gte(column, value) { filters.push((row) => String(row[column]) >= String(value)); return query; },
        lte(column, value) { filters.push((row) => String(row[column]) <= String(value)); return query; },
        order() { return query; },
        in(column, values) { filters.push((row) => values.includes(row[column])); return query; },
        maybeSingle() {
          const found = (tableRows[table] || []).filter((row) => filters.every((filter) => filter(row)))[0] || null;
          return Promise.resolve({ data: found, error: null });
        },
        then(resolve, reject) {
          rows = (tableRows[table] || []).filter((row) => filters.every((filter) => filter(row)));
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
}

test("matched receipt email renders salesman, customer, collector and matched voucher", () => {
  const email = buildMatchedReceiptEmail({ dateLabel: "2026-10-08", salesmanGroups: [sampleGroup()] });
  assert.equal(email.receiptCount, 1);
  assert.equal(email.totalAmount, 100);
  assert.match(email.subject, /Matched app receipts/);
  assert.match(email.html, /Sales One/);
  assert.match(email.html, /Shop One/);
  assert.match(email.html, /Collector One/);
  assert.match(email.html, /R-100/);
  assert.match(email.text, /Only app receipts matched/);
});

test("upload matching uses changed Tally dates and test preview sends to Malik without claiming", async () => {
  const sent = [];
  const claims = [];
  const group = sampleGroup();
  group.rows.push({
    ...group.rows[0],
    visit: { ...group.rows[0].visit, id: "visit-2" },
    tally: { ...group.rows[0].tally, receipt_date: "2026-10-09", vch_no: "R-101" },
  });

  const result = await runMatchedReceiptEmailCycle({}, {
    uploadDates: ["2026-10-08"],
    preview: true,
    to: "malik@pinasz.com",
    now: new Date("2026-10-09T21:35:00Z"),
    env: mailEnv,
    loadData: async (_admin, options) => {
      const rows = group.rows.filter((row) => options.dateFilter({
        appDate: row.visit.visit_date,
        tallyDate: row.tally.receipt_date,
        visit: row.visit,
        tally: row.tally,
      }));
      return { groups: new Map([["S01", { ...group, rows }]]) };
    },
    claim: async (...args) => claims.push(args),
    send: async (message) => { sent.push(message); return { id: "preview-id" }; },
  });

  assert.equal(result.preview, true);
  assert.equal(result.matchedCount, 1);
  assert.equal(result.sentCount, 1);
  assert.equal(result.claimedCount, 0);
  assert.deepEqual(sent[0].to, ["malik@pinasz.com"]);
  assert.equal(claims.length, 0);
  assert.match(sent[0].html, /R-100/);
  assert.doesNotMatch(sent[0].html, /R-101/);
});

test("daily matched email is gated until preview approval", async () => {
  let loaded = false;
  const result = await runMatchedReceiptEmailCycle({}, {
    date: "2026-10-08",
    env: mailEnv,
    loadData: async () => { loaded = true; return { groups: new Map() }; },
  });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "salesman_delivery_disabled_until_preview_approval");
  assert.equal(loaded, false);
});

test("normal matched email claims each app visit once and prefers report email", async () => {
  const sent = [];
  const claimed = [];
  const completed = [];
  const result = await runMatchedReceiptEmailCycle({}, {
    date: "2026-10-08",
    now: new Date("2026-10-09T21:35:00Z"),
    env: { ...mailEnv, MATCHED_RECEIPT_EMAIL_ENABLED: "true" },
    loadData: async () => ({ groups: new Map([["S01", sampleGroup()]]) }),
    claim: async (_admin, claimId) => { claimed.push(claimId); return true; },
    complete: async (_admin, claimIds) => completed.push(...claimIds),
    send: async (message) => { sent.push(message); return { id: "provider-id" }; },
  });

  assert.equal(result.sentCount, 1);
  assert.equal(result.claimedCount, 1);
  assert.deepEqual(claimed, ["visit-1:salesman:S01"]);
  assert.deepEqual(completed, ["visit-1:salesman:S01"]);
  assert.deepEqual(sent[0].to, ["reports@example.com"]);
});

test("already-claimed matched receipts are not sent twice", async () => {
  let sent = false;
  const result = await runMatchedReceiptEmailCycle({}, {
    date: "2026-10-08",
    env: { ...mailEnv, MATCHED_RECEIPT_EMAIL_ENABLED: "true" },
    loadData: async () => ({ groups: new Map([["S01", sampleGroup()]]) }),
    claim: async () => false,
    send: async () => { sent = true; },
  });
  assert.equal(result.sentCount, 0);
  assert.equal(result.claimedCount, 0);
  assert.equal(sent, false);
});

function bossReportingFixture() {
  const first = sampleGroup();
  first.salesman = { ...first.salesman, id: "sales-1" };
  const second = sampleGroup();
  second.salesman = {
    ...second.salesman,
    id: "sales-2",
    salesman_code: "S02",
    salesman_name: "Sales Two",
    report_email: "sales-two@example.com",
  };
  second.rows = second.rows.map((row) => ({
    ...row,
    visit: { ...row.visit, id: "visit-2", salesman_code: "S02", customer_code: "C2", customer_name: "Shop Two" },
    tally: { ...row.tally, vch_no: "R-200" },
  }));
  const boss = {
    id: "boss-1",
    role: "manager",
    salesman_code: "BOSS",
    salesman_name: "Team Boss",
    report_email: "boss@example.com",
    is_active: true,
  };
  return {
    groups: new Map([["S01", first], ["S02", second]]),
    profiles: [boss, first.salesman, second.salesman],
    authUsers: [
      { id: "sales-1", user_metadata: { head_salesman_code: "BOSS" } },
      { id: "sales-2", user_metadata: { head_salesman_code: "BOSS" } },
      { id: "boss-1", user_metadata: {} },
    ],
  };
}

test("daily run sends separate salesman emails and one consolidated email to their boss", async () => {
  const sent = [];
  const claimed = [];
  const completed = [];
  const fixture = bossReportingFixture();
  const result = await runMatchedReceiptEmailCycle({}, {
    date: "2026-10-08",
    now: new Date("2026-10-09T21:35:00Z"),
    env: { ...mailEnv, MATCHED_RECEIPT_EMAIL_ENABLED: "true" },
    loadData: async () => fixture,
    claim: async (_admin, claimId) => { claimed.push(claimId); return true; },
    complete: async (_admin, claimIds) => completed.push(...claimIds),
    send: async (message) => { sent.push(message); return { id: `email-${sent.length}` }; },
  });

  assert.equal(result.sentCount, 3);
  assert.equal(result.claimedCount, 4);
  assert.equal(result.sentBosses.length, 1);
  assert.deepEqual(sent.map((message) => message.to[0]).sort(), [
    "boss@example.com",
    "reports@example.com",
    "sales-two@example.com",
  ]);
  const bossMail = sent.find((message) => message.to[0] === "boss@example.com");
  assert.match(bossMail.subject, /Consolidated/);
  assert.match(bossMail.html, /Sales One/);
  assert.match(bossMail.html, /Sales Two/);
  assert.equal(sent.filter((message) => message.to[0] === "boss@example.com").length, 1);
  assert.ok(claimed.includes("visit-1:boss:boss-1"));
  assert.ok(claimed.includes("visit-2:boss:boss-1"));
  assert.equal(completed.length, 4);
});

test("receipt-register upload trigger sends salesman mail without a separate boss digest", async () => {
  const sent = [];
  const fixture = bossReportingFixture();
  const result = await runMatchedReceiptEmailCycle({}, {
    uploadDates: ["2026-10-08"],
    now: new Date("2026-10-09T12:00:00Z"),
    env: { ...mailEnv, MATCHED_RECEIPT_EMAIL_ENABLED: "true" },
    loadData: async () => fixture,
    claim: async () => true,
    complete: async () => {},
    send: async (message) => { sent.push(message); return { id: `email-${sent.length}` }; },
  });

  assert.equal(result.sentCount, 2);
  assert.deepEqual(sent.map((message) => message.to[0]).sort(), [
    "reports@example.com",
    "sales-two@example.com",
  ]);
  assert.equal(sent.some((message) => message.to[0] === "boss@example.com"), false);
});

test("daily boss digest includes later-matched month-to-date receipts while salesman mail stays daily", async () => {
  const sent = [];
  const fixture = bossReportingFixture();
  fixture.groups.get("S02").rows[0].visit.visit_date = "2026-10-01";
  fixture.groups.get("S02").rows[0].tally.receipt_date = "2026-10-01";
  let loads = 0;
  const result = await runMatchedReceiptEmailCycle({}, {
    date: "2026-10-08",
    now: new Date("2026-10-09T21:35:00Z"),
    env: { ...mailEnv, MATCHED_RECEIPT_EMAIL_ENABLED: "true" },
    loadData: async (_admin, options) => {
      loads += 1;
      if (loads === 1) {
        assert.equal(options.fromDate, "2026-10-08");
        assert.equal(options.toDate, "2026-10-08");
        return { ...fixture, groups: new Map([["S01", fixture.groups.get("S01")]]) };
      }
      assert.equal(options.fromDate, "2026-10-01");
      assert.equal(options.toDate, "2026-10-10");
      assert.equal(options.dateFilter, null);
      return fixture;
    },
    claim: async () => true,
    complete: async () => {},
    send: async (message) => { sent.push(message); return { id: `email-${sent.length}` }; },
  });

  assert.equal(result.sentCount, 2);
  assert.deepEqual(sent.map((message) => message.to[0]).sort(), ["boss@example.com", "reports@example.com"]);
  const bossMail = sent.find((message) => message.to[0] === "boss@example.com");
  assert.match(bossMail.html, /R-200/);
  assert.equal(sent.filter((message) => message.to[0] === "boss@example.com").length, 1);
});

test("reconciliation exposes matched pairs only for trusted internal use and enriches owner", async () => {
  const admin = createReportAdmin();
  const publicReport = await buildReceiptsNotInTallyReport(admin, {
    fromDate: "2026-10-08",
    toDate: "2026-10-08",
  });
  assert.equal(Object.hasOwn(publicReport, "matched"), false);
  assert.equal(publicReport.summary.matchedCount, 1);

  const internalReport = await buildReceiptsNotInTallyReport(admin, {
    fromDate: "2026-10-08",
    toDate: "2026-10-08",
    includeMatched: true,
  });
  assert.equal(internalReport.matched[0].visit.salesman_code, "S01");
  assert.equal(internalReport.matched[0].visit.collector_name, "Collector One");
  assert.equal(internalReport.matched[0].tally.vch_no, "R-100");
});

test("previously resolved Error rows stay out of matched email after a later register match", async () => {
  const admin = createReportAdmin(JSON.stringify({ byVisitId: { "1": { note: "error" } } }));
  const report = await buildReceiptsNotInTallyReport(admin, {
    fromDate: "2026-10-08",
    toDate: "2026-10-08",
    includeMatched: true,
  });
  assert.equal(report.summary.matchedCount, 0);
  assert.equal(report.matched.length, 0);
  assert.equal(report.ignoredInTally[0].resolution, "error");
});

test("receipt uploader resolution records Error or Duplicate distinctly", async () => {
  let storedValue = "";
  const admin = {
    from() {
      return {
        select() { return this; },
        eq() { return this; },
        maybeSingle: async () => ({ data: { setting_value: storedValue || "{}" }, error: null }),
        upsert: async (row) => { storedValue = row.setting_value; return { error: null }; },
      };
    },
  };

  await markReceiptAsMistake(admin, { visitId: "visit-error", note: "error" });
  await markReceiptAsMistake(admin, { visitId: "visit-duplicate", note: "duplicate" });
  const stored = JSON.parse(storedValue);
  assert.equal(stored.byVisitId["visit-error"].note, "error");
  assert.equal(stored.byVisitId["visit-duplicate"].note, "duplicate");
});