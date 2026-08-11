import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { randomInt } from "crypto";

export const runtime = "nodejs";
export const maxDuration = 60;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const LOCAL_LOGIN_DOMAIN = "@madiba-sfa.local";

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeCredentialToken(value) {
  return normalizeCode(value)
    .replace(/[^A-Z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .replace(/\.{2,}/g, ".");
}

function normalizeLoginName(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return "";

  const localPart = text.includes("@") ? text.split("@")[0] : text;
  return localPart
    .replace(/[^a-z0-9._-]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .replace(/\.{2,}/g, ".");
}

function randomSixDigitPassword() {
  return String(randomInt(100000, 1000000));
}

function normalizeName(value, fallback = "") {
  const text = String(value || "").trim();
  return text || fallback;
}

function buildEmailFromLoginName(loginName, suffix = 0) {
  const safeLocal = normalizeLoginName(loginName) || `salesman${Date.now()}`;
  const localPart = suffix > 0 ? `${safeLocal}${suffix}` : safeLocal;
  return `${localPart}${LOCAL_LOGIN_DOMAIN}`;
}

function displayLoginName(email) {
  const localPart = String(email || "").trim().toLowerCase().split("@")[0];
  return normalizeLoginName(localPart) || localPart;
}

function getStoredPassword(metadata) {
  const password = String(metadata?.generated_password || "").trim();
  return /^\d{6}$/.test(password) ? password : "";
}

function normalizeRole(value) {
  const role = String(value || "").trim().toLowerCase();
  if (role === "invoice-maker" || role === "invoice_maker") return "invoice-maker";
  if (["salesman", "manager", "admin"].includes(role)) return role;
  return "salesman";
}

function isInvoiceMakerRole(role) {
  const normalized = String(role || "").trim().toLowerCase();
  return normalized === "invoice-maker" || normalized === "invoice_maker";
}

async function setGeneratedPassword(admin, userId, metadata = {}) {
  const password = randomSixDigitPassword();
  const { error } = await admin.auth.admin.updateUserById(userId, {
    password,
    user_metadata: {
      ...metadata,
      generated_password: password,
      generated_password_mode: "random6",
    },
  });

  if (error) throw error;
  return password;
}

async function autoCreateExistingSalesmen(admin) {
  const salesmanMap = new Map();
  const pageSize = 1000;

  for (let page = 0; page < 100; page += 1) {
    const from = page * pageSize;
    const to = from + pageSize - 1;

    const { data: rows, error: rowsError } = await admin
      .from("active_sales")
      .select("salesman_code,salesman_name")
      .not("salesman_code", "is", null)
      .range(from, to);

    if (rowsError) {
      throw new Error(rowsError.message || "Unable to read existing salesmen from sales data.");
    }

    const list = rows || [];
    list.forEach((row) => {
      const code = normalizeCode(row.salesman_code);
      if (!code) return;

      const name = normalizeName(row.salesman_name, code);
      if (!salesmanMap.has(code)) {
        salesmanMap.set(code, { code, name });
        return;
      }

      const existing = salesmanMap.get(code);
      if (!existing.name || existing.name === code) {
        salesmanMap.set(code, { code, name });
      }
    });

    if (list.length < pageSize) break;
  }

  const salesmenFromData = Array.from(salesmanMap.values());
  if (salesmenFromData.length === 0) {
    return { created: 0, skipped: 0, failed: 0, details: [], message: "No salesman data found in sales_raw." };
  }

  const codes = salesmenFromData.map((item) => item.code);
  const existingProfiles = [];

  for (let index = 0; index < codes.length; index += 200) {
    const batch = codes.slice(index, index + 200);
    const { data: rows, error: profilesError } = await admin
      .from("profiles")
      .select("salesman_code")
      .in("salesman_code", batch);

    if (profilesError) throw profilesError;
    existingProfiles.push(...(rows || []));
  }

  const existingCodeSet = new Set(existingProfiles.map((row) => normalizeCode(row.salesman_code)).filter(Boolean));

  const usersRes = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (usersRes.error) throw usersRes.error;

  const usedEmails = new Set((usersRes.data?.users || []).map((user) => String(user.email || "").toLowerCase()).filter(Boolean));

  let created = 0;
  let skipped = 0;
  let failed = 0;
  const details = [];

  for (const salesman of salesmenFromData) {
    if (existingCodeSet.has(salesman.code)) {
      skipped += 1;
      continue;
    }

    let createdUser = null;
    let createdEmail = "";
    const password = randomSixDigitPassword();

    for (let suffix = 0; suffix < 20; suffix += 1) {
      const candidateEmail = buildEmailFromLoginName(salesman.code, suffix);
      if (usedEmails.has(candidateEmail)) continue;

      const { data: userData, error: createUserError } = await admin.auth.admin.createUser({
        email: candidateEmail,
        password,
        email_confirm: true,
        user_metadata: {
          head_salesman_code: null,
          head_salesman_name: null,
          generated_password: password,
          generated_password_mode: "random6",
        },
      });

      if (!createUserError && userData?.user?.id) {
        createdUser = userData.user;
        createdEmail = candidateEmail;
        usedEmails.add(candidateEmail);
        break;
      }
    }

    if (!createdUser?.id) {
      failed += 1;
      details.push({ salesman_code: salesman.code, status: "failed", error: "Unable to create auth user" });
      continue;
    }

    const { error: profileInsertError } = await admin.from("profiles").upsert({
      id: createdUser.id,
      role: "salesman",
      salesman_code: salesman.code,
      salesman_name: salesman.name,
    });

    if (profileInsertError) {
      await admin.auth.admin.deleteUser(createdUser.id);
      failed += 1;
      details.push({ salesman_code: salesman.code, status: "failed", error: profileInsertError.message || "Unable to create profile" });
      continue;
    }

    created += 1;
    details.push({
      salesman_code: salesman.code,
      salesman_name: salesman.name,
      email: createdEmail,
      login_name: displayLoginName(createdEmail),
      password,
      status: "created",
    });
  }

  return {
    created,
    skipped,
    failed,
    details,
    message: `Auto-create completed. Created: ${created}, skipped existing: ${skipped}, failed: ${failed}.`,
  };
}

async function requireManagementAccess(admin, request) {
  const authHeader = request.headers.get("authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    return { error: NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 }) };
  }

  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: userError } = await admin.auth.getUser(token);

  if (userError || !user) {
    return { error: NextResponse.json({ success: false, error: "Invalid login session" }, { status: 401 }) };
  }

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profileError || !profile || !["admin", "manager"].includes(String(profile.role || "").toLowerCase())) {
    return { error: NextResponse.json({ success: false, error: "Only management can access salesman hierarchy." }, { status: 403 }) };
  }

  return { user };
}

async function loadSalesmen(admin) {
  const [profilesRes, usersRes] = await Promise.all([
    admin
      .from("profiles")
      .select("id,salesman_code,salesman_name,role")
      .in("role", ["salesman", "manager", "admin", "invoice-maker", "invoice_maker"])
      .order("salesman_name"),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);

  if (profilesRes.error) throw profilesRes.error;
  if (usersRes.error) throw usersRes.error;

  const authUsers = usersRes.data?.users || [];
  const authMap = new Map(authUsers.map((user) => [user.id, user]));

  return (profilesRes.data || []).map((profile) => {
    const authUser = authMap.get(profile.id);
    const metadata = authUser?.user_metadata || authUser?.app_metadata || {};

    return {
      id: profile.id,
      salesman_code: profile.salesman_code || "",
      salesman_name: profile.salesman_name || "",
      role: profile.role || "",
      email: authUser?.email || "",
      login_name: displayLoginName(authUser?.email || ""),
      head_salesman_code: metadata.head_salesman_code || "",
      head_salesman_name: metadata.head_salesman_name || "",
      default_password: getStoredPassword(metadata),
    };
  });
}

async function syncGeneratedSalesmanPasswords(admin) {
  const [profilesRes, usersRes] = await Promise.all([
    admin
      .from("profiles")
      .select("id,salesman_code,role")
      .in("role", ["salesman", "invoice-maker", "invoice_maker"]),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);

  if (profilesRes.error) throw profilesRes.error;
  if (usersRes.error) throw usersRes.error;

  const authMap = new Map((usersRes.data?.users || []).map((user) => [user.id, user]));

  for (const profile of profilesRes.data || []) {
    const authUser = authMap.get(profile.id);
    const metadata = authUser?.user_metadata || authUser?.app_metadata || {};
    if (getStoredPassword(metadata)) {
      continue;
    }

    const password = await setGeneratedPassword(admin, profile.id, metadata);

    if (!password) {
      throw new Error(`Unable to generate password for ${profile.salesman_code || profile.id}.`);
    }
  }
}

export async function GET(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const access = await requireManagementAccess(admin, request);
    if (access.error) return access.error;

    const autoCreateSummary = await autoCreateExistingSalesmen(admin);
    await syncGeneratedSalesmanPasswords(admin);

    const salesmen = await loadSalesmen(admin);

    return NextResponse.json({
      success: true,
      salesmen,
      autoCreateSummary,
      headOptions: salesmen
        .filter((salesman) => !isInvoiceMakerRole(salesman.role))
        .map((salesman) => ({
          id: salesman.id,
          salesman_code: salesman.salesman_code,
          salesman_name: salesman.salesman_name,
        })),
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message || "Unable to load salesman hierarchy." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ success: false, error: "Server configuration is incomplete." }, { status: 500 });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const access = await requireManagementAccess(admin, request);
    if (access.error) return access.error;

    const body = await request.json();
    const mode = String(body?.mode || "").trim();

    if (mode === "auto-create-existing-salesmen") {
      const summary = await autoCreateExistingSalesmen(admin);
      return NextResponse.json({ success: true, ...summary });
    }

    if (mode === "create-salesman") {
      const inputLogin = String(body?.email || body?.loginName || "").trim().toLowerCase();
      const selectedRole = normalizeRole(body?.role || "salesman");
      const salesmanCode = normalizeCode(body?.salesmanCode || "");
      const salesmanName = String(body?.salesmanName || "").trim();
      const headSalesmanCode = normalizeCode(body?.headSalesmanCode || "");
      const loginName = normalizeLoginName(inputLogin);
      const email = inputLogin.includes("@") ? inputLogin : buildEmailFromLoginName(loginName);

      if (!loginName || !salesmanCode || !salesmanName) {
        return NextResponse.json({ success: false, error: "Username, salesman code, and salesman name are required." }, { status: 400 });
      }

      const { data: existingCode, error: existingCodeError } = await admin
        .from("profiles")
        .select("id")
        .eq("salesman_code", salesmanCode)
        .maybeSingle();

      if (existingCodeError) throw existingCodeError;
      if (existingCode) {
        return NextResponse.json({ success: false, error: `Salesman code ${salesmanCode} already exists.` }, { status: 409 });
      }

      let headSalesmanName = "";
      if (headSalesmanCode && !isInvoiceMakerRole(selectedRole)) {
        const { data: headSalesman, error: headError } = await admin
          .from("profiles")
          .select("salesman_name,salesman_code")
          .eq("salesman_code", headSalesmanCode)
          .maybeSingle();

        if (headError) throw headError;
        if (!headSalesman) {
          return NextResponse.json({ success: false, error: "Head salesman not found." }, { status: 404 });
        }

        headSalesmanName = headSalesman.salesman_name || "";
      }

      const password = randomSixDigitPassword();
      const { data: createdUser, error: createUserError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          head_salesman_code: isInvoiceMakerRole(selectedRole) ? null : (headSalesmanCode || null),
          head_salesman_name: isInvoiceMakerRole(selectedRole) ? null : (headSalesmanName || null),
          generated_password: password,
          generated_password_mode: "random6",
        },
      });

      if (createUserError) {
        return NextResponse.json({ success: false, error: createUserError.message || "Unable to create salesman login." }, { status: 409 });
      }

      const userId = createdUser?.user?.id;
      if (!userId) {
        return NextResponse.json({ success: false, error: "Created user id is missing." }, { status: 500 });
      }

      const { error: profileInsertError } = await admin.from("profiles").upsert({
        id: userId,
        role: selectedRole,
        salesman_code: salesmanCode,
        salesman_name: salesmanName,
      });

      if (profileInsertError) {
        await admin.auth.admin.deleteUser(userId);
        throw profileInsertError;
      }

      return NextResponse.json({
        success: true,
        message: `${isInvoiceMakerRole(selectedRole) ? "Invoice maker" : "Salesman"} ${salesmanName} created successfully.`,
        created: {
          id: userId,
          email,
          login_name: loginName,
          salesman_code: salesmanCode,
          salesman_name: salesmanName,
          role: selectedRole,
          password,
        },
      });
    }

    if (mode === "assign-head") {
      const salesmanId = String(body?.salesmanId || "").trim();
      const headSalesmanCode = normalizeCode(body?.headSalesmanCode || "");

      if (!salesmanId) {
        return NextResponse.json({ success: false, error: "Missing salesman id." }, { status: 400 });
      }

      const { data: salesmen, error: salesmenError } = await admin
        .from("profiles")
        .select("id,salesman_code,salesman_name")
        .eq("id", salesmanId)
        .single();

      if (salesmenError) throw salesmenError;

      let headSalesmanName = "";
      if (headSalesmanCode) {
        const { data: headSalesman, error: headError } = await admin
          .from("profiles")
          .select("salesman_name,salesman_code")
          .eq("salesman_code", headSalesmanCode)
          .maybeSingle();

        if (headError) throw headError;
        if (!headSalesman) {
          return NextResponse.json({ success: false, error: "Head salesman not found." }, { status: 404 });
        }

        headSalesmanName = headSalesman.salesman_name || "";
      }

      const { error: updateError } = await admin.auth.admin.updateUserById(salesmen.id, {
        user_metadata: {
          head_salesman_code: headSalesmanCode || null,
          head_salesman_name: headSalesmanName || null,
        },
      });

      if (updateError) throw updateError;

      return NextResponse.json({
        success: true,
        message: `Assigned ${salesmen.salesman_name || salesmen.salesman_code || salesmanId} to ${headSalesmanCode || "no head"}.`,
      });
    }

    if (mode === "reset-password") {
      const salesmanId = String(body?.salesmanId || "").trim();

      if (!salesmanId) {
        return NextResponse.json({ success: false, error: "Missing salesman id." }, { status: 400 });
      }

      const { data: salesmen, error: salesmenError } = await admin
        .from("profiles")
        .select("id,salesman_code,salesman_name")
        .eq("id", salesmanId)
        .single();

      if (salesmenError) throw salesmenError;

      const currentSalesmen = await loadSalesmen(admin);
      const currentSalesman = currentSalesmen.find((item) => item.id === salesmen.id);

      const password = await setGeneratedPassword(admin, salesmen.id, {
        head_salesman_code: currentSalesman?.head_salesman_code || null,
        head_salesman_name: currentSalesman?.head_salesman_name || null,
      });

      return NextResponse.json({
        success: true,
        message: `Password reset for ${salesmen.salesman_name || salesmen.salesman_code || salesmanId}.`,
        password,
      });
    }

    if (mode === "reset-all-passwords") {
      const salesmen = await loadSalesmen(admin);

      const results = [];
      for (const salesman of salesmen) {
        try {
          const password = await setGeneratedPassword(admin, salesman.id, {
            head_salesman_code: salesman.head_salesman_code || null,
            head_salesman_name: salesman.head_salesman_name || null,
          });

          results.push({ salesmanId: salesman.id, success: true, password });
        } catch (error) {
          results.push({ salesmanId: salesman.id, success: false, error: error.message });
        }
      }

      return NextResponse.json({
        success: true,
        message: "Default passwords reset for all salesmen.",
        results,
      });
    }

    return NextResponse.json({ success: false, error: "Unsupported action." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message || "Unable to update salesman hierarchy." }, { status: 500 });
  }
}