"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "./Sidebar";
import { KeyboardShortcuts } from "./KeyboardShortcuts";
import { ThemeToggle } from "./ThemeToggle";

export function ClientLayout({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();
  const isPublicRoute = ["/privacy", "/terms", "/support", "/status", "/sign-in"].includes(pathname);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || isPublicRoute) {
    return (
      <div className="flex min-h-dvh overflow-hidden bg-dark-900">
        <main key={pathname} className="flex-1 overflow-hidden min-w-0">
          {children}
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-dvh overflow-hidden">
      <Sidebar />
      <main key={pathname} className="flex-1 overflow-hidden min-w-0">
        <div className="pointer-events-none fixed right-4 top-4 z-30 flex justify-end md:right-6">
          <div className="pointer-events-auto">
            <ThemeToggle />
          </div>
        </div>
        {children}
      </main>
      <KeyboardShortcuts />
    </div>
  );
}
