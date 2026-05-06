DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename NOT IN ('__drizzle_migrations')
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', r.tablename);
  END LOOP;
END $$;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

DROP POLICY IF EXISTS "public_read_avis_approved" ON public.avis;
CREATE POLICY "public_read_avis_approved"
ON public.avis
FOR SELECT
TO anon, authenticated
USING (approuve = true);
GRANT SELECT ON TABLE public.avis TO anon, authenticated;

DROP POLICY IF EXISTS "public_read_disponibilites" ON public.disponibilites;
CREATE POLICY "public_read_disponibilites"
ON public.disponibilites
FOR SELECT
TO anon, authenticated
USING (true);
GRANT SELECT ON TABLE public.disponibilites TO anon, authenticated;

DROP POLICY IF EXISTS "public_read_charter_slots_active" ON public."charterSlots";
CREATE POLICY "public_read_charter_slots_active"
ON public."charterSlots"
FOR SELECT
TO anon, authenticated
USING (active = true);
GRANT SELECT ON TABLE public."charterSlots" TO anon, authenticated;
