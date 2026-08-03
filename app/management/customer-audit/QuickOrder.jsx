"use client";
import React from "react";
import { qtyFormat } from "./lib/format";
import { getPrice } from "./lib/priceHelpers";

export default function QuickOrder({
  quickOrderAllItems = [],
  quickOrderSuggestions = { newItems: [], notBoughtRecently: [], buyingLess: [] },
  itemMasterStatus = "",
  itemMasterLength = 0,
  transactionsLength = 0,
  peerTransactionsLength = 0,
  priceList = {},
  orderQuantities = {},
  changeOrderQty,
  increaseOrderQty,
  decreaseOrderQty,
}) {
  const groups = [
    {
      key: "newItems",
      title: "New Items",
      subtitle: "Items this customer has never bought",
      items: quickOrderSuggestions.newItems,
    },
    {
      key: "notBoughtRecently",
      title: "Not Bought Since Long",
      subtitle: "Previously purchased items with the oldest last purchase",
      items: quickOrderSuggestions.notBoughtRecently,
    },
    {
      key: "buyingLess",
      title: "Buying Less",
      subtitle: "Items currently buying below their historical average quantity",
      items: quickOrderSuggestions.buyingLess,
    },
  ];

  return (
    <section className="auditSection auditQuickOrderSection">
      <div className="auditQuickOrderHeading">
        <div>
          <h3>Quick Order</h3>
          <div
            style={{
              fontSize: "11px",
              padding: "6px 10px",
              margin: "6px 0",
              background: "#fff4cc",
              border: "1px solid #d6b84c",
            }}
          >
            ITEM MASTER: {itemMasterStatus} {" | "}
            LOADED: {itemMasterLength} {" | "}
            CUSTOMER TRANSACTIONS: {transactionsLength} {" | "} PEER TRANSACTIONS: {peerTransactionsLength}
            {" | "}
            NEW SUGGESTIONS: {quickOrderSuggestions.newItems.length}
          </div>
          <p>Suggested items based on this customer's purchase history.</p>
        </div>

        <span className="auditQuickOrderCount">{quickOrderAllItems.length} suggestions</span>
      </div>

      {quickOrderAllItems.length === 0 ? (
        <div className="auditEmpty">No quick-order suggestions available for this customer.</div>
      ) : (
        <div className="auditQuickOrderGroups">
          {groups.map((group) => (
            <div key={group.key} className="auditQuickOrderGroup">
              <div className="auditQuickOrderGroupHeader">
                <div>
                  <strong>{group.title}</strong>
                  <span>{group.subtitle}</span>
                </div>

                <b>{group.items.length}</b>
              </div>

              {group.items.length === 0 ? (
                <div className="auditQuickOrderEmpty">No suggestion</div>
              ) : (
                <div className="auditQuickOrderTableWrap">
                  <table className="auditQuickOrderTable">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Category</th>
                        <th>History</th>
                        <th>Rate</th>
                        <th>Order Qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.items.map((item) => {
                        const orderQty = Number(orderQuantities[item.item_code] || 0);
                        const price = getPrice(priceList, item.item_code);

                        return (
                          <tr key={`${group.key}-${item.item_code}`}>
                            <td>
                              <div className="auditQuickItemCode">{item.item_code}</div>
                              <strong className="auditQuickItemName">{item.item_name}</strong>
                            </td>

                            <td>{item.category || "Unclassified"}</td>

                            <td>
                              {group.key === "newItems" && (
                                <span className="auditQuickBadge auditQuickBadgeNew">{item.recommendationReason}</span>
                              )}

                              {group.key === "buyingLess" && (
                                <div className="auditQuickHistory">
                                  <span>Avg Qty / Month</span>
                                  <strong>{qtyFormat(item.avgQty)}</strong>
                                  <span>Months Bought</span>
                                  <strong>{item.activeMonths}</strong>
                                  <span>Latest Qty</span>
                                  <strong className="auditQuickDecline">{qtyFormat(item.latestQty)}</strong>
                                </div>
                              )}

                              {group.key === "buyingLess" && (
                                <div className="auditQuickHistory">
                                  <span>Previous 3 months</span>
                                  <strong>{qtyFormat(item.previousQty)}</strong>
                                  <span>Recent 3 months</span>
                                  <strong className="auditQuickDecline">{qtyFormat(item.recentQty)}</strong>
                                </div>
                              )}
                            </td>

                            <td className="auditQuickRate">{price ? `SAR ${price.toFixed(2)}` : "NOT FOUND"}</td>

                            <td>
                              <div className="auditQtyControl">
                                <button
                                  type="button"
                                  className="auditQtyButton"
                                  onClick={() => decreaseOrderQty(item.item_code)}
                                >
                                  −
                                </button>

                                <input
                                  type="number"
                                  min="0"
                                  step="1"
                                  inputMode="numeric"
                                  value={orderQty || ""}
                                  placeholder="0"
                                  onChange={(e) => changeOrderQty(item.item_code, e.target.value)}
                                />

                                <button
                                  type="button"
                                  className="auditQtyButton"
                                  onClick={() => increaseOrderQty(item.item_code)}
                                >
                                  +
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
