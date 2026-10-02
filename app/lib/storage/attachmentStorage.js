import { createHash } from "node:crypto";
import * as supabaseProvider from "./providers/supabaseProvider.js";

export const ACTIVE_STORAGE_PROVIDER = supabaseProvider.SUPABASE_PROVIDER;
export const SIGNED_URL_TTL_SECONDS = 300;

const PROVIDERS = {
  [supabaseProvider.SUPABASE_PROVIDER]: supabaseProvider,
};

export function resolveStorageProvider(name = ACTIVE_STORAGE_PROVIDER) {
  const provider = PROVIDERS[String(name || "").trim().toLowerCase()];
  if (!provider) throw new Error(`Attachment storage provider "${name}" is not available.`);
  return provider;
}

async function toBuffer(body) {
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  if (body && typeof body.arrayBuffer === "function") return Buffer.from(await body.arrayBuffer());
  throw new Error("Attachment body must be a Blob, ArrayBuffer, or typed array.");
}

// Server-only: business modules call this instead of a storage SDK.
export async function putObject(admin, { key, body, contentType, provider = ACTIVE_STORAGE_PROVIDER }) {
  const buffer = await toBuffer(body);
  const stored = await resolveStorageProvider(provider).putObject(admin, {
    key,
    body: buffer,
    contentType,
    upsert: false,
  });
  return {
    provider,
    key: stored.key,
    contentType: contentType || null,
    size: buffer.byteLength,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    md5: createHash("md5").update(buffer).digest("hex"),
  };
}

export async function getObject(admin, { key, provider = ACTIVE_STORAGE_PROVIDER }) {
  return resolveStorageProvider(provider).getObject(admin, { key });
}

export async function headObject(admin, { key, provider = ACTIVE_STORAGE_PROVIDER }) {
  return resolveStorageProvider(provider).headObject(admin, { key });
}

export async function getSignedReadUrl(admin, {
  key,
  provider = ACTIVE_STORAGE_PROVIDER,
  expiresIn = SIGNED_URL_TTL_SECONDS,
  downloadName = "",
}) {
  const ttl = Math.max(30, Math.min(Number(expiresIn) || SIGNED_URL_TTL_SECONDS, 900));
  const url = await resolveStorageProvider(provider).getSignedReadUrl(admin, { key, expiresIn: ttl, downloadName });
  return { url, expiresAt: new Date(Date.now() + ttl * 1000).toISOString(), expiresIn: ttl };
}

export async function deleteObject() {
  throw new Error("Attachment deletion is not enabled.");
}
