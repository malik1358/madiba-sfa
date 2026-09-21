/**
 * Production Supabase project ref (public identifier, not a secret).
 * From repo MCP config / project "SFA".
 */
export const PRODUCTION_SUPABASE_PROJECT_REF = "ynmtlzyqvmurpmfretji";

export function extractSupabaseProjectRef(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";

  try {
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const host = new URL(withProtocol).hostname.toLowerCase();
    const apiMatch = host.match(/^([a-z0-9]+)\.supabase\.co$/i);
    if (apiMatch) return apiMatch[1];
    const dbMatch = host.match(/^db\.([a-z0-9]+)\.supabase\.co$/i);
    if (dbMatch) return dbMatch[1];
  } catch {
    return "";
  }

  return "";
}

export function isProductionSupabaseUrl(url) {
  return extractSupabaseProjectRef(url) === PRODUCTION_SUPABASE_PROJECT_REF;
}

/**
 * Enforce the guard everywhere except real Vercel production deploys
 * (or an explicit emergency override).
 */
export function shouldEnforceLocalSupabaseGuard(env = process.env) {
  if (String(env.MADIBA_ALLOW_PRODUCTION_SUPABASE || "").trim() === "1") {
    return false;
  }
  if (String(env.VERCEL_ENV || "").trim().toLowerCase() === "production") {
    return false;
  }
  return true;
}

export function assertSupabaseUrlAllowed(url, env = process.env) {
  if (!shouldEnforceLocalSupabaseGuard(env)) {
    return;
  }
  if (!isProductionSupabaseUrl(url)) {
    return;
  }

  throw new Error(
    "Production Supabase is blocked in local/development. " +
      "Use local Supabase credentials in .env.local (see .env.example). " +
      "Do not point NEXT_PUBLIC_SUPABASE_URL at the production project.",
  );
}

export function assertConfiguredSupabaseUrlAllowed(env = process.env) {
  const url = String(env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  if (!url) return;
  assertSupabaseUrlAllowed(url, env);
}
