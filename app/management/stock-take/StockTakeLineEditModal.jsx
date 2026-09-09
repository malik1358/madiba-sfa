"use client";

import { useMemo, useState } from "react";
import {
  availableStockTakeUnits,
  findItemByItemCode,
  formatStockQty,
  previewConvertedQty,
} from "../../lib/stockTake";

export default function StockTakeLineEditModal({
  line,
  items = [],
  t,
  dir,
  saving = false,
  onClose,
  onSave,
}) {
  const item = useMemo(
    () => findItemByItemCode(items, line?.item_code) || null,
    [items, line?.item_code],
  );
  const units = availableStockTakeUnits(item);
  const [qty, setQty] = useState(line?.qty_entered != null ? String(line.qty_entered) : "");
  const [scannedUom, setScannedUom] = useState(String(line?.scanned_uom || "").toUpperCase());
  const [pallet, setPallet] = useState(line?.pallet_ref || "");
  const [location, setLocation] = useState(line?.location_ref || "");

  const converted = previewConvertedQty({
    qtyEntered: qty,
    scannedUom,
    baseUomPackSize: item?.base_uom_pack_size,
    midUomPackSize: item?.mid_uom_pack_size,
  });

  return (
    <div className="moduleModalOverlay" dir={dir} role="presentation" onClick={onClose}>
      <div className="moduleModal" role="dialog" aria-modal="true" aria-labelledby="stock-take-edit-title" onClick={(event) => event.stopPropagation()}>
        <h2 id="stock-take-edit-title">{t("editTitle")}</h2>
        <p className="moduleHint">
          <strong>{line?.item_name}</strong>
          <span className="moduleCode"> {line?.item_code}</span>
        </p>
        <form
          className="moduleFormGrid moduleModalForm"
          onSubmit={(event) => {
            event.preventDefault();
            onSave({ qty, scannedUom, pallet, location });
          }}
        >
          <label>
            {t("unit")}
            {units.length ? (
              <select className="moduleInput" value={scannedUom} onChange={(event) => setScannedUom(event.target.value)} required>
                <option value="">Select unit</option>
                {units.map((unit) => (
                  <option key={unit.kind} value={unit.kind}>{unit.label}</option>
                ))}
              </select>
            ) : (
              <input className="moduleInput" value={line?.scanned_uom_label || scannedUom} readOnly />
            )}
          </label>
          <label>
            {t("qty")}
            <input className="moduleInput" inputMode="decimal" value={qty} onChange={(event) => setQty(event.target.value)} required />
          </label>
          <label>
            {t("qtyBase")}
            <input className="moduleInput" readOnly tabIndex={-1} value={converted ? formatStockQty(converted.qtyBase) : ""} />
          </label>
          <label>
            {t("qtyMaster")}
            <input className="moduleInput" readOnly tabIndex={-1} value={converted ? formatStockQty(converted.qtyMaster) : ""} />
          </label>
          <label>
            {t("pallet")}
            <input className="moduleInput" value={pallet} onChange={(event) => setPallet(event.target.value)} />
          </label>
          <label>
            {t("location")}
            <input className="moduleInput" value={location} onChange={(event) => setLocation(event.target.value)} />
          </label>
          <div className="moduleModalSubmit stockTakeSessionActions">
            <button className="modulePrimaryButton" type="submit" disabled={saving}>
              {saving ? t("saving") : t("saveEdit")}
            </button>
            <button className="moduleInlineButton" type="button" onClick={onClose} disabled={saving}>
              {t("cancel")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
