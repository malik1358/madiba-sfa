import "./globals.css";
import BuildUpdateWatcher from "./components/BuildUpdateWatcher";
import GlobalAppStatus from "./components/GlobalAppStatus";
import GlobalLogoutButton from "./components/GlobalLogoutButton";
import NativeFieldTracking from "./components/NativeFieldTracking";
import PwaShell from "./components/PwaShell";
import { AppPopupProvider } from "./components/AppPopupProvider";
import MorningAttendanceRedirect from "./components/MorningAttendanceRedirect";
import { resolveBuildId, resolveBuildTime, formatBuildDateTime } from "./lib/buildInfo";

export const metadata = {
  title: "MADIBA SFA",
  description: "KSA Sales Force Automation System",
  manifest: "/manifest.webmanifest",
  applicationName: "MADIBA SFA",
  appleWebApp: {
    capable: true,
    title: "MADIBA SFA",
    statusBarStyle: "default",
  },
  themeColor: "#073f4c",
  icons: {
    icon: "/icons/icon.svg",
    apple: "/icons/icon.svg",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#073f4c",
};

export default function RootLayout({ children }) {
  const isStaging = process.env.NEXT_PUBLIC_APP_ENV === "staging";
  const environment = isStaging ? "STAGING" : "PRODUCTION";
  const buildId = resolveBuildId();
  const buildTime = formatBuildDateTime(resolveBuildTime());

  return (
    <html lang="en">
      <body data-build-id={buildId} data-build-time={buildTime}>
        <AppPopupProvider>
          {isStaging && (
            <div className="environmentBanner" role="status">
              STAGING / UAT - TEST DATA ONLY
            </div>
          )}
          <BuildUpdateWatcher />
          <PwaShell />
          <NativeFieldTracking />
          <MorningAttendanceRedirect />
          <GlobalAppStatus environment={environment} buildId={buildId} buildTime={buildTime} />
          <GlobalLogoutButton />
          {children}
        </AppPopupProvider>
      </body>
    </html>
  );
}
