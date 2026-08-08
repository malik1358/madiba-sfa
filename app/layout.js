import "./globals.css";
import GlobalLogoutButton from "./components/GlobalLogoutButton";

export const metadata = {
  title: "MADIBA SFA",
  description: "KSA Sales Force Automation System",
};

export default function RootLayout({ children }) {
  const isStaging = process.env.NEXT_PUBLIC_APP_ENV === "staging";

  return (
    <html lang="en">
      <body>
        {isStaging && (
          <div className="environmentBanner" role="status">
            STAGING / UAT - TEST DATA ONLY
          </div>
        )}
        <GlobalLogoutButton />
        {children}
      </body>
    </html>
  );
}
