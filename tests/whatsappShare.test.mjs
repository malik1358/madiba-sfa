import test from "node:test";
import assert from "node:assert/strict";

import {
  buildWhatsappAppUrl,
  buildWhatsappShareUrl,
  shareTextAndFilesOnWhatsapp,
  toWhatsappShareFile,
} from "../app/lib/whatsappShare.js";

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

test("visit summaries share through the WhatsApp composer without a preset number", () => {
  const url = buildWhatsappShareUrl("Field visit report");
  assert.equal(url.startsWith("https://api.whatsapp.com/send?text="), true);
  assert.equal(url.includes("wa.me/"), false);
});

test("toWhatsappShareFile names unnamed blobs for WhatsApp attachments", () => {
  assert.equal(toWhatsappShareFile(null), null);
  const blob = new Blob(["photo"], { type: "image/jpeg" });
  const file = toWhatsappShareFile(blob, "payment-copy.jpg");
  assert.equal(file.name, "payment-copy.jpg");
  assert.equal(file.type, "image/jpeg");
});

test("shareTextAndFilesOnWhatsapp falls back to WhatsApp text when file share is unavailable", async () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const openedUrls = [];
  const fakeAnchor = {
    href: "",
    target: "",
    rel: "",
    style: {},
    click() {
      openedUrls.push(this.href);
    },
  };

  globalThis.window = {
    open(url) {
      openedUrls.push(url);
      return {};
    },
    setTimeout: globalThis.setTimeout.bind(globalThis),
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    writable: true,
    value: {},
  });
  globalThis.document = {
    body: {
      appendChild() {},
      removeChild() {},
    },
    createElement(tag) {
      if (tag === "textarea") {
        return {
          value: "",
          style: {},
          setAttribute() {},
          focus() {},
          select() {},
          setSelectionRange() {},
        };
      }
      assert.equal(tag, "a");
      return fakeAnchor;
    },
    execCommand() {
      return true;
    },
  };

  try {
    const file = new File([new Blob(["photo"], { type: "image/jpeg" })], "receipt.jpg", {
      type: "image/jpeg",
    });
    const result = await shareTextAndFilesOnWhatsapp("Collection visit summary", [file], {
      title: "Summary",
      dialogTitle: "Share on WhatsApp",
    });

    assert.equal(result.success, true);
    assert.equal(result.fallback, true);
    assert.equal(result.reason, "files-not-supported");
    assert.equal(result.method, "whatsapp-url");
    assert.ok(openedUrls.some((url) => String(url).includes("whatsapp")));
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousNavigatorDescriptor) {
      Object.defineProperty(globalThis, "navigator", previousNavigatorDescriptor);
    } else {
      delete globalThis.navigator;
    }
  }
});
