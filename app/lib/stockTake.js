export const STOCK_TAKE_UOM = {
  BASE: "BASE",
  MID: "MID",
  MASTER: "MASTER",
};

export function normalizeStockTakeCode(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

export function normalizeWarehouseName(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

export function warehouseKey(value) {
  return normalizeWarehouseName(value).toUpperCase();
}

export function normalizeBarcode(value) {
  return String(value || "").trim();
}

export function parsePackSize(value) {
  if (value == null || value === "") return 0;
  const numeric = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(numeric) ? numeric : 0;
}

export function parseQtyEntered(value) {
  const numeric = Number(String(value ?? "").replace(/,/g, "").trim());
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error("Enter a quantity greater than zero.");
  }
  return numeric;
}

export function formatStockQty(value, digits = 6) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "";
  const text = numeric.toFixed(digits).replace(/\.?0+$/, "");
  return text === "-0" ? "0" : text;
}

export function resolveScannedUom(item, barcode) {
  const scanned = normalizeBarcode(barcode);
  if (!scanned || !item) return { kind: null, ambiguous: false };

  const matches = [];
  if (normalizeBarcode(item.barcode_base) && normalizeBarcode(item.barcode_base) === scanned) {
    matches.push(STOCK_TAKE_UOM.BASE);
  }
  if (normalizeBarcode(item.barcode_mid) && normalizeBarcode(item.barcode_mid) === scanned) {
    matches.push(STOCK_TAKE_UOM.MID);
  }
  if (normalizeBarcode(item.barcode_master) && normalizeBarcode(item.barcode_master) === scanned) {
    matches.push(STOCK_TAKE_UOM.MASTER);
  }

  const unique = [...new Set(matches)];
  if (unique.length === 1) return { kind: unique[0], ambiguous: false };
  if (unique.length > 1) return { kind: unique[0], ambiguous: true };

  const itemCode = normalizeStockTakeCode(item.item_code);
  if (itemCode && (itemCode === normalizeStockTakeCode(scanned) || normalizeBarcode(item.item_code) === scanned)) {
    return { kind: null, ambiguous: true };
  }

  return { kind: null, ambiguous: false };
}

export function uomLabel(item, kind) {
  if (kind === STOCK_TAKE_UOM.MID) return String(item?.mid_uom || "MID").trim() || "MID";
  if (kind === STOCK_TAKE_UOM.MASTER) return String(item?.master_uom || "MASTER").trim() || "MASTER";
  return String(item?.base_uom || "BASE").trim() || "BASE";
}

export function availableStockTakeUnits(item) {
  if (!item) return [];
  const units = [{ kind: STOCK_TAKE_UOM.BASE, label: uomLabel(item, STOCK_TAKE_UOM.BASE) }];
  if (parsePackSize(item.mid_uom_pack_size) > 0) {
    units.push({ kind: STOCK_TAKE_UOM.MID, label: uomLabel(item, STOCK_TAKE_UOM.MID) });
  }
  if (parsePackSize(item.base_uom_pack_size) > 0) {
    units.push({ kind: STOCK_TAKE_UOM.MASTER, label: uomLabel(item, STOCK_TAKE_UOM.MASTER) });
  }
  return units;
}

export function focusStockTakeAfterLookup({ lookupMode, unitLocked, unitCount }) {
  if (lookupMode === "barcode" || unitLocked) return "qty";
  if (Number(unitCount) <= 1) return "qty";
  return "unit";
}

export function convertEnteredQtyToUnits({ qtyEntered, scannedUom, baseUomPackSize, midUomPackSize }) {
  const qty = parseQtyEntered(qtyEntered);
  const masterSize = parsePackSize(baseUomPackSize);
  const midSize = parsePackSize(midUomPackSize);
  const kind = String(scannedUom || "").toUpperCase();

  let qtyBase = 0;
  if (kind === STOCK_TAKE_UOM.BASE) {
    qtyBase = qty;
  } else if (kind === STOCK_TAKE_UOM.MID) {
    if (!(midSize > 0)) {
      throw new Error("MID UOM Pack Size is missing for this item.");
    }
    qtyBase = qty * midSize;
  } else if (kind === STOCK_TAKE_UOM.MASTER) {
    if (!(masterSize > 0)) {
      throw new Error("Base UOM Pack Size is missing for this item.");
    }
    qtyBase = qty * masterSize;
  } else {
    throw new Error("Select Base, MID, or Master unit for this barcode.");
  }

  if (!(masterSize > 0)) {
    throw new Error("Base UOM Pack Size is missing for this item.");
  }

  return {
    qtyEntered: qty,
    qtyBase,
    qtyMid: midSize > 0 ? qtyBase / midSize : null,
    qtyMaster: qtyBase / masterSize,
    scannedUom: kind,
  };
}

export function previewConvertedQty(args) {
  try {
    return convertEnteredQtyToUnits(args);
  } catch {
    return null;
  }
}

