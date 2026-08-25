#!/usr/bin/env node
/**
 * One-time customer GPS import from Excel or CSV.
 *
 * Usage:
 *   npm.cmd run import:customer-locations -- "C:\path\customer master gps location.xlsx"
 *   npm.cmd run import:customer-locations -- data/customer-locations-missing-20260825.csv --missing-only
 *
 * Requires .env.local with NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 */

import { readFileSync, existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import XLSX from "xlsx";
import {
  applyCustomerLocationUpdates,
  parseLocationSpreadsheetRow,
  planCustomerLocationUpdates,
} from "../app/lib/customerLocationImport.js";

function parseCsvRows(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return [];

  const headers = lines[0].split(",").map((value) => value.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(",");
    return headers.reduce((row, header, index) => {
      row[header] = String(values[index] || "").trim();
      return row;
    }, {});
  });
}

function loadLocationRows(inputPath) {
  const extension = extname(inputPath).toLowerCase();
  if (extension === ".csv") {
    return parseCsvRows(readFileSync(inputPath, "utf8"));
  }

  const workbook = XLSX.readFile(inputPath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: "" });
}

function loadEnvLocal() {
  const envPath = join(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;

  readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .forEach((line) => {
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

async function fetchAllCustomers(admin) {
  const pageSize = 1000;
  let from = 0;
  const rows = [];

  while (true) {
    const { data, error } = await admin
      .from("customers")
      .select("customer_code,customer_name,latitude,longitude")
      .range(from, from + pageSize - 1);

    if (error) throw error;
    if (!Array.isArray(data) || data.length === 0) break;

    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }

  return rows;
}

async function main() {
  loadEnvLocal();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  }

  const inputPath = resolve(
    process.argv.find((arg) => !arg.startsWith("--") && arg.endsWith(".xlsx"))
    || process.argv.find((arg) => !arg.startsWith("--") && arg.endsWith(".csv"))
    || process.argv[2]
    || join(process.env.USERPROFILE || "", "OneDrive", "Documents", "customer master gps location.xlsx"),
  );
  if (!existsSync(inputPath)) {
    throw new Error(`Location file not found: ${inputPath}`);
  }

  const missingOnly = process.argv.includes("--missing-only");
  const rawRows = loadLocationRows(inputPath);
  const parsedRows = rawRows.map(parseLocationSpreadsheetRow);

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const customers = await fetchAllCustomers(admin);
  const plan = planCustomerLocationUpdates(parsedRows, customers, { onlyMissing: missingOnly });

  console.log(`Source rows: ${rawRows.length}`);
  console.log(`Matched updates: ${plan.updates.length}`);
  console.log(`Skipped (invalid/zero GPS): ${plan.skipped.length}`);
  console.log(`Already had GPS: ${plan.alreadySet.length}`);
  console.log(`Not found in customers table: ${plan.notFound.length}`);

  if (plan.updates.length === 0) {
    console.log("Nothing to update.");
    if (plan.notFound.length > 0) {
      console.log("First unmatched rows:");
      plan.notFound.slice(0, 10).forEach((row) => console.log(`  - ${row.party_name}`));
    }
    return;
  }

  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) {
    console.log("Dry run only. Sample updates:");
    plan.updates.slice(0, 5).forEach((row) => {
      console.log(`  ${row.customer_code} -> ${row.latitude}, ${row.longitude}`);
    });
    return;
  }

  const result = await applyCustomerLocationUpdates(admin, plan.updates);
  console.log(`Updated: ${result.updated}`);
  if (result.failures.length > 0) {
    console.log(`Failures: ${result.failures.length}`);
    result.failures.slice(0, 10).forEach((row) => console.log(`  ${row.customer_code}: ${row.error}`));
  }

  if (plan.notFound.length > 0) {
    console.log("Unmatched party names (first 15):");
    plan.notFound.slice(0, 15).forEach((row) => console.log(`  - ${row.party_name}`));
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
