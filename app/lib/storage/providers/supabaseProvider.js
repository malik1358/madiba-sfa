import { joinObjectKey, splitObjectKey } from "../attachmentKeys.js";

export const SUPABASE_PROVIDER = "supabase";

function storageError(error, fallback) {
  if (error instanceof Error) return error;
  return Object.assign(new Error(String(error?.message || fallback)), {
    statusCode: error?.statusCode ?? error?.status,
  });
}

function isNotFoundError(error) {
  const status = Number(error?.statusCode ?? error?.status ?? error?.originalError?.status);
  return status === 404 || status === 400 || /not.?found|does not exist/i.test(String(error?.message || ""));
}

export async function putObject(admin, { key, body, contentType, upsert = false }) {
  const { bucket, path } = splitObjectKey(key);
  const { data, error } = await admin.storage.from(bucket).upload(path, body, {
    contentType: contentType || undefined,
    upsert,
  });
  if (error) throw storageError(error, "Unable to store attachment.");
  return { key: joinObjectKey(bucket, data?.path || path) };
}

export async function getObject(admin, { key }) {
  const { bucket, path } = splitObjectKey(key);
  const { data, error } = await admin.storage.from(bucket).download(path);
  if (error || !data) throw storageError(error, "Attachment file is not available.");
  return data.arrayBuffer();
}

export async function headObject(admin, { key }) {
  const { bucket, path } = splitObjectKey(key);
  const { data, error } = await admin.storage.from(bucket).info(path);
  if (error) {
    if (isNotFoundError(error)) return { exists: false };
    throw storageError(error, "Unable to inspect attachment.");
  }
  const size = Number(data?.size ?? data?.metadata?.size);
  return {
    exists: true,
    size: Number.isFinite(size) ? size : null,
    contentType: data?.contentType || data?.metadata?.mimetype || null,
  };
}

export async function getSignedReadUrl(admin, { key, expiresIn, downloadName }) {
  const { bucket, path } = splitObjectKey(key);
  const options = downloadName ? { download: downloadName } : undefined;
  const { data, error } = await admin.storage.from(bucket).createSignedUrl(path, expiresIn, options);
  if (error || !data?.signedUrl) throw storageError(error, "Unable to create attachment link.");
  return data.signedUrl;
}
