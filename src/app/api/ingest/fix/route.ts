/**
 * POST /api/ingest/fix
 *
 * Single ingestion endpoint for both the real GPS tag and the simulator.
 * Protected by X-Api-Key header (INGEST_API_KEY in .env).
 *
 * Body (JSON):
 *   tag_serial  string   — tag serial number (e.g. "TAG-00001" or "SIM-00001")
 *   lat         number   — latitude  (WGS-84)
 *   lon         number   — longitude (WGS-84)
 *   fixed_at    string   — ISO-8601 UTC timestamp when the GPS fix was taken
 *   speed_kmh?  number   — speed in km/h (optional)
 *   battery_pct? number  — 0–100 (optional)
 *   signal_bars? number  — 0–4   (optional)
 *
 * Responses:
 *   201 { fix_id, animal_id, alerts_raised }
 *   400 validation error
 *   401 missing or invalid API key
 *   404 tag not found / not assigned to an animal
 *   500 internal error
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import postgres from "postgres";
import { runAlertEngine } from "@/lib/db";
import { createDatabaseClient } from "../../../../../db/connection";

// ─── Schema ──────────────────────────────────────────────────────────────────
const FixSchema = z.object({
  tag_serial:   z.string().min(1).max(50),
  lat:          z.number().min(-90).max(90),
  lon:          z.number().min(-180).max(180),
  fixed_at:     z.string().datetime({ offset: true }),
  speed_kmh:    z.number().nonnegative().optional(),
  battery_pct:  z.number().int().min(0).max(100).optional(),
  signal_bars:  z.number().int().min(0).max(4).optional(),
});

// ─── DB connection (lazy singleton) ──────────────────────────────────────────
let _sql: postgres.Sql | null = null;
function getSql() {
  if (!_sql) {
    _sql = createDatabaseClient({ max: 5 });
  }
  return _sql;
}

// ─── Handler ─────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  // 1. API key guard
  const apiKey = req.headers.get("x-api-key");
  if (!apiKey || apiKey !== process.env.INGEST_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Parse + validate body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = FixSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const data = parsed.data;
  const sql  = getSql();

  try {
    // 3. Resolve tag
    const [tag] = await sql`
      SELECT id, is_simulated FROM tags WHERE serial_number = ${data.tag_serial}
    `;
    if (!tag) {
      return NextResponse.json(
        { error: `Tag '${data.tag_serial}' not found` },
        { status: 404 }
      );
    }

    // 4. Resolve animal assigned to this tag
    const [animal] = await sql`
      SELECT id FROM animals WHERE tag_id = ${tag.id} LIMIT 1
    `;
    if (!animal) {
      return NextResponse.json(
        { error: `No animal assigned to tag '${data.tag_serial}'` },
        { status: 404 }
      );
    }

    // 5. Insert fix
    const pointWkt = `POINT(${data.lon} ${data.lat})`;
    const [fix] = await sql`
      INSERT INTO fixes (
        tag_id, animal_id, geom, lat, lon,
        fixed_at, speed_kmh, battery_pct, signal_bars, is_simulated
      )
      VALUES (
        ${tag.id}, ${animal.id},
        ST_GeomFromText(${pointWkt}, 4326),
        ${data.lat}, ${data.lon},
        ${data.fixed_at}::timestamptz,
        ${data.speed_kmh ?? null},
        ${data.battery_pct ?? null},
        ${data.signal_bars ?? null},
        ${tag.is_simulated}
      )
      RETURNING id
    `;

    // 6. Run alert engine
    const alertsBefore = await sql`
      SELECT COUNT(*) AS n FROM alerts WHERE animal_id = ${animal.id} AND status = 'new'
    `;
    const countBefore = Number(alertsBefore[0].n);

    await runAlertEngine(sql, {
      fixId:      fix.id,
      tagId:      tag.id,
      animalId:   animal.id,
      lat:        data.lat,
      lon:        data.lon,
      fixedAt:    new Date(data.fixed_at),
      speedKmh:   data.speed_kmh ?? null,
      batteryPct: data.battery_pct ?? null,
    });

    const alertsAfter = await sql`
      SELECT COUNT(*) AS n FROM alerts WHERE animal_id = ${animal.id} AND status = 'new'
    `;
    const alertsRaised = Number(alertsAfter[0].n) - countBefore;

    return NextResponse.json(
      { fix_id: fix.id, animal_id: animal.id, alerts_raised: alertsRaised },
      { status: 201 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    console.error("[ingest/fix]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
