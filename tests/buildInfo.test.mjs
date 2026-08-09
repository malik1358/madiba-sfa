import test from "node:test";
import assert from "node:assert/strict";

import { addPdfBuildFooter } from "../app/lib/buildInfo.js";

test("addPdfBuildFooter writes the build number on every page", () => {
  const calls = [];
  const doc = {
    internal: {
      pageSize: {
        getWidth: () => 595,
        getHeight: () => 842,
      },
    },
    getNumberOfPages: () => 2,
    setPage: (page) => calls.push(["page", page]),
    setFont: () => {},
    setFontSize: () => {},
    setTextColor: () => {},
    text: (...args) => calls.push(["text", ...args]),
  };

  addPdfBuildFooter(doc, "1f7c9cb");

  assert.deepEqual(calls.filter(([type]) => type === "page"), [["page", 1], ["page", 2]]);
  assert.equal(calls.filter(([type, text]) => type === "text" && text === "Build: 1f7c9cb").length, 2);
});