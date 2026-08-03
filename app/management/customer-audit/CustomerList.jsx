"use client";
import React from "react";

export default function CustomerList({
  salesmen = [],
  filteredCustomers = [],
  selectedSalesman,
  setSelectedSalesman,
  search,
  setSearch,
  openCustomer,
  PAGE_VERSION,
  BUILD_COMMIT,
  error,
}) {
  return (
    <div>
      <div className="auditFilters">
        <div className="auditFilterField">
          <label>Salesman</label>
          <select value={selectedSalesman} onChange={(e) => setSelectedSalesman(e.target.value)}>
            <option value="ALL">All Salesmen</option>
            {salesmen.map((salesman) => (
              <option key={salesman} value={salesman}>
                {salesman}
              </option>
            ))}
          </select>
        </div>

        <div className="auditFilterField auditSearchField">
          <label>Search Customer</label>
          <input type="search" value={search} placeholder="Code or customer name..." onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      {error && <div className="auditError">{error}</div>}

      <div className="auditCustomerCount">
        <strong>{filteredCustomers.length}</strong> customers
      </div>

      <div className="auditCustomerList">
        {filteredCustomers.map((customer) => (
          <button
            type="button"
            className="auditCustomerCard"
            key={customer.customer_code}
            onClick={() => openCustomer(customer)}
          >
            <div className="auditCustomerCode">{customer.customer_code}</div>
            <div className="auditCustomerMain">
              <strong>{customer.customer_name}</strong>
              <span>{customer.current_salesman_code || "No salesman"}</span>
              <small>Last transaction: {shortDate(customer.latest_transaction_date)}</small>
            </div>
            <div className="auditCustomerArrow">›</div>
          </button>
        ))}
      </div>

      {filteredCustomers.length === 0 && <div className="auditEmpty">No customers match the current filters.</div>}

      <div className="auditVersion">Page updated: {PAGE_VERSION}</div>
    </div>
  );
}
