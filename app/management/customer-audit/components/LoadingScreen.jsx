export default function LoadingScreen({ title, subtitle }) {
  return (
    <main className="auditPage">
      <div className="auditShell">
        <div className="auditBrand">MADIBA SFA</div>
        <h1>{title}</h1>
        <p className="auditSubtitle">{subtitle}</p>
      </div>
    </main>
  );
}
