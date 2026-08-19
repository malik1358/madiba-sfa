export function resolveBuildId(env = process.env) {
  return String(env.VERCEL_GIT_COMMIT_SHA || env.NEXT_PUBLIC_BUILD_ID || "local").slice(0, 7);
}

export function getClientBuildId() {
  if (typeof document === "undefined") return "local";
  return String(document.body?.dataset?.buildId || "local").trim() || "local";
}

export function addPdfBuildFooter(doc, buildId = getClientBuildId()) {
  const label = `Build: ${String(buildId || "local").trim() || "local"}`;
  const pageCount = doc.getNumberOfPages();

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    doc.setPage(pageNumber);
    doc.setFont(undefined, "normal");
    doc.setFontSize(8);
    doc.setTextColor(90);
    doc.text(label, doc.internal.pageSize.getWidth() - 40, doc.internal.pageSize.getHeight() - 14, { align: "right" });
    doc.setTextColor(0);
  }
}