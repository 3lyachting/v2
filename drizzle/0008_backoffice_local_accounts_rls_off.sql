-- Cette table n'est utilisée que par le serveur Node (connexion DATABASE_URL), pas par PostgREST.
-- Si la RLS est activée sans politique explicite, PostgreSQL refuse tout INSERT/UPDATE/DELETE.
ALTER TABLE IF EXISTS public.backoffice_local_accounts DISABLE ROW LEVEL SECURITY;
