function normalizedValue(value) {
  return String(value ?? "").trim().toUpperCase();
}

/**
 * Identity for a sales line across re-imports.
 * Rate is excluded on purpose: later uploads often correct pack/unit rate while
 * keeping the same qty + sales_amount. Including rate treated those as different
 * lines and double-counted vouchers (e.g. NFD/1337).
 */
function transactionSignature(row) {
  return [
    row?.transaction_date,
    row?.voucher_number,
    row?.reference,
    row?.customer_code,
    row?.item_code,
    row?.quantity,
    row?.sales_amount,
  ].map(normalizedValue).join("|");
}

export function mergeSalesSnapshots(rows) {
  const snapshotsByTransaction = new Map();

  (rows || []).forEach((row) => {
    const signature = transactionSignature(row);
    // Missing import_batch_id must share one LEGACY bucket. Per-id LEGACY keys
    // (LEGACY:<id>) dropped true duplicate lines inside active_sales — e.g. 1171C
    // NFD/57 Binding 1,959.63 and 2255 Sanding 160 — and Outstanding Compare
    // then understated SFA open by their VAT-incl total (2,437.58).
    const batchKey = row?.import_batch_id == null
      ? "LEGACY"
      : String(row.import_batch_id);
    const byBatch = snapshotsByTransaction.get(signature) || new Map();
    const batchRows = byBatch.get(batchKey) || [];
    batchRows.push(row);
    byBatch.set(batchKey, batchRows);
    snapshotsByTransaction.set(signature, byBatch);
  });

  return [...snapshotsByTransaction.values()].flatMap((byBatch) => {
    return [...byBatch.entries()]
      .sort(([batchA, rowsA], [batchB, rowsB]) => {
        if (rowsB.length !== rowsA.length) return rowsB.length - rowsA.length;
        return Number(batchB) - Number(batchA);
      })[0]?.[1] || [];
  });
}