import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMissingCataloguePhotoEmail,
  missingCataloguePhotoEmailRecipients,
} from "../app/lib/missingCataloguePhotosEmail.js";
import { runMissingCataloguePhotoEmailCycle } from "../app/lib/missingCataloguePhotosEmailServer.js";

const env = { SMTP_HOST: "test.invalid", SMTP_FROM: "reports@example.com" };
const report = {
  photosReady: true,
  rows: [
    { code: "A000001", name: "Baby <Oil>", category: "Baby Care" },
    { code: "A000005", name: "Shampoo", category: "Body Care" },
  ],
  summary: { missing: 2, withPhotos: 4, excludedBuilding: 3 },
};

function options(extra = {}) {
  return {
    now: new Date("2026-10-17T06:00:00Z"),
    env,
    claimSend: async () => ({ settingKey: "test", claim: "test" }),
    finishSend: async () => {},
    releaseSend: async () => {},
    loadReport: async () => report,
    ...extra,
  };
}

test("missing catalogue photo email goes to Malik and Swami", () => {
  assert.deepEqual(missingCataloguePhotoEmailRecipients({}), ["malik@pinasz.com", "swami@pinasz.com"]);
  assert.deepEqual(missingCataloguePhotoEmailRecipients({ MISSING_CATALOGUE_PHOTOS_EMAIL_TO: "ops@example.com" }), ["ops@example.com"]);
});

test("missing catalogue photo email lists priced catalogue items and escapes names", () => {
  const email = buildMissingCataloguePhotoEmail({ date: "2026-10-17", ...report });
  assert.match(email.subject, /Missing catalogue photos - 2026-10-17 \(2\)/);
  assert.match(email.html, /#0f4c5c/);
  assert.match(email.html, /#f4fafa/);
  assert.match(email.html, /Baby &lt;Oil&gt;/);
  assert.doesNotMatch(email.html, /No price/);
  assert.match(email.html, />Total</);
  assert.match(email.text, /A000001 \| Baby <Oil> \| Baby Care/);
  assert.match(email.text, /Total: 2/);
});

test("daily missing catalogue photo email sends once and skips a second claim", async () => {
  const messages = [];
  const result = await runMissingCataloguePhotoEmailCycle({}, options({ send: async (message) => messages.push(message) }));
  assert.equal(result.date, "2026-10-17");
  assert.equal(result.sentCount, 1);
  assert.deepEqual(messages[0].to, ["malik@pinasz.com", "swami@pinasz.com"]);
  assert.match(messages[0].subject, /Missing catalogue photos/);

  const skipped = await runMissingCataloguePhotoEmailCycle({}, options({
    claimSend: async () => null,
    send: async () => { throw new Error("should not send"); },
  }));
  assert.equal(skipped.skipped, true);
  assert.equal(skipped.reason, "already_claimed_or_sent");
});

test("missing photo storage does not send and releases the claim", async () => {
  let released = 0;
  const result = await runMissingCataloguePhotoEmailCycle({}, options({
    loadReport: async () => ({ photosReady: false, rows: [], summary: {} }),
    releaseSend: async () => { released += 1; },
    send: async () => { throw new Error("should not send"); },
  }));
  assert.equal(result.reason, "photos_not_ready");
  assert.equal(released, 1);
});

test("a failed send releases the claim", async () => {
  let released = 0;
  await assert.rejects(
    runMissingCataloguePhotoEmailCycle({}, options({
      releaseSend: async () => { released += 1; },
      send: async () => { throw new Error("send failed"); },
    })),
    /send failed/,
  );
  assert.equal(released, 1);
});
