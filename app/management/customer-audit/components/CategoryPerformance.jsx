import { Fragment } from 'react';
import { monthName, numberFormat, qtyFormat, trendClass } from '../lib/format';
import { isDoNotUseItem } from '../lib/helpers';

export default function CategoryPerformance({ analytics, itemCatalog = [], expandedCategories, toggleCategory, orderQuantities, decreaseOrderQty, increaseOrderQty, changeOrderQty, priceList }) {
  const catalogByCode = new Map(
    itemCatalog.map((item) => [String(item.item_code || '').trim().toUpperCase(), item])
  );

  return (
    <section className="auditSection">
      <div className="auditCategoryTitle">
        <span>Category Performance by Month</span>
        <small>Tap a category to view items and place an order.</small>
      </div>
      <div className="auditTableScroll">
        <table className="auditMatrix auditCategoryMatrixV3">
          <thead>
            <tr className="auditYearRow">
              <th rowSpan="2" className="auditCategoryHeader">Category</th>
              <th rowSpan="2" className="auditCategoryMetricHeader">Metric</th>
              {analytics.yearGroups.map((group) => (
                <th key={group.year} colSpan={group.months.length} className="auditYearHeader">{group.year}</th>
              ))}
              <th rowSpan="2" className="auditTotalHeader">Total</th>
            </tr>
            <tr className="auditMonthRow">
              {analytics.months.map((month) => (
                <th key={month}>{monthName(month)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {analytics.categories.map((category) => {
              const isExpanded = Boolean(expandedCategories[category.category]);

              return (
                <Fragment key={category.category}>
                  <tr className="auditCategorySalesRow">
                    <th rowSpan="2" className="auditMergedCategory auditClickableCategory" onClick={() => toggleCategory(category.category)}>
                      <button type="button" className="auditCategoryToggle" onClick={(e) => {
                        e.stopPropagation();
                        toggleCategory(category.category);
                      }}>
                        <span className="auditCategoryArrow">{isExpanded ? '▼' : '▶'}</span>
                        <span>{category.category}</span>
                      </button>
                    </th>
                    <th className="auditCategoryMetric">Sales</th>
                    {analytics.months.map((month, index) => {
                      const current = category.months[month]?.sales || 0;
                      const previous = index > 0 ? category.months[analytics.months[index - 1]]?.sales || 0 : 0;
                      return (
                        <td key={month} className={trendClass(current, previous, index > 0)}>
                          {current ? numberFormat(current) : '—'}
                        </td>
                      );
                    })}
                    <td className="auditMatrixTotal">{numberFormat(category.totalSales)}</td>
                  </tr>

                  <tr className="auditCategorySkuRow">
                    <th className="auditCategoryMetric">SKUs Sold</th>
                    {analytics.months.map((month, index) => {
                      const current = category.months[month]?.skuCount || 0;
                      const previous = index > 0 ? category.months[analytics.months[index - 1]]?.skuCount || 0 : 0;
                      return (
                        <td key={month} className={trendClass(current, previous, index > 0)}>
                          {current || '—'}
                        </td>
                      );
                    })}
                    <td className="auditMatrixTotal">{category.totalSkuCount}</td>
                  </tr>

                  {isExpanded && (
                    <tr className="auditExpandedItemsRow">
                      <td colSpan={analytics.months.length + 3} className="auditExpandedItemsCell">
                        <div className="auditExpandedCategory">
                          <div className="auditExpandedCategoryHeader">
                            <div>
                              <strong>{category.category}</strong>
                              <span>{category.items.length} items</span>
                            </div>
                            <button type="button" className="auditCollapseButton" onClick={() => toggleCategory(category.category)}>
                              Close
                            </button>
                          </div>

                          {category.items.length === 0 ? (
                            <div className="auditEmpty">No items found in this category.</div>
                          ) : (
                            <div className="auditItemTableScroll">
                              <table className="auditItemMatrix">
                                <thead>
                                  <tr className="auditItemYearRow">
                                    <th rowSpan="2" className="auditItemNameHeader">Item</th>
                                    <th rowSpan="2" className="auditItemMetricHeader">Metric</th>
                                    {analytics.yearGroups.map((group) => (
                                      <th key={group.year} colSpan={group.months.length}>{group.year}</th>
                                    ))}
                                    <th rowSpan="2" className="auditItemTotalHeader">Total</th>
                                    <th rowSpan="2" className="auditRateHeader">Rate</th>
                                    <th rowSpan="2" className="auditOrderQtyHeader">Order Qty</th>
                                  </tr>
                                  <tr className="auditItemMonthRow">
                                    {analytics.months.map((month) => (
                                      <th key={month}>{monthName(month)}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {category.items.map((item) => {
                                    const orderQty = Number(orderQuantities[item.item_code] || 0);
                                    const catalogItem = catalogByCode.get(String(item.item_code || '').trim().toUpperCase());
                                    const currentName = String(catalogItem?.item_name || '').trim();
                                    const hasCurrentReplacement = Boolean(currentName) && !isDoNotUseItem(currentName);
                                    const displayName = hasCurrentReplacement ? currentName : item.item_name;
                                    const isNotOrderable = isDoNotUseItem(displayName);
                                    return (
                                      <Fragment key={item.item_key}>
                                        <tr className="auditItemValueRow">
                                          <th rowSpan="2" className="auditItemNameCell">
                                            <div className="auditItemCode">{item.item_code}</div>
                                            <div className="auditItemName">{displayName}</div>
                                            {item.abc_class && <div className="auditItemABC">{item.abc_class}</div>}
                                            {isNotOrderable && <div className="auditItemABC">Do Not Use</div>}
                                          </th>
                                          <th className="auditItemMetricCell">Value</th>
                                          {analytics.months.map((month, index) => {
                                            const current = item.months[month]?.value || 0;
                                            const previous = index > 0 ? item.months[analytics.months[index - 1]]?.value || 0 : 0;
                                            return (
                                              <td key={month} className={trendClass(current, previous, index > 0)}>
                                                {current ? numberFormat(current) : '—'}
                                              </td>
                                            );
                                          })}
                                          <td className="auditItemTotal">{numberFormat(item.total_value)}</td>
                                          <td rowSpan="2" className="auditRateCell">
                                            <span>
                                              {priceList[String(item.item_code).trim().toUpperCase()] ? `SAR ${Number(priceList[String(item.item_code).trim().toUpperCase()]).toFixed(2)}` : '—'}
                                            </span>
                                          </td>
                                          <td rowSpan="2" className={isNotOrderable ? "auditOrderQtyCell auditCategoryNoOrder" : "auditOrderQtyCell"}>
                                            {isNotOrderable ? (
                                              <span>Not orderable</span>
                                            ) : (
                                              <div className="auditQtyControl">
                                                <button type="button" className="auditQtyButton" onClick={() => decreaseOrderQty(item.item_code)}>−</button>
                                                <input type="number" min="0" step="1" inputMode="numeric" value={orderQty || ''} placeholder="0" onChange={(e) => changeOrderQty(item.item_code, e.target.value)} />
                                                <button type="button" className="auditQtyButton" onClick={() => increaseOrderQty(item.item_code)}>+</button>
                                              </div>
                                            )}
                                          </td>
                                        </tr>
                                        <tr className="auditItemQtyRow">
                                          <th className="auditItemMetricCell">Qty</th>
                                          {analytics.months.map((month, index) => {
                                            const current = item.months[month]?.quantity || 0;
                                            const previous = index > 0 ? item.months[analytics.months[index - 1]]?.quantity || 0 : 0;
                                            return (
                                              <td key={month} className={trendClass(current, previous, index > 0)}>
                                                {current ? qtyFormat(current) : '—'}
                                              </td>
                                            );
                                          })}
                                          <td className="auditItemTotal">{qtyFormat(item.total_quantity)}</td>
                                        </tr>
                                      </Fragment>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
