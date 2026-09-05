import { numberFormat, qtyFormat, shortDate } from '../lib/format';
import ExportableTable from '../../../components/ExportableTable';

export default function TransactionHistory({ transactions, analytics }) {
  return (
    <section className="auditSection">
      <div className="auditTransactionHeader">
        <div>
          <h3>Transaction History</h3>
          <p className="auditSectionNote">Full source transaction history for this customer.</p>
        </div>
        <span className="auditTransactionCount">{analytics.transactionCount} transactions</span>
      </div>

      <ExportableTable filename="customer-transaction-history" sheetName="Transactions" className="auditTableScroll">
        <table className="auditTransactionTable">
          <thead>
            <tr>
              <th>Date</th>
              <th>Voucher</th>
              <th>Item Code</th>
              <th>Item</th>
              <th>Category</th>
              <th>Qty</th>
              <th>Sales</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((row) => (
              <tr key={row.id}>
                <td>{shortDate(row.transaction_date)}</td>
                <td>{row.voucher_number || row.reference || '—'}</td>
                <td>{row.item_code || '—'}</td>
                <td>{row.item_name || '—'}</td>
                <td>{row.category || 'Unclassified'}</td>
                <td className={`auditNumberCell ${Number(row.quantity) < 0 ? 'auditNegativeValue' : ''}`}>{qtyFormat(row.quantity)}</td>
                <td className={`auditNumberCell ${Number(row.sales_amount) < 0 ? 'auditNegativeValue' : ''}`}>{numberFormat(row.sales_amount)}</td>
              </tr>
            ))}
            {transactions.length === 0 && (
              <tr>
                <td colSpan={7}>No transactions found for this customer.</td>
              </tr>
            )}
          </tbody>
        </table>
      </ExportableTable>
    </section>
  );
}
