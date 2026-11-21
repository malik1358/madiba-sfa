import test from "node:test";
import assert from "node:assert/strict";

import {
  buildReceiptSummaryShareImage,
  buildWhatsappAppUrl,
  buildWhatsappShareUrl,
  downloadWhatsappShareFiles,
  normalizeWhatsappSummaryText,
  prepareWhatsappAttachmentShare,
  shareTextAndFilesOnWhatsapp,
  shouldOmitWebShareText,
  toWhatsappShareFile,
  whatsappCacheFileName,
  wrapWhatsappSummaryLines,
} from "../app/lib/whatsappShare.js";
import { buildGoogleMapsPointUrl } from "../app/lib/geo.js";
import { patchWhatsappSummaryDayActivity } from "../app/lib/dayActivityWhatsapp.js";

test("buildWhatsappShareUrl encodes message text", () => {
  const url = buildWhatsappShareUrl("Customer: Test\nCode: 1254");
  assert.match(url, /^https:\/\/api\.whatsapp\.com\/send\?text=/);
  assert.ok(url.includes("Customer%3A%20Test"));
});

test("normalizeWhatsappSummaryText strips CRLF so WhatsApp keeps line breaks", () => {
  const normalized = normalizeWhatsappSummaryText(
    "Customer: Test\r\nQueue priority: 36.\r\nGPS: https://maps.google.com/?q=24.6,46.7\r\nDistance from customer: 1.00 km",
  );
  assert.equal(normalized.includes("\r"), false);
  assert.match(normalized, /Customer: Test\nQueue priority: 36\.\nGPS:/);
});

test("buildWhatsappShareUrl encodes CRLF summaries without %0D", () => {
  const url = buildWhatsappShareUrl(
    "Customer: Test\r\nGPS: https://maps.google.com/?q=24.6,46.7\r\nDistance from customer: 1.00 km",
  );
  assert.equal(url.includes("%0D"), false);
  assert.ok(url.includes("Customer%3A%20Test%0AGPS%3A%20"));
  assert.ok(url.includes("Distance%20from%20customer"));
});

test("buildGoogleMapsPointUrl avoids & so WhatsApp text URLs cannot truncate at query=", () => {
  assert.equal(buildGoogleMapsPointUrl(24.636141, 46.707131), "https://maps.google.com/?q=24.636141,46.707131");
  assert.equal(String(buildGoogleMapsPointUrl(24.636141, 46.707131)).includes("&"), false);
});

test("patchWhatsappSummaryDayActivity replaces CRLF totals instead of duplicating", () => {
  const stored = [
    "Customer: Test",
    "Visits with order: 1 / 100 ﷼",
    "Visits without order: 2",
    "Collections: 0 / 0 ﷼",
  ].join("\r\n");
  const patched = patchWhatsappSummaryDayActivity(stored, {
    known: true,
    orderCount: 3,
    orderValue: 900,
    visitWithoutOrderCount: 1,
    collectionCount: 2,
    collectionValue: 400,
  });
  assert.equal(patched.includes("\r"), false);
  assert.equal((patched.match(/Visits with order:/g) || []).length, 1);
  assert.match(patched, /Visits with order: 3 \/ 900 ﷼\nVisits without order: 1\nCollections: 2 \/ 400 ﷼/);
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
  const previousCreateObjectURL = URL.createObjectURL;
  const previousRevokeObjectURL = URL.revokeObjectURL;
  const openedUrls = [];
  const downloads = [];
  const fakeAnchor = {
    href: "",
    target: "",
    rel: "",
    download: "",
    style: {},
    click() {
      if (this.download) downloads.push({ href: this.href, download: this.download });
      else openedUrls.push(this.href);
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
  URL.createObjectURL = () => "blob:receipt";
  URL.revokeObjectURL = () => {};
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
    assert.equal(result.filesDownloaded, true);
    assert.equal(downloads.length, 1);
    assert.equal(downloads[0].download, "receipt.jpg");
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
    URL.createObjectURL = previousCreateObjectURL;
    URL.revokeObjectURL = previousRevokeObjectURL;
  }
});

test("shareTextAndFilesOnWhatsapp downloads catalogue photos when file share is unavailable", async () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const previousCreateObjectURL = URL.createObjectURL;
  const previousRevokeObjectURL = URL.revokeObjectURL;
  const downloads = [];

  globalThis.window = {
    setTimeout: globalThis.setTimeout.bind(globalThis),
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    writable: true,
    value: {},
  });
  URL.createObjectURL = () => "blob:catalogue";
  URL.revokeObjectURL = () => {};
  globalThis.document = {
    body: {
      appendChild() {},
      removeChild() {},
    },
    createElement(tag) {
      assert.equal(tag, "a");
      return {
        href: "",
        download: "",
        rel: "",
        style: {},
        click() {
          downloads.push(this.download);
        },
      };
    },
  };

  try {
    const file = new File([new Blob(["photo"], { type: "image/jpeg" })], "A001-share.jpg", {
      type: "image/jpeg",
    });
    const result = await shareTextAndFilesOnWhatsapp("", [file], {
      title: "Product catalogue",
      dialogTitle: "Share on WhatsApp",
      keepSeparateFiles: true,
    });

    assert.equal(result.success, true);
    assert.equal(result.fallback, true);
    assert.equal(result.method, "download-files");
    assert.equal(result.reason, "files-not-supported");
    assert.deepEqual(downloads, ["A001-share.jpg"]);
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
    URL.createObjectURL = previousCreateObjectURL;
    URL.revokeObjectURL = previousRevokeObjectURL;
  }
});

