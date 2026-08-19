import "./globals.css";
import BuildUpdateWatcher from "./components/BuildUpdateWatcher";
import GlobalAppStatus from "./components/GlobalAppStatus";
import GlobalLogoutButton from "./components/GlobalLogoutButton";
import { resolveBuildId } from "./lib/buildInfo";

export const metadata = {
  title: "MADIBA SFA",
  description: "KSA Sales Force Automation System",
};

export default function RootLayout({ children }) {
  const isStaging = process.env.NEXT_PUBLIC_APP_ENV === "staging";
  const environment = isStaging ? "STAGING" : "PRODUCTION";
  const buildId = resolveBuildId();

  return (
    <html lang="en">
      <body data-build-id={buildId}>
        {isStaging && (
          <div className="environmentBanner" role="status">
            STAGING / UAT - TEST DATA ONLY
          </div>
        )}
        <BuildUpdateWatcher />
        <GlobalAppStatus environment={environment} buildId={buildId} />
        <GlobalLogoutButton />
        {children}
      </body>
    </html>
  );
}
