export async function extractPdfText(buffer) {
  const pdfParseModule = await import("pdf-parse");
  const pdfParse = pdfParseModule.default || pdfParseModule;
  const result = await pdfParse(Buffer.from(buffer));
  return String(result?.text || "");
}
