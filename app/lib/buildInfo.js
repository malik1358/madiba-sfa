export function resolveBuildId(env = process.env) {
  return String(env.VERCEL_GIT_COMMIT_SHA || env.NEXT_PUBLIC_BUILD_ID || "local").slice(0, 7);
}

export function resolveBuildTime(env = process.env) {
  const raw = String(
    env.NEXT_PUBLIC_BUILD_TIME
    || env.VERCEL_DEPLOYMENT_CREATED_AT
    || "",
  ).trim();

  if (!raw) return "";

  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

export function formatBuildDateTime(isoString, locale = "en-GB") {
  if (!isoString) return "";

  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleString(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function getClientBuildId() {
  if (typeof document === "undefined") return "local";
  return String(document.body?.dataset?.buildId || "local").trim() || "local";
}

export function buildCacheBustingReloadUrl(serverBuildId, currentHref = "") {
  const buildToken = String(serverBuildId || "").trim();
  const href = String(currentHref || "").trim() || "/";
  const url = new URL(href, "http://local");
  if (buildToken) {
    url.searchParams.set("_build", buildToken);
  } else {
    url.searchParams.set("_build", String(Date.now()));
  }
  return `${url.pathname}${url.search}${url.hash}`;
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