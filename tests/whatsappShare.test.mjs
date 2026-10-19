import test from "node:test";
import assert from "node:assert/strict";

import { buildWhatsappAppUrl, buildWhatsappShareUrl, toWhatsappShareFile } from "../app/lib/whatsappShare.js";

test("buildWhatsappShareUrl encodes message text", () => {
  const url = buildWhatsappShareUrl("Customer: Test\nCode: 1254");
  assert.match(url, /^https:\/\/api\.whatsapp\.com\/send\?text=/);
  assert.ok(url.includes("Customer%3A%20Test"));
});

test("buildWhatsappShareUrl supports optional destination number", () => {
  const url = buildWhatsappShareUrl("Hello", "0551234567");
  assert.equal(url, "https://wa.me/966551234567?text=Hello");
});

test("buildWhatsappAppUrl opens the WhatsApp app share composer", () => {
  const url = buildWhatsappAppUrl("Customer: Test\nCode: 1254");
  assert.equal(url.startsWith("whatsapp://send?text="), true);
  assert.ok(url.includes("Customer%3A%20Test"));
});

test("toWhatsappShareFile names unnamed blobs for WhatsApp attachments", () => {
  assert.equal(toWhatsappShareFile(null), null);
  const blob = new Blob(["photo"], { type: "image/jpeg" });
  const file = toWhatsappShareFile(blob, "payment-copy.jpg");
  assert.equal(file.name, "payment-copy.jpg");
  assert.equal(file.type, "image/jpeg");
});
