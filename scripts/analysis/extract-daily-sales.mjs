import fs from "node:fs";

const src = process.argv[2];
const dest = process.argv[3] || "scripts/analysis/daily-sales.json";
const text = fs.readFileSync(src, "utf8");

const outer = JSON.parse(text);
const payload = typeof outer.result === "string" ? outer.result : text;

// Prefer the tagged payload block that actually wraps a JSON array.
const block = payload.match(/<untrusted-data-[0-9a-f-]+>\s*(\[[\s\S]*?\])\s*<\/untrusted-data-[0-9a-f-]+>/i);
const fallback = payload.match(/(\[\s*\{\s*"d"\s*:[\s\S]*\}\s*\])/);
const jsonText = block?.[1] || fallback?.[1];
if (!jsonText) {
  console.error("Could not locate JSON array in dump");
  process.exit(1);
}
const rows = JSON.parse(jsonText).map((r) => ({
  d: String(r.d).slice(0, 10),
  salesman: String(r.salesman || "").trim().toUpperCase(),
  net_sales: Number(r.net_sales) || 0,
}));
fs.mkdirSync("scripts/analysis", { recursive: true });
fs.writeFileSync(dest, JSON.stringify(rows));
console.log(JSON.stringify({
  rows: rows.length,
  first: rows[0],
  last: rows[rows.length - 1],
  salesmen: [...new Set(rows.map((r) => r.salesman))].sort(),
}, null, 2));
