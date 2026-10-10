import { createClient } from "@supabase/supabase-js";
import {
  classifyCustomerGpsWriteBlock,
  loadSavedHomeLocations,
  reportOnlyMessageForBlock,
} from "../../../lib/customerGpsWriteGuard.js";
import { isAtMadibaStore } from "../../../lib/madibaStoreLocation.js";

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

export async function GET(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return Response.json({ success: false, error: "Server configuration is incomplete" }, { status: 500 });
    }

    await getAuthUser(request);
    const url = new URL(request.url);
    const latitude = Number(url.searchParams.get("latitude"));
    const longitude = Number(url.searchParams.get("longitude"));
    const language = String(url.searchParams.get("language") || "en").trim().toLowerCase() === "ar"
      ? "ar"
      : "en";

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new Error("Latitude and longitude are required");
    }

    const location = { latitude, longitude };
    // Store check does not need DB; still load homes for the shared classifier.
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const homeLocations = isAtMadibaStore(location)
      ? []
      : await loadSavedHomeLocations(admin);
    const block = classifyCustomerGpsWriteBlock(location, homeLocations);

    return Response.json({
      success: true,
      blocked: Boolean(block),
      reason: block?.reason || null,
      message: reportOnlyMessageForBlock(block, language),
    });
  } catch (error) {
    return Response.json(
      { success: false, error: error.message || "Unable to check location write rules" },
      { status: 400 },
    );
  }
}
