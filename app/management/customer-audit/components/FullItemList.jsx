"use client";

import { useDeferredValue, useState } from "react";
import { isDoNotUseItem } from "../lib/helpers";

function normalizedText(value) {
  return String(value || "").trim().toLowerCase();
}

export default function FullItemList({ itemCatalog, orderQuantities, decreaseOrderQty, increaseOrderQty, changeOrderQty, priceList }) {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const query = normalizedText(deferredSearch);

  const items = (itemCatalog || [])
    .filter((item) => {
      if (!query) return true;
      return [item.item_code, item.item_name, item.category]
        .some((value) => normalizedText(value).includes(query));
    })
    .sort((left, right) => String(left.item_name || left.item_code).localeCompare(String(right.item_name || right.item_code)));

  return (
    <section className="auditSection">
      <div className="auditQuickOrderHeading">
        <div>
          <h3>Full Item List</h3>
          <p>Search the full catalog and add any available item to this order.</p>
        </div>
        <span className="auditQuickOrderCount">{items.length} items</span>
      </div>

      <input
        className="moduleInput"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search item name, code, or category"
        aria-label="Search full item list"
      />

      <div className="auditTableScroll" style={{ marginTop: "10px" }}>
        <table className="auditQuickOrderTable auditFullItemListTable">
          <thead>
            <tr>
              <th>Item</th>
              <th>Category</th>
              <th>Rate</th>
              <th>Order Qty</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const code = String(item.item_code || "").trim();
              const name = String(item.item_name || code).trim();
              const notOrderable = isDoNotUseItem(name);
              const orderQty = Number(orderQuantities[code] || 0);
              const rate = priceList[String(code).toUpperCase()];

              return (
                <tr key={code}>
                  <td>
                    <div className="auditQuickItemCode">{code}</div>
                    <strong className="auditQuickItemName">{name}</strong>
                  </td>
                  <td>{item.category || "Unclassified"}</td>
                  <td className="auditQuickRate">{rate ? Number(rate).toLocaleString("en-US", { maximumFractionDigits: 0 }) : "NOT FOUND"}</td>
                  <td>
                    {notOrderable ? (
                      <span className="auditQuickBadge">Not orderable</span>
                    ) : (
                      <div className="auditQtyControl">
                        <button type="button" className="auditQtyButton" onClick={() => decreaseOrderQty(code)}>−</button>
                        <input type="number" min="0" step="1" inputMode="numeric" value={orderQty || ""} placeholder="0" onChange={(event) => changeOrderQty(code, event.target.value)} />
                        <button type="button" className="auditQtyButton" onClick={() => increaseOrderQty(code)}>+</button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {items.length === 0 && (
              <tr><td colSpan={4}>No catalog items match this search.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
