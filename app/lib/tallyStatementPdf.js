import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseTallyStatementPositionedPages } from "./tallyStatementCompare.js";

const requireFromRoot = createRequire(pathToFileURL(path.join(process.cwd(), "package.json")));

async function loadPdfJs() {
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

  const pdfPath = requireFromRoot.resolve("pdfjs-dist/legacy/build/pdf.mjs");
  const pdfjs = await import(pathToFileURL(pdfPath).href);
  if (pdfjs.GlobalWorkerOptions) {
    try {
      const workerPath = requireFromRoot.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");
      pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
    } catch {
      pdfjs.GlobalWorkerOptions.workerSrc = "";
    }
  }
  return pdfjs;
}

export async function parseTallyStatementPdfBuffer(buffer) {
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    isEvalSupported: false,
    useWorkerFetch: false,
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
