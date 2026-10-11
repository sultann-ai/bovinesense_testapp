import { DevicesTable } from "@/components/devices/DevicesTable";
import { DeviceKeysPanel } from "@/components/settings/DeviceKeysPanel";
import { resolveAccess } from "@/lib/auth/access";
import { can } from "@/lib/permissions";

export const dynamic = "force-dynamic";

// Everyone in the organization can read the tag inventory; only organization admins see the
// device API keys (create and revoke).
export default async function DevicesPage() {
  const result = await resolveAccess();
  const canManage = result.status === "ok" && can(result.access.role, "devices:manage");

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8 p-6">
      <div>
        <h1 className="text-2xl font-semibold leading-8 text-text-primary">Devices</h1>
        <p className="mt-1 text-sm text-text-secondary">Every tag with its battery, signal and last contact. Unassigned tags are listed first.</p>
      </div>
      <DevicesTable />
      {canManage && <DeviceKeysPanel />}
    </div>
  );
}
