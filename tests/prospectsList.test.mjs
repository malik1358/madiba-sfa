import test from "node:test";
import assert from "node:assert/strict";

import {
  buildOfflineProspectCustomerCode,
  buildProspectCustomerCode,
  enrichProspectsWithOrders,
  formatProspectOrderLabel,
  findProspectForCustomerCode,
  hiddenProspectCustomerCodes,
  isOpenProspectForOrderScreens,
  isPlaceholderProspectName,
  mapProspectOrderNumbers,
  mergeUniqueCustomersByCode,
  prospectDisplayName,
  resolveProspectCustomerCode,
  visibleCustomerFromProspect,
} from "../app/lib/prospects.js";

test("buildProspectCustomerCode formats prospect order customer codes", () => {
  assert.equal(buildProspectCustomerCode(126), "PROSPECT-126");
  assert.equal(buildProspectCustomerCode("64"), "PROSPECT-64");
  assert.equal(buildProspectCustomerCode(0), "");
  assert.equal(buildOfflineProspectCustomerCode("abc123"), "PROSPECT-OFF-abc123");
  assert.equal(resolveProspectCustomerCode({ offline_id: "abc123", id: 9 }), "PROSPECT-9");
  assert.equal(resolveProspectCustomerCode({ offline_id: "abc123" }), "PROSPECT-OFF-abc123");
});

test("prospectDisplayName prefers company then shop then customer name", () => {
  assert.equal(prospectDisplayName({ company_name: "AL NOOR STATIONERY" }), "AL NOOR STATIONERY");
  assert.equal(prospectDisplayName({ shop_name: "Noor Shop" }), "Noor Shop");
  assert.equal(isPlaceholderProspectName("", "PROSPECT-308"), true);
  assert.equal(isPlaceholderProspectName("PROSPECT-308", "PROSPECT-308"), true);
  assert.equal(isPlaceholderProspectName("Prospect 308", "PROSPECT-308"), true);
  assert.equal(isPlaceholderProspectName("AL NOOR STATIONERY", "PROSPECT-308"), false);
});

test("formatProspectOrderLabel prefers order_number then falls back to id", () => {
  assert.equal(formatProspectOrderLabel({ id: 55, order_number: "SO-1001" }), "SO-1001");
  assert.equal(formatProspectOrderLabel({ id: 55, order_number: "" }), "55");
});

test("mapProspectOrderNumbers groups sales orders by prospect customer code", () => {
  const grouped = mapProspectOrderNumbers([
    { id: 10, order_number: "", customer_code: "PROSPECT-5", status: "SUBMITTED", created_at: "2026-08-20T10:00:00Z" },
    { id: 12, order_number: "SO-200", customer_code: "PROSPECT-5", status: "DRAFT", created_at: "2026-08-25T10:00:00Z" },
    { id: 99, order_number: "", customer_code: "1062C", status: "SUBMITTED", created_at: "2026-08-25T11:00:00Z" },
  ]);

  assert.deepEqual(grouped.get("PROSPECT-5"), [
    { id: 12, order_number: "SO-200", status: "DRAFT", created_at: "2026-08-25T10:00:00Z" },
    { id: 10, order_number: "10", status: "SUBMITTED", created_at: "2026-08-20T10:00:00Z" },
  ]);
  assert.equal(grouped.has("1062C"), false);
});

test("enrichProspectsWithOrders attaches order numbers to prospect rows", () => {
  const enriched = enrichProspectsWithOrders(
    [{ id: 5, company_name: "Test Shop" }],
    [{ id: 12, order_number: "SO-200", customer_code: "PROSPECT-5", status: "DRAFT", created_at: "2026-08-25T10:00:00Z" }],
  );

  assert.equal(enriched[0].latest_order_number, "SO-200");
  assert.deepEqual(enriched[0].order_numbers, ["SO-200"]);
});

