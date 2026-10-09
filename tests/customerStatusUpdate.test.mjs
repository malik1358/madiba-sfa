import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CUSTOMER_INACTIVE_WITH_OUTSTANDING_ERROR,
  OUTSTANDING_DATASET_KEY,
  customerHasOutstandingBalance,
  findOutstandingForCustomer,
} from "../app/lib/outstanding.js";

const source = readFileSync(new URL("../app/api/visit-reports/route.js", import.meta.url), "utf8");
const patchBody = source.split("export async function PATCH(request) {")[1].split("export async function POST(request)")[0].trim().replace(/\}\s*$/, "");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

async function updateStatus(customer, isActive, dataset = null) {
  let updateFilter = null;
  const admin = {
    from(table) {
      if (table === "system_settings") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { setting_value: JSON.stringify(dataset) } }) }) }),
          upsert: async () => ({ error: null }),
          delete: () => ({ eq: async () => ({ error: null }) }),
        };
      }
      assert.equal(table, "customers");
      return {
        update(values) {
          return {
            eq(column, value) {
              assert.equal(column, "customer_code");
              updateFilter = value;
              return {
                select: () => ({
                  maybeSingle: async () => ({
                    data: value === customer.customer_code ? { customer_code: value, ...values } : null,
                  }),
                }),
              };
            },
          };
        },
      };
    },
  };
  const dependencies = {
    supabaseUrl: "http://127.0.0.1:54321",
    serviceKey: "test-only",
    NextResponse: { json: (body, options) => ({ body, status: options?.status || 200 }) },
    getBearerToken: () => "test-session",
    normalizeCode: (value) => String(value || "").trim().toUpperCase(),
    createClient: () => admin,
    resolveScope: async () => ({ role: "admin", userId: "test-user" }),
    shouldRequireTransactionGps: () => false,
    ensureCustomerVisible: async () => customer,
    OUTSTANDING_DATASET_KEY,
    findOutstandingForCustomer,
    customerHasOutstandingBalance,
    CUSTOMER_INACTIVE_WITH_OUTSTANDING_ERROR,
    inactiveMetaKey: (code) => `customer_inactive_meta:${code}`,
    buildGpsActivityNote: () => "{}",
    normalizeGpsCapturePlatform: () => "web",
    isProspectCustomerCode: () => false,
    promoteEntryGpsToCustomerIfMissing: async () => {},
  };
  const handler = new AsyncFunction("request", ...Object.keys(dependencies), patchBody);
  const response = await handler({ json: async () => ({ customerCode: customer.customer_code, isActive }) }, ...Object.values(dependencies));
  return { response, updateFilter };
}

test("customer status PATCH updates exact stored legacy codes for activation and deactivation", async () => {
  for (const code of [
    "1052 Al Qusoor Al Rasiya General Contracting Establishme",
    "Ahmed Anwar Abu Al-Jadail Trading Establishment",
    "1071c ART MART LIMITED",
    "1052",
    "1071C",
  ]) {
    for (const isActive of [false, true]) {
      const { response, updateFilter } = await updateStatus({ customer_code: code, customer_name: code }, isActive);
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.equal(response.body.success, true);
      assert.equal(response.body.customer.is_active, isActive);
      assert.equal(updateFilter, code);
    }
  }
});

test("customer status PATCH still rejects deactivation with outstanding", async () => {
  const customer = { customer_code: "1052", customer_name: "Al Qusoor Al Rasiya" };
  const { response, updateFilter } = await updateStatus(customer, false, {
    rows: [{ ...customer, total_outstanding: 100, buckets: { "0-30": 100 } }],
  });
  assert.equal(response.status, 400);
  assert.equal(response.body.error, CUSTOMER_INACTIVE_WITH_OUTSTANDING_ERROR);
  assert.equal(updateFilter, null);
});