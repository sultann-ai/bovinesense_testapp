import { NextRequest, NextResponse } from "next/server";
import { requireApiAccess, scopeMatch } from "@/lib/auth/api";
import { ilikeAny } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireApiAccess();
  if (!auth.ok) return auth.response;
  const { ctx } = auth;

  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q || q.length < 2) return NextResponse.json([]);

  try {
    const { data, error } = await ctx.db
      .from("animal_overview")
      .select("id, animal_name, status, tag_serial, borrower_name, loan_number, branch_name, lat, lon")
      .match(scopeMatch(ctx))
      .or(ilikeAny(["tag_serial", "borrower_name", "loan_number", "animal_name"], q))
      .limit(8);
    if (error) throw error;

    return NextResponse.json(
      data.map(({ id, ...rest }) => ({ animal_id: id, ...rest })),
    );
  } catch (err) {
    console.error("[api/search]", err);
    return NextResponse.json([]);
  }
}