test("enrichProspectsWithOrders matches both live and offline prospect customer codes", () => {
  const enriched = enrichProspectsWithOrders(
    [{ id: 9, offline_id: "abc123", company_name: "Test Shop" }],
    [
      { id: 3, order_number: "SO-OFF", customer_code: "PROSPECT-OFF-abc123", status: "SUBMITTED", created_at: "2026-09-01T10:00:00Z" },
      { id: 4, order_number: "325", customer_code: "PROSPECT-9", status: "SUBMITTED", created_at: "2026-09-07T08:00:00Z" },
    ],
  );

  assert.equal(enriched[0].latest_order_number, "325");
  assert.deepEqual(enriched[0].order_numbers, ["325", "SO-OFF"]);
});

test("mapProspectOrderNumbers includes offline prospect customer codes", () => {
  const grouped = mapProspectOrderNumbers([
    { id: 3, order_number: "SO-OFF", customer_code: "PROSPECT-OFF-abc123", status: "SUBMITTED", created_at: "2026-09-01T10:00:00Z" },
  ]);
  assert.equal(grouped.get("PROSPECT-OFF-ABC123")?.[0]?.order_number, "SO-OFF");
});

test("open prospect helpers keep unordered prospects and hide ordered or converted ones", () => {
  const openProspect = { id: 11, company_name: "New Shop" };
  const orderedProspect = {
    id: 12,
    company_name: "Ordered Shop",
    latest_order_id: 88,
    order_numbers: ["SO-88"],
  };
  const convertedProspect = {
    id: 13,
    company_name: "Linked Shop",
    converted_customer_code: "1173C",
  };

  assert.equal(isOpenProspectForOrderScreens(openProspect), true);
  assert.equal(isOpenProspectForOrderScreens(orderedProspect), false);
  assert.equal(isOpenProspectForOrderScreens(convertedProspect), false);
  assert.deepEqual([...hiddenProspectCustomerCodes([openProspect, orderedProspect, convertedProspect])].sort(), [
    "PROSPECT-12",
    "PROSPECT-13",
  ]);
  assert.equal(mergeUniqueCustomersByCode(
    [{ customer_code: "PROSPECT-11", customer_name: "New Shop" }],
    [{ customer_code: "prospect-11", customer_name: "Duplicate" }, { customer_code: "1173C", customer_name: "Real" }],
  ).map((row) => row.customer_code).join(","), "PROSPECT-11,1173C");
});

test("visibleCustomerFromProspect maps a visit-report customer from a prospect row", () => {
  const customer = visibleCustomerFromProspect({
    id: 64,
    salesman_code: "S12",
    company_name: "Gana al araice",
    city: "Riyadh",
    area: "Al Jazah",
  });

  assert.equal(customer.customer_code, "PROSPECT-64");
  assert.equal(customer.customer_name, "Gana al araice");
  assert.equal(customer.current_salesman_code, "S12");
  assert.equal(customer.is_prospect, true);
});

test("findProspectForCustomerCode loads live and offline prospect codes", async () => {
  const admin = {
    from() {
      return {
        select() { return this; },
        eq(field, value) {
          this.field = field;
          this.value = value;
          return this;
        },
        ilike() { return this; },
        limit() { return this; },
        maybeSingle() {
          if (this.field === "id" && this.value === 64) {
            return { data: { id: 64, company_name: "Gana al araice" }, error: null };
          }
          if (this.field === "offline_id" && this.value === "abc123") {
            return { data: { id: 9, offline_id: "abc123", company_name: "Offline Shop" }, error: null };
          }
          return { data: null, error: null };
        },
      };
    },
  };

  const live = await findProspectForCustomerCode(admin, "PROSPECT-64");
  assert.equal(live.id, 64);
  assert.equal((await findProspectForCustomerCode(admin, "PROSPECT-OFF-abc123")).offline_id, "abc123");
  assert.equal(await findProspectForCustomerCode(admin, "1173C"), null);
});

