"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  Bell,
  PawPrint,
  Users,
  MapPin,
  FileText,
  Cpu,
  Settings,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/",           label: "Overview",         icon: LayoutDashboard },
  { href: "/alerts",     label: "Alerts",            icon: Bell,            badge: 3 },
  { href: "/animals",    label: "Animals",           icon: PawPrint },
  { href: "/borrowers",  label: "Borrowers",         icon: Users },
  { href: "/geofences",  label: "Geofences",         icon: MapPin },
  { href: "/reports",    label: "Reports",           icon: FileText },
  { href: "/devices",    label: "Devices",           icon: Cpu },
] as const;

const SETTINGS_ITEM = { href: "/settings", label: "Settings", icon: Settings };

interface NavItemProps {
  href: string;
  label: string;
  icon: React.ElementType;
  badge?: number;
  collapsed: boolean;
  active: boolean;
}

function NavItem({ href, label, icon: Icon, badge, collapsed, active }: NavItemProps) {
  return (
    <Link
      href={href}
      title={collapsed ? label : undefined}
      className={cn(
        "group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-150",
        "text-text-on-nav/70 hover:bg-white/10 hover:text-text-on-nav",
        active && "bg-brand text-white hover:bg-brand-hover",
        collapsed && "justify-center px-0"
      )}
    >
      <Icon size={20} strokeWidth={1.5} className="shrink-0" />

      {!collapsed && (
        <span className="truncate">{label}</span>
      )}

      {badge !== undefined && badge > 0 && (
        <span
          className={cn(
            "ml-auto flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-semibold tabular-nums",
            active ? "bg-white/25 text-white" : "bg-status-breach text-white"
          )}
        >
          {badge}
        </span>
      )}

      {collapsed && badge !== undefined && badge > 0 && (
        <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-status-breach" />
      )}
    </Link>
  );
}

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();

  const width = collapsed ? "w-[72px]" : "w-[240px]";

  return (
    <aside
      className={cn(
        "relative flex flex-col shrink-0 bg-bg-nav transition-[width] duration-200 ease-out",
        "border-r border-white/8",
        width
      )}
    >
      {/* Logo area */}
      <div className={cn(
        "flex h-16 items-center border-b border-white/8 px-4 shrink-0",
        collapsed && "justify-center px-0"
      )}>
        {collapsed ? (
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-brand text-white text-sm font-bold">
            B
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-brand text-white text-sm font-bold shrink-0">
              B
            </div>
            <div className="leading-tight">
              <div className="text-text-on-nav font-semibold text-sm">BOP</div>
              <div className="text-text-on-nav/50 text-[10px]">Bovine Track</div>
            </div>
          </div>
        )}
      </div>

      {/* Nav items */}
      <nav className="flex flex-col gap-1 flex-1 overflow-y-auto px-2 py-3">
        {NAV_ITEMS.map((item) => (
          <NavItem
            key={item.href}
            {...item}
            collapsed={collapsed}
            active={item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)}
          />
        ))}
      </nav>

      {/* Settings pinned bottom */}
      <div className="border-t border-white/8 px-2 py-3">
        <NavItem
          {...SETTINGS_ITEM}
          collapsed={collapsed}
          active={pathname.startsWith("/settings")}
        />
      </div>

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        className={cn(
          "absolute -right-3 top-20 z-10 flex h-6 w-6 items-center justify-center",
          "rounded-full border border-border bg-bg-surface text-text-secondary",
          "shadow-sm hover:text-text-primary transition-colors"
        )}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {collapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
      </button>
    </aside>
  );
}
