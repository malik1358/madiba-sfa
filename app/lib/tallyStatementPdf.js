import "pdfjs-dist/legacy/build/pdf.worker.mjs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { parseTallyStatementPositionedPages } from "./tallyStatementCompare.js";

async function ensureDomPolyfill() {
  if (typeof globalThis.DOMMatrix !== "undefined"
    && typeof globalThis.ImageData !== "undefined"
    && typeof globalThis.Path2D !== "undefined") {
    return;
  }
  try {
    const canvas = await import("@napi-rs/canvas");
    if (typeof globalThis.DOMMatrix === "undefined" && canvas.DOMMatrix) {
      globalThis.DOMMatrix = canvas.DOMMatrix;
    }
    if (typeof globalThis.ImageData === "undefined" && canvas.ImageData) {
      globalThis.ImageData = canvas.ImageData;
    }
    if (typeof globalThis.Path2D === "undefined" && canvas.Path2D) {
      globalThis.Path2D = canvas.Path2D;
    }
  } catch {
    // pdfjs loads canvas itself when this package is unavailable.
  }
}

export async function parseTallyStatementPdfBuffer(buffer) {
  await ensureDomPolyfill();
  const doc = await getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    isEvalSupported: false,
    useWorkerFetch: false,
    disableFontFace: true,
  }).promise;

  const pages = [];
  const pageCount = Math.min(doc.numPages || 0, 40);
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push((content.items || []).map((item) => ({
      x: item.transform?.[4] || 0,
      y: item.transform?.[5] || 0,
      width: item.width || 0,
      text: item.str || "",
    })));
  }

  return parseTallyStatementPositionedPages(pages);
}
