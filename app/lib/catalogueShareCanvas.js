import { catalogueShareFileName, wrapShareText } from "./catalogueShareCard.js";

const CARD_WIDTH = 1080;
const PHOTO_MAX_HEIGHT = 1080;
const SIDE_PAD = 40;
const ROLE_SIZE = {
  name: 44,
  code: 28,
  packing: 32,
  unit: 28,
  price: 54,
  was: 28,
  discount: 28,
  meta: 26,
};
const FONT_FAMILY = '"Segoe UI", "Noto Naskh Arabic", "Noto Sans Arabic", Tahoma, Arial, sans-serif';

function fontFor(role) {
  const size = ROLE_SIZE[role] || 28;
  const weight = role === "name" || role === "price" ? 700 : 500;
  return `${weight} ${size}px ${FONT_FAMILY}`;
}

function limitWrapped(parts, max = 3) {
  if (parts.length <= max) return parts;
  const kept = parts.slice(0, max);
  kept[max - 1] = `${kept[max - 1].replace(/[.\s…]+$/g, "")}…`;
  return kept;
}

async function defaultDecode(blob) {
  if (typeof createImageBitmap === "function") return createImageBitmap(blob);
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Unable to read the product photo."));
      image.src = url;
    });
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => {
    if (typeof canvas.toBlob !== "function") {
      reject(new Error("Unable to prepare the share image."));
      return;
    }
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Unable to prepare the share image."));
    }, "image/jpeg", 0.88);
  });
}

export async function renderCatalogueShareJpeg({
  photoBlob = null,
  lines = [],
  rtl = false,
  document: doc = globalThis.document,
  decodeImage = defaultDecode,
} = {}) {
  if (!doc?.createElement) throw new Error("Unable to prepare the share image.");
  const image = photoBlob ? await decodeImage(photoBlob) : null;
  const sourceWidth = Number(image?.width) || CARD_WIDTH;
  const sourceHeight = Number(image?.height) || 720;
  const fittedHeight = Math.max(1, Math.round(CARD_WIDTH * (sourceHeight / sourceWidth)));
  const photoHeight = Math.min(PHOTO_MAX_HEIGHT, image ? fittedHeight : 640);
  const photoWidth = image && fittedHeight > PHOTO_MAX_HEIGHT
    ? Math.max(1, Math.round(PHOTO_MAX_HEIGHT * (sourceWidth / sourceHeight)))
    : CARD_WIDTH;

  const measureCanvas = doc.createElement("canvas");
  const measure = measureCanvas.getContext("2d");
  if (!measure) throw new Error("Unable to prepare the share image.");
  const maxText = CARD_WIDTH - SIDE_PAD * 2;
  const wrapped = [];
  for (const line of lines) {
    measure.font = fontFor(line.role);
    const parts = limitWrapped(wrapShareText(line.text, maxText, (value) => measure.measureText(value).width));
    parts.forEach((text) => wrapped.push({ role: line.role, text, size: ROLE_SIZE[line.role] || 28 }));
  }
  const footerHeight = 36 + wrapped.reduce((sum, line) => sum + line.size + 14, 16);
  const canvas = doc.createElement("canvas");
  canvas.width = CARD_WIDTH;
  canvas.height = photoHeight + footerHeight;
  canvas.dir = rtl ? "rtl" : "ltr";
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Unable to prepare the share image.");
  context.direction = rtl ? "rtl" : "ltr";
  context.textAlign = rtl ? "right" : "left";
  context.textBaseline = "alphabetic";
  context.fillStyle = "#f3f7f8";
  context.fillRect(0, 0, CARD_WIDTH, photoHeight);
  if (image) {
    const offsetX = Math.round((CARD_WIDTH - photoWidth) / 2);
    const offsetY = Math.round((photoHeight - Math.min(photoHeight, fittedHeight)) / 2);
    context.drawImage(image, offsetX, offsetY, photoWidth, Math.min(photoHeight, fittedHeight));
  } else {
    context.fillStyle = "#687f87";
    context.font = `600 36px ${FONT_FAMILY}`;
    context.textAlign = "center";
    context.fillText(rtl ? "لا توجد صورة" : "No photo", CARD_WIDTH / 2, photoHeight / 2);
    context.textAlign = rtl ? "right" : "left";
  }
  context.fillStyle = "#0f4c5c";
  context.fillRect(0, photoHeight, CARD_WIDTH, footerHeight);
  let y = photoHeight + 36;
  const x = rtl ? CARD_WIDTH - SIDE_PAD : SIDE_PAD;
  for (const line of wrapped) {
    y += line.size;
    context.font = `${line.role === "name" || line.role === "price" ? 700 : 500} ${line.size}px ${FONT_FAMILY}`;
    context.fillStyle = line.role === "price" ? "#fff4c2" : "#ffffff";
    context.fillText(line.text, x, y);
    if (line.role === "was") {
      const textWidth = context.measureText(line.text).width;
      context.strokeStyle = "#d7e4e8";
      context.lineWidth = 2;
      context.beginPath();
      const lineY = y - line.size * 0.32;
      context.moveTo(x, lineY);
      context.lineTo(x + (rtl ? -textWidth : textWidth), lineY);
      context.stroke();
    }
    y += 14;
  }
  if (image && typeof image.close === "function") image.close();
  return canvasBlob(canvas);
}

export async function buildCatalogueShareFiles({
  photos = [],
  lines = [],
  rtl = false,
  loadPhoto,
  fileCode = "item",
  limit = 8,
  document,
  decodeImage,
} = {}) {
  const selected = (photos || []).slice(0, limit);
  const jobs = selected.length ? selected : [null];
  const files = [];
  for (let index = 0; index < jobs.length; index += 1) {
    let photoBlob = null;
    if (jobs[index] && loadPhoto) {
      try {
        photoBlob = await loadPhoto(jobs[index]);
      } catch {
        photoBlob = null;
      }
    }
    const blob = await renderCatalogueShareJpeg({ photoBlob, lines, rtl, document, decodeImage });
    files.push(new File([blob], catalogueShareFileName(fileCode, index), { type: "image/jpeg" }));
  }
  return files;
}
