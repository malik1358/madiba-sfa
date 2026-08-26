export function resolveBackFallbackPath(pathname = "") {
  const path = String(pathname || "").trim() || "/";
  if (path === "/") return null;

  const segments = path.split("/").filter(Boolean);
  if (segments[0] === "management") {
    if (segments.length <= 1) return "/";
    return `/${segments.slice(0, -1).join("/")}`;
  }

  return "/";
}
