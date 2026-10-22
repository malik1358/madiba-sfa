import test from "node:test";
import assert from "node:assert/strict";

import {
  buildReceiptSummaryShareImage,
  buildWhatsappAppUrl,
  buildWhatsappShareUrl,
  prepareWhatsappAttachmentShare,
  shareTextAndFilesOnWhatsapp,
  shouldOmitWebShareText,
  toWhatsappShareFile,
  whatsappCacheFileName,
  wrapWhatsappSummaryLines,
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

test("whatsapp cache names use extensions Android WhatsApp accepts", () => {
  assert.equal(whatsappCacheFileName({ type: "image/jpeg", name: "receipt copy (1).heic" }, 0), "attachment-1.jpg");
  assert.equal(whatsappCacheFileName({ type: "application/pdf", name: "receipt.pdf" }, 1), "attachment-2.pdf");
  assert.equal(whatsappCacheFileName({ type: "image/png", name: "payment.png" }, 2), "attachment-3.png");
  assert.equal(shouldOmitWebShareText("Mozilla/5.0 (Linux; Android 14; Pixel)"), true);
  assert.equal(shouldOmitWebShareText("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"), false);
});

test("toWhatsappShareFile names unnamed blobs for WhatsApp attachments", () => {
  assert.equal(toWhatsappShareFile(null), null);
  const blob = new Blob(["photo"], { type: "image/jpeg" });
  const file = toWhatsappShareFile(blob, "payment-copy.jpg");
  assert.equal(file.name, "payment-copy.jpg");
  assert.equal(file.type, "image/jpeg");
});

function createShareCanvasDocument() {
  return {
    createElement(tag) {
      assert.equal(tag, "canvas");
      const canvas = {
        width: 0,
        height: 0,
        getContext() {
          return {
            fillStyle: "",
            font: "",
            textAlign: "",
            textBaseline: "",
            direction: "",
            fillRect() {},
            fillText() {},
            drawImage() {},
            measureText(value) {
              return { width: String(value || "").length * 8 };
            },
          };
        },
        toBlob(callback) {
          callback(new Blob(["jpeg"], { type: "image/jpeg" }));
        },
      };
      return canvas;
    },
  };
}

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

test("Android web share sends the collection file and keeps the summary for paste", async () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  let shared = null;

  globalThis.window = { setTimeout: globalThis.setTimeout.bind(globalThis) };
  globalThis.document = {
    body: { appendChild() {}, removeChild() {} },
    createElement(tag) {
      if (tag === "canvas") {
        return createShareCanvasDocument().createElement("canvas");
      }
      return {
        value: "",
        style: {},
        setAttribute() {},
        focus() {},
        select() {},
        setSelectionRange() {},
      };
    },
    execCommand() {
      return true;
    },
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    writable: true,
    value: {
      userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8)",
      clipboard: { writeText: async () => {} },
      canShare: () => true,
      share: async (payload) => {
        shared = payload;
      },
    },
  });

  try {
    const file = new File([new Blob(["photo"], { type: "image/jpeg" })], "receipt.jpg", {
      type: "image/jpeg",
    });
    const result = await shareTextAndFilesOnWhatsapp("Collection visit summary", [file], {
      title: "Summary",
      loadImage: async () => ({ width: 640, height: 480 }),
    });
    assert.equal(result.success, true);
    assert.equal(result.method, "web-share-files");
    assert.equal(result.textCopied, true);
    assert.equal(result.embeddedSummary, true);
    assert.equal(shared.text, undefined);
    assert.equal(shared.files.length, 1);
    assert.equal(shared.files[0].name, "collection-receipt-summary.jpg");
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

test("iPhone web share keeps the collection summary with the file", async () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  let shared = null;

  globalThis.window = { setTimeout: globalThis.setTimeout.bind(globalThis) };
  globalThis.document = {
    body: { appendChild() {}, removeChild() {} },
    createElement() {
      return {
        value: "",
        style: {},
        setAttribute() {},
        focus() {},
        select() {},
        setSelectionRange() {},
      };
    },
    execCommand() {
      return true;
    },
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    writable: true,
    value: {
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)",
      clipboard: { writeText: async () => {} },
      canShare: () => true,
      share: async (payload) => {
        shared = payload;
      },
    },
  });

  try {
    const file = new File([new Blob(["photo"], { type: "image/jpeg" })], "receipt.jpg", {
      type: "image/jpeg",
    });
    const result = await shareTextAndFilesOnWhatsapp("Collection visit summary", [file], {
      title: "Summary",
    });
    assert.equal(result.success, true);
    assert.equal(result.method, "web-share-files");
    assert.equal(shared.text, "Collection visit summary");
    assert.equal(shared.files.length, 1);
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

test("wrapWhatsappSummaryLines keeps blank lines from the visit summary", () => {
  const lines = wrapWhatsappSummaryLines("Customer: Test\n\nWorking hours\n4h 30m", 200, () => 10);
  assert.deepEqual(lines, ["Customer: Test", "", "Working hours", "4h 30m"]);
});

test("buildReceiptSummaryShareImage prints the summary under the receipt photo", async () => {
  const file = new File([new Blob(["photo"], { type: "image/jpeg" })], "receipt.jpg", {
    type: "image/jpeg",
  });
  const image = await buildReceiptSummaryShareImage([file], "Customer: 1254\nAmount: 500", {
    document: createShareCanvasDocument(),
    loadImage: async () => ({ width: 800, height: 600 }),
  });
  assert.equal(image?.type, "image/jpeg");
  assert.equal(image?.name, "collection-receipt-summary.jpg");
});

test("Android preparation embeds the summary on the receipt and drops separate text", async () => {
  const file = new File([new Blob(["photo"], { type: "image/jpeg" })], "receipt.jpg", {
    type: "image/jpeg",
  });
  const prepared = await prepareWhatsappAttachmentShare(
    "Customer: 1254\nFunds received: 500",
    [file],
    {
      userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8)",
      document: createShareCanvasDocument(),
      loadImage: async () => ({ width: 640, height: 480 }),
    },
  );
  assert.equal(prepared.embeddedSummary, true);
  assert.equal(prepared.message, "");
  assert.equal(prepared.textCopied, true);
  assert.equal(prepared.files.length, 1);
  assert.equal(prepared.files[0].name, "collection-receipt-summary.jpg");
});
