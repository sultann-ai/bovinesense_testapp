/**
 * Device API keys for the active organization (Settings → Device keys). Organization admins only
 * (permission "devices:manage"); the database enforces the same rule with Row Level Security.
 *
 *   GET  /api/device-keys   list keys (never the key itself, never the hash)
 *   POST /api/device-keys   { label } -> creates a key and returns the PLAIN key once
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiAccess } from "@/lib/auth/api";
import { errorCode } from "@/lib/api-helpers";
import { DEVICE_KEY_LABEL_MAX, generateDeviceKey } from "@/lib/device-keys";

export const dynamic = "force-dynamic";

const COLUMNS = "id, label, key_prefix, created_at, last_used_at, revoked_at";
// A key is a secret: no response from here may be cached by the browser or a proxy.
const NO_STORE = { "Cache-Control": "no-store" } as const;

const CreateSchema = z.object({
  label: z.string().trim().min(1, "Give the key a name").max(DEVICE_KEY_LABEL_MAX),
});

export async function GET() {
  const auth = await requireApiAccess("devices:manage");
  if (!auth.ok) return auth.response;
  const { ctx } = auth;

  try {
    const { data, error } = await ctx.db
      .from("device_api_keys")
      .select(COLUMNS)
      .eq("organization_id", ctx.organizationId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return NextResponse.json(data, { headers: NO_STORE });
  } catch (err) {
    console.error("[api/device-keys GET]", err);
    return NextResponse.json({ error: "Could not load device keys" }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireApiAccess("devices:manage");
  if (!auth.ok) return auth.response;
  const { ctx } = auth;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Validation failed" },
      { status: 400 },
    );
  }

  // The organization and the creator always come from the session, never from the body.
  const { key, hash, prefix } = generateDeviceKey();
  try {
    const { data, error } = await ctx.db
      .from("device_api_keys")
      .insert({
        organization_id: ctx.organizationId,
        key_hash: hash,
        key_prefix: prefix,
        label: parsed.data.label,
        created_by: ctx.user.id,
      })
      .select(COLUMNS)
      .single();
    if (error) throw error;

    // The only time the plain key exists outside the device. It is not stored anywhere.
    return NextResponse.json({ ...data, key }, { status: 201, headers: NO_STORE });
  } catch (err) {
    if (errorCode(err) === "42501") {
      return NextResponse.json({ error: "Forbidden", code: "forbidden" }, { status: 403 });
    }
    console.error("[api/device-keys POST]", err);
    return NextResponse.json({ error: "Could not create the key" }, { status: 503 });
  }
}
