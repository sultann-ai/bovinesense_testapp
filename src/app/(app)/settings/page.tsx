import { AccessDenied } from "@/components/shell/AccessDenied";
import { ComingSoon } from "@/components/shell/ComingSoon";
import { resolveAccess } from "@/lib/auth/access";
import { can } from "@/lib/permissions";

export const dynamic = "force-dynamic";

// Organization settings are for org admins only. Device API keys now live on the Devices screen.
export default async function SettingsPage() {
  const result = await resolveAccess();
  if (result.status !== "ok" || !can(result.access.role, "settings:manage")) {
    return <AccessDenied />;
  }
  return (
    <ComingSoon
      title="Settings"
      description="Users, roles, alert rules and notification recipients will be managed here. Device API keys are on the Devices screen."
    />
  );
}
