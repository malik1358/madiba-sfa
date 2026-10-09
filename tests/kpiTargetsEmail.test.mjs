import test from "node:test";
import assert from "node:assert/strict";

import {
  buildKpiTargetsEmail,
  changedKpiTargetKeys,
  resolveKpiTargetEmailRecipients,
} from "../app/lib/kpiTargetsEmail.js";
import { runKpiTargetsEmailCycle } from "../app/lib/kpiTargetsEmailServer.js";

test("KPI target change detection catches edits and additions but ignores unchanged values", () => {
  assert.deepEqual(changedKpiTargetKeys({ collection: 10 }, { collection: 10 }), []);
  assert.deepEqual(changedKpiTargetKeys({}, { officeSupplies: 100, newCustomers: 2 }), ["officeSupplies", "newCustomers"]);
  assert.deepEqual(changedKpiTargetKeys({ repeatCustomers: 5 }, { repeatCustomers: 0 }), ["repeatCustomers"]);
});

test("KPI email shows every current-month KPI and safely escapes names", () => {
  const email = buildKpiTargetsEmail({
    month: "2026-10",
    changedLabels: ["Collection"],
    snapshot: {
      salesmanName: "Ali <Sales>",
      kpis: [{ key: "collection", label: "Collection", actual: 50, target: 100, achievement: 50, status: { label: "Behind" } }],
    },
  });
  assert.match(email.subject, /2026-10/);
  assert.match(email.html, /Ali &lt;Sales&gt;/);
  assert.match(email.text, /Updated KPIs: Collection/);
  assert.match(email.text, /actual 50, target 100/);
});

test("KPI email recipients deduplicate salesman against every reporting boss", () => {
  assert.deepEqual(resolveKpiTargetEmailRecipients({
    reportEmail: "ali.report@madiba.com",
    email: "ali@madiba.com",
    chainEmails: ["boss@madiba.com", "top@madiba.com", "ali.report@madiba.com"],
  }), {
    to: ["ali.report@madiba.com"],
    cc: ["boss@madiba.com", "top@madiba.com"],
  });
});

test("monthly KPI send emails each salesman with the complete boss chain copied", async () => {
  const sent = [];
  const profiles = [
    { id: "ali", role: "salesman", salesman_code: "S01", salesman_name: "Ali", email: "ali@madiba.com", report_email: "ali.report@madiba.com", is_active: true },
    { id: "boss", role: "manager", salesman_code: "M01", salesman_name: "Boss", email: "boss@madiba.com", is_active: true },
    { id: "top", role: "admin", salesman_code: "A01", salesman_name: "Top Boss", email: "top@madiba.com", is_active: true },
  ];
  const result = await runKpiTargetsEmailCycle({}, {
    month: "2026-10",
    salesmanCodes: ["S01"],
    changedLabelsBySalesman: { S01: ["Collection"] },
    env: { SMTP_HOST: "smtp.example.com", SMTP_FROM: "sfa@madiba.com" },
    getProfiles: async () => profiles,
    listAuthUsers: async () => ([
      { id: "ali", user_metadata: { head_salesman_code: "M01" } },
      { id: "boss", user_metadata: { head_salesman_code: "A01" } },
      { id: "top", user_metadata: {} },
    ]),
    loadSnapshots: async (_admin, input) => {
      assert.deepEqual(input.salesmen, [{ salesmanCode: "S01", salesmanName: "Ali" }]);
      assert.equal(input.reportDate, "2026-10-01");
      return [{ salesmanCode: "S01", salesmanName: "Ali", kpis: [{ key: "collection", label: "Collection", actual: 50, target: 100, achievement: 50, status: { label: "Behind" } }] }];
    },
    send: async (message) => sent.push(message),
  });
  assert.equal(result.sentCount, 1);
  assert.deepEqual(sent[0].to, ["ali.report@madiba.com"]);
  assert.deepEqual(sent[0].cc, ["boss@madiba.com", "top@madiba.com"]);
  assert.match(sent[0].text, /Updated KPIs: Collection/);
});