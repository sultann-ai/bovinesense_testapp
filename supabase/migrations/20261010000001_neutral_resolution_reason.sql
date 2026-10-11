-- BovineSense — lender-neutral wording for a resolution reason.
--
-- The platform serves any lender, not only banks, so the resolution reason "moved with bank consent"
-- becomes "moved with consent" (project spec, "Alert lifecycle"). Existing alerts keep their meaning: the
-- enum value is renamed in place, so no rows change and nothing needs backfilling.
--
-- No table is created here, so there is no row security to add; the alerts table keeps the policies
-- it already has.
alter type public.resolution_reason rename value 'moved_with_bank_consent' to 'moved_with_consent';
