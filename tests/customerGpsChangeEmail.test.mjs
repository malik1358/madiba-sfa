import test from "node:test";
import assert from "node:assert/strict";
import { buildGpsChangeEmail, claimGpsChangeEmail, runGpsChangeEmailCycle } from "../app/lib/customerGpsChangeEmailServer.js";
import { gpsReportRow } from "../app/lib/customerGpsReport.js";
import { buildModuleAccess } from "../app/lib/moduleAccess.js";

const env = { SMTP_HOST: "test.invalid", SMTP_FROM: "reports@example.com" };
function options(extra = {}) {
  return { now: new Date("2026-10-04T21:40:00Z"), env, claimSend: async () => ({ settingKey: "test", claim: "test" }), finishSend: async () => {}, releaseSend: async () => {}, loadRows: async () => [], ...extra };
}

test("one daily email goes to the selected inbox even when no changes happened", async () => {
  const messages = [];
  const result = await runGpsChangeEmailCycle({}, options({ send: async (message) => messages.push(message) }));
  assert.equal(result.date, "2026-10-04");
  assert.equal(result.sentCount, 1);
  assert.deepEqual(messages[0].to, ["malik@pinasz.com"]);
  assert.match(messages[0].html, /No salesman-accepted GPS changes/);
  assert.equal(messages.length, 1);
});

test("duplicate and concurrent cycles send only once", async () => {
  let claimed = false;
  let sent = 0;
  const opts = options({ claimSend: async () => { if (claimed) return null; claimed = true; return {}; }, send: async () => { sent += 1; } });
  const results = await Promise.all([runGpsChangeEmailCycle({}, opts), runGpsChangeEmailCycle({}, opts)]);
  assert.equal(sent, 1);
  assert.equal(results.filter((row) => row.skipped).length, 1);
});

test("atomic database unique conflict skips an already claimed date", async () => {
  assert.equal(await claimGpsChangeEmail({ from: () => ({ insert: async () => ({ error: { code: "23505" } }) }) }, "2026-10-04"), null);
});

test("failed send releases claim but delivered email keeps claim on marker failure", async () => {
  let released = 0;
  const releaseSend = async () => { released += 1; };
  await assert.rejects(runGpsChangeEmailCycle({}, options({ releaseSend, send: async () => { throw new Error("send failed"); } })), /send failed/);
  assert.equal(released, 1);
  await assert.rejects(runGpsChangeEmailCycle({}, options({ releaseSend, send: async () => {}, finishSend: async () => { throw new Error("marker failed"); } })), /marker failed/);
  assert.equal(released, 1);
});

test("email includes actor, KSA timestamp, both maps and distance; escapes HTML", () => {
  const row = gpsReportRow({ customer_code: "1415", updated_by_name: "<script>Salesman</script>", created_at: "2026-10-04T09:30:00Z", latitude: 24.71, longitude: 46.6, previous_latitude: 24.7, previous_longitude: 46.6, source: "salesman_accepted" }, "Shop");
  const email = buildGpsChangeEmail("2026-10-04", [row]);
  assert.match(email.html, /&lt;script&gt;/);
  assert.ok(email.html.includes(row.old_map_url));
  assert.ok(email.html.includes(row.new_map_url));
  assert.ok(email.text.includes(row.distance_meters.toFixed(1)));
  assert.match(email.text, /12:30/);
});

test("GPS digest rejects open days and unconfigured mail instead of silently succeeding", async () => {
  await assert.rejects(runGpsChangeEmailCycle({}, options({ date: "2026-10-05" })), /completed/);
  await assert.rejects(runGpsChangeEmailCycle({}, options({ env: {} })), /not configured/);
});

test("GPS history screen is restricted to admin and manager", () => {
  for (const role of ["admin", "manager", "salesman", "collector", "invoice-maker", "product-promoter"]) {
    assert.equal(buildModuleAccess({ role }).canAccessPath("/management/customer-gps-history"), ["admin", "manager"].includes(role));
  }
});