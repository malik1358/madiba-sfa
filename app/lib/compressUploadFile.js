const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 2000;

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Unable to read this photo. Retake it or choose JPG/PNG/PDF."));
    };
    image.src = url;
  });
}

function canvasToJpegBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Unable to compress this photo. Retake it or choose a smaller JPG/PNG file."));
        return;
      }
      resolve(blob);
    }, "image/jpeg", quality);
  });
}

async function compressImageFile(file) {
  const image = await loadImageFromFile(file);
  const scale = Math.min(
    1,
    MAX_IMAGE_DIMENSION / Math.max(image.width, image.height, 1),
  );
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Unable to compress this photo in the browser.");

  context.drawImage(image, 0, 0, width, height);

  let quality = 0.88;
  let blob = await canvasToJpegBlob(canvas, quality);
  while (blob.size > MAX_UPLOAD_BYTES && quality > 0.45) {
    quality -= 0.08;
    blob = await canvasToJpegBlob(canvas, quality);
  }

  if (blob.size > MAX_UPLOAD_BYTES) {
    throw new Error("Photo is still too large after compression. Retake the photo closer or use PDF.");
  }

  const baseName = String(file.name || "upload").replace(/\.[^.]+$/, "") || "upload";
  return new File([blob], `${baseName}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
}

export async function prepareUploadFile(file) {
  if (!file || typeof File === "undefined" || !(file instanceof Blob)) return file;

  const mime = String(file.type || "").toLowerCase();
  if (mime === "application/pdf") {
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new Error("PDF file is too large. Choose a file under 3 MB.");
    }
    return file;
  }

  if (!mime.startsWith("image/")) return file;
  if (file.size <= MAX_UPLOAD_BYTES && !mime.includes("heic") && !mime.includes("heif")) {
    return file;
  }

  return compressImageFile(file);
}
