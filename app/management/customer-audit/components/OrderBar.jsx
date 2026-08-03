import { qtyFormat } from '../lib/format';

export default function OrderBar({ orderItems, orderSummary, savingOrder, submittingOrder, saveDraft, setShowOrderReview, priceList, draftOrderId }) {
  if (orderItems.length === 0) return null;

  const grandTotal = orderItems.reduce((sum, item) => sum + Number(priceList[String(item.item_code).trim().toUpperCase()] || 0) * Number(item.order_quantity), 0);

  return (
    <section className="auditOrderBar">
      <div className="auditOrderBarSummary">
        <span>Current Order</span>
        <strong>
          {orderSummary.itemCount} {orderSummary.itemCount === 1 ? 'item' : 'items'} • {qtyFormat(orderSummary.totalQuantity)} units<br />
          <strong>SAR {grandTotal.toFixed(2)}</strong>
        </strong>
      </div>

      <div className="auditOrderBarActions">
        <button type="button" className="auditDraftButton" disabled={savingOrder || submittingOrder} onClick={saveDraft}>
          {savingOrder ? 'Saving...' : draftOrderId ? 'Update Draft' : 'Save Draft'}
        </button>
        <button type="button" className="auditViewOrderButton" onClick={() => setShowOrderReview(true)}>
          View Order
        </button>
      </div>
    </section>
  );
}
