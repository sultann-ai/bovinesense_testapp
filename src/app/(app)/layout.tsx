import { redirect } from "next/navigation";
import { Sidebar } from "@/components/shell/Sidebar";
import { TopBar } from "@/components/shell/TopBar";
import { DemoModeBanner } from "@/components/shell/DemoModeBanner";
import { SessionGuard } from "@/components/shell/SessionGuard";
import { PermissionsProvider } from "@/components/shell/PermissionsProvider";
import { TenantProvider } from "@/components/shell/TenantProvider";
import { ScopeProvider } from "@/components/shell/ScopeProvider";
import { RealtimeProvider } from "@/components/realtime/RealtimeProvider";
import { MapConfigProvider } from "@/components/map/MapConfigContext";
import { getDisplayName, loadAccessList, resolveAccess } from "@/lib/auth/access";
import { brandStyle } from "@/lib/branding";
import { demoBannerMessage } from "@/lib/tenant-settings";
import { createClient } from "@/lib/supabase/server";

// Everything inside the shell needs a signed-in user with a valid active organization.
// The proxy has already redirected anonymous visitors; this re-checks against the
// database on each render (so a revoked membership or suspended organization takes
// effect immediately) and renders the real user / organization / role.
export const dynamic = "force-dynamic";

/** "Demo environment: N live tags, M simulated animals." from what this user can see of the tenant's tags. */
async function demoMessage(organizationId: string, custom: string | null, scoped: boolean): Promise<string> {
  if (custom) return custom;
  try {
    const db = await createClient();
    const count = async (simulated: boolean) => {
      const { count: n, error } = await db
        .from("tags")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .eq("is_simulated", simulated);
      if (error) throw error;
      return n ?? 0;
    };
    const [liveTags, simulatedAnimals] = await Promise.all([count(false), count(true)]);
    const text = demoBannerMessage({ liveTags, simulatedAnimals }, null);
    return scoped ? `${text.slice(0, -1)} in your scope.` : text;
  } catch (err) {
    console.error("[layout] demo banner counts", err);
    return "Demo environment: simulated data is mixed with live tags.";
  }
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const result = await resolveAccess();
  if (result.status === "unauthenticated") redirect("/login");
  if (result.status === "no_org") redirect("/org/continue");

  const { access } = result;
  const org = access.organization;
  const [fullName, list] = await Promise.all([
    getDisplayName(access.user.id),
    loadAccessList(access.user.id),
  ]);
  const bannerText = org.tenant.demoMode
    ? await demoMessage(org.id, org.tenant.demoBannerText, access.scope.regionId !== null || access.scope.branchId !== null)
    : null;

  return (
    <PermissionsProvider role={access.role}>
    <TenantProvider
      value={{
        name: org.name,
        logoUrl: org.tenant.logoUrl,
        timezone: org.tenant.timezone,
        offlineThresholdHours: org.tenant.offlineThresholdHours,
      }}
    >
    {/* key: switching organization starts a fresh scope, a fresh subscription and fresh state */}
    <ScopeProvider key={org.id} organizationId={org.id}>
    <RealtimeProvider key={org.id} organizationId={org.id}>
    <MapConfigProvider config={org.map}>
    {/* A tenant accent may override the brand tokens only (never the status tokens). */}
    <div className="flex h-full overflow-hidden" style={brandStyle(org.tenant.brand)}>
      <SessionGuard />
      <Sidebar />

      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar
          user={{ name: fullName, email: access.user.email }}
          role={access.role}
          activeOrganizationId={org.id}
          organizations={list.organizations.map((o) => ({ id: o.id, name: o.name }))}
        />
        {bannerText && <DemoModeBanner message={bannerText} />}
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
    </MapConfigProvider>
    </RealtimeProvider>
    </ScopeProvider>
    </TenantProvider>
    </PermissionsProvider>
  );
}
