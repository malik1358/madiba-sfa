const ARABIC_FONT = "NotoNaskhArabic";
const ARABIC_FILE = "NotoNaskhArabic-Regular.ttf";
const ARABIC_RUN = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]+(?:[ \t]+[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]+)*/g;

export function containsArabicText(value) {
  return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(String(value ?? ""));
}

export function splitPdfTextRuns(text) {
  const value = String(text ?? "");
  const runs = [];
  let last = 0;
  for (const match of value.matchAll(ARABIC_RUN)) {
    const index = match.index || 0;
    if (index > last) runs.push({ text: value.slice(last, index), arabic: false });
    runs.push({ text: match[0], arabic: true });
    last = index + match[0].length;
  }
  if (last < value.length) runs.push({ text: value.slice(last), arabic: false });
  return runs;
}

function arabicFontStyle(style) {
  return style === "bold" || style === "bolditalic" ? "bold" : "normal";
}

function visualArabic(doc, text) {
  const shaped = typeof doc.processArabic === "function" ? doc.processArabic(String(text)) : String(text);
  return Array.from(shaped).reverse().join("");
}

export function registerArabicPdfFont(doc, fontBase64) {
  if (!doc || doc.__arabicPdfFont || !fontBase64) return;
  doc.addFileToVFS(ARABIC_FILE, fontBase64);
  doc.addFont(ARABIC_FILE, ARABIC_FONT, "normal");
  doc.addFont(ARABIC_FILE, ARABIC_FONT, "bold");
  doc.__arabicPdfFont = true;
}

export function installArabicPdfText(doc) {
  if (!doc || doc.__arabicPdfText || typeof doc.text !== "function") return;
  doc.__arabicPdfText = true;

  const originalText = doc.text.bind(doc);
  const originalSplit = doc.splitTextToSize.bind(doc);
  const originalWidth = doc.getTextWidth.bind(doc);

  function latinFont() {
    const current = typeof doc.getFont === "function" ? doc.getFont() : null;
    return {
      fontName: current?.fontName && current.fontName !== ARABIC_FONT ? current.fontName : "helvetica",
      fontStyle: current?.fontStyle || "normal",
    };
  }

  function widthOf(text, arabic, font) {
    doc.setFont(arabic ? ARABIC_FONT : font.fontName, arabic ? arabicFontStyle(font.fontStyle) : font.fontStyle);
    const drawn = arabic ? visualArabic(doc, text) : String(text ?? "");
    return { drawn, width: originalWidth(drawn) };
  }

  function measure(text, font) {
    return splitPdfTextRuns(text).reduce((sum, run) => sum + widthOf(run.text, run.arabic, font).width, 0);
  }

  function wrapMixed(text, maxWidth, font) {
    const limit = Number(maxWidth);
    if (!Number.isFinite(limit) || limit <= 0) return [String(text ?? "")];
    const tokens = String(text ?? "").split(/(\s+)/);
    const lines = [];
    let line = "";
    let lineWidth = 0;
    tokens.forEach((token) => {
      if (!token) return;
      const tokenWidth = measure(token, font);
      if (line && lineWidth + tokenWidth > limit && token.trim()) {
        lines.push(line.replace(/\s+$/, ""));
        line = token.replace(/^\s+/, "");
        lineWidth = measure(line, font);
        return;
      }
      line += token;
      lineWidth += tokenWidth;
    });
    if (line) lines.push(line.replace(/\s+$/, ""));
    return lines.length ? lines : [""];
  }

  doc.getTextWidth = function getTextWidth(text) {
    const value = String(text ?? "");
    if (!doc.__arabicPdfFont || !containsArabicText(value)) return originalWidth(value);
    const font = latinFont();
    try {
      return measure(value, font);
    } finally {
      doc.setFont(font.fontName, font.fontStyle);
    }
  };

  doc.splitTextToSize = function splitTextToSize(text, size, options) {
    const value = typeof text === "string" ? text : "";
    if (typeof text !== "string" || !doc.__arabicPdfFont || !containsArabicText(value)) {
      return originalSplit(text, size, options);
    }
    const font = latinFont();
    try {
      return value.split(/\r?\n/).flatMap((paragraph) => wrapMixed(paragraph, size, font));
    } finally {
      doc.setFont(font.fontName, font.fontStyle);
    }
  };

  doc.text = function text(value, x, y, options, transform) {
    if (typeof value !== "string" || !doc.__arabicPdfFont || !containsArabicText(value) || options?.angle) {
      return originalText(value, x, y, options, transform);
    }

    const font = latinFont();
    const maxWidth = Number(options?.maxWidth || 0);
    const lines = maxWidth > 0 ? wrapMixed(value, maxWidth, font) : String(value).split(/\r?\n/);
    const lineHeight = typeof doc.getLineHeight === "function" ? doc.getLineHeight() : (doc.getFontSize?.() || 10) * 1.15;
    const align = options?.align || "left";
    let cursorY = Number(y) || 0;

    lines.forEach((line) => {
      const prepared = splitPdfTextRuns(line).map((run) => ({
        ...run,
        ...widthOf(run.text, run.arabic, font),
      }));
      const lineWidth = prepared.reduce((sum, run) => sum + run.width, 0);
      let cursorX = Number(x) || 0;
      if (align === "right") cursorX -= lineWidth;
      if (align === "center") cursorX -= lineWidth / 2;

      prepared.forEach((run) => {
        if (!run.drawn) return;
        doc.setFont(run.arabic ? ARABIC_FONT : font.fontName, run.arabic ? arabicFontStyle(font.fontStyle) : font.fontStyle);
        originalText(run.drawn, cursorX, cursorY, run.arabic ? { isInputVisual: false } : undefined);
        cursorX += run.width;
      });
      cursorY += lineHeight;
    });

    doc.setFont(font.fontName, font.fontStyle);
    return doc;
  };
}
