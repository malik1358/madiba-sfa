import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function getAuthUser(request) {
  const authHeader = request.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    throw new Error("No authorization header provided");
  }

  const token = authHeader.slice(7);
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error("Unable to verify user session");
  return user;
}

export async function POST(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return Response.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }

    const user = await getAuthUser(request);
    const body = await request.json().catch(() => ({}));
    const token = String(body?.token || "").trim();
    const platform = String(body?.platform || "android").trim().toLowerCase() || "android";

    if (!token) {
      return Response.json({ success: false, error: "Push token is required." }, { status: 400 });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { error } = await admin
      .from("device_push_tokens")
      .upsert({
        user_id: user.id,
        token,
        platform,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id,token" });

    if (error) throw error;

    return Response.json({ success: true });
  } catch (error) {
    return Response.json(
      { success: false, error: error.message || "Unable to save push token." },
      { status: 400 },
    );
  }
}

export async function DELETE(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return Response.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }

    const user = await getAuthUser(request);
    const body = await request.json().catch(() => ({}));
    const token = String(body?.token || "").trim();

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let query = admin.from("device_push_tokens").delete().eq("user_id", user.id);
    if (token) query = query.eq("token", token);

    const { error } = await query;
    if (error) throw error;

    return Response.json({ success: true });
  } catch (error) {
    return Response.json(
      { success: false, error: error.message || "Unable to remove push token." },
      { status: 400 },
    );
  }
}
