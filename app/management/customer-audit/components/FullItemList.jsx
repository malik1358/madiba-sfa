"use client";

import { Fragment, useDeferredValue, useMemo, useState } from "react";
import { getPrice, isDoNotUseItem, normalizeCode } from "../lib/helpers";
import { isBuildingMaterialItem, pickCatalogCategory } from "../../../lib/pricePayload";
import { formatSchemeDetail, lookupSchemeApplication } from "../../../lib/orderSchemes";
import { formatAppliedDiscount, getPricedOrderLine, lookupDiscountRate } from "../../../lib/regionalPricing";
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

function hasCurrentItemName(value, itemCode) {
  const text = String(value || "").trim();
  return Boolean(text) && normalizeCode(text) !== normalizeCode(itemCode) && !isDoNotUseItem(text);
}

function buildCatalog(itemCatalog, priceSheetItems, priceList) {
  const itemMap = new Map();
  const excludedCodes = new Set();

  (itemCatalog || []).forEach((item) => {
    const code = normalizeCode(item?.item_code);
    if (!code) return;
    const nextItem = {
      ...item,
      item_code: code,
      item_name: String(item.item_name || code).trim(),
      category: pickCatalogCategory(item.category) || "Unclassified",
    };
    if (isBuildingMaterialItem(nextItem)) {
      excludedCodes.add(code);
      return;
    }
    itemMap.set(code, nextItem);
  });

  (priceSheetItems || []).forEach((sheetItem) => {
    const code = normalizeCode(sheetItem?.item_code);
    if (!code) return;
    const existing = itemMap.get(code);
    const sheetName = String(sheetItem.item_name || "").trim();
    const sheetCategory = String(sheetItem.category || "").trim();
    const nextItem = {
      ...(existing || {}),
      item_code: code,
      item_name: hasCurrentItemName(sheetName, code)
        ? sheetName
        : (hasCurrentItemName(existing?.item_name, code) ? existing.item_name : code),
      category: pickCatalogCategory(sheetCategory, existing?.category) || "Missing Category",
    };
    if (isBuildingMaterialItem(nextItem)) {
      excludedCodes.add(code);
      itemMap.delete(code);
      return;
    }
    itemMap.set(code, nextItem);
  });

  Object.keys(priceList || {}).forEach((rawCode) => {
    const code = normalizeCode(rawCode);
    if (!code || itemMap.has(code) || excludedCodes.has(code)) return;
    itemMap.set(code, {
      item_code: code,
      item_name: code,
      category: "Missing Category",
    });
  });

  return Array.from(itemMap.values())
    .filter((item) => !isDoNotUseItem(item.item_name) && !isBuildingMaterialItem(item))
    .sort((left, right) => String(left.item_name || left.item_code).localeCompare(String(right.item_name || right.item_code)));
}

export default function FullItemList({ itemCatalog, priceSheetItems, orderQuantities, decreaseOrderQty, increaseOrderQty, changeOrderQty, priceList, cashDiscountMap = {}, valueDiscountMap = {}, paymentType = "credit", schemeApplications = {} }) {
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
              <th>Cash Discount</th>
              <th>Value Discount</th>
              <th>Scheme</th>
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
                    <td colSpan={8}>
                      <button type="button" className="moduleCategoryToggle" onClick={() => setExpandedCategories((current) => ({ ...current, [group.category]: !current[group.category] }))} aria-expanded={isExpanded}>
                        <span className="moduleCategorySymbol">{isExpanded ? "−" : "+"}</span><strong>{group.category}</strong><small>{group.items.length} items</small>
                      </button>
                    </td>
                  </tr>
                  {isExpanded && group.items.map((item) => {
                    const code = String(item.item_code || "").trim();
                    const orderQty = Number(orderQuantities[code] || 0);
                    const wholesale = getPrice(priceList, code);
                    const cashDiscount = lookupDiscountRate(cashDiscountMap, code);
                    const valueDiscount = lookupDiscountRate(valueDiscountMap, code);
                    const scheme = lookupSchemeApplication(schemeApplications, code);
                    const priced = getPricedOrderLine({
                      wholesaleRate: wholesale,
                      quantity: orderQty,
                      paymentType,
                      cashDiscountRate: cashDiscount,
                      valueDiscountRate: valueDiscount,
                      schemeUnitDiscount: scheme.unitDiscount,
                      schemeDiscountedQty: scheme.discountedQty,
                    });
                    const nameIsCode = normalizeCode(item.item_name) === normalizeCode(code);
                    return (
                      <tr key={code} className="moduleItemRow">
                        <td>{group.category}</td>
                        <td><strong>{nameIsCode ? code : item.item_name}</strong>{!nameIsCode && <div className="moduleCode">{code}</div>}</td>
                        <td>
                          {wholesale ? Number(wholesale).toLocaleString("en-US", { maximumFractionDigits: 2 }) : "NOT FOUND"}
                          {wholesale && orderQty > 0 && priced.rate !== wholesale ? (
                            <div className="moduleCode">Net {Number(priced.rate).toLocaleString("en-US", { maximumFractionDigits: 2 })}</div>
                          ) : null}
                        </td>
                        <td>{formatAppliedDiscount(cashDiscount, priced.applied.cash)}</td>
                        <td>{formatAppliedDiscount(valueDiscount, priced.applied.value)}</td>
                        <td>{formatSchemeDetail(scheme)}</td>
                        <td><div className="moduleQtyControl"><button type="button" onClick={() => decreaseOrderQty(code)}>−</button><input type="number" min="0" step="1" inputMode="numeric" value={orderQty || ""} placeholder="0" onChange={(event) => changeOrderQty(code, event.target.value)} /><button type="button" onClick={() => increaseOrderQty(code)}>+</button></div></td>
                        <td>{Number(priced.lineValue || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
                      </tr>
                    );
                  })}
                </Fragment>
              );
            })}
            {groups.length === 0 && (
              <tr><td colSpan={8}>No catalog items match this search.</td></tr>
            )}
          </tbody>
        </table>
      </ExportableTable>
    </section>
  );
}
