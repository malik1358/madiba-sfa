function normalizedValue(value) {
  return String(value ?? "").trim().toUpperCase();
}

function transactionSignature(row) {
  return [
    row?.transaction_date,
    row?.voucher_number,
    row?.reference,
    row?.customer_code,
    row?.item_code,
    row?.quantity,
    row?.sales_amount,
    row?.rate,
  ].map(normalizedValue).join("|");
}

export function mergeSalesSnapshots(rows) {
  const snapshotsByTransaction = new Map();

  (rows || []).forEach((row) => {
    const signature = transactionSignature(row);
    const batchKey = row?.import_batch_id == null
      ? `LEGACY:${row?.id || signature}`
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