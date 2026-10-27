import { qtyFormat } from '../lib/format';

export default function OrderBar({
  orderItems,
  orderSummary,
  savingOrder,
  submittingOrder,
  deletingDraft = false,
  saveDraft,
  deleteDraft = null,
  setShowOrderReview,
  priceList,
  draftOrderId,
  loadedOrderStatus = 'DRAFT',
  orderWriteBlocked = false,
}) {
  if (orderItems.length === 0) return null;

  const grandTotal = orderItems.reduce((sum, item) => sum + Number(priceList[String(item.item_code).trim().toUpperCase()] || 0) * Number(item.order_quantity), 0);
  const canDeleteDraft = Boolean(draftOrderId)
    && String(loadedOrderStatus || 'DRAFT').toUpperCase() === 'DRAFT'
    && typeof deleteDraft === 'function';

  return (
    <section className="auditOrderBar">
      <div className="auditOrderBarSummary">
        <span>Current Order</span>
        <strong>
          {orderSummary.itemCount} {orderSummary.itemCount === 1 ? 'item' : 'items'} • {qtyFormat(orderSummary.totalQuantity)} units<br />
          <strong>{grandTotal.toLocaleString('en-US', { maximumFractionDigits: 0 })}</strong>
        </strong>
      </div>

      <div className="auditOrderBarActions">
        <button type="button" className="auditDraftButton" disabled={savingOrder || submittingOrder || deletingDraft || orderWriteBlocked} onClick={saveDraft}>
          {savingOrder ? 'Saving...' : draftOrderId ? 'Update Draft' : 'Save Draft'}
        </button>
        {canDeleteDraft ? (
          <button
            type="button"
            className="auditDeleteDraftButton"
            disabled={savingOrder || submittingOrder || deletingDraft}
            onClick={deleteDraft}
          >
            {deletingDraft ? 'Deleting...' : 'Delete Draft'}
          </button>
        ) : null}
        <button type="button" className="auditViewOrderButton" onClick={() => setShowOrderReview(true)}>
          View Order
        </button>
      </div>
    </section>
  );
}
