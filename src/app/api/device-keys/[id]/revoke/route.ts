/**
 * POST /api/device-keys/:id/revoke
 *
 * Revokes a device key: devices using it get 401 from the next request on. Revocation is
 * permanent (the database refuses to un-revoke), and the row is kept so "last used" stays visible.
 */
import { NextResponse } from "next/server";
import { requireApiAccess } from "@/lib/auth/api";
import { isUuid } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiAccess("devices:manage");
  if (!auth.ok) return auth.response;
  const { ctx } = auth;

  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Invalid key id" }, { status: 400 });

  try {
    // A refused or empty update matches zero rows without an error, so ask for the row back.
    const { data, error } = await ctx.db
      .from("device_api_keys")
      .update({ revoked_at: new Date().toISOString() })
      .eq("organization_id", ctx.organizationId)
      .eq("id", id)
      .is("revoked_at", null)
      .select("id");
    if (error) throw error;

    if (!data || data.length === 0) {
      // Missing, in another organization, or already revoked: indistinguishable on purpose.
      return NextResponse.json({ error: "Key not found or already revoked" }, { status: 404 });
    }
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[api/device-keys revoke]", err);
    return NextResponse.json({ error: "Could not revoke the key" }, { status: 503 });
  }
}