export function findItemByItemCode(items, itemCode) {
  const code = normalizeStockTakeCode(itemCode);
  if (!code) return null;
  return (items || []).find((item) => normalizeStockTakeCode(item.item_code) === code) || null;
}

export function attachQtyMidToLines(lines, items = []) {
  const byCode = new Map(
    (items || []).map((item) => [normalizeStockTakeCode(item.item_code), item]),
  );
  return (lines || []).map((line) => {
    const item = byCode.get(normalizeStockTakeCode(line.item_code));
    const midSize = parsePackSize(item?.mid_uom_pack_size);
    const qtyBase = Number(line.qty_base);
    return {
      ...line,
      qty_mid: midSize > 0 && Number.isFinite(qtyBase) ? qtyBase / midSize : null,
    };
  });
}

export function itemMatchesBarcode(item, barcode) {
  const scanned = normalizeBarcode(barcode);
  if (!scanned || !item) return false;
  if (normalizeBarcode(item.barcode_base) === scanned) return true;
  if (normalizeBarcode(item.barcode_mid) === scanned) return true;
  if (normalizeBarcode(item.barcode_master) === scanned) return true;
  if (normalizeBarcode(item.item_code) === scanned) return true;
  return normalizeStockTakeCode(item.item_code) === normalizeStockTakeCode(scanned);
}

export function findItemByBarcode(items, barcode) {
  const scanned = normalizeBarcode(barcode);
  if (!scanned) return null;
  return (items || []).find((item) => itemMatchesBarcode(item, scanned)) || null;
}

export function lookupStockTakeItem({ items = [], barcode, itemCode } = {}) {
  const barcodeValue = normalizeBarcode(barcode);
  const itemCodeValue = normalizeStockTakeCode(itemCode);
  if (itemCodeValue && !barcodeValue) {
    const item = findItemByItemCode(items, itemCodeValue);
    if (!item) throw new Error("Item code not found in stock take master.");
    return {
      item,
      lookupMode: "itemCode",
      scannedUom: "",
      scannedUomLabel: "",
      needsUom: true,
      unitLocked: false,
    };
  }

  const item = findItemByBarcode(items, barcodeValue);
  if (!item) throw new Error("Barcode not found in stock take master.");
  const resolved = resolveScannedUom(item, barcodeValue);
  const unitLocked = Boolean(resolved.kind) && !resolved.ambiguous;
  return {
    item,
    lookupMode: unitLocked ? "barcode" : "itemCode",
    scannedUom: unitLocked ? resolved.kind : "",
    scannedUomLabel: unitLocked ? uomLabel(item, resolved.kind) : "",
    needsUom: !unitLocked,
    unitLocked,
  };
}

export function buildLocalStockTakeLine({
  id,
  item,
  qty,
  scannedUom,
  barcode,
  pallet,
  location,
  scannedByName,
  scannedAt,
} = {}) {
  const converted = convertEnteredQtyToUnits({
    qtyEntered: qty,
    scannedUom,
    baseUomPackSize: item?.base_uom_pack_size,
    midUomPackSize: item?.mid_uom_pack_size,
  });
  return {
    id: id || `local:${Date.now()}`,
    item_code: item.item_code,
    item_name: item.item_name,
    barcode: normalizeBarcode(barcode) || item.item_code,
    scanned_uom: converted.scannedUom,
    scanned_uom_label: uomLabel(item, converted.scannedUom),
    qty_entered: converted.qtyEntered,
    qty_base: converted.qtyBase,
    qty_mid: converted.qtyMid,
    qty_master: converted.qtyMaster,
    pallet_ref: String(pallet || "").trim() || null,
    location_ref: String(location || "").trim() || null,
    scanned_by_name: scannedByName || "",
    scanned_at: scannedAt || new Date().toISOString(),
    pending: true,
  };
}

export function hasStockTakeModuleAccess({ role, stockTakeAccess = false } = {}) {
  const normalized = String(role || "").trim().toLowerCase().replace(/_/g, "-");
  if (normalized === "admin") return true;
  return Boolean(stockTakeAccess);
}

export function canAccessStockTakeSession({ session, userId, sharedSessionIds = [] } = {}) {
  if (!session || !userId) return false;
  if (String(session.started_by || "") === String(userId)) return true;
  return (sharedSessionIds || []).map(String).includes(String(session.id));
}

export function isOpenStockTakeSession(session) {
  return String(session?.status || "OPEN").toUpperCase() === "OPEN";
}

export function canArchiveStockTakeSession({ session, userId, role } = {}) {
  if (!session || !userId || !isOpenStockTakeSession(session)) return false;
  if (String(session.started_by || "") === String(userId)) return true;
  return String(role || "").trim().toLowerCase().replace(/_/g, "-") === "admin";
}

