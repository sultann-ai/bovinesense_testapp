"use client";

import { useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Check, ChevronDown, LogOut } from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { cn } from "@/lib/utils";
import { ROLE_LABELS, ROLE_SHORT_LABELS, type AppRole } from "@/lib/permissions";
import { initialsOfName } from "@/lib/branding";
import { LiveIndicator } from "@/components/realtime/LiveIndicator";
import { useLive } from "@/components/realtime/RealtimeProvider";
import { GlobalSearch } from "./GlobalSearch";
import { ScopeSelector } from "./ScopeSelector";
import { TenantLogo } from "./TenantLogo";
import { useTenant } from "./TenantProvider";

/**
 * The top bar (64 px): the tenant's logo and name with "Powered by BovineSense"; one global search;
 * the region / branch scope selector; the live status; the alert bell with the live count; the user
 * menu with the person's role and the organization switcher.
 */
export interface SwitchableOrganization {
  id: string;
  name: string;
}

interface TopBarProps {
  user: { name: string | null; email: string | null };
  role: AppRole;
  activeOrganizationId: string;
  /** Organizations the user may switch to (the menu offers the switcher when there is more than one). */
  organizations: SwitchableOrganization[];
}

function initialsOf(name: string | null, email: string | null): string {
  const source = (name ?? "").trim() || (email ?? "").split("@")[0] || "?";
  return initialsOfName(source.replace(/[._-]+/g, " "));
}

export function TopBar({ user, role, activeOrganizationId, organizations }: TopBarProps) {
  const tenant = useTenant();
  const { newAlertCount: alertCount } = useLive();
  const pathname = usePathname();
  const signOutForm = useRef<HTMLFormElement>(null);
  const switchForm = useRef<HTMLFormElement>(null);
  const switchTarget = useRef<HTMLInputElement>(null);

  const displayName = user.name?.trim() || user.email || "Signed in";
  const canSwitch = organizations.length > 1;

  function switchTo(id: string) {
    if (id === activeOrganizationId || !switchTarget.current) return;
    switchTarget.current.value = id;
    switchForm.current?.requestSubmit();
  }

  return (
    <header data-testid="topbar" className="z-20 flex h-16 shrink-0 items-center gap-4 border-b border-border bg-bg-surface px-6">
      {/* Sign-out and organization switching are plain form POSTs (303 back into the app) */}
      <form ref={signOutForm} method="post" action="/auth/signout" className="hidden" />
      <form ref={switchForm} method="post" action="/org/select" className="hidden">
        <input ref={switchTarget} type="hidden" name="organization_id" defaultValue="" />
        <input type="hidden" name="next" value={pathname} readOnly />
      </form>

      {/* The tenant, powered by the product */}
      <div className="flex shrink-0 items-center gap-3" data-testid="tenant-brand">
        <TenantLogo name={tenant.name} logoUrl={tenant.logoUrl} />
        <div className="leading-tight">
          <div className="text-sm font-semibold text-text-primary" data-testid="tenant-name">{tenant.name}</div>
          <div className="text-xs text-text-secondary">Powered by BovineSense</div>
        </div>
      </div>

      <div aria-hidden className="mx-1 h-6 w-px bg-border" />

      <GlobalSearch />
      <ScopeSelector />

      <div className="flex-1" />

      <LiveIndicator />

      {/* Alert bell: the number of open alerts in the current scope, live; opens the Alerts screen */}
      <Link
        href="/alerts"
        data-testid="bell"
        className="relative flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] text-text-secondary outline-none transition-colors hover:bg-bg-sunken hover:text-text-primary focus-visible:ring-2 focus-visible:ring-brand/40"
        aria-label={alertCount === 1 ? "1 open alert" : `${alertCount} open alerts`}
      >
        <Bell size={20} strokeWidth={1.5} />
        {alertCount > 0 && (
          <span
            data-testid="bell-badge"
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-status-breach px-1 text-[10px] font-semibold tabular-nums text-white"
          >
            {alertCount > 99 ? "99+" : alertCount}
          </span>
        )}
      </Link>

      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            aria-label="Account menu"
            className={cn(
              "flex h-11 items-center gap-2 rounded-[var(--radius-sm)] border border-border bg-bg-surface px-3 text-sm text-text-primary",
              "outline-none transition-colors hover:bg-bg-sunken focus-visible:ring-2 focus-visible:ring-brand/40",
            )}
          >
            <span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-tint text-xs font-semibold text-brand-hover">{initialsOf(user.name, user.email)}</span>
            <span className="flex min-w-0 flex-col items-start text-left leading-tight">
              <span data-testid="account-name" className="max-w-[160px] truncate text-sm font-medium">{displayName}</span>
              <span data-testid="account-role" className="text-[11px] text-text-secondary">{ROLE_SHORT_LABELS[role]}</span>
            </span>
            <ChevronDown size={14} strokeWidth={1.5} className="text-text-secondary" />
          </button>
        </DropdownMenu.Trigger>

        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className="z-50 min-w-[260px] rounded-[var(--radius-md)] border border-border bg-bg-surface p-1 shadow-[var(--shadow-float)]"
            sideOffset={6}
            align="end"
          >
            <div className="px-2 py-2" data-testid="account-summary">
              <div className="truncate text-sm font-medium text-text-primary">{displayName}</div>
              {user.name && user.email && <div className="truncate text-xs text-text-secondary">{user.email}</div>}
              <div className="mt-1 truncate text-xs text-text-secondary">{ROLE_LABELS[role]} · {tenant.name}</div>
            </div>

            {canSwitch && (
              <>
                <DropdownMenu.Separator className="my-1 h-px bg-border" />
                <DropdownMenu.Label className="px-2 py-1 text-xs font-medium uppercase tracking-[0.04em] text-text-secondary">Switch organization</DropdownMenu.Label>
                {organizations.map((o) => (
                  <DropdownMenu.Item
                    key={o.id}
                    onSelect={() => switchTo(o.id)}
                    data-testid={`switch-org-${o.id}`}
                    className="flex cursor-pointer items-center justify-between gap-3 rounded-[var(--radius-sm)] px-2 py-2 text-sm text-text-primary outline-none data-[highlighted]:bg-bg-sunken"
                  >
                    <span className="truncate">{o.name}</span>
                    {o.id === activeOrganizationId && <Check size={14} strokeWidth={1.5} aria-label="Current organization" className="text-brand-hover" />}
                  </DropdownMenu.Item>
                ))}
              </>
            )}

            <DropdownMenu.Separator className="my-1 h-px bg-border" />
            <DropdownMenu.Item
              onSelect={() => signOutForm.current?.requestSubmit()}
              className="flex cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] px-2 py-2 text-sm text-text-secondary outline-none data-[highlighted]:bg-bg-sunken data-[highlighted]:text-text-primary"
            >
              <LogOut size={14} strokeWidth={1.5} />
              Sign out
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </header>
  );
}
