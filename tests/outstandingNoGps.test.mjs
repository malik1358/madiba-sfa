import test from "node:test";
import assert from "node:assert/strict";
import {
  backfillCustomerGpsFromLastVisits,
  customerHasExcludedOutstandingNoGpsSalesman,
  customerIsTransferredToLegal,
  customerMatchesSalesmanFilter,
  dateOnly,
  enrichOutstandingNoGpsRow,
  extractGpsFromVisitLocation,
  formatSalesmanDisplay,
  laterVisitAt,
  outstandingNoGpsExportRows,
  preferLaterVisitGps,
  shouldIncludeOutstandingNoGpsCustomer,
  sortOutstandingNoGpsRows,
} from "../app/lib/outstandingNoGps.js";

test("dateOnly keeps YYYY-MM-DD and laterVisitAt picks the newest timestamp", () => {
  assert.equal(dateOnly("2026-08-12T15:04:00Z"), "2026-08-12");
  assert.equal(
    dateOnly(laterVisitAt("2026-08-01", "2026-08-12T09:00:00Z", "2026-07-30")),
    "2026-08-12",
  );
});

test("formatSalesmanDisplay shows name and code together", () => {
  assert.equal(formatSalesmanDisplay("S01", "Parvez"), "Parvez (S01)");
  assert.equal(formatSalesmanDisplay("PARVEZ", "PARVEZ"), "PARVEZ");
  assert.equal(formatSalesmanDisplay("S01", ""), "S01");
});

test("enrichOutstandingNoGpsRow fills last invoice, salesman, and outstanding", () => {
  const row = enrichOutstandingNoGpsRow(
    {
      customer_code: "1062C",
      customer_name: "AL TAWFEER TRADING COMPANY",
      current_salesman_code: "S01",
      latest_transaction_date: "2026-04-01",
      latitude: null,
      longitude: null,
    },
    {
      salesmanNameByCode: new Map([["S01", "Parvez"]]),
      lastVisitByCustomer: new Map([["1062C", "2026-08-20T10:00:00Z"]]),
      outstandingDataset: {
        rows: [{
          customer_code: "1062C",
          customer_name: "AL TAWFEER",
          total_outstanding: 12500,
          salesman: "Parvez",
        }],
        invoices: [{
          customer_code: "1062C",
          customer_name: "AL TAWFEER",
          invoice_date: "2026-07-15",
          pending_amount: 12500,
        }],
      },
      todayIso: "2026-09-03",
    },
  );

  assert.equal(row.total_outstanding, 12500);
  assert.equal(row.last_invoice_date, "2026-07-15");
  assert.equal(row.last_visit_date, "2026-08-20");
  assert.equal(row.salesman_display, "Parvez (S01)");
  assert.equal(row.missing_gps, true);
});

test("sortOutstandingNoGpsRows orders by outstanding then salesman filter matches code or name", () => {
  const sorted = sortOutstandingNoGpsRows([
    { customer_name: "B", total_outstanding: 10 },
    { customer_name: "A", total_outstanding: 90 },
  ]);
  assert.equal(sorted[0].customer_name, "A");

  assert.equal(customerMatchesSalesmanFilter({
    current_salesman_code: "S01",
    salesman_name: "Parvez",
  }, "parvez"), true);
  assert.equal(customerMatchesSalesmanFilter({
    current_salesman_code: "S02",
    salesman_name: "Junaid",
  }, "S01"), false);
});

test("outstanding no GPS report drops Zia, Asrar Ahmed, and legal transfers", () => {
  assert.equal(customerHasExcludedOutstandingNoGpsSalesman({
    salesman_name: "ASRAR AHMED",
  }), true);
  assert.equal(customerHasExcludedOutstandingNoGpsSalesman({
    outstanding_salesman: "Zia",
  }), true);
  assert.equal(customerHasExcludedOutstandingNoGpsSalesman({
    salesman_name: "Parvez",
  }), false);

  const legalTransfers = [
    { customer_code: "9001C", is_transferred: true },
    { customer_code: "9002C", is_transferred: false },
  ];
  assert.equal(customerIsTransferredToLegal({ customer_code: "9001C" }, legalTransfers), true);
  assert.equal(customerIsTransferredToLegal({ customer_code: "9002C" }, legalTransfers), false);
  assert.equal(shouldIncludeOutstandingNoGpsCustomer({
    customer_code: "1062C",
    salesman_name: "Parvez",
  }, { legalTransfers }), true);
  assert.equal(shouldIncludeOutstandingNoGpsCustomer({
    customer_code: "9001C",
    salesman_name: "Parvez",
  }, { legalTransfers }), false);
  assert.equal(shouldIncludeOutstandingNoGpsCustomer({
    customer_code: "1062C",
    salesman_name: "Zia",
  }, { legalTransfers }), false);
});

test("outstandingNoGpsExportRows writes report columns", () => {
  const [exported] = outstandingNoGpsExportRows([{
    customer_code: "1062C",
    customer_name: "AL TAWFEER TRADING COMPANY",
    salesman_display: "Parvez (S01)",
    current_salesman_code: "S01",
    city: "Riyadh",
    area: "North",
    total_outstanding: 12500,
    last_invoice_date: "2026-07-15",
    last_visit_date: "2026-08-20",
  }]);

  assert.equal(exported["Customer Code"], "1062C");
  assert.equal(exported["Last Invoice Date"], "2026-07-15");
  assert.equal(exported["Last Visit Date"], "2026-08-20");
  assert.equal(exported["Outstanding Amount"], 12500);
});

test("extractGpsFromVisitLocation requires finite non-zero coordinates", () => {
  assert.deepEqual(extractGpsFromVisitLocation({ latitude: 24.58, longitude: 46.57 }), {
    latitude: 24.58,
    longitude: 46.57,
  });
  assert.equal(extractGpsFromVisitLocation({ latitude: 0, longitude: 46.57 }), null);
  assert.equal(extractGpsFromVisitLocation(null), null);
});

test("preferLaterVisitGps keeps the newest visit pin", () => {
  const older = { latitude: 1, longitude: 2, visitAt: "2026-09-01T00:00:00Z" };
  const newer = { latitude: 3, longitude: 4, visitAt: "2026-09-24T00:00:00Z" };
  assert.equal(preferLaterVisitGps(older, newer), newer);
  assert.equal(preferLaterVisitGps(newer, older), newer);
});

test("backfillCustomerGpsFromLastVisits promotes missing master GPS from visit map", async () => {
  const updates = [];
  const admin = {
    from(table) {
      if (table === "customers") {
        return {
          update(payload) {
            updates.push(payload);
            return {
              eq() {
                return {
                  select() {
                    return {
                      async maybeSingle() {
                        return {
                          data: {
                            customer_code: "1573",
                            latitude: payload.latitude,
                            longitude: payload.longitude,
                          },
                          error: null,
                        };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      }
      if (table === "customer_gps_history") {
        return {
          async insert() {
            return { error: null };
          },
        };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  };

  const customer = { customer_code: "1573", latitude: null, longitude: null };
  const result = await backfillCustomerGpsFromLastVisits(admin, [customer], {
    visitGpsByCustomer: new Map([
      ["1573", { latitude: 24.581979, longitude: 46.576307, visitAt: "2026-09-24T06:26:26Z" }],
    ]),
  });

  assert.equal(result.promoted, 1);
  assert.deepEqual(result.codes, ["1573"]);
  assert.equal(customer.latitude, 24.581979);
  assert.equal(updates.length, 1);
});
