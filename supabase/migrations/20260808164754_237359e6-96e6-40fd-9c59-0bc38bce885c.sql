GRANT SELECT (id, room_id, fingerprint, pseudo, joined_at, last_seen_at) ON public.room_participants TO anon, authenticated;
GRANT UPDATE (last_seen_at) ON public.room_participants TO anon, authenticated;
GRANT ALL ON public.room_participants TO service_role;