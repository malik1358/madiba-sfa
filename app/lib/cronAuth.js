export function normalizeCronSecret(value) {
  return String(value || "").trim();
}

export function isCronAuthorized(request, expectedSecret = process.env.CRON_SECRET) {
  const secret = normalizeCronSecret(expectedSecret);
  if (!secret) return false;

  const authHeader = request.headers.get("authorization") || "";
  const bearer = authHeader.startsWith("Bearer ")
    ? normalizeCronSecret(authHeader.slice(7))
    : "";
  const headerSecret = normalizeCronSecret(request.headers.get("x-cron-secret"));

  return bearer === secret || headerSecret === secret;
}
