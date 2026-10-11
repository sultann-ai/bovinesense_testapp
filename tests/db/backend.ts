/**
 * Database backends for the Row Level Security tests.
 *
 * Default: PGlite, a real PostgreSQL engine compiled to WebAssembly, running in-process. No
 * Docker, no installed Postgres, no network. It does not ship PostGIS, so for this backend the
 * spatial types and functions are replaced by tiny text stubs (see STUBS and `forPglite`).
 * Nothing the policies do depends on geometry, so the policy logic under test is the real thing.
 *
 * Opt-in: set TEST_DATABASE_URL to a Postgres connection string to run the very same tests
 * against a Supabase test project (use its direct connection string) or a local `supabase start`
 * database (postgresql://postgres:postgres@127.0.0.1:54322/postgres). The migrations must already
 * be applied there (`supabase db push`); nothing is applied or stubbed. Every test runs inside one
 * transaction that is rolled back at the end, so the target database is left untouched. Use a
 * disposable project anyway: never point this at data you care about.
 */
import fs from "node:fs";
import path from "node:path";

export type Row = Record<string, unknown>;
export interface QueryResult {
  rows: Row[];
}
export type Query = (sql: string, params?: unknown[]) => Promise<QueryResult>;

export interface TestDb {
  kind: "pglite" | "postgres";
  query: Query;
  close(): Promise<void>;
}

