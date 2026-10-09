import { createClient } from "@supabase/supabase-js";
import {
  authorizeAttachmentRead,
  defaultAccessDeps,
  resolveAttachmentTarget,
} from "../../../../lib/storage/attachmentAccess.js";
import { getSignedReadUrl } from "../../../../lib/storage/attachmentStorage.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function result(status, body) {
  return { status, body };
}

export async function handleAttachmentUrlRequest({
  admin,
  token,
  id,
  searchParams,
  deps = defaultAccessDeps,
  signUrl = getSignedReadUrl,
}) {
  if (!token) return result(401, { success: false, error: "Not authenticated" });

  const { data, error } = await admin.auth.getUser(token);
  const user = data?.user;
  if (error || !user) return result(401, { success: false, error: "Invalid login session" });

  const target = await resolveAttachmentTarget(admin, {
    id,
    legacyKind: searchParams?.get("kind") || "",
    legacyRef: searchParams?.get("ref") || "",
  });
  if (target.status === 400) return result(400, { success: false, error: "Invalid attachment reference." });
  if (target.status !== 200) return result(404, { success: false, error: "Attachment not found." });

  const access = await authorizeAttachmentRead(admin, { user, token, target, deps });
  if (!access.allowed) return result(403, { success: false, error: access.reason || "Access denied." });

  const download = searchParams?.get("download") === "1";
  const signed = await signUrl(admin, {
    provider: target.object.provider,
    key: target.object.key,
    downloadName: download ? target.fileName : "",
  });

  return result(200, {
    success: true,
    url: signed.url,
    expiresAt: signed.expiresAt,
    fileName: target.fileName || "",
    contentType: target.contentType || null,
    category: target.category,
  });
}

export async function GET(request, context) {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    if (!supabaseUrl || !serviceKey) {
      return Response.json({ success: false, error: "Server configuration is incomplete." }, { status: 500, headers });
    }

    const params = await context?.params;
    const authHeader = request.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { status, body } = await handleAttachmentUrlRequest({
      admin,
      token,
      id: params?.id,
      searchParams: new URL(request.url).searchParams,
    });
    return Response.json(body, { status, headers });
  } catch (error) {
    console.error("Unable to create attachment link:", error);
    return Response.json({ success: false, error: "Unable to open attachment." }, { status: 500, headers });
  }
}
