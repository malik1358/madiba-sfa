import { readFileSync } from "node:fs";
import { extractCustomerDocumentText } from "../app/lib/extractCustomerDocumentText.js";

const [filePath, mime, fileName] = process.argv.slice(2);
if (!filePath) {
  process.stdout.write(JSON.stringify({ text: "" }));
  process.exit(0);
}

try {
  const buffer = readFileSync(filePath);
  const text = await extractCustomerDocumentText({
    buffer,
    mime: mime || "",
    fileName: fileName || "",
  });
  process.stdout.write(JSON.stringify({ text: String(text || "") }));
} catch (error) {
  process.stderr.write(String(error?.stack || error?.message || error));
  process.stdout.write(JSON.stringify({ text: "" }));
  process.exit(0);
}
