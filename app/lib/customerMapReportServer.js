import { buildCustomerMapReport } from "./customerMapReport.js";

const CUSTOMER_MAP_SELECT = "customer_code,customer_name,current_salesman_code,city,area,latitude,longitude,is_active";
const PAGE_SIZE = 1000;

export async function fetchCustomerMapRows(admin) {
  const rows = [];
  let from = 0;

  while (true) {
    const { data, error } = await admin
      .from("customers")
      .select(CUSTOMER_MAP_SELECT)
      .order("customer_code", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return rows;
}

export async function loadCustomerMapReport(admin, filters = {}) {
  const rows = await fetchCustomerMapRows(admin);
  return buildCustomerMapReport(rows, filters);
}
