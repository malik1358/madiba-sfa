import { AwsClient } from "aws4fetch";
import { readR2Config } from "../r2Guard.js";

export const R2_PROVIDER = "r2";

const R2_RETRIES = 2;
const METADATA_KEYS = ["sha256", "category", "entity-type"];

let cached = null;

// Rebuilt when env changes (tests, rotated keys); credentials never leave this module.
function r2Context(env = process.env) {
  const config = readR2Config(env);
  const signature = `${config.accountId}|${config.accessKeyId}|${config.secretAccessKey}|${config.bucket}|${config.endpoint}`;
  if (!cached || cached.signature !== signature) {
    cached = {
      signature,
      config,
      client: new AwsClient({
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        service: "s3",
        region: "auto",
        retries: R2_RETRIES,
      }),
    };
  }
  return cached;
}

function encodeKey(key) {
  const text = String(key || "").trim().replace(/^\/+/, "");
  if (!text || text.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("Invalid attachment object key.");
  }
  return text.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

function objectUrl(config, key) {
  return `${config.endpoint}/${encodeURIComponent(config.bucket)}/${encodeKey(key)}`;
}

function r2Error(action, response) {
  return Object.assign(new Error(`R2 ${action} failed (${response.status}).`), { statusCode: response.status });
}

function metadataHeaders(metadata = {}) {
  const headers = {};
  for (const name of METADATA_KEYS) {
    const value = String(metadata?.[name] ?? "").trim();
    // R2 metadata must be ASCII; only opaque technical values are allowed here.
    if (value && /^[A-Za-z0-9._:-]{1,128}$/.test(value)) headers[`x-amz-meta-${name}`] = value;
  }
  return headers;
}

export async function ensureBucket() {
  r2Context();
}

export async function putObject(_admin, { key, body, contentType, metadata = {}, env }) {
  const { client, config } = r2Context(env);
  const sha256 = String(metadata?.sha256 || "").toLowerCase();
  const response = await client.fetch(objectUrl(config, key), {
    method: "PUT",
    body,
    headers: {
      "content-type": contentType || "application/octet-stream",
      "if-none-match": "*",
      // R2 rejects the upload if the bytes do not match this hash.
      ...(/^[a-f0-9]{64}$/.test(sha256) ? { "x-amz-content-sha256": sha256 } : {}),
      ...metadataHeaders(metadata),
    },
  });
  if (response.status === 412) {
    throw Object.assign(new Error("The resource already exists"), { statusCode: 412 });
  }
  if (!response.ok) throw r2Error("upload", response);
  return { key: String(key).replace(/^\/+/, ""), etag: response.headers.get("etag") || null };
}

export async function getObject(_admin, { key, env }) {
  const { client, config } = r2Context(env);
  const response = await client.fetch(objectUrl(config, key), { method: "GET" });
  if (!response.ok) throw r2Error("download", response);
  return response.arrayBuffer();
}

export async function headObject(_admin, { key, env }) {
  const { client, config } = r2Context(env);
  const response = await client.fetch(objectUrl(config, key), { method: "HEAD" });
  if (response.status === 404) return { exists: false };
  if (!response.ok) throw r2Error("head", response);
  const size = Number(response.headers.get("content-length"));
  return {
    exists: true,
    size: Number.isFinite(size) ? size : null,
    contentType: response.headers.get("content-type") || null,
    etag: response.headers.get("etag") || null,
    sha256: response.headers.get("x-amz-meta-sha256") || null,
  };
}

export async function getSignedReadUrl(_admin, { key, expiresIn, downloadName, env }) {
  const { client, config } = r2Context(env);
  const url = new URL(objectUrl(config, key));
  url.searchParams.set("X-Amz-Expires", String(expiresIn));
  if (downloadName) {
    const safeName = String(downloadName).replace(/["\\\r\n]/g, "_");
    url.searchParams.set("response-content-disposition", `attachment; filename="${safeName}"`);
  }
  const signed = await client.sign(new Request(url.toString(), { method: "GET" }), { aws: { signQuery: true } });
  return signed.url;
}
