import { createHash } from "node:crypto";
import * as supabaseProvider from "./providers/supabaseProvider.js";
import * as r2Provider from "./providers/r2Provider.js";

export const STORAGE_PROVIDERS = Object.freeze({
  supabase: supabaseProvider.SUPABASE_PROVIDER,
  r2: r2Provider.R2_PROVIDER,
});
export const DEFAULT_STORAGE_PROVIDER = STORAGE_PROVIDERS.supabase;
export const ACTIVE_STORAGE_PROVIDER = DEFAULT_STORAGE_PROVIDER;
export const SIGNED_URL_TTL_SECONDS = 300;
export const MAX_SIGNED_URL_TTL_SECONDS = 900;
const MIN_SIGNED_URL_TTL_SECONDS = 30;

const PROVIDERS = {
  [STORAGE_PROVIDERS.supabase]: supabaseProvider,
  [STORAGE_PROVIDERS.r2]: r2Provider,
};

function isOn(value) {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}

export function clampSignedUrlTtl(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return SIGNED_URL_TTL_SECONDS;
  return Math.max(MIN_SIGNED_URL_TTL_SECONDS, Math.min(Math.round(seconds), MAX_SIGNED_URL_TTL_SECONDS));
}

// Server-only. Anything other than an explicit "r2" keeps Supabase as the write provider.
export function readAttachmentStorageConfig(env = process.env) {
  const writeProvider = String(env.ATTACHMENT_WRITE_PROVIDER || "").trim().toLowerCase() === STORAGE_PROVIDERS.r2
    ? STORAGE_PROVIDERS.r2
    : STORAGE_PROVIDERS.supabase;
  return {
    writeProvider,
    dualWrite: writeProvider === STORAGE_PROVIDERS.r2 && isOn(env.ATTACHMENT_DUAL_WRITE),
    forceSupabaseReads: isOn(env.ATTACHMENT_FORCE_SUPABASE_READS),
    signedUrlTtlSeconds: clampSignedUrlTtl(env.ATTACHMENT_SIGNED_URL_TTL_SECONDS),
  };
}

export function resolveStorageProvider(name = DEFAULT_STORAGE_PROVIDER) {
  const provider = PROVIDERS[String(name || "").trim().toLowerCase()];
  if (!provider) throw new Error(`Attachment storage provider "${name}" is not available.`);
  return provider;
}

// Rollback switch: only valid for objects that also exist in Supabase (historical or dual-written).
function readProviderFor(provider, config) {
  return config.forceSupabaseReads ? STORAGE_PROVIDERS.supabase : (provider || DEFAULT_STORAGE_PROVIDER);
}

async function toBuffer(body) {
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  if (body && typeof body.arrayBuffer === "function") return Buffer.from(await body.arrayBuffer());
  throw new Error("Attachment body must be a Blob, ArrayBuffer, or typed array.");
}

async function prepareBody(body) {
  const buffer = await toBuffer(body);
  return {
    buffer,
    size: buffer.byteLength,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    md5: createHash("md5").update(buffer).digest("hex"),
  };
}

function describeError(error) {
  return { message: String(error?.message || error || "unknown error"), status: error?.statusCode ?? error?.status ?? null };
}

async function putPrepared(admin, provider, { key, prepared, contentType, metadata }) {
  const stored = await resolveStorageProvider(provider).putObject(admin, {
    key,
    body: prepared.buffer,
    contentType,
    upsert: false,
    metadata: { ...metadata, sha256: prepared.sha256 },
  });
  return {
    provider,
    key: stored.key,
    contentType: contentType || null,
    size: prepared.size,
    sha256: prepared.sha256,
    md5: prepared.md5,
  };
}

export async function putObject(admin, { key, body, contentType, provider = DEFAULT_STORAGE_PROVIDER, metadata = {} }) {
  return putPrepared(admin, provider, { key, prepared: await prepareBody(body), contentType, metadata });
}

/**
 * Writes the primary copy per configuration and reports exactly where it landed.
 * - supabase mode: Supabase only.
 * - r2 mode: R2 primary; on R2 failure fall back to Supabase (primary.provider = "supabase").
 * - r2 + dual write: after R2 succeeds, a best-effort Supabase safety copy at the same key.
 * Throws only when no provider stored the object.
 */
export async function writeAttachmentObject(admin, {
  key,
  body,
  contentType,
  metadata = {},
  config = readAttachmentStorageConfig(),
}) {
  const prepared = await prepareBody(body);
  const write = (provider) => putPrepared(admin, provider, { key, prepared, contentType, metadata });

  if (config.writeProvider !== STORAGE_PROVIDERS.r2) {
    return { primary: await write(STORAGE_PROVIDERS.supabase), secondary: null, fallbackError: null };
  }

  let primary;
  try {
    primary = await write(STORAGE_PROVIDERS.r2);
  } catch (r2Error) {
    console.error("Attachment R2 write failed; falling back to Supabase.", { key, category: metadata.category, ...describeError(r2Error) });
    try {
      primary = await write(STORAGE_PROVIDERS.supabase);
    } catch (supabaseError) {
      console.error("Attachment Supabase fallback write failed.", { key, category: metadata.category, ...describeError(supabaseError) });
      throw Object.assign(new Error("Unable to store the attachment. Please try again."), {
        cause: supabaseError,
        r2Error,
      });
    }
    return { primary, secondary: null, fallbackError: describeError(r2Error) };
  }

  let secondary = null;
  if (config.dualWrite) {
    try {
      secondary = { ...(await write(STORAGE_PROVIDERS.supabase)), ok: true };
    } catch (copyError) {
      console.error("Attachment Supabase safety copy failed; R2 copy kept.", { key, category: metadata.category, ...describeError(copyError) });
      secondary = { provider: STORAGE_PROVIDERS.supabase, key, ok: false, error: describeError(copyError) };
    }
  }
  return { primary, secondary, fallbackError: null };
}

export async function getObject(admin, { key, provider = DEFAULT_STORAGE_PROVIDER, config = readAttachmentStorageConfig() }) {
  return resolveStorageProvider(readProviderFor(provider, config)).getObject(admin, { key });
}

export async function headObject(admin, { key, provider = DEFAULT_STORAGE_PROVIDER }) {
  return resolveStorageProvider(provider).headObject(admin, { key });
}

export async function getSignedReadUrl(admin, {
  key,
  provider = DEFAULT_STORAGE_PROVIDER,
  expiresIn,
  downloadName = "",
  config = readAttachmentStorageConfig(),
}) {
  const ttl = clampSignedUrlTtl(expiresIn ?? config.signedUrlTtlSeconds);
  const url = await resolveStorageProvider(readProviderFor(provider, config)).getSignedReadUrl(admin, {
    key,
    expiresIn: ttl,
    downloadName,
  });
  return { url, expiresAt: new Date(Date.now() + ttl * 1000).toISOString(), expiresIn: ttl };
}

export async function ensureAttachmentBucket(admin, bucket, provider = DEFAULT_STORAGE_PROVIDER) {
  return resolveStorageProvider(provider).ensureBucket(admin, bucket);
}

export async function deleteObject() {
  throw new Error("Attachment deletion is not enabled.");
}
