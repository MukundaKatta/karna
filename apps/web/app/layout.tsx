import type { Metadata, Viewport } from "next";
import { Sidebar } from "@/components/Sidebar";
import "./globals.css";

export const metadata: Metadata = {
  title: "Karna - AI Agent Dashboard",
  description: "Admin dashboard and web chat interface for the Karna AI agent platform",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Karna",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#020617",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">
        <div className="flex h-dvh overflow-hidden">
          <Sidebar />
          <main className="flex-1 overflow-hidden min-w-0">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
