import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCombinedVisitScore,
  buildSalesOpportunityScore,
  buildSalesmanVisitPlanDigestEmail,
  buildSalesmanVisitPlanEmail,
  groupVisitPlansBySalesman,
  isSalesmanVisitPlanEmailEnabled,
  isSalesmanVisitPlanSendToUsersEnabled,
  rankSalesmanVisitPlan,
  resolveVisitFocus,
  scoreVisitPlanCustomer,
} from "../app/lib/salesmanVisitPlan.js";
import {
  buildSalesmanVisitPlanPayload,
  mergeVisitPlanCustomerCandidates,
  sendSalesmanVisitPlanEmailsFromPayload,
} from "../app/lib/salesmanVisitPlanServer.js";
import {
  buildModuleAccess,
  isSalesmanVisitPlanSalesmanAccessApproved,
  localizedModuleLabel,
} from "../app/lib/moduleAccess.js";

test("sales opportunity prefers purchase-gap customers with strong recent value", () => {
  const hot = buildSalesOpportunityScore({
    recent_sales_value: 80000,
    days_since_last_invoice: 35,
    average_monthly_purchase: 15000,
    highest_monthly_sales: 30000,
  });
  const cold = buildSalesOpportunityScore({
    recent_sales_value: 1000,
    days_since_last_invoice: 3,
    average_monthly_purchase: 500,
    highest_monthly_sales: 800,
  });
  assert.ok(hot > cold);
  assert.ok(hot >= 70);
});

test("combined score boosts customers strong on both sales and collection", () => {
  assert.equal(buildCombinedVisitScore(80, 80) > buildCombinedVisitScore(80, 20), true);
  assert.equal(resolveVisitFocus(75, 70), "Both");
  assert.equal(resolveVisitFocus(75, 20), "Sales");
  assert.equal(resolveVisitFocus(20, 75), "Collection");
});

test("rankSalesmanVisitPlan orders by combined probability and caps the list", () => {
  const ranked = rankSalesmanVisitPlan([
    {
      customer_code: "A1",
      customer_name: "Alpha",
      salesman_code: "S1",
      recent_sales_value: 60000,
      days_since_last_invoice: 30,
      average_monthly_purchase: 12000,
      highest_monthly_sales: 20000,
      total_due_amount: 5000,
      probability_score: 40,
      probability_label: "Medium",
    },
    {
      customer_code: "B1",
      customer_name: "Beta",
      salesman_code: "S1",
      recent_sales_value: 70000,
      days_since_last_invoice: 32,
      average_monthly_purchase: 14000,
      highest_monthly_sales: 25000,
      total_due_amount: 25000,
      probability_score: 85,
      probability_label: "High",
      outstanding_cash: 5000,
    },
    {
      customer_code: "C1",
      customer_name: "Gamma",
      salesman_code: "S1",
      recent_sales_value: 2000,
      days_since_last_invoice: 5,
      total_due_amount: 0,
      probability_score: 0,
    },
  ], { limit: 2, todayIso: "2026-09-12T08:00:00.000Z" });

  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].customer_code, "B1");
  assert.equal(ranked[0].rank, 1);
  assert.equal(ranked[0].focus, "Both");
});

test("groupVisitPlansBySalesman builds one plan per salesman code", () => {
  const plans = groupVisitPlansBySalesman([
    {
      customer_code: "A1",
      customer_name: "Alpha",
      salesman_code: "S1",
      recent_sales_value: 50000,
      days_since_last_invoice: 28,
      average_monthly_purchase: 10000,
      total_due_amount: 8000,
      probability_score: 55,
      probability_label: "Medium",
    },
    {
      customer_code: "B1",
      customer_name: "Beta",
      salesman_code: "S2",
      recent_sales_value: 40000,
      days_since_last_invoice: 40,
      average_monthly_purchase: 9000,
      total_due_amount: 12000,
      probability_score: 60,
      probability_label: "Medium",
    },
  ], {
    limit: 5,
    todayIso: "2026-09-12T08:00:00.000Z",
    salesmanProfiles: [
      { salesman_code: "S1", salesman_name: "Sale One", report_email: "one@company.com" },
      { salesman_code: "S2", salesman_name: "Sale Two", email: "two@company.com" },
    ],
  });

  assert.equal(plans.length, 2);
  assert.equal(plans.find((plan) => plan.salesmanCode === "S1")?.email, "one@company.com");
});