const ROOT = path.resolve(__dirname, "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "supabase", "migrations");

/** Minimal stand-ins for what Supabase provides (auth schema, roles) and for PostGIS. */
const STUBS = `
create schema extensions;
create schema auth;

-- Supabase ships this publication; Realtime streams the tables added to it (migration 7).
create publication supabase_realtime;

-- pg_cron stand-in: the same scheduling API and tables (jobs are recorded, never executed; tests
-- call the job functions directly). schedule() upserts by name, as the real one does.
create schema cron;
create table cron.job (
  jobid bigserial primary key, schedule text not null, command text not null,
  jobname text unique, active boolean not null default true
);
create table cron.job_run_details (
  runid bigserial primary key, jobid bigint not null, status text, start_time timestamptz,
  end_time timestamptz, return_message text
);
create function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as $$
  insert into cron.job (jobname, schedule, command) values ($1, $2, $3)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
  returning jobid
$$;
create function cron.unschedule(job_name text) returns boolean language sql as $$
  with d as (delete from cron.job where jobname = $1 returning 1) select exists (select 1 from d)
$$;

-- Supabase lets the API roles use the extensions schema (PostGIS lives there). The spatial views
-- and create_geofence() run as the caller, so they need this.
-- (Granted after the roles are created, below.)

-- Supabase's API roles. (service_role and the superuser used for fixtures bypass RLS.)
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

grant usage on schema extensions to anon, authenticated, service_role;

-- Supabase gives every new function and table in public to the API roles by default (that is why
-- each migration must REVOKE explicitly). Emulated here so a missing revoke fails the tests.
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb,
  phone text
);

-- Same contract as Supabase's auth.uid(): the JWT subject for the current request.
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

-- PostGIS stand-ins (types and the few functions the migrations reference).
--
-- Geometry is text. A point is 'lon lat'. A fence is a rectangle written 'BOX(minlon minlat,maxlon
-- maxlat)' (what st_makeenvelope returns); its boundary is 'BOUNDARY(BOX(...))'. That is enough
-- for the alert rules to be tested with fixed coordinates: st_contains and st_distance (in
-- metres, local flat-earth approximation, within ~0.5% of PostGIS at Punjab's latitude) work on
-- exactly those shapes. Any other text (the RLS fixtures use 'g') keeps the old inert behaviour.
create domain extensions.geometry as text;
create domain extensions.geography as text;

-- 'lon lat' -> (lon, lat)
create function extensions.stub_pt(p text) returns float8[] language sql immutable as $$
  select array[split_part($1, ' ', 1)::float8, split_part($1, ' ', 2)::float8]
$$;
-- 'BOX(a b,c d)' or 'BOUNDARY(BOX(a b,c d))' -> {minlon,minlat,maxlon,maxlat}, null for anything else
create function extensions.stub_box(g text) returns float8[] language sql immutable as $$
  select case when m is null then null else array[m[1]::float8, m[2]::float8, m[3]::float8, m[4]::float8] end
  from (select regexp_match($1, 'BOX\\(([-0-9.]+) ([-0-9.]+),([-0-9.]+) ([-0-9.]+)\\)') as m) t
$$;

create function extensions.st_point(float8, float8) returns extensions.geometry language sql immutable as $$ select ($1::text || ' ' || $2::text)::extensions.geometry $$;
create function extensions.st_makepoint(float8, float8) returns extensions.geometry language sql immutable as $$ select ($1::text || ' ' || $2::text)::extensions.geometry $$;
create function extensions.st_setsrid(extensions.geometry, int) returns extensions.geometry language sql immutable as $$ select $1 $$;

create function extensions.st_contains(extensions.geometry, extensions.geometry) returns boolean language sql immutable as $$
  select case
    when extensions.stub_box($1) is null then $1::text = $2::text
    else ((extensions.stub_pt($2))[1] between (extensions.stub_box($1))[1] and (extensions.stub_box($1))[3])
     and ((extensions.stub_pt($2))[2] between (extensions.stub_box($1))[2] and (extensions.stub_box($1))[4])
  end
$$;

-- Metres from a point to a rectangle (0 if inside), or to its edge when the first argument is a
-- BOUNDARY(...) (so it is also non-zero for a point inside).
create function extensions.st_distance(extensions.geography, extensions.geography) returns float8 language plpgsql immutable as $$
declare
  b float8[] := extensions.stub_box($1::text);
  p float8[];
  kx float8;
  ky float8 := 111195;
  dx float8;
  dy float8;
begin
  if b is null then return 0; end if;
  p  := extensions.stub_pt($2::text);
  kx := 111195 * cos(radians(p[2]));
  if $1::text like 'BOUNDARY(%' then
    if p[1] between b[1] and b[3] and p[2] between b[2] and b[4] then
      return least((p[1] - b[1]) * kx, (b[3] - p[1]) * kx, (p[2] - b[2]) * ky, (b[4] - p[2]) * ky);
    end if;
  end if;
  dx := greatest(b[1] - p[1], 0, p[1] - b[3]) * kx;
  dy := greatest(b[2] - p[2], 0, p[2] - b[4]) * ky;
  return sqrt(dx * dx + dy * dy);
end
$$;

create function extensions.st_boundary(extensions.geometry) returns extensions.geometry language sql immutable as $$
  select case when extensions.stub_box($1) is null then $1 else ('BOUNDARY(' || $1::text || ')')::extensions.geometry end
$$;
-- Validation helpers used by the geofence functions. Every drawn shape counts as a valid polygon;
-- text containing INVALID counts as one that crosses itself, LINESTRING as the wrong type and
-- NPOINTS=n as a shape of n points, so each rule can be tested.
create function extensions.st_isvalid(extensions.geometry) returns boolean language sql immutable as $$ select position('INVALID' in $1::text) = 0 $$;
create function extensions.st_geometrytype(extensions.geometry) returns text language sql immutable as $$
  select case when $1::text like '%LINESTRING%' then 'ST_LineString' else 'ST_Polygon' end
$$;
create function extensions.st_npoints(extensions.geometry) returns integer language sql immutable as $$
  select case when $1::text ~ 'NPOINTS=[0-9]+' then substring($1::text from 'NPOINTS=([0-9]+)')::integer else 4 end
$$;
create function extensions.st_asgeojson(extensions.geometry) returns text language sql immutable as $$ select '{"type":"Stub"}'::text $$;
create function extensions.st_geomfromgeojson(text) returns extensions.geometry language sql immutable as $$ select $1::extensions.geometry $$;
create function extensions.st_buffer(extensions.geography, float8) returns extensions.geography language sql immutable as $$ select $1 $$;
create function extensions.st_makeenvelope(float8, float8, float8, float8, int) returns extensions.geometry language sql immutable as $$
  select ('BOX(' || $1::text || ' ' || $2::text || ',' || $3::text || ' ' || $4::text || ')')::extensions.geometry
$$;
`;

/** Rewrite the few PostGIS-specific statements so a migration runs on PGlite. */
function forPglite(sql: string): string {
  return sql
    .replace(/create extension if not exists postgis with schema extensions;/g, "")
    .replace(/extensions\.geometry\((Geometry|Point), 4326\)/g, "extensions.geometry")
    .replace(/using gist/g, "using btree");
}

export function migrationFiles(): string[] {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => path.join(MIGRATIONS_DIR, f));
}

