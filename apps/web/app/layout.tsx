import type { Metadata, Viewport } from "next";
import { ClientLayout } from "@/components/ClientLayout";
import "./globals.css";

// Force dynamic rendering for all pages to avoid static prerender issues
// with client components (Sidebar, Zustand store)
export const dynamic = "force-dynamic";

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
      <body className="antialiased bg-dark-900">
        <ClientLayout>{children}</ClientLayout>
      </body>
    </html>
  );
}
