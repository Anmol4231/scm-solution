import type { Metadata } from "next";
import { AuthProvider } from "@/lib/auth-context";
import "./globals.css";

export const metadata: Metadata = {
  title: "StockTrackRx - Healthcare Supply Chain Platform",
  description: "Medicine inventory and dispensing for healthcare facilities",
  manifest: "/manifest.json",
  themeColor: "#1a3a6e",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "StockTrackRx",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="apple-touch-icon" href="/icons/meditrack-logo.jpeg" />
        <link rel="icon" href="/icons/icon.svg" type="image/svg+xml" />
      </head>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
