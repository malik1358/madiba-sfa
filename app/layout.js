import "./globals.css";
import GlobalAppStatus from "./components/GlobalAppStatus";
import GlobalLogoutButton from "./components/GlobalLogoutButton";

export const metadata = {
  title: "MADIBA SFA",
  description: "KSA Sales Force Automation System",
};

export default function RootLayout({ children }) {
  const isStaging = process.env.NEXT_PUBLIC_APP_ENV === "staging";
  const environment = isStaging ? "STAGING" : "PRODUCTION";
  const buildId = String(process.env.VERCEL_GIT_COMMIT_SHA || process.env.NEXT_PUBLIC_BUILD_ID || "local").slice(0, 7);

  return (
    <html lang="en">
      <body>
        {isStaging && (
          <div className="environmentBanner" role="status">
            STAGING / UAT - TEST DATA ONLY
          </div>
        )}
        <GlobalAppStatus environment={environment} buildId={buildId} />
        <GlobalLogoutButton />
        {children}
      </body>
    </html>
  );
}
