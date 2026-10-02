import { isProductionSupabaseUrl } from "../supabaseGuard.js";

export const PRODUCTION_R2_BUCKET = "madiba-attachments-prod";
export const DEVELOPMENT_R2_BUCKET = "madiba-attachments-dev";

const PROD_NAME_PATTERN = /(^|[-_.])(prod|production|live)($|[-_.])/i;
const R2_HOST_PATTERN = /^[a-f0-9]{32}(\.[a-z]{2,10})?\.r2\.cloudflarestorage\.com$/i;

export function isProductionR2Bucket(bucket) {
  const name = String(bucket || "").trim().toLowerCase();
  return name === PRODUCTION_R2_BUCKET || PROD_NAME_PATTERN.test(name);
}

function isProductionRuntime(env) {
  return String(env.VERCEL_ENV || "").trim().toLowerCase() === "production";
}

export function defaultR2Endpoint(accountId) {
  return `https://${String(accountId || "").trim().toLowerCase()}.r2.cloudflarestorage.com`;
}

// Only the private S3 API host is accepted: never r2.dev or a public custom domain.
export function normalizeR2Endpoint(endpoint, accountId) {
  const raw = String(endpoint || "").trim() || defaultR2Endpoint(accountId);
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("R2_ENDPOINT is not a valid URL.");
  }
  if (url.protocol !== "https:") throw new Error("R2_ENDPOINT must use https.");
  if (url.pathname.replace(/\/+$/, "") || url.search || url.hash) {
    throw new Error("R2_ENDPOINT must be the account endpoint without a bucket or path.");
  }
  if (!R2_HOST_PATTERN.test(url.hostname)) {
    throw new Error("R2_ENDPOINT must be <account>.r2.cloudflarestorage.com (optionally <account>.<jurisdiction>.r2...).");
  }
  const account = String(accountId || "").trim().toLowerCase();
  if (account && !url.hostname.toLowerCase().startsWith(`${account}.`)) {
    throw new Error("R2_ENDPOINT does not match R2_ACCOUNT_ID.");
  }
  return `https://${url.hostname.toLowerCase()}`;
}

/**
 * Fail closed:
 * - the production bucket only from Vercel production connected to production Supabase;
 * - Vercel production never writes to a non-production bucket.
 * No override flag on purpose.
 */
export function assertR2BucketAllowed(bucket, env = process.env) {
  const name = String(bucket || "").trim();
  if (!name) throw new Error("R2_BUCKET is not configured.");
  if (typeof window !== "undefined") throw new Error("R2 storage is server-only.");

  const productionBucket = isProductionR2Bucket(name);
  const productionRuntime = isProductionRuntime(env);
  const productionSupabase = isProductionSupabaseUrl(env.NEXT_PUBLIC_SUPABASE_URL);

  if (productionBucket && !(productionRuntime && productionSupabase)) {
    throw new Error(
      "Production R2 bucket is blocked outside Vercel production. Use madiba-attachments-dev locally.",
    );
  }
  if (productionRuntime && !productionBucket) {
    throw new Error("Vercel production must use the production R2 bucket.");
  }
}

export function readR2Config(env = process.env) {
  const accountId = String(env.R2_ACCOUNT_ID || "").trim();
  const accessKeyId = String(env.R2_ACCESS_KEY_ID || "").trim();
  const secretAccessKey = String(env.R2_SECRET_ACCESS_KEY || "").trim();
  const bucket = String(env.R2_BUCKET || "").trim();

  const missing = [
    ["R2_ACCOUNT_ID", accountId],
    ["R2_ACCESS_KEY_ID", accessKeyId],
    ["R2_SECRET_ACCESS_KEY", secretAccessKey],
    ["R2_BUCKET", bucket],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) throw new Error(`R2 is not configured: missing ${missing.join(", ")}.`);
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error("R2_BUCKET is not a valid bucket name.");

  assertR2BucketAllowed(bucket, env);
  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    endpoint: normalizeR2Endpoint(env.R2_ENDPOINT, accountId),
  };
}
