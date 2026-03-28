"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  MessageSquare,
  LayoutDashboard,
  Users,
  History,
  Puzzle,
  Wrench,
  Brain,
  BarChart3,
  Settings,
  ChevronDown,
  ChevronRight,
  PanelLeftClose,
  PanelLeft,
  Zap,
  Menu,
  X,
} from "lucide-react";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useDashboardStore } from "@/lib/store";

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  children?: NavItem[];
}

const navItems: NavItem[] = [
  {
    label: "Chat",
    href: "/chat",
    icon: <MessageSquare size={18} />,
  },
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: <LayoutDashboard size={18} />,
    children: [
      { label: "Overview", href: "/dashboard", icon: <BarChart3 size={16} /> },
      { label: "Agents", href: "/dashboard/agents", icon: <Users size={16} /> },
      { label: "Sessions", href: "/dashboard/sessions", icon: <History size={16} /> },
      { label: "Skills", href: "/dashboard/skills", icon: <Puzzle size={16} /> },
      { label: "Tools", href: "/dashboard/tools", icon: <Wrench size={16} /> },
      { label: "Memory", href: "/dashboard/memory", icon: <Brain size={16} /> },
      { label: "Analytics", href: "/dashboard/analytics", icon: <BarChart3 size={16} /> },
    ],
  },
  {
    label: "Settings",
    href: "/dashboard/settings",
    icon: <Settings size={18} />,
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const { sidebarCollapsed, toggleSidebar } = useDashboardStore();
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(["Dashboard"]),
  );
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close mobile sidebar on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Close on escape key
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, []);

  // Prevent body scroll when mobile sidebar is open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  const toggleSection = (label: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(label)) {
        next.delete(label);
      } else {
        next.add(label);
      }
      return next;
    });
  };

  const isActive = (href: string) => {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname.startsWith(href);
  };

  const sidebarContent = (
    <>
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 h-14 border-b border-dark-700 shrink-0">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-accent-600 text-white">
          <Zap size={18} />
        </div>
        {!sidebarCollapsed && (
          <span className="text-lg font-semibold text-white tracking-tight">
            Karna
          </span>
        )}
        {/* Mobile close button */}
        <button
          onClick={() => setMobileOpen(false)}
          className="ml-auto p-1.5 rounded-lg text-dark-400 hover:text-white md:hidden"
        >
          <X size={20} />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3 px-2">
        {navItems.map((item) => (
          <div key={item.label} className="mb-1">
            {item.children ? (
              <>
                <button
                  onClick={() => toggleSection(item.label)}
                  className={cn(
                    "flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                    pathname.startsWith("/dashboard") && item.label === "Dashboard"
                      ? "text-white bg-dark-700/50"
                      : "text-dark-300 hover:text-white hover:bg-dark-700/50",
                  )}
                >
                  {item.icon}
                  {!sidebarCollapsed && (
                    <>
                      <span className="flex-1 text-left">{item.label}</span>
                      {expandedSections.has(item.label) ? (
                        <ChevronDown size={14} />
                      ) : (
                        <ChevronRight size={14} />
                      )}
                    </>
                  )}
                </button>
                {!sidebarCollapsed && expandedSections.has(item.label) && (
                  <div className="ml-4 mt-1 space-y-0.5">
                    {item.children.map((child) => (
                      <Link
                        key={child.href}
                        href={child.href}
                        className={cn(
                          "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors",
                          isActive(child.href)
                            ? "text-accent-400 bg-accent-600/10"
                            : "text-dark-400 hover:text-white hover:bg-dark-700/40",
                        )}
                      >
                        {child.icon}
                        <span>{child.label}</span>
                      </Link>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <Link
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                  isActive(item.href)
                    ? "text-accent-400 bg-accent-600/10"
                    : "text-dark-300 hover:text-white hover:bg-dark-700/50",
                )}
              >
                {item.icon}
                {!sidebarCollapsed && <span>{item.label}</span>}
              </Link>
            )}
          </div>
        ))}
      </nav>

      {/* Collapse toggle (desktop only) */}
      <div className="border-t border-dark-700 p-2 hidden md:block">
        <button
          onClick={toggleSidebar}
          className="flex items-center justify-center w-full p-2 rounded-lg text-dark-400 hover:text-white hover:bg-dark-700/50 transition-colors"
        >
          {sidebarCollapsed ? <PanelLeft size={18} /> : <PanelLeftClose size={18} />}
        </button>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile hamburger button — fixed top-left */}
      <button
        onClick={() => setMobileOpen(true)}
        className={cn(
          "fixed top-3 left-3 z-50 p-2 rounded-lg bg-dark-800 border border-dark-700 text-dark-300 hover:text-white md:hidden",
          mobileOpen && "hidden",
        )}
        aria-label="Open menu"
      >
        <Menu size={20} />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile sidebar — slides in from left */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex flex-col bg-dark-800 border-r border-dark-700 w-72 transition-transform duration-200 ease-out md:hidden",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {sidebarContent}
      </aside>

      {/* Desktop sidebar — always visible */}
      <aside
        className={cn(
          "hidden md:flex flex-col h-screen bg-dark-800 border-r border-dark-700 transition-all duration-200",
          sidebarCollapsed ? "w-16" : "w-60",
        )}
      >
        {sidebarContent}
      </aside>
    </>
  );
}
