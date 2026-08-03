"use client";
import React from "react";
import { qtyFormat } from "./lib/format";
import { getPrice } from "./lib/priceHelpers";

export default function OrderBar({
  orderItems = [],
  orderSummary = { itemCount: 0, totalQuantity: 0 },
  priceList = {},
  savingOrder = false,
  submittingOrder = false,
  draftOrderId = null,
  saveDraft,
  setShowOrderReview,
}) {
  const grandTotal = orderItems
    .reduce((sum, item) => sum + getPrice(priceList, item.item_code) * Number(item.order_quantity || 0), 0)
    .toFixed(2);

  return (
    <section className="auditOrderBar">
      <div className="auditOrderBarSummary">
        <span>Current Order</span>
        <strong>
          {orderSummary.itemCount} {orderSummary.itemCount === 1 ? "item" : "items"}
          {" • "}
          {qtyFormat(orderSummary.totalQuantity)} <br />
          <strong>
            SAR {grandTotal}
          </strong>
          units
        </strong>
      </div>

      <div className="auditOrderBarActions">
        <button
          type="button"
          className="auditDraftButton"
          disabled={savingOrder || submittingOrder}
          onClick={saveDraft}
        >
          {savingOrder ? "Saving..." : draftOrderId ? "Update Draft" : "Save Draft"}
        </button>

        <button type="button" className="auditViewOrderButton" onClick={() => setShowOrderReview(true)}>
          View Order
        </button>
      </div>
    </section>
  );
}
