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
    qtyMaster: qtyBase / masterSize,
    scannedUom: kind,
  };
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

export function hasStockTakeModuleAccess({ role, stockTakeAccess = false } = {}) {
  const normalized = String(role || "").trim().toLowerCase().replace(/_/g, "-");
  if (normalized === "admin") return true;
  return Boolean(stockTakeAccess);
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