export function duplicateOpenWarehouseMessage({ warehouseName, existing, userId, sharedSessionIds = [] } = {}) {
  if (!existing) return "";
  const name = existing.warehouse_name || warehouseName || "this warehouse";
  if (canAccessStockTakeSession({ session: existing, userId, sharedSessionIds })) {
    return `An open inventory already exists for ${name}. Open it from the list instead of starting a new one.`;
  }
  const owner = String(existing.started_by_name || "").trim() || "another user";
  return `An open inventory already exists for ${name} (opened by ${owner}). Ask them to share it with you.`;
}

export function annotateOpenStockTakeSessions({ sessions = [], userId, sharedSessionIds = [] } = {}) {
  const shared = new Set((sharedSessionIds || []).map(String));
  const mine = String(userId || "");
  return (sessions || [])
    .filter((session) => String(session.status || "OPEN").toUpperCase() === "OPEN")
    .filter((session) => String(session.started_by || "") === mine || shared.has(String(session.id)))
    .map((session) => ({
      ...session,
      accessKind: String(session.started_by || "") === mine ? "mine" : "shared",
    }))
    .sort((a, b) => String(b.started_at || "").localeCompare(String(a.started_at || "")));
}

export function stockTakeShareTargets(profiles = [], currentUserId) {
  return (profiles || [])
    .filter((profile) => String(profile.id) !== String(currentUserId))
    .filter((profile) => hasStockTakeModuleAccess({
      role: profile.role,
      stockTakeAccess: profile.stock_take_access === true,
    }))
    .map((profile) => {
      const inactive = profile.is_active === false;
      const baseName = String(profile.salesman_name || profile.salesman_code || profile.id || "").trim() || String(profile.id);
      return {
        id: profile.id,
        name: inactive ? `${baseName} (inactive)` : baseName,
        inactive,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function consolidateStockTakeReportLines(lines = []) {
  const groups = new Map();

  function uniqueLabels(values) {
    const list = [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))];
    if (list.length === 0) return "—";
    if (list.length === 1) return list[0];
    return "Multiple";
  }

  (lines || []).forEach((line) => {
    const warehouseName = String(line.warehouse_name || "").trim() || "—";
    const itemCode = normalizeStockTakeCode(line.item_code) || String(line.item_code || "").trim();
    const key = `${warehouseKey(warehouseName)}::${itemCode || "UNKNOWN"}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        warehouse_name: warehouseName,
        item_code: line.item_code,
        item_name: line.item_name,
        qty_base: 0,
        qty_master: 0,
        qty_entered: 0,
        system_qty_base: line.system_qty_base ?? null,
        last_scanned_at: line.scanned_at || "",
        lines: [],
      });
    }
    const group = groups.get(key);
    group.lines.push(line);
    group.qty_base += Number(line.qty_base) || 0;
    group.qty_master += Number(line.qty_master) || 0;
    group.qty_entered += Number(line.qty_entered) || 0;
    if (group.system_qty_base == null && line.system_qty_base != null) {
      group.system_qty_base = line.system_qty_base;
    }
    if (String(line.scanned_at || "") > String(group.last_scanned_at || "")) {
      group.last_scanned_at = line.scanned_at;
      group.item_name = line.item_name || group.item_name;
      group.item_code = line.item_code || group.item_code;
    }
  });

  return [...groups.values()]
    .map((group) => {
      const detail = [...group.lines].sort((left, right) => String(right.scanned_at || "").localeCompare(String(left.scanned_at || "")));
      const units = [...new Set(detail.map((line) => String(line.scanned_uom || "").toUpperCase()).filter(Boolean))];
      return {
        ...group,
        lines: detail,
        scanCount: detail.length,
        userLabel: uniqueLabels(detail.map((line) => line.scanned_by_name || line.scanned_by)),
        barcodeLabel: uniqueLabels(detail.map((line) => line.barcode)),
        unitLabel: uniqueLabels(detail.map((line) => line.scanned_uom_label || line.scanned_uom)),
        qtyEnteredLabel: units.length === 1 ? group.qty_entered : null,
        palletLabel: uniqueLabels(detail.map((line) => line.pallet_ref)),
        locationLabel: uniqueLabels(detail.map((line) => line.location_ref)),
      };
    })
    .sort((left, right) => String(right.last_scanned_at || "").localeCompare(String(left.last_scanned_at || "")));
}

export function attachSystemQtyToLines(lines, systemRows = []) {
  const byItem = new Map(
    (systemRows || []).map((row) => [normalizeStockTakeCode(row.item_code), Number(row.qty_base) || 0]),
  );

  return (lines || []).map((line) => {
    const key = normalizeStockTakeCode(line.item_code);
    const hasSystem = byItem.has(key);
    const systemQtyBase = hasSystem ? byItem.get(key) : null;
    return {
      ...line,
      system_qty_base: systemQtyBase,
      variance_qty_base: systemQtyBase == null ? null : Number(line.qty_base || 0) - systemQtyBase,
    };
  });
}
