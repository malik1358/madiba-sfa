import { canonicalCustomerCode, normalizeCustomerNameKey, parsePartyName } from "./customerCode.js";

const LOCATION_COLUMN_ALIASES = {
  partyName: ["party name", "party_name", "customer", "customer name"],
  latitude: ["latitude", "lattitude", "lat"],
  longitude: ["longitude", "longitutde", "longititude", "lng", "lon"],
};

function normalizeHeader(value) {
  return String(value || "").trim().toLowerCase();
}

function pickValue(row, aliases) {
  const entries = Object.entries(row || {});
  for (const [key, value] of entries) {
    const header = normalizeHeader(key);
    if (aliases.some((alias) => header === alias)) {
      return value;
    }
  }
  return "";
}

function toCoordinate(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

export function isValidCustomerCoordinate(value) {
  const number = Number(value);
  return Number.isFinite(number) && number !== 0;
}

export function isValidLatitude(value) {
  return isValidCustomerCoordinate(value) && value >= -90 && value <= 90;
}

export function isValidLongitude(value) {
  return isValidCustomerCoordinate(value) && value >= -180 && value <= 180;
}

export function parseLocationSpreadsheetRow(row) {
  const partyName = String(pickValue(row, LOCATION_COLUMN_ALIASES.partyName) || "").trim();
  const latitude = toCoordinate(pickValue(row, LOCATION_COLUMN_ALIASES.latitude));
  const longitude = toCoordinate(pickValue(row, LOCATION_COLUMN_ALIASES.longitude));
  const parsedParty = parsePartyName(partyName);

  return {
    party_name: partyName,
    customer_code: parsedParty.customer_code,
    customer_name: parsedParty.customer_name,
    latitude,
    longitude,
  };
}

export function dedupeLocationRows(rows) {
  const byKey = new Map();

  (rows || []).forEach((row, index) => {
    const code = canonicalCustomerCode(row.customer_code || row.party_name);
    const nameKey = normalizeCustomerNameKey(row.customer_name || row.party_name);
    const key = code || `name:${nameKey}` || `row:${index}`;

    const existing = byKey.get(key);
    const nextValid = isValidLatitude(row.latitude) && isValidLongitude(row.longitude);

    if (!existing) {
      byKey.set(key, row);
      return;
    }

    const existingValid = isValidLatitude(existing.latitude) && isValidLongitude(existing.longitude);
    if (nextValid || !existingValid) {
      byKey.set(key, row);
    }
  });

  return [...byKey.values()];
}

export function buildCustomerLookup(customers) {
  const byCode = new Map();
  const byName = new Map();

  (customers || []).forEach((customer) => {
    const code = canonicalCustomerCode(customer.customer_code);
    if (code && !byCode.has(code)) {
      byCode.set(code, customer);
    }

    const nameKey = normalizeCustomerNameKey(customer.customer_name);
    if (nameKey && !byName.has(nameKey)) {
      byName.set(nameKey, customer);
    }
  });

  return { byCode, byName };
}

export function resolveCustomerForLocationRow(row, lookup) {
  const code = canonicalCustomerCode(row.customer_code || row.party_name);
  if (code && lookup.byCode.has(code)) {
    return lookup.byCode.get(code);
  }

  const nameKey = normalizeCustomerNameKey(row.customer_name || row.party_name);
  if (nameKey && lookup.byName.has(nameKey)) {
    return lookup.byName.get(nameKey);
  }

  return null;
}

export function planCustomerLocationUpdates(rows, customers) {
  const lookup = buildCustomerLookup(customers);
  const dedupedRows = dedupeLocationRows(rows);

  const updates = [];
  const skipped = [];
  const notFound = [];

  dedupedRows.forEach((row) => {
    if (!isValidLatitude(row.latitude) || !isValidLongitude(row.longitude)) {
      skipped.push({ ...row, reason: "invalid_or_zero_coordinates" });
      return;
    }

    const customer = resolveCustomerForLocationRow(row, lookup);
    if (!customer) {
      notFound.push(row);
      return;
    }

    updates.push({
      customer_code: customer.customer_code,
      customer_name: customer.customer_name,
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      source_party_name: row.party_name || "",
    });
  });

  return { updates, skipped, notFound };
}

export async function applyCustomerLocationUpdates(admin, updates, chunkSize = 100) {
  let updated = 0;
  const failures = [];

  for (let index = 0; index < updates.length; index += chunkSize) {
    const chunk = updates.slice(index, index + chunkSize);
    const results = await Promise.all(chunk.map(async (row) => {
      const { error } = await admin
        .from("customers")
        .update({
          latitude: row.latitude,
          longitude: row.longitude,
          updated_at: new Date().toISOString(),
        })
        .eq("customer_code", row.customer_code);

      if (error) {
        failures.push({ customer_code: row.customer_code, error: error.message });
        return false;
      }
      return true;
    }));

    updated += results.filter(Boolean).length;
  }

  return { updated, failures };
}
