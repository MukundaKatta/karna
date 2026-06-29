"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  MessageSquare,
  LayoutDashboard,
  Users,
  History,
  Puzzle,
  Wrench,
  Brain,
  ShieldAlert,
  BarChart3,
  Settings,
  Store,
  ChevronDown,
  ChevronRight,
  PanelLeftClose,
  PanelLeft,
  Zap,
  Menu,
  X,
  Activity,
  GitBranch,
  LifeBuoy,
  LogOut,
  CreditCard,
  KeyRound,
  UserCircle,
  Coins,
  ClipboardCheck,
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

interface NavGroup {
  label: string;
  items: NavItem[];
}

export const navGroups: NavGroup[] = [
  {
    label: "Core",
    items: [
      { label: "Chat", href: "/chat", icon: <MessageSquare size={18} /> },
      {
        label: "Dashboard",
        href: "/dashboard",
        icon: <LayoutDashboard size={18} />,
        children: [
          { label: "Overview", href: "/dashboard", icon: <BarChart3 size={16} /> },
          { label: "Sessions", href: "/dashboard/sessions", icon: <History size={16} /> },
          { label: "Analytics", href: "/dashboard/analytics", icon: <BarChart3 size={16} /> },
          { label: "Usage", href: "/dashboard/usage", icon: <Coins size={16} /> },
          { label: "Evals", href: "/dashboard/evals", icon: <ClipboardCheck size={16} /> },
          { label: "Timeline", href: "/dashboard/timeline", icon: <Activity size={16} /> },
        ],
      },
      { label: "Workflows", href: "/workflows", icon: <GitBranch size={18} /> },
    ],
  },
  {
    label: "Management",
    items: [
      { label: "Agents", href: "/dashboard/agents", icon: <Users size={18} /> },
      { label: "Tools", href: "/dashboard/tools", icon: <Wrench size={18} /> },
      { label: "Skills", href: "/dashboard/skills", icon: <Puzzle size={18} /> },
      { label: "Marketplace", href: "/marketplace", icon: <Store size={18} /> },
      { label: "Memory", href: "/dashboard/memory", icon: <Brain size={18} /> },
      { label: "Moderation", href: "/dashboard/moderation", icon: <ShieldAlert size={18} /> },
      { label: "Observability", href: "/observability", icon: <Activity size={18} /> },
    ],
  },
  {
    label: "Settings",
    items: [
      { label: "Settings", href: "/dashboard/settings", icon: <Settings size={18} /> },
      { label: "API Keys", href: "/dashboard/settings#api-keys", icon: <KeyRound size={18} /> },
      { label: "Billing", href: "/dashboard/settings#billing", icon: <CreditCard size={18} /> },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { sidebarCollapsed, toggleSidebar, hydrateDashboardSettings } = useDashboardStore();
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(["Dashboard"]),
  );
  const [mobileOpen, setMobileOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);

  useEffect(() => {
    hydrateDashboardSettings();
  }, [hydrateDashboardSettings]);

  // Close mobile sidebar on route change
  useEffect(() => {
    setMobileOpen(false);
    setAccountOpen(false);
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

  const handleSignOut = async () => {
    try {
      await fetch("/api/auth/beta", { method: "DELETE" });
    } finally {
      router.push("/sign-in");
      router.refresh();
    }
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
        {navGroups.map((group) => (
          <div key={group.label} className="mb-4">
            {!sidebarCollapsed && (
              <div className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-dark-500">
                {group.label}
              </div>
            )}
            {group.items.map((item) => (
              <div key={item.href} className="mb-1">
                {item.children ? (
                  <>
                    <button
                      onClick={() => toggleSection(item.label)}
                      title={sidebarCollapsed ? item.label : undefined}
                      aria-label={sidebarCollapsed ? item.label : undefined}
                      className={cn(
                        "flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                        pathname.startsWith("/dashboard") && item.label === "Dashboard"
                          ? "text-white bg-dark-700/50"
                          : "text-dark-300 hover:text-white hover:bg-dark-700/50",
                      )}
                      aria-expanded={expandedSections.has(item.label)}
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
                            aria-current={isActive(child.href) ? "page" : undefined}
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
                    aria-current={isActive(item.href) ? "page" : undefined}
                    title={sidebarCollapsed ? item.label : undefined}
                    aria-label={sidebarCollapsed ? item.label : undefined}
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
          </div>
        ))}
      </nav>

      <div className="border-t border-dark-700 px-2 py-3">
        {!sidebarCollapsed && (
          <div className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-dark-500">
            Help
          </div>
        )}
        <div className="space-y-1">
          <Link
            href="/status"
            aria-current={isActive("/status") ? "page" : undefined}
            title={sidebarCollapsed ? "Status" : undefined}
            aria-label={sidebarCollapsed ? "Status" : undefined}
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-dark-300 hover:text-white hover:bg-dark-700/50 transition-colors"
          >
            <Activity size={18} />
            {!sidebarCollapsed && <span>Status</span>}
          </Link>
          <Link
            href="/support"
            aria-current={isActive("/support") ? "page" : undefined}
            title={sidebarCollapsed ? "Support" : undefined}
            aria-label={sidebarCollapsed ? "Support" : undefined}
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-dark-300 hover:text-white hover:bg-dark-700/50 transition-colors"
          >
            <LifeBuoy size={18} />
            {!sidebarCollapsed && <span>Support</span>}
          </Link>
          <button
            onClick={() => setAccountOpen((open) => !open)}
            className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm text-dark-300 hover:text-white hover:bg-dark-700/50 transition-colors"
            aria-expanded={accountOpen}
          >
            <UserCircle size={18} />
            {!sidebarCollapsed && (
              <>
                <span className="flex-1 text-left">Beta account</span>
                {accountOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </>
            )}
          </button>
          {!sidebarCollapsed && accountOpen && (
            <div className="ml-3 rounded-lg border border-dark-700 bg-dark-900/70 p-1">
              <Link
                href="/dashboard/settings"
                className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-dark-300 hover:bg-dark-700/60 hover:text-white"
              >
                <Settings size={15} />
                Account settings
              </Link>
              <button
                onClick={handleSignOut}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-dark-300 hover:bg-dark-700/60 hover:text-white"
              >
                <LogOut size={15} />
                Leave beta
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Collapse toggle (desktop only) */}
      <div className="border-t border-dark-700 p-2 hidden md:block">
        <button
          onClick={toggleSidebar}
          className="flex items-center justify-center w-full p-2 rounded-lg text-dark-400 hover:text-white hover:bg-dark-700/50 transition-colors"
          title="Toggle sidebar (Cmd/Ctrl /)"
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
        aria-label="Sidebar"
        aria-hidden={!mobileOpen}
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex flex-col bg-dark-800 border-r border-dark-700 w-72 transition-transform duration-200 ease-out md:hidden",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {sidebarContent}
      </aside>

      {/* Desktop sidebar — always visible */}
      <aside
        aria-label="Sidebar"
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
