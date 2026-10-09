import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  RECEIPT_JPEG_QUALITY,
  RECEIPT_MAX_IMAGE_DIMENSION,
  RECEIPT_MIN_JPEG_QUALITY,
  RECEIPT_TARGET_BYTES,
  encodeReceiptJpeg,
  prepareReceiptUploadFile,
  prepareUploadFile,
  receiptCanvasSize,
  shouldKeepOriginalReceipt,
} from "../app/lib/compressUploadFile.js";
import { formDataToOfflinePayload } from "../app/lib/offlineSyncQueue.js";

// Browser stand-ins: <img> reports EXIF-oriented natural size, like modern Chrome/Safari.
const harness = {
  imageWidth: 0,
  imageHeight: 0,
  decodeFails: false,
  bytesForEncode: (quality, width, height) => Math.round(width * height * quality * 0.4),
  imagesCreated: 0,
  qualities: [],
  canvases: [],
  fills: [],
};

const saved = {};

beforeEach(() => {
  Object.assign(harness, {
    imageWidth: 0,
    imageHeight: 0,
    decodeFails: false,
    bytesForEncode: (quality, width, height) => Math.round(width * height * quality * 0.4),
    imagesCreated: 0,
    qualities: [],
    canvases: [],
    fills: [],
  });

  saved.Image = globalThis.Image;
  saved.document = globalThis.document;

  globalThis.Image = class FakeImage {
    constructor() {
      harness.imagesCreated += 1;
      this.onload = null;
      this.onerror = null;
      this.width = 0;
      this.height = 0;
    }

    set src(value) {
      if (!value) return;
      setTimeout(() => {
        if (harness.decodeFails) {
          this.onerror?.(new Error("decode failed"));
          return;
        }
        this.width = harness.imageWidth;
        this.height = harness.imageHeight;
        this.onload?.();
      }, 0);
    }
  };

  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, "canvas");
      const canvas = {
        width: 0,
        height: 0,
        getContext() {
          return {
            fillStyle: "",
            fillRect(x, y, w, h) {
              harness.fills.push({ color: this.fillStyle, x, y, w, h });
            },
            drawImage() {},
          };
        },
        toBlob(callback, type, quality) {
          harness.qualities.push(quality);
          const size = harness.bytesForEncode(quality, canvas.width, canvas.height);
          callback(new Blob([new Uint8Array(size)], { type }));
        },
      };
      harness.canvases.push(canvas);
      return canvas;
    },
  };
});

afterEach(() => {
  globalThis.Image = saved.Image;
  globalThis.document = saved.document;
});

const JPEG_HEADER = [0xff, 0xd8, 0xff, 0xe0];
const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47];
const PDF_HEADER = [0x25, 0x50, 0x44, 0x46, 0x2d];

function makeFile(name, type, size, header = []) {
  const bytes = new Uint8Array(size);
  bytes.set(header.slice(0, size));
  return new File([bytes], name, { type });
}

async function sameBytes(left, right) {
  const [a, b] = await Promise.all([left.arrayBuffer(), right.arrayBuffer()]);
  return Buffer.from(a).equals(Buffer.from(b));
}

test("receipt policy constants match the approved design", () => {
  assert.equal(RECEIPT_MAX_IMAGE_DIMENSION, 1600);
  assert.equal(RECEIPT_JPEG_QUALITY, 0.75);
  assert.equal(RECEIPT_MIN_JPEG_QUALITY, 0.7);
  assert.equal(RECEIPT_TARGET_BYTES, 500 * 1024);
});

test("receiptCanvasSize caps the longest side at 1600 for landscape and portrait", () => {
  assert.deepEqual(receiptCanvasSize(4000, 3000), { width: 1600, height: 1200, scaled: true });
  assert.deepEqual(receiptCanvasSize(3000, 4000), { width: 1200, height: 1600, scaled: true });
  assert.deepEqual(receiptCanvasSize(1200, 900), { width: 1200, height: 900, scaled: false });
  assert.deepEqual(receiptCanvasSize(1600, 1600), { width: 1600, height: 1600, scaled: false });
});

