"use client";

import { Fragment, useDeferredValue, useMemo, useState } from "react";
import { getPrice, isDoNotUseItem, normalizeCode } from "../lib/helpers";
import ExportableTable from "../../../components/ExportableTable";

function normalizedText(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeCategoryLabel(value) {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  if (!text) return "Unclassified";

  return text
    .split(" ")
    .map((word) => (word.toUpperCase() === "POS"
      ? "POS"
      : `${word.slice(0, 1).toUpperCase()}${word.slice(1).toLowerCase()}`))
    .join(" ");
}

function hasMeaningfulValue(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  return !["UNCLASSIFIED", "TO_MAP", "TBD", "TODO", "N/A", "NA", "-"].includes(text.toUpperCase());
}

function hasCurrentItemName(value, itemCode) {
  const text = String(value || "").trim();
  return Boolean(text) && normalizeCode(text) !== normalizeCode(itemCode) && !isDoNotUseItem(text);
}

function buildCatalog(itemCatalog, priceSheetItems, priceList) {
  const itemMap = new Map();

  (itemCatalog || []).forEach((item) => {
    const code = normalizeCode(item?.item_code);
    if (!code) return;
    itemMap.set(code, {
      ...item,
      item_code: code,
      item_name: String(item.item_name || code).trim(),
      category: String(item.category || "Unclassified").trim() || "Unclassified",
    });
  });

  (priceSheetItems || []).forEach((sheetItem) => {
    const code = normalizeCode(sheetItem?.item_code);
    if (!code) return;
    const existing = itemMap.get(code);
    const sheetName = String(sheetItem.item_name || "").trim();
    const sheetCategory = String(sheetItem.category || "").trim();

    itemMap.set(code, {
      ...(existing || {}),
      item_code: code,
      item_name: hasCurrentItemName(sheetName, code)
        ? sheetName
        : (hasCurrentItemName(existing?.item_name, code) ? existing.item_name : code),
      category: hasMeaningfulValue(sheetCategory)
        ? sheetCategory
        : (hasMeaningfulValue(existing?.category) ? existing.category : "Missing Category"),
    });
  });

  Object.keys(priceList || {}).forEach((rawCode) => {
    const code = normalizeCode(rawCode);
    if (!code || itemMap.has(code)) return;
    itemMap.set(code, {
      item_code: code,
      item_name: code,
      category: "Missing Category",
    });
  });

  return Array.from(itemMap.values())
    .filter((item) => !isDoNotUseItem(item.item_name))
    .sort((left, right) => String(left.item_name || left.item_code).localeCompare(String(right.item_name || right.item_code)));
}

export default function FullItemList({ itemCatalog, priceSheetItems, orderQuantities, decreaseOrderQty, increaseOrderQty, changeOrderQty, priceList }) {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [expandedCategories, setExpandedCategories] = useState({});
  const deferredSearch = useDeferredValue(search);
  const query = normalizedText(deferredSearch);

  const catalog = useMemo(
    () => buildCatalog(itemCatalog, priceSheetItems, priceList),
    [itemCatalog, priceSheetItems, priceList]
  );

  const categories = useMemo(
    () => ["ALL", ...new Set(catalog.map((item) => normalizeCategoryLabel(item.category)))],
    [catalog]
  );

  const groups = useMemo(() => {
    const grouped = new Map();
    catalog.forEach((item) => {
      const category = normalizeCategoryLabel(item.category);
      if (categoryFilter !== "ALL" && category !== categoryFilter) return;
      if (query && ![item.item_code, item.item_name, item.category].some((value) => normalizedText(value).includes(query))) return;

      const items = grouped.get(category) || [];
      items.push(item);
      grouped.set(category, items);
    });
    return Array.from(grouped.entries())
      .map(([category, items]) => ({ category, items }))
      .sort((left, right) => left.category.localeCompare(right.category));
  }, [catalog, categoryFilter, query]);

  return (
    <section className="auditSection">
      <div className="auditQuickOrderHeading">
        <div>
          <h3>Full Item List</h3>
          <p>Search the full catalog and add any available item to this order.</p>
        </div>
        <span className="auditQuickOrderCount">{catalog.length} catalog items</span>
      </div>

      <div className="moduleFilterRow">
        <input className="moduleInput" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search item name, code, or category" aria-label="Search full item list" />
        <select className="moduleInput" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
          {categories.map((category) => <option key={category} value={category}>{category}</option>)}
        </select>
      </div>

      <ExportableTable filename="customer-full-item-list" sheetName="Items" className="auditTableScroll" style={{ marginTop: "10px" }}>
        <table className="moduleTable moduleOrderTable auditFullItemListTable">
          <thead>
            <tr>
              <th>Category</th>
              <th>Item</th>
              <th>Price</th>
              <th>Qty</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => {
              const isExpanded = Boolean(expandedCategories[group.category]);
              return (
                <Fragment key={group.category}>
                  <tr className="moduleCategoryRow">
                    <td colSpan={5}>
                      <button type="button" className="moduleCategoryToggle" onClick={() => setExpandedCategories((current) => ({ ...current, [group.category]: !current[group.category] }))} aria-expanded={isExpanded}>
                        <span className="moduleCategorySymbol">{isExpanded ? "−" : "+"}</span><strong>{group.category}</strong><small>{group.items.length} items</small>
                      </button>
                    </td>
                  </tr>
                  {isExpanded && group.items.map((item) => {
                    const code = String(item.item_code || "").trim();
                    const orderQty = Number(orderQuantities[code] || 0);
                    const price = getPrice(priceList, code);
                    const nameIsCode = normalizeCode(item.item_name) === normalizeCode(code);
                    return (
                      <tr key={code} className="moduleItemRow">
                        <td>{group.category}</td>
                        <td><strong>{nameIsCode ? code : item.item_name}</strong>{!nameIsCode && <div className="moduleCode">{code}</div>}</td>
                        <td>{price ? Number(price).toLocaleString("en-US", { maximumFractionDigits: 2 }) : "NOT FOUND"}</td>
                        <td><div className="moduleQtyControl"><button type="button" onClick={() => decreaseOrderQty(code)}>−</button><input type="number" min="0" step="1" inputMode="numeric" value={orderQty || ""} placeholder="0" onChange={(event) => changeOrderQty(code, event.target.value)} /><button type="button" onClick={() => increaseOrderQty(code)}>+</button></div></td>
                        <td>{(price * orderQty).toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
                      </tr>
                    );
                  })}
                </Fragment>
              );
            })}
            {groups.length === 0 && (
              <tr><td colSpan={5}>No catalog items match this search.</td></tr>
            )}
          </tbody>
        </table>
      </ExportableTable>
    </section>
  );
}