test("email builders include ranked visit rows", () => {
  const plan = groupVisitPlansBySalesman([{
    customer_code: "A1",
    customer_name: "Alpha Trading",
    salesman_code: "S1",
    city: "Riyadh",
    area: "Olaya",
    recent_sales_value: 50000,
    days_since_last_invoice: 28,
    average_monthly_purchase: 10000,
    highest_monthly_sales: 18000,
    total_due_amount: 9000,
    probability_score: 70,
    probability_label: "High",
  }], {
    salesmanProfiles: [{ salesman_code: "S1", salesman_name: "Sale One" }],
    todayIso: "2026-09-12T08:00:00.000Z",
  })[0];

  const email = buildSalesmanVisitPlanEmail(plan, { reportDate: "2026-09-12", previewOnly: true });
  assert.match(email.subject, /Sale One/);
  assert.match(email.html, /Alpha Trading/);
  assert.match(email.html, /Admin preview/);

  const digest = buildSalesmanVisitPlanDigestEmail([plan], { reportDate: "2026-09-12" });
  assert.match(digest.subject, /digest/i);
  assert.match(digest.html, /Sale One/);
});

test("feature flags default on after promotion", () => {
  assert.equal(isSalesmanVisitPlanEmailEnabled({}), true);
  assert.equal(isSalesmanVisitPlanSendToUsersEnabled({}), true);
  assert.equal(isSalesmanVisitPlanSalesmanAccessApproved({}), true);
  assert.equal(isSalesmanVisitPlanEmailEnabled({ SALESMAN_VISIT_PLAN_EMAIL_ENABLED: "false" }), false);
  assert.equal(isSalesmanVisitPlanSalesmanAccessApproved({
    NEXT_PUBLIC_SALESMAN_VISIT_PLAN_SALESMAN_ACCESS: "false",
  }), false);
});

test("module access includes salesman visit plan for admin and field sales", () => {
  assert.equal(buildModuleAccess({ role: "admin" }).canAccess("salesmanVisitPlan"), true);
  assert.equal(buildModuleAccess({ role: "salesman", salesmanCode: "S1" }).canAccess("salesmanVisitPlan"), true);
  assert.equal(localizedModuleLabel("salesmanVisitPlan", "en"), "Salesman Visit Plan");
});

test("merge candidates keep sales metrics and collection probability", () => {
  const merged = mergeVisitPlanCustomerCandidates(
    [{
      customer_code: "A1",
      customer_name: "Alpha",
      current_salesman_code: "S1",
      recent_sales_value: 22000,
      average_monthly_purchase: 5000,
      latest_transaction_date: "2026-08-01",
    }],
    [{
      customer_code: "A1",
      customer_name: "Alpha",
      current_salesman_code: "S1",
      invoices: [{
        invoice_number: "INV1",
        due_date: "2026-08-01",
        pending_amount: 4000,
        overdue_days: 40,
      }],
      outstanding_0_30: 0,
      outstanding_30_60: 4000,
      outstanding_61_90: 0,
      outstanding_above_90: 0,
    }],
    "2026-09-12T08:00:00.000Z",
  );

  assert.equal(merged.length, 1);
  assert.equal(merged[0].recent_sales_value, 22000);
  assert.ok(Number(merged[0].probability_score) > 0 || Number(merged[0].total_due_amount) > 0);

  const payload = buildSalesmanVisitPlanPayload({
    visibleCustomers: merged,
    collectionRecords: [],
    salesmanProfiles: [{ salesman_code: "S1", salesman_name: "Sale One" }],
    limit: 5,
    todayIso: "2026-09-12T08:00:00.000Z",
  });
  assert.equal(payload.salesmanCount, 1);
  assert.ok(payload.visitCount >= 1);
});

test("email send stays skipped while disabled unless forcePreview", async () => {
  const skipped = await sendSalesmanVisitPlanEmailsFromPayload({
    reportDate: "2026-09-12",
    salesmanCount: 0,
    visitCount: 0,
    plans: [],
  }, {
    forcePreview: false,
    env: { SALESMAN_VISIT_PLAN_EMAIL_ENABLED: "false" },
  });
  assert.equal(skipped.skipped, true);
  assert.equal(skipped.reason, "email_disabled_until_approved");
});

test("scoreVisitPlanCustomer exposes labels for UI coloring", () => {
  const scored = scoreVisitPlanCustomer({
    customer_code: "A1",
    customer_name: "Alpha",
    recent_sales_value: 50000,
    days_since_last_invoice: 30,
    average_monthly_purchase: 10000,
    highest_monthly_sales: 20000,
    total_due_amount: 15000,
    probability_score: 72,
    probability_label: "High",
  }, "2026-09-12T08:00:00.000Z");
  assert.equal(scored.collection_label, "High");
  assert.ok(scored.combined_score >= 50);
});
