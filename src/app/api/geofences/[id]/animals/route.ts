import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiAccess } from "@/lib/auth/api";
import { errorCode } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

const Schema = z.object({
  animal_ids: z.array(z.number().int().positive()).min(1).max(500),
  action:     z.enum(["assign", "unassign"]),
});

/**
 * Put animals on this fence (moving them off any other) or take them off it. Organization admins
 * only; the database function runs as the signed-in user, so Row Level Security has the last word.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiAccess("geofences:manage");
  if (!auth.ok) return auth.response;
  const { ctx } = auth;

  const { id } = await params;
  const fenceId = parseInt(id, 10);
  if (isNaN(fenceId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Validation failed" }, { status: 400 });
  }

  const { data, error } = await ctx.db.rpc("set_animal_fence", {
    p_geofence_id: fenceId,
    p_animal_ids:  parsed.data.animal_ids,
    p_assign:      parsed.data.action === "assign",
  });
  if (error) {
    const code = errorCode(error);
    if (code === "P0002") return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (code === "42501") return NextResponse.json({ error: "Forbidden", code: "forbidden" }, { status: 403 });
    console.error("[api/geofences/[id]/animals]", error);
    return NextResponse.json({ error: "DB error" }, { status: 503 });
  }
  return NextResponse.json({ changed: data ?? 0 });
}
