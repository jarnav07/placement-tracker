-- Optional safety helper for the placement maintenance workflow.
--
-- Creates a point-in-time copy of public.placements before each automated audit.
-- This is strictly read-only with respect to the live table: it SELECTs rows into a
-- new table and never modifies or deletes placement data.
--
-- The audit script (scripts/placement-audit.mjs) calls this RPC at the start of a run
-- and logs a warning (but continues safely) if the function has not been installed.

CREATE OR REPLACE FUNCTION public.create_placements_backup()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  backup_name text;
BEGIN
  backup_name := 'placements_backup_' || to_char(now() AT TIME ZONE 'UTC', 'YYYY_MM_DD_HH24_MI_SS');
  EXECUTE format('CREATE TABLE IF NOT EXISTS %I AS SELECT * FROM public.placements', backup_name);
  RETURN backup_name;
END;
$$;

-- Only the service-role automation should be able to create backups.
REVOKE ALL ON FUNCTION public.create_placements_backup() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_placements_backup() TO service_role;
