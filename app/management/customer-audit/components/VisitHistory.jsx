import ExportableTable from "../../../components/ExportableTable";
import { formatKsaDateTime } from "../../../lib/workdayActivity";

function formatAmount(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount <= 0) return "—";
  return amount.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

export default function VisitHistory({ visits = [], loading = false }) {
  const rows = Array.isArray(visits) ? visits : [];

  return (
    <section className="auditSection">
      <div className="auditTransactionHeader">
        <div>
          <h3>Visit History</h3>
          <p className="auditSectionNote">
            All field and collection visits for this customer by any user, with date and outcome.
          </p>
        </div>
        <span className="auditTransactionCount">
          {loading ? "Loading..." : `${rows.length} visit${rows.length === 1 ? "" : "s"}`}
        </span>
      </div>

      {loading ? (
        <div className="auditEmpty">Loading visits...</div>
      ) : (
        <ExportableTable filename="customer-visit-history" sheetName="Visits" className="moduleTableWrap" style={{ marginTop: "10px" }}>
          <table className="moduleTable moduleBiTable">
            <thead>
              <tr>
                <th>Date</th>
                <th>User</th>
                <th>Type</th>
                <th>Outcome</th>
                <th>Amount</th>
                <th>Next Visit</th>
                <th>Remark</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((visit) => (
                <tr key={visit.id || `${visit.savedAt}-${visit.userId}-${visit.outcome}`}>
                  <td>{visit.savedAt ? formatKsaDateTime(visit.savedAt) : "—"}</td>
                  <td>{visit.userName || "—"}</td>
                  <td>{visit.typeLabel || visit.type || "—"}</td>
                  <td>{visit.outcomeLabel || visit.outcome || "—"}</td>
                  <td>{formatAmount(visit.amountReceived)}</td>
                  <td>{visit.nextVisitAt || "—"}</td>
                  <td>{visit.remark || "—"}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7}>No visits recorded for this customer.</td>
                </tr>
              )}
            </tbody>
          </table>
        </ExportableTable>
      )}
    </section>
  );
}
