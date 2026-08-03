"use client";
import React from "react";
import { getPrice } from "./lib/priceHelpers";
import { qtyFormat } from "./lib/format";

export default function OrderReview({
  show,
  orderItems = [],
  priceList = {},
  selectedCustomer = {},
  orderSummary = { itemCount: 0, totalQuantity: 0 },
  draftOrderId = null,
  savingOrder = false,
  submittingOrder = false,
  saveDraft,
  submitOrder,
  changeOrderQty,
  increaseOrderQty,
  decreaseOrderQty,
  setShowOrderReview,
}) {
  const grandTotal = orderItems
    .reduce((sum, item) => sum + getPrice(priceList, item.item_code) * Number(item.order_quantity || 0), 0)
    .toFixed(2);

  if (!show) return null;

  return (
    <div className="auditOrderOverlay">
      <div className="auditOrderReview">
        <div className="auditOrderReviewHeader">
          <div>
            <span className="auditOrderReviewEyebrow">MADIBA SFA</span>
            <h3>Review Order</h3>
            <p>
              {selectedCustomer.customer_code} {selectedCustomer.customer_name}
            </p>
          </div>

          <button type="button" className="auditOrderClose" aria-label="Close order review" onClick={() => setShowOrderReview(false)}>
            ×
          </button>
        </div>

        <div className="auditOrderReviewSummary">
          <div>
            <span>Items</span>
            <strong>{orderSummary.itemCount}</strong>
          </div>

          <div>
            <span>Total Qty</span>
            <strong>{qtyFormat(orderSummary.totalQuantity)}</strong>
          </div>

          <div>
            <span>Status</span>
            <strong>{draftOrderId ? "Draft" : "New"}</strong>
          </div>
        </div>

        <div className="auditOrderReviewLines">
          {orderItems.map((item) => (
            <div key={item.item_code} className="auditOrderReviewLine">
              <div className="auditOrderReviewItem">
                <span>{item.item_code}</span>
                <strong>{item.item_name}</strong>
                <small>{item.category || "Unclassified"}</small>
              </div>

              <div className="auditOrderReviewRate">
                <span>Rate</span>
                <strong style={{ color: getPrice(priceList, item.item_code) ? "#0f766e" : "red" }}>
                  {getPrice(priceList, item.item_code) ? `SAR ${getPrice(priceList, item.item_code).toFixed(2)}` : "PRICE NOT FOUND"}
                </strong>
              </div>

              <div className="auditOrderReviewQty">
                <span>Qty</span>
                <div className="auditQtyControl auditQtyControlReview">
                  <button type="button" className="auditQtyButton" onClick={() => decreaseOrderQty(item.item_code)}>
                    −
                  </button>

                  <input type="number" min="0" step="1" inputMode="numeric" value={item.order_quantity} onChange={(e) => changeOrderQty(item.item_code, e.target.value)} />

                  <button type="button" className="auditQtyButton" onClick={() => increaseOrderQty(item.item_code)}>
                    +
                  </button>
                </div>

                <div className="auditOrderReviewTotal">
                  <span>Total</span>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="auditOrderGrandTotal">
          <strong>
            Grand Total : SAR {grandTotal}
          </strong>
        </div>

        <div className="auditOrderReviewActions">
          <button type="button" className="auditSaveDraftButton" disabled={savingOrder || submittingOrder} onClick={saveDraft}>
            {savingOrder ? "Saving..." : draftOrderId ? "Update Draft" : "Save Draft"}
          </button>

          <button type="button" className="auditSubmitOrderButton" disabled={savingOrder || submittingOrder} onClick={submitOrder}>
            {submittingOrder ? "Submitting..." : "Submit Final Order"}
          </button>
        </div>
      </div>
    </div>
  );
}
