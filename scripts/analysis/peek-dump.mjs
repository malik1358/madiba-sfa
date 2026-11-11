import fs from "node:fs";

const path = process.argv[2];
const t = fs.readFileSync(path, "utf8");
console.log("len", t.length);
console.log("starts", JSON.stringify(t.slice(0, 100)));
console.log("idx [{", t.indexOf("[{"));
console.log("idx untrusted", t.indexOf("untrusted-data"));
const i = t.indexOf("[{");
console.log("at [{", JSON.stringify(t.slice(i, i + 150)));
const j = t.lastIndexOf("}]");
console.log("near }]", JSON.stringify(t.slice(Math.max(0, j - 40), j + 10)));
console.log("ends", JSON.stringify(t.slice(-120)));
