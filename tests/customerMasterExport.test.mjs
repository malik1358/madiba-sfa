import test from "node:test";
import assert from "node:assert/strict";
import { resolveCustomerMasterExportFields } from "../app/lib/customerCode.js";
import { customerMasterExportRows, customerMatchesMasterSearch, dedupeCustomerMasterRows, looksLikeCustomerCodeSearch, postgrestIlikeContains } from "../app/lib/customerMasterQuery.js";

test("resolveCustomerMasterExportFields splits numeric leading code from party name", () => {
  const display = resolveCustomerMasterExportFields({
    customer_code: "",
    customer_name: "1062C AL TAWFEER TRADING COMPANY",
  });

  assert.equal(display.customer_code, "1062C");
  assert.equal(display.customer_name, "AL TAWFEER TRADING COMPANY");
  assert.equal(display.partyName, "1062C AL TAWFEER TRADING COMPANY");
});

test("resolveCustomerMasterExportFields dedupes when code and name both hold full party", () => {
  const display = resolveCustomerMasterExportFields({
    customer_code: "1062C AL TAWFEER TRADING COMPANY",
    customer_name: "1062C AL TAWFEER TRADING COMPANY",
  });

  assert.equal(display.customer_code, "1062C");
  assert.equal(display.customer_name, "AL TAWFEER TRADING COMPANY");
});

test("resolveCustomerMasterExportFields keeps name-only customers without a code", () => {
  const display = resolveCustomerMasterExportFields({
    customer_code: "",
    customer_name: "SADA AL KHALEEJ TRADING COMPANY",
  });

  assert.equal(display.customer_code, "");
  assert.equal(display.customer_name, "SADA AL KHALEEJ TRADING COMPANY");
});

test("customerMasterExportRows writes cleaned code and name columns", () => {
  const [row] = customerMasterExportRows([
    {
      customer_code: "1062C AL TAWFEER TRADING COMPANY",
      customer_name: "1062C AL TAWFEER TRADING COMPANY",
      current_salesman_code: "S01",
      city: "Riyadh",
      area: "North",
      latitude: 24.7,
      longitude: 46.7,
      is_active: true,
      latest_transaction_date: "2026-01-01",
    },
  ]);

  assert.equal(row["Customer Code"], "1062C");
  assert.equal(row["Customer Name"], "AL TAWFEER TRADING COMPANY");
  assert.equal(row["Party Name"], "1062C AL TAWFEER TRADING COMPANY");
});

test("dedupeCustomerMasterRows keeps one row per code and prefers GPS", () => {
  const rows = dedupeCustomerMasterRows([
    {
      customer_code: "",
      customer_name: "1062C AL TAWFEER TRADING COMPANY",
      latitude: null,
      longitude: null,
      latest_transaction_date: "2026-03-19",
    },
    {
      customer_code: "1062C",
      customer_name: "AL TAWFEER TRADING COMPANY",
      latitude: 24.6384623,
      longitude: 46.7138027,
      latest_transaction_date: "2026-03-19",
    },
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].customer_code, "1062C");
  assert.equal(rows[0].customer_name, "AL TAWFEER TRADING COMPANY");
  assert.equal(rows[0].latitude, 24.6384623);
});

test("customerMasterExportRows exports deduped customers once", () => {
  const exported = customerMasterExportRows(dedupeCustomerMasterRows([
    {
      customer_code: "1062C AL TAWFEER TRADING COMPANY",
      customer_name: "1062C AL TAWFEER TRADING COMPANY",
      latitude: null,
      longitude: null,
    },
    {
      customer_code: "1062C",
      customer_name: "AL TAWFEER TRADING COMPANY",
      latitude: 24.6384623,
      longitude: 46.7138027,
    },
  ]));

  assert.equal(exported.length, 1);
  assert.equal(exported[0]["Customer Code"], "1062C");
  assert.equal(exported[0]["GPS Status"], "With GPS");
});

test("numeric customer search uses PostgREST star wildcards, not percent encoding", () => {
  assert.equal(postgrestIlikeContains("1545"), "*1545*");
  assert.equal(looksLikeCustomerCodeSearch("1545"), true);
  assert.equal(looksLikeCustomerCodeSearch("*1545*"), true);
  assert.equal(looksLikeCustomerCodeSearch("Naghmat"), false);
});

test("code search matches 1545 only, not other customers that contain those digits", () => {
  const naghmat = {
    customer_code: "1545",
    customer_name: "Naghmat al raihah",
  };
  const other = {
    customer_code: "21545",
    customer_name: "Other Trading",
  };
  const party = {
    customer_code: "1545 Naghmat al raihah",
    customer_name: "1545 Naghmat al raihah",
  };

  assert.equal(customerMatchesMasterSearch(naghmat, "1545"), true);
  assert.equal(customerMatchesMasterSearch(party, "1545"), true);
  assert.equal(customerMatchesMasterSearch(other, "1545"), false);
  assert.equal(customerMatchesMasterSearch(naghmat, "*1545*"), true);
});

test("sales raw party name becomes customer code 1545", async () => {
  const { customerRowFromSalesRaw } = await import("../app/lib/customerMasterQuery.js");
  const row = customerRowFromSalesRaw({
    customer_code: "1545 Naghmat al raihah",
    customer_name: "1545 Naghmat al raihah",
    salesman_code: "ABADALLA ANTHANATH",
    transaction_date: "2026-08-20",
  });
  assert.equal(row.customer_code, "1545");
  assert.equal(row.customer_name, "Naghmat al raihah");
});