test("encodeReceiptJpeg uses 0.75 only when the result is within the target", async () => {
  const qualities = [];
  const { blob, quality } = await encodeReceiptJpeg(async (q) => {
    qualities.push(q);
    return new Blob([new Uint8Array(300 * 1024)]);
  });
  assert.deepEqual(qualities, [0.75]);
  assert.equal(quality, 0.75);
  assert.equal(blob.size, 300 * 1024);
});

test("encodeReceiptJpeg tries 0.70 once and never goes lower, even when still above target", async () => {
  const qualities = [];
  const { blob, quality } = await encodeReceiptJpeg(async (q) => {
    qualities.push(q);
    return new Blob([new Uint8Array(q === 0.75 ? 2_000_000 : 1_900_000)]);
  });
  assert.deepEqual(qualities, [0.75, 0.7]);
  assert.equal(quality, 0.7);
  assert.equal(blob.size, 1_900_000);
});

test("shouldKeepOriginalReceipt keeps small originals that re-encoding would not shrink", () => {
  assert.equal(shouldKeepOriginalReceipt({ originalSize: 60_000, compressedSize: 140_000, scaled: false, isHeic: false }), true);
  assert.equal(shouldKeepOriginalReceipt({ originalSize: 60_000, compressedSize: 40_000, scaled: false, isHeic: false }), false);
  assert.equal(shouldKeepOriginalReceipt({ originalSize: 60_000, compressedSize: 140_000, scaled: true, isHeic: false }), false);
  assert.equal(shouldKeepOriginalReceipt({ originalSize: 60_000, compressedSize: 140_000, scaled: false, isHeic: true }), false);
});

test("large landscape phone JPG is resized to 1600px and re-encoded as JPEG", async () => {
  harness.imageWidth = 4032;
  harness.imageHeight = 3024;
  const original = makeFile("IMG_1234.jpg", "image/jpeg", 3_500_000, JPEG_HEADER);

  const prepared = await prepareReceiptUploadFile(original);

  assert.equal(prepared.type, "image/jpeg");
  assert.equal(prepared.name, "IMG_1234.jpg");
  assert.equal(harness.canvases[0].width, 1600);
  assert.equal(harness.canvases[0].height, 1200);
  // 1600x1200 at 0.75 is above ~500 KB in this harness, so 0.70 is tried and kept.
  assert.deepEqual(harness.qualities, [0.75, 0.7]);
  assert.equal(prepared.size, Math.round(1600 * 1200 * 0.7 * 0.4));
  assert.ok(prepared.size < original.size);
});

test("portrait receipts (including EXIF-rotated photos reported upright) stay portrait", async () => {
  harness.imageWidth = 3024;
  harness.imageHeight = 4032;
  const prepared = await prepareReceiptUploadFile(makeFile("portrait.jpg", "image/jpeg", 2_800_000, JPEG_HEADER));

  assert.equal(prepared.type, "image/jpeg");
  assert.equal(harness.canvases[0].width, 1200);
  assert.equal(harness.canvases[0].height, 1600);
});

test("small PNG under 3 MB is still compressed to JPEG on a white background", async () => {
  harness.imageWidth = 1200;
  harness.imageHeight = 900;
  const original = makeFile("screenshot.png", "image/png", 900_000, PNG_HEADER);

  const prepared = await prepareReceiptUploadFile(original);

  assert.equal(prepared.type, "image/jpeg");
  assert.equal(prepared.name, "screenshot.jpg");
  assert.deepEqual(harness.qualities, [0.75]);
  assert.equal(harness.fills[0].color, "#ffffff");
  assert.equal(harness.canvases[0].width, 1200);
});

test("already-small JPEG is kept unchanged when re-encoding would not shrink it", async () => {
  harness.imageWidth = 800;
  harness.imageHeight = 600;
  const original = makeFile("small.jpg", "image/jpeg", 60_000, JPEG_HEADER);

  const prepared = await prepareReceiptUploadFile(original);

  assert.equal(prepared.type, "image/jpeg");
  assert.equal(prepared.size, original.size);
  assert.equal(await sameBytes(prepared, original), true);
});

