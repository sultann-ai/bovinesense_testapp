-- BovineSense — Supabase Realtime for the live dashboard.
--
-- The browser subscribes to postgres_changes on fixes, alerts and animals, filtered by
-- organization_id. Supabase Realtime delivers a change to a subscriber only if that subscriber's
-- own role (`authenticated`, with their JWT) is allowed to SELECT the changed row, so the Row Level
-- Security policies from migration 5 decide who receives what: a Demo Bank user never receives a
-- Bank of Punjab row, a branch officer never receives another branch's, and so on. The client-side
-- organization filter is only a courtesy to cut traffic; it is not what protects the data.
-- (tests/db/realtime.test.ts proves the visibility rules for the exact rows ingest_fix() writes.)
--
-- Adding a table to the `supabase_realtime` publication changes nothing about who can read it.
-- Only INSERT/UPDATE events are used, and an UPDATE carries the complete new row, so the default
-- replica identity is enough (no REPLICA IDENTITY FULL, no extra write-ahead-log volume).
--
--   fixes    INSERT  a new position            -> moves the marker
--   alerts   INSERT  a new alert               -> feed, bell badge, toast
--            UPDATE  acknowledged/assigned/resolved by someone -> feed, KPIs
--   animals  UPDATE  status changed by ingest  -> marker colour, KPIs
--
-- Idempotent, and a no-op (with a notice) on a database without the publication, such as a plain
-- Postgres used for tests; on Supabase the publication always exists.
do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'publication supabase_realtime not found: realtime not enabled (not a Supabase database)';
    return;
  end if;

  foreach t in array array['fixes', 'alerts', 'animals'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
