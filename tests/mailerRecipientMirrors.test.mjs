import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_EMAIL_RECIPIENT_MIRRORS,
  applyEmailRecipientMirrors,
  parseEmailRecipientMirrors,
} from "../app/lib/mailer.js";

test("default mirror maps Soyeb to Sohail", () => {
  assert.deepEqual(
    DEFAULT_EMAIL_RECIPIENT_MIRRORS["soyeb@noorshukran.com"],
    ["sohail.budhiya@noorshukran.com"],
  );
});

test("applyEmailRecipientMirrors CCs Sohail when Soyeb is on To", () => {
  const result = applyEmailRecipientMirrors({
    to: ["soyeb@noorshukran.com"],
    cc: ["fazlur.rahiman@noorshukran.com"],
  });
  assert.deepEqual(result.to, ["soyeb@noorshukran.com"]);
  assert.ok(result.cc.includes("fazlur.rahiman@noorshukran.com"));
  assert.ok(result.cc.includes("sohail.budhiya@noorshukran.com"));
});

test("applyEmailRecipientMirrors CCs Sohail when Soyeb is only on CC", () => {
  const result = applyEmailRecipientMirrors({
    to: ["malik@pinasz.com"],
    cc: ["soyeb@noorshukran.com"],
  });
  assert.deepEqual(result.to, ["malik@pinasz.com"]);
  assert.ok(result.cc.includes("soyeb@noorshukran.com"));
  assert.ok(result.cc.includes("sohail.budhiya@noorshukran.com"));
});

test("applyEmailRecipientMirrors does not duplicate Sohail when already on To", () => {
  const result = applyEmailRecipientMirrors({
    to: ["soyeb@noorshukran.com", "sohail.budhiya@noorshukran.com"],
    cc: [],
  });
  assert.deepEqual(result.to, ["soyeb@noorshukran.com", "sohail.budhiya@noorshukran.com"]);
  assert.deepEqual(result.cc, []);
});

test("EMAIL_RECIPIENT_MIRRORS env override replaces defaults", () => {
  const mirrors = parseEmailRecipientMirrors({
    EMAIL_RECIPIENT_MIRRORS: "a@example.com=b@example.com,c@example.com",
  });
  assert.deepEqual(mirrors, {
    "a@example.com": ["b@example.com", "c@example.com"],
  });
  const result = applyEmailRecipientMirrors(
    { to: ["a@example.com"], cc: [] },
    { EMAIL_RECIPIENT_MIRRORS: "a@example.com=b@example.com" },
  );
  assert.deepEqual(result.cc, ["b@example.com"]);
});