test("decodable HEIC is always converted to JPEG", async () => {
  harness.imageWidth = 1000;
  harness.imageHeight = 800;
  const prepared = await prepareReceiptUploadFile(makeFile("IMG_0001.HEIC", "image/heic", 100_000));

  assert.equal(prepared.type, "image/jpeg");
  assert.equal(prepared.name, "IMG_0001.jpg");
});

test("PDF receipt is unchanged and never decoded", async () => {
  const original = makeFile("receipt.pdf", "application/pdf", 1_200_000, PDF_HEADER);

  const prepared = await prepareReceiptUploadFile(original);

  assert.equal(harness.imagesCreated, 0);
  assert.equal(prepared.type, "application/pdf");
  assert.equal(prepared.size, original.size);
  assert.equal(await sameBytes(prepared, original), true);
});

test("Android octet-stream PDF is detected by magic bytes and left unchanged", async () => {
  const original = makeFile("download", "application/octet-stream", 50_000, PDF_HEADER);

  const prepared = await prepareReceiptUploadFile(original);

  assert.equal(harness.imagesCreated, 0);
  assert.equal(prepared.type, "application/pdf");
  assert.equal(await sameBytes(prepared, original), true);
});

test("decoding failure falls back to the original bytes like the existing upload path", async () => {
  harness.decodeFails = true;
  const original = makeFile("camera.jpg", "image/jpeg", 4_000_000, JPEG_HEADER);

  const prepared = await prepareReceiptUploadFile(original);

  assert.equal(prepared.type, "image/jpeg");
  assert.equal(prepared.size, original.size);
  assert.equal(await sameBytes(prepared, original), true);
});

test("decoding failure above the 20 MB storage limit still reports an error", async () => {
  harness.decodeFails = true;
  await assert.rejects(
    prepareReceiptUploadFile(makeFile("huge.jpg", "image/jpeg", 21 * 1024 * 1024, JPEG_HEADER)),
    /Unable to read this photo/,
  );
});

test("payment copy path (prepareUploadFile) is unchanged: small JPG passes through untouched", async () => {
  harness.imageWidth = 4032;
  harness.imageHeight = 3024;
  const original = makeFile("payment.jpg", "image/jpeg", 2_000_000, JPEG_HEADER);

  const prepared = await prepareUploadFile(original);

  assert.equal(harness.imagesCreated, 0);
  assert.equal(prepared.size, original.size);
  assert.equal(await sameBytes(prepared, original), true);
});

test("offline queue payload stores the compressed receipt bytes", async () => {
  harness.imageWidth = 4032;
  harness.imageHeight = 3024;
  const prepared = await prepareReceiptUploadFile(makeFile("IMG_9.jpg", "image/jpeg", 3_500_000, JPEG_HEADER));

  const formData = new FormData();
  formData.append("customerCode", "1114C");
  formData.append("receiptCopy", prepared);
  const payload = await formDataToOfflinePayload(formData);

  assert.equal(payload.files.length, 1);
  assert.equal(payload.files[0].name, "receiptCopy");
  assert.equal(payload.files[0].fileName, "IMG_9.jpg");
  assert.equal(payload.files[0].mimeType, "image/jpeg");
  assert.equal(payload.files[0].buffer.byteLength, prepared.size);
});

test("collection save sends the same prepared receipt to the API and WhatsApp; payment copy keeps old prep", () => {
  const source = fs.readFileSync(
    new URL("../app/management/payment-collections/PaymentCollectionsView.jsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /const preparedReceipt = await prepareReceiptUploadFile\(form\.receiptCopy\);/);
  assert.match(source, /const preparedPayment = await prepareUploadFile\(form\.paymentCopy\);/);
  assert.match(source, /const receiptFile = toWhatsappShareFile\(preparedReceipt, receiptFallback\);\s*formData\.append\("receiptCopy", receiptFile\);\s*if \(receiptFile\) shareFiles\.push\(receiptFile\);/);
});

test("customer documents keep the existing upload preparation", () => {
  const source = fs.readFileSync(
    new URL("../app/management/customer-master/CustomerDocumentsPanel.jsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /await prepareUploadFile\(file\)/);
  assert.doesNotMatch(source, /prepareReceiptUploadFile/);
});
