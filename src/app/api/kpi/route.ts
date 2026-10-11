import { NextRequest, NextResponse } from "next/server";
import { requireApiAccess, scopeMatch } from "@/lib/auth/api";
import { intParam } from "@/lib/api-helpers";
import type { ApiContext } from "@/lib/auth/api";

export const dynamic = "force-dynamic";

type Totals = {
  total: number; inside_count: number; breach_count: number; stale_count: number; new_alerts: number;
};

const EMPTY = { total: 0, inside_count: 0, inside_pct: 0, breach_count: 0, stale_count: 0, new_alerts: 0 };

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Change over the last 24 hours, from history the database really keeps:
 *   breach_count / stale_count  open breach / tag-offline alerts now, minus the ones that were open 24 h ago
 *                               (an alert was open at T when it was raised by T and not resolved by T);
 *   total                       animals added in the last 24 h.
 * "Inside boundary" has no delta: the database does not keep daily status history, and inventing one
 * would be wrong. Any failure here just means no deltas; the numbers themselves still show.
 */
async function dayDeltas(ctx: ApiContext, regionId: number | null, branchId: number | null) {
  const now = new Date();
  const then = new Date(now.getTime() - DAY_MS).toISOString();

  const openAt = async (type: "breach" | "tag_offline", at: Date) => {
    const iso = at.toISOString();
    let q = ctx.db
      .from("alert_overview")
      .select("id", { count: "exact", head: true })
      .match(scopeMatch(ctx))
      .eq("type", type)
      .lte("created_at", iso)
      .or(`resolved_at.is.null,resolved_at.gt.${iso}`);
    if (regionId !== null) q = q.eq("region_id", regionId);
    if (branchId !== null) q = q.eq("branch_id", branchId);
    const { count, error } = await q;
    if (error) throw error;
    return count ?? 0;
  };

  // Animals are filtered by branch; a region means "the branches of that region".
  const region = regionId ?? ctx.scope.regionId;
  const branch = branchId ?? ctx.scope.branchId;
  let branchIds: number[] | null = null;
  if (branch === null && region !== null) {
    const { data, error } = await ctx.db.from("branches").select("id").eq("organization_id", ctx.organizationId).eq("region_id", region);
    if (error) throw error;
    branchIds = data.map((b) => b.id);
  }
  let animals = ctx.db.from("animals").select("id", { count: "exact", head: true }).eq("organization_id", ctx.organizationId).gt("created_at", then);
  if (branch !== null) animals = animals.eq("branch_id", branch);
  else if (branchIds !== null) animals = animals.in("branch_id", branchIds);

  const [breachNow, breachThen, offlineNow, offlineThen, added] = await Promise.all([
    openAt("breach", now), openAt("breach", new Date(now.getTime() - DAY_MS)),
    openAt("tag_offline", now), openAt("tag_offline", new Date(now.getTime() - DAY_MS)),
    animals.then(({ count, error }) => { if (error) throw error; return count ?? 0; }),
  ]);
  return { total: added, breach_count: breachNow - breachThen, stale_count: offlineNow - offlineThen };
}

export async function GET(req: NextRequest) {
  const auth = await requireApiAccess();
  if (!auth.ok) return auth.response;
  const { ctx } = auth;

  // Optional narrowing from the scope selector; the caller's own scope is always applied first.
  const regionId = intParam(req.nextUrl.searchParams.get("region_id"));
  const branchId = intParam(req.nextUrl.searchParams.get("branch_id"));
  if (Number.isNaN(regionId) || Number.isNaN(branchId)) {
    return NextResponse.json({ error: "Invalid filter" }, { status: 400 });
  }

  try {
    // One row per organization / region / branch; sum the rows the caller may see.
    let query = ctx.db
      .from("kpi_summary")
      .select("total, inside_count, breach_count, stale_count, new_alerts")
      .match(scopeMatch(ctx));
    if (regionId !== null) query = query.eq("region_id", regionId);
    if (branchId !== null) query = query.eq("branch_id", branchId);
    const { data, error } = await query;
    if (error) throw error;

    const sum = data.reduce<Totals>(
      (acc, r) => ({
        total:        acc.total        + (r.total ?? 0),
        inside_count: acc.inside_count + (r.inside_count ?? 0),
        breach_count: acc.breach_count + (r.breach_count ?? 0),
        stale_count:  acc.stale_count  + (r.stale_count ?? 0),
        new_alerts:   acc.new_alerts   + (r.new_alerts ?? 0),
      }),
      { total: 0, inside_count: 0, breach_count: 0, stale_count: 0, new_alerts: 0 },
    );

    const delta = await dayDeltas(ctx, regionId, branchId).catch((err) => {
      console.error("[api/kpi] deltas", err);
      return null;
    });

    return NextResponse.json({
      ...sum,
      inside_pct: sum.total > 0 ? Math.round((100 * sum.inside_count) / sum.total) : 0,
      delta,
    });
  } catch (err) {
    console.error("[api/kpi]", err);
    return NextResponse.json(EMPTY, { status: 503 });
  }
}
