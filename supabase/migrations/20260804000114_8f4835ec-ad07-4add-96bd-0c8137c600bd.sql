DROP POLICY IF EXISTS "Anyone can create valid ephemeral rooms" ON public.rooms;
REVOKE INSERT ON public.rooms FROM anon, authenticated;
GRANT SELECT ON public.rooms TO anon, authenticated;
GRANT ALL ON public.rooms TO service_role;