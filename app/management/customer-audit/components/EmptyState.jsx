export default function EmptyState({ title, message, action }) {
  return (
    <div className="auditEmpty">
      <strong>{title}</strong>
      {message && <div>{message}</div>}
      {action}
    </div>
  );
}
