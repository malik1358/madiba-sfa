import "./globals.css";
import GlobalLogoutButton from "./components/GlobalLogoutButton";

export const metadata = {
  title: "MADIBA SFA",
  description: "KSA Sales Force Automation System",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <GlobalLogoutButton />
        {children}
      </body>
    </html>
  );
}