async function createPglite(): Promise<TestDb> {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite();
  await db.exec(STUBS);
  for (const file of migrationFiles()) {
    try {
      await db.exec(forPglite(fs.readFileSync(file, "utf8")));
    } catch (err) {
      throw new Error(`Migration ${path.basename(file)} failed on PGlite: ${(err as Error).message}`);
    }
  }
  return {
    kind: "pglite",
    query: async (sql, params) => {
      const r = await db.query<Row>(sql, params as unknown[]);
      return { rows: r.rows };
    },
    close: () => db.close(),
  };
}

async function createPostgres(url: string): Promise<TestDb> {
  const { default: postgres } = await import("postgres");
  // One connection: role and transaction state must stay on the same session.
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  return {
    kind: "postgres",
    query: async (text, params) => {
      const rows = await sql.unsafe(text, (params ?? []) as never[]);
      return { rows: [...rows] as Row[] };
    },
    close: () => sql.end(),
  };
}

export async function createTestDb(): Promise<TestDb> {
  const url = process.env.TEST_DATABASE_URL;
  return url ? createPostgres(url) : createPglite();
}

/**
 * Run `fn` as an end user: the `authenticated` role with the JWT claims Supabase's API would
 * set (so auth.uid() is `userId`). Pass null for the unauthenticated `anon` role.
 * The session is always reset afterwards.
 */
export async function asUser<T>(
  db: TestDb,
  userId: string | null,
  fn: (q: Query) => Promise<T>,
): Promise<T> {
  const claims = userId
    ? JSON.stringify({ sub: userId, role: "authenticated", aud: "authenticated" })
    : JSON.stringify({ role: "anon" });
  await db.query("select set_config('request.jwt.claims', $1, false), set_config('request.jwt.claim.sub', $2, false)", [
    claims,
    userId ?? "",
  ]);
  await db.query(userId ? "set role authenticated" : "set role anon");
  try {
    return await fn(db.query);
  } finally {
    await db.query("reset role");
    await db.query("select set_config('request.jwt.claims', '', false), set_config('request.jwt.claim.sub', '', false)");
  }
}

export interface Probe {
  /** The statement ran without error. */
  ok: boolean;
  /** Rows returned (use RETURNING on writes) — how many rows the statement really touched. */
  rows: Row[];
  /** Postgres error code when it failed (e.g. 42501 insufficient_privilege / RLS violation). */
  code?: string;
}

/**
 * Run one statement inside a savepoint and ALWAYS roll it back, so tests can attempt a write,
 * observe what the database allowed, and leave the data exactly as it was.
 */
export async function probe(q: Query, sql: string, params?: unknown[]): Promise<Probe> {
  await q("savepoint probe");
  try {
    const r = await q(sql, params);
    return { ok: true, rows: r.rows };
  } catch (err) {
    const code = (err as { code?: string }).code;
    return { ok: false, rows: [], code };
  } finally {
    await q("rollback to savepoint probe");
    await q("release savepoint probe");
  }
}

/** True when the statement either failed or touched no rows: i.e. the database refused it. */
export function refused(p: Probe): boolean {
  return !p.ok || p.rows.length === 0;
}