test("downloadWhatsappShareFiles triggers one browser download per file", async () => {
  const previousDocument = globalThis.document;
  const previousCreateObjectURL = URL.createObjectURL;
  const previousRevokeObjectURL = URL.revokeObjectURL;
  const downloads = [];

  URL.createObjectURL = () => "blob:file";
  URL.revokeObjectURL = () => {};
  globalThis.document = {
    body: {
      appendChild() {},
      removeChild() {},
    },
    createElement(tag) {
      assert.equal(tag, "a");
      return {
        href: "",
        download: "",
        rel: "",
        style: {},
        click() {
          downloads.push(this.download);
        },
      };
    },
  };

  try {
    const files = [
      new File([new Blob(["a"], { type: "image/jpeg" })], "one.jpg", { type: "image/jpeg" }),
      new File([new Blob(["b"], { type: "image/jpeg" })], "two.jpg", { type: "image/jpeg" }),
    ];
    const ok = await downloadWhatsappShareFiles(files, { pauseMs: 0 });
    assert.equal(ok, true);
    assert.deepEqual(downloads, ["one.jpg", "two.jpg"]);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    URL.createObjectURL = previousCreateObjectURL;
    URL.revokeObjectURL = previousRevokeObjectURL;
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
    assert.equal(result.embeddedSummary, false);
    assert.equal(shared.text, "Collection visit summary");
    assert.equal(shared.files.length, 1);
    assert.equal(shared.files[0].name, "receipt.jpg");
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

test("Android preparation keeps the summary as text and the receipt as the image", async () => {
  const file = new File([new Blob(["photo"], { type: "image/jpeg" })], "receipt.jpg", {
    type: "image/jpeg",
  });
  const prepared = await prepareWhatsappAttachmentShare(
    "Customer: 1254\nFunds received: 500",
    [file],
    {
      userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8)",
    },
  );
  assert.equal(prepared.embeddedSummary, false);
  assert.equal(prepared.message, "Customer: 1254\nFunds received: 500");
  assert.equal(prepared.files.length, 1);
  assert.equal(prepared.files[0].name, "receipt.jpg");
});

test("collection preparation stacks several photos into one JPEG", async () => {
  const files = [
    new File([new Blob(["a"], { type: "image/jpeg" })], "receipt-a.jpg", { type: "image/jpeg" }),
    new File([new Blob(["b"], { type: "image/jpeg" })], "receipt-b.jpg", { type: "image/jpeg" }),
  ];
  const prepared = await prepareWhatsappAttachmentShare("Visit summary", files, {
    document: createShareCanvasDocument(),
    loadImage: async () => ({ width: 400, height: 300 }),
  });
  assert.equal(prepared.files.length, 1);
  assert.equal(prepared.files[0].name, "collection-attachments.jpg");
  assert.equal(prepared.files[0].type, "image/jpeg");
});

test("catalogue export keeps each product photo as a separate file", async () => {
  const files = [
    new File([new Blob(["a"], { type: "image/jpeg" })], "A003944.jpg", { type: "image/jpeg" }),
    new File([new Blob(["b"], { type: "image/jpeg" })], "A003945.jpg", { type: "image/jpeg" }),
  ];
  const prepared = await prepareWhatsappAttachmentShare("", files, {
    keepSeparateFiles: true,
    document: createShareCanvasDocument(),
    loadImage: async () => ({ width: 400, height: 300 }),
  });
  assert.equal(prepared.files.length, 2);
  assert.equal(prepared.files[0].name, "A003944.jpg");
  assert.equal(prepared.files[1].name, "A003945.jpg");
});
