import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { extractPdfText } from "./extractPdfText.js";
import { extractCrNumberFromText } from "./customerDocumentParse.js";

const requireFromRoot = createRequire(pathToFileURL(path.join(process.cwd(), "package.json")));

function killProcessTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } else {
      process.kill(pid, "SIGKILL");
    }
  } catch {
    // already exited
  }
}

async function polyfillDomForPdfJs() {
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
}

async function normalizeImageForOcr(buffer) {
  try {
    const sharpMod = await import("sharp");
    const sharp = sharpMod.default || sharpMod;
    return await sharp(buffer, { failOn: "none" })
      .rotate()
      .png()
      .toBuffer();
  } catch {
    return null;
  }
}

export async function ocrImageBuffer(buffer) {
  const clean = await normalizeImageForOcr(buffer);
  if (!clean) return "";

  try {
    const { createWorker } = await import("tesseract.js");
    const localData = existsSync(path.join(process.cwd(), "eng.traineddata"));
    const worker = await createWorker("eng", 1, localData ? {
      langPath: process.cwd(),
      cachePath: process.cwd(),
      gzip: false,
    } : undefined);
    try {
      const result = await worker.recognize(clean);
      return String(result?.data?.text || "");
    } finally {
      try {
        await worker.terminate();
      } catch {
        // ignore
      }
    }
  } catch {
    return "";
  }
}

async function loadPdfJs() {
  await polyfillDomForPdfJs();
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

async function extractPdfJsText(buffer) {
  try {
    const pdfjs = await loadPdfJs();
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
      isEvalSupported: false,
      useWorkerFetch: false,
    }).promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= Math.min(doc.numPages, 4); pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push((content.items || []).map((item) => item.str || "").join(" "));
    }
    return pages.join("\n");
  } catch {
    return "";
  }
}

async function renderPdfPages(buffer, maxPages = 1) {
  const pdfjs = await loadPdfJs();
  const { createCanvas } = await import("@napi-rs/canvas");
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    isEvalSupported: false,
    useWorkerFetch: false,
  }).promise;
  const images = [];
  const pageCount = Math.min(doc.numPages || 1, maxPages);
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1.6 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const canvasContext = canvas.getContext("2d");
    await page.render({ canvas, canvasContext, viewport }).promise;
    images.push(canvas.toBuffer("image/png"));
  }
  return images;
}

export async function extractCustomerDocumentText({ buffer, mime = "", fileName = "" } = {}) {
  const name = String(fileName || "");
  const type = String(mime || "").toLowerCase();
  const isPdf = type.includes("pdf") || name.toLowerCase().endsWith(".pdf");
  const isImage = type.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif)$/i.test(name);

  if (isImage) {
    try {
      return await ocrImageBuffer(buffer);
    } catch {
      return "";
    }
  }

  if (!isPdf) return "";

  const parts = [];
  try {
    parts.push(await extractPdfText(buffer));
  } catch {
    // continue
  }

  if (!extractCrNumberFromText(parts.join("\n"))) {
    const pdfJsText = await extractPdfJsText(buffer);
    if (pdfJsText) parts.push(pdfJsText);
  }

  let text = parts.filter(Boolean).join("\n");
  if (extractCrNumberFromText(text)) return text;

  try {
    const pageImages = await renderPdfPages(buffer, 1);
    for (const image of pageImages) {
      try {
        parts.push(await ocrImageBuffer(image));
      } catch {
        // continue
      }
    }
  } catch {
    // canvas/pdfjs render unavailable
  }

  return parts.filter(Boolean).join("\n");
}

export function extractCustomerDocumentTextSafe({ buffer, mime = "", fileName = "", timeoutMs = 40000 } = {}) {
  const id = randomBytes(8).toString("hex");
  const tmpFile = path.join(os.tmpdir(), `madiba-doc-${id}.bin`);
  const worker = path.join(process.cwd(), "scripts", "extract-customer-document-text.mjs");
  writeFileSync(tmpFile, buffer);

  return new Promise((resolve) => {
    const child = spawn(process.execPath, [worker, tmpFile, String(mime || ""), String(fileName || "")], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
      windowsHide: true,
    });

    let stdout = "";
    let settled = false;
    const finish = (text) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        unlinkSync(tmpFile);
      } catch {
        // ignore
      }
      resolve(String(text || ""));
    };

    const timer = setTimeout(() => {
      killProcessTree(child.pid);
      finish("");
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
    });
    child.on("error", () => finish(""));
    child.on("exit", () => {
      try {
        const parsed = JSON.parse(String(stdout || "").trim() || "{}");
        finish(parsed.text || "");
      } catch {
        finish(stdout);
      }
    });
  });
}
