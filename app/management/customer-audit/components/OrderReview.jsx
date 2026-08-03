import { qtyFormat } from '../lib/format';
import { calculateGrandTotal } from '../lib/orderHelpers';

export default function OrderReview({ showOrderReview, orderItems, orderSummary, priceList, savingOrder, submittingOrder, saveDraft, submitOrder, setShowOrderReview, draftOrderId, decreaseOrderQty, increaseOrderQty, changeOrderQty }) {
  if (!showOrderReview || orderItems.length === 0) return null;

  return (
    <div className="auditOrderOverlay">
      <div className="auditOrderReview">
        <div className="auditOrderReviewHeader">
          <div>
            <span className="auditOrderReviewEyebrow">MADIBA SFA</span>
            <h3>Review Order</h3>
            <p>Customer order review</p>
          </div>
          <button type="button" className="auditOrderClose" aria-label="Close order review" onClick={() => setShowOrderReview(false)}>×</button>
        </div>

        <div className="auditOrderReviewSummary">
          <div><span>Items</span><strong>{orderSummary.itemCount}</strong></div>
          <div><span>Total Qty</span><strong>{qtyFormat(orderSummary.totalQuantity)}</strong></div>
          <div><span>Status</span><strong>{draftOrderId ? 'Draft' : 'New'}</strong></div>
        </div>

        <div className="auditOrderReviewLines">
          {orderItems.map((item) => (
            <div key={item.item_code} className="auditOrderReviewLine">
              <div className="auditOrderReviewItem">
                <span>{item.item_code}</span>
                <strong>{item.item_name}</strong>
                <small>{item.category || 'Unclassified'}</small>
              </div>
              <div className="auditOrderReviewRate">
                <span>Rate</span>
                <strong style={{ color: priceList[String(item.item_code).trim().toUpperCase()] ? '#0f766e' : 'red' }}>
                  {priceList[String(item.item_code).trim().toUpperCase()] ? `SAR ${Number(priceList[String(item.item_code).trim().toUpperCase()]).toFixed(2)}` : 'PRICE NOT FOUND'}
                </strong>
              </div>
              <div className="auditOrderReviewQty">
                <span>Qty</span>
                <div className="auditQtyControl auditQtyControlReview">
                  <button type="button" className="auditQtyButton" onClick={() => decreaseOrderQty(item.item_code)}>−</button>
                  <input type="number" min="0" step="1" inputMode="numeric" value={item.order_quantity} onChange={(e) => changeOrderQty(item.item_code, e.target.value)} />
                  <button type="button" className="auditQtyButton" onClick={() => increaseOrderQty(item.item_code)}>+</button>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="auditOrderGrandTotal">
          <strong>Grand Total : SAR {calculateGrandTotal(orderItems, priceList).toFixed(2)}</strong>
        </div>

        <div className="auditOrderReviewActions">
          <button type="button" className="auditSaveDraftButton" disabled={savingOrder || submittingOrder} onClick={saveDraft}>
            {savingOrder ? 'Saving...' : draftOrderId ? 'Update Draft' : 'Save Draft'}
          </button>
          <button type="button" className="auditSubmitOrderButton" disabled={savingOrder || submittingOrder} onClick={submitOrder}>
            {submittingOrder ? 'Submitting...' : 'Submit Final Order'}
          </button>
        </div>
      </div>
    </div>
  );
}
