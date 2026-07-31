import "./globals.css";

export const metadata = {
  title: "MADIBA SFA",
  description: "KSA Sales Force Automation System",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
