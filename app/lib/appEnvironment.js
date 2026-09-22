/**
 * App environment labels for the shell and build-info API.
 * Local/dev is non-production. Production is Vercel `main` only.
 * Legacy `staging` is treated as non-production for backwards compatibility.
 */

const NON_PRODUCTION_ENVS = new Set(["local", "development", "dev", "staging"]);

export function normalizeAppEnv(env = process.env) {
  return String(env.NEXT_PUBLIC_APP_ENV || "").trim().toLowerCase();
}

export function isNonProductionAppEnv(env = process.env) {
  return NON_PRODUCTION_ENVS.has(normalizeAppEnv(env));
}

/** Shell / API label: LOCAL or PRODUCTION. */
export function resolveAppEnvironmentLabel(env = process.env) {
  return isNonProductionAppEnv(env) ? "LOCAL" : "PRODUCTION";
}
