export const metadata = {
  title: "Privacy Policy | MADIBA SFA",
  description: "Privacy policy for the MADIBA Sales Force Automation Android app.",
  robots: { index: true, follow: true },
};

export default function PrivacyPolicyPage() {
  return (
    <main className="modulePage">
      <div className="moduleShell" style={{ maxWidth: 760 }}>
        <header className="moduleHeader">
          <div>
            <p className="moduleEyebrow">MADIBA SFA</p>
            <h1>Privacy Policy</h1>
            <p className="moduleSubtitle">Last updated: 28 August 2026</p>
          </div>
        </header>

        <section className="moduleSection">
          <p>
            MADIBA SFA (<code>com.madiba.sfa</code>) is a company sales-force app for authorized field staff
            in Saudi Arabia. It is not a consumer app. This policy explains what the Android app and
            related website collect and why.
          </p>

          <h2>Who can use the app</h2>
          <p>
            Access requires a company login issued by your employer. Customers of the business do not
            create accounts in this app.
          </p>

          <h2>Information we collect</h2>
          <ul>
            <li>
              <strong>Account details:</strong> email or username, name, salesman code, and role, used
              to sign you in and show the correct customers and menus.
            </li>
            <li>
              <strong>Location:</strong> GPS coordinates while you are logged in during a work session.
              Location may be collected in the background when field tracking is active, so attendance,
              visits, orders, and collections can be verified. Precise location is used.
            </li>
            <li>
              <strong>Work activity:</strong> visits, orders, collections, prospects, attendance, notes,
              and related business records.
            </li>
            <li>
              <strong>Photos and files:</strong> camera or gallery images you attach (for example payment
              receipts or visit photos).
            </li>
            <li>
              <strong>Device notices:</strong> a push-notification token so the company can send work
              alerts (inactivity reminders and transaction alerts). Battery-optimization status may be
              checked so tracking can keep running.
            </li>
          </ul>

          <h2>How we use this information</h2>
          <p>We use it only to run sales operations for your employer, including:</p>
          <ul>
            <li>signing you in and enforcing attendance and GPS rules</li>
            <li>recording field visits, orders, and collections</li>
            <li>showing managers maps and activity reports</li>
            <li>sending work notifications</li>
          </ul>
          <p>We do not sell personal data. We do not use it for advertising or unrelated profiling.</p>

          <h2>Sharing</h2>
          <p>
            Data is available to authorized company users (managers and administrators) inside MADIBA SFA.
            It is stored with our hosting and database providers (currently Vercel and Supabase) and, for
            push alerts, Google Firebase. Those providers process data on our instructions.
          </p>

          <h2>Security</h2>
          <p>
            Traffic uses HTTPS. Access is limited to signed-in staff. You should keep your password
            private and lock your phone.
          </p>

          <h2>Retention</h2>
          <p>
            Work records are kept for as long as the company needs them for operations, audit, or legal
            requirements. Device push tokens are kept while the app remains installed and the account is
            active.
          </p>

          <h2>Your choices</h2>
          <ul>
            <li>You can deny location, camera, or notification permission in Android settings. Some work functions will then be blocked.</li>
            <li>You can sign out to stop field tracking for that session.</li>
            <li>Ask your company administrator to correct account details or deactivate access when you leave.</li>
          </ul>

          <h2>Children</h2>
          <p>MADIBA SFA is for adult field staff (18+). It is not directed at children.</p>

          <h2>Contact</h2>
          <p>
            For privacy questions, contact your MADIBA administrator. The app listing package name is
            {" "}
            <code>com.madiba.sfa</code>.
          </p>
        </section>
      </div>
    </main>
  );
}
