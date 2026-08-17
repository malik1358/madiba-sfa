import { qtyFormat } from '../lib/format';

export default function QuickOrder({ quickOrderSuggestions, orderQuantities, decreaseOrderQty, increaseOrderQty, changeOrderQty, priceList }) {
  const quickOrderAllItems = [
    ...quickOrderSuggestions.newItems,
    ...quickOrderSuggestions.notBoughtRecently,
    ...quickOrderSuggestions.buyingLess,
  ];

  return (
    <section className="auditSection auditQuickOrderSection">
      <div className="auditQuickOrderHeading">
        <div>
          <h3>Quick Order</h3>
          <p>Suggested items based on this customer's purchase history.</p>
        </div>
        <span className="auditQuickOrderCount">{quickOrderAllItems.length} suggestions</span>
      </div>

      {quickOrderAllItems.length === 0 ? (
        <div className="auditEmpty">No quick-order suggestions available for this customer.</div>
      ) : (
        <div className="auditQuickOrderGroups">
          {[
            { key: 'newItems', title: 'New Items', subtitle: 'Items this customer has never bought', items: quickOrderSuggestions.newItems },
            { key: 'notBoughtRecently', title: 'Not Bought Since Long', subtitle: 'Previously purchased items with the oldest last purchase', items: quickOrderSuggestions.notBoughtRecently },
            { key: 'buyingLess', title: 'Buying Less', subtitle: 'Items currently buying below their historical average quantity', items: quickOrderSuggestions.buyingLess },
          ].map((group) => (
            <div key={group.key} className="auditQuickOrderGroup">
              <div className="auditQuickOrderGroupHeader">
                <div>
                  <strong>{group.title}</strong>
                  <span>{group.subtitle}</span>
                </div>
                <b>{group.items.length}</b>
              </div>

              {group.items.length === 0 ? (
                <div className="auditQuickOrderEmpty">
                  {group.key === 'buyingLess' && quickOrderSuggestions.historyMonthCount < 2
                    ? 'At least 2 months of purchase history are required.'
                    : 'No suggestion'}
                </div>
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
                        return (
                          <tr key={`${group.key}-${item.item_code}`}>
                            <td>
                              <div className="auditQuickItemCode">{item.item_code}</div>
                              <strong className="auditQuickItemName">{item.item_name}</strong>
                            </td>
                            <td>{item.category || 'Unclassified'}</td>
                            <td>
                              {group.key === 'newItems' && <span className="auditQuickBadge auditQuickBadgeNew">{item.recommendationReason}</span>}
                              {group.key === 'buyingLess' && (
                                <div className="auditQuickHistory">
                                  <span>Avg Qty / Month</span>
                                  <strong>{qtyFormat(item.avgQty)}</strong>
                                  <span>Months Bought</span>
                                  <strong>{item.activeMonths}</strong>
                                  <span>Latest Qty</span>
                                  <strong className="auditQuickDecline">{qtyFormat(item.latestQty)}</strong>
                                </div>
                              )}
                              {group.key === 'buyingLess' && (
                                <div className="auditQuickHistory">
                                  <span>Previous 3 months</span>
                                  <strong>{qtyFormat(item.previousQty)}</strong>
                                  <span>Recent 3 months</span>
                                  <strong className="auditQuickDecline">{qtyFormat(item.recentQty)}</strong>
                                </div>
                              )}
                            </td>
                            <td className="auditQuickRate">
                              {priceList[String(item.item_code).trim().toUpperCase()] ? Number(priceList[String(item.item_code).trim().toUpperCase()]).toLocaleString('en-US', { maximumFractionDigits: 0 }) : 'NOT FOUND'}
                            </td>
                            <td>
                              <div className="auditQtyControl">
                                <button type="button" className="auditQtyButton" onClick={() => decreaseOrderQty(item.item_code)}>−</button>
                                <input type="number" min="0" step="1" inputMode="numeric" value={orderQty || ''} placeholder="0" onChange={(e) => changeOrderQty(item.item_code, e.target.value)} />
                                <button type="button" className="auditQtyButton" onClick={() => increaseOrderQty(item.item_code)}>+</button>
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
