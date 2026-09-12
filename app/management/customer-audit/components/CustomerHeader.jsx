export default function CustomerHeader({ customer, analytics, outstandingSalesman = "" }) {
  const salesmanLabel = String(outstandingSalesman || "").trim()
    || String(customer.current_salesman_code || "").trim()
    || "NO SALESMAN";

  return (
    <section className="auditCustomerHero">
      <div className="auditHeroCode">{customer.customer_code}</div>
      <h2>
        {customer.customer_code} {customer.customer_name}
      </h2>
      <div className="auditHeroSalesman">{salesmanLabel}</div>

      <section className="auditSummaryGrid">
        <div className="auditSummaryCard">
          <span>Orders</span>
          <strong>{analytics.orderCount}</strong>
        </div>
        <div className="auditSummaryCard">
          <span>Last Purchase</span>
          <strong>{analytics.latestDate}</strong>
        </div>
      </section>
    </section>
  );
}
