"use client";

import { useState, useEffect } from "react";
import { Sidebar } from "./Sidebar";

export function ClientLayout({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="flex h-dvh overflow-hidden">
        <main className="flex-1 overflow-hidden min-w-0">
          {children}
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-dvh overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-hidden min-w-0">
        {children}
      </main>
    </div>
  );
}
