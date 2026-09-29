#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  findRepeatedAttendanceLocations,
  HOME_LOCATION_CANDIDATE_MIN_DAYS,
  isAtHomeLocation,
} from "../app/lib/homeLocation.js";
import { assertSupabaseUrlAllowed } from "../app/lib/supabaseGuard.js";

const OSAMA_HOME = { latitude: 24.63063, longitude: 46.69947 };
const CUSTOMER_MATCH_RADIUS_METERS = 25;

function loadEnvLocal() {
  const envPath = join(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;

  readFileSync(envPath, "utf8").split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) return;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  });
}

function isMissingColumn(error) {
  return error?.code === "42703"
    || String(error?.message || "").toLowerCase().includes("column")
      && String(error?.message || "").toLowerCase().includes("does not exist");
}

async function readAll(query, pageSize = 1000) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await query.range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return rows;
  }
}

async function loadProfiles(admin) {
  let result = await admin.from("profiles")
    .select("id,salesman_code,salesman_name,role,home_latitude,home_longitude")
    .order("salesman_name");
  if (result.error && isMissingColumn(result.error)) {
    result = await admin.from("profiles")
      .select("id,salesman_code,salesman_name,role")
      .order("salesman_name");
  }
  if (result.error) throw result.error;
  return result.data || [];
}

async function loadAttendanceLogs(admin) {
  const query = admin.from("daily_activity_logs")
    .select("user_id,entry_type,note,created_at")
    .in("entry_type", ["MORNING_ATTENDANCE", "END_OF_DAY"])
    .order("created_at", { ascending: true });
  return readAll(query);
}

async function loadCustomersAtPoint(admin, point) {
  const latitudeDelta = CUSTOMER_MATCH_RADIUS_METERS / 110000;
  const longitudeDelta = latitudeDelta / Math.max(0.01, Math.cos((point.latitude * Math.PI) / 180));
  const query = admin.from("customers")
    .select("customer_code,customer_name,latitude,longitude")
    .gte("latitude", point.latitude - latitudeDelta)
    .lte("latitude", point.latitude + latitudeDelta)
    .gte("longitude", point.longitude - longitudeDelta)
    .lte("longitude", point.longitude + longitudeDelta);
  const nearby = await readAll(query, 500);
  return nearby.filter((customer) => isAtHomeLocation(customer, point, CUSTOMER_MATCH_RADIUS_METERS));
}

async function main() {
  loadEnvLocal();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local.");
  }
  assertSupabaseUrlAllowed(supabaseUrl);

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const [profiles, logs, customers] = await Promise.all([
    loadProfiles(admin),
    loadAttendanceLogs(admin),
    loadCustomersAtPoint(admin, OSAMA_HOME),
  ]);
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const candidates = findRepeatedAttendanceLocations(logs).map((candidate) => {
    const profile = profileById.get(candidate.userId) || {};
    return {
      salesman: profile.salesman_name || "Unknown profile",
      salesmanCode: profile.salesman_code || "",
      role: profile.role || "",
      ...candidate,
    };
  });
  const coordinateRows = logs.filter((row) => row.note && /"location"\s*:/.test(String(row.note))).length;

  console.log(JSON.stringify({
    readOnly: true,
    historyEntryCount: logs.length,
    entriesWithLocationNotes: coordinateRows,
    candidateRule: `Same 500 m cluster on at least ${HOME_LOCATION_CANDIDATE_MIN_DAYS} distinct KSA dates; no profile changes are made.`,
    repeatedAttendanceCandidates: candidates,
    osamaHome: OSAMA_HOME,
    profilesMatchingOsamaName: profiles
      .filter((profile) => /osama/i.test(`${profile.salesman_name || ""} ${profile.salesman_code || ""}`))
      .map(({ id, salesman_name, salesman_code, home_latitude, home_longitude }) => ({
        id,
        salesman_name,
        salesman_code,
        currentHome: home_latitude == null || home_longitude == null
          ? null
          : { latitude: home_latitude, longitude: home_longitude },
      })),
    customerPinsWithin25mOfOsamaHome: customers,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
