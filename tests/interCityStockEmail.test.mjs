import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_INTER_CITY_STOCK_EMAIL_TO,
  buildInterCityStockEmail,
  interCityStockEmailClaimKey,
  interCityStockEmailRecipients,
} from "../app/lib/interCityStockEmail.js";
import { resolveInterCityStockEmailSchedule } from "../app/lib/interCityStockEmailServer.js";

test("inter-city stock email defaults to Malik", () => {
  assert.deepEqual(interCityStockEmailRecipients({}), [DEFAULT_INTER_CITY_STOCK_EMAIL_TO]);
});

test("inter-city stock email test override replaces recipients", () => {
  assert.deepEqual(
    interCityStockEmailRecipients({ INTER_CITY_STOCK_EMAIL_TEST_TO: "qa@example.com" }),
    ["qa@example.com"],
  );
});

test("claim key is per KSA day", () => {
  assert.equal(interCityStockEmailClaimKey("2026-11-14"), "inter_city_stock_email:2026-11-14");
});

test("schedule skips Friday unless forced", () => {
  const friday = new Date("2026-11-13T08:00:00+03:00"); // Friday KSA
  assert.equal(resolveInterCityStockEmailSchedule(friday).skipped, true);
  assert.equal(resolveInterCityStockEmailSchedule(friday, { force: true }).skipped, false);
  const saturday = new Date("2026-11-14T08:00:00+03:00");
  assert.equal(resolveInterCityStockEmailSchedule(saturday).skipped, false);
});

test("email lists all three gap sections in cartons", () => {
  const message = buildInterCityStockEmail({
    stockDate: "2026-11-11",
    summary: {
      dammamToRiyadhItems: 1,
      riyadhToDammamItems: 2,
      riyadhToStoreItems: 3,
      storeStockItems: 4,
    },
    directions: {
      dammamToRiyadh: {
        rows: [{
          itemCode: "A001",
          itemName: "Dammam only",
          unit: "CTN",
          sourceQty: 10,
          destinationQty: 0,
          suggestedQty: 5,
        }],
      },
      riyadhToDammam: {
        rows: [{
          itemCode: "A002",
          itemName: "Riyadh only",
          unit: "CTN",
          sourceQty: 20,
          destinationQty: 0,
          suggestedQty: 8,
        }],
      },
      riyadhToStore: {
        rows: [{
          itemCode: "A003",
          itemName: "Warehouse not store",
          unit: "CTN",
          sourceQty: 12,
          destinationQty: 0,
          suggestedQty: 5,
        }],
      },
    },
  }, { date: "2026-11-14", env: { NEXT_PUBLIC_APP_URL: "https://madiba-sfa.vercel.app" } });

  assert.match(message.subject, /Stock gaps \(cartons\)/);
  assert.match(message.subject, /D→R 1/);
  assert.match(message.subject, /R→Store 3/);
  assert.match(message.html, /In Dammam, not in Riyadh/);
  assert.match(message.html, /In Riyadh, not in Dammam/);
  assert.match(message.html, /In Riyadh warehouse, not in Store/);
  assert.match(message.html, /A003/);
  assert.match(message.html, /CTN/);
  assert.match(message.text, /cartons/);
});
