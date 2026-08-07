-- 1. Hide participant public keys from public reads (column-level SELECT)
REVOKE SELECT ON public.room_participants FROM anon, authenticated;
GRANT SELECT (id, room_id, fingerprint, pseudo, joined_at, last_seen_at)
  ON public.room_participants TO anon, authenticated;

-- 2. Only the presence timestamp may be updated by public roles
REVOKE UPDATE ON public.room_participants FROM anon, authenticated;
GRANT UPDATE (last_seen_at) ON public.room_participants TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.room_participants_immutable_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.room_id IS DISTINCT FROM OLD.room_id
     OR NEW.fingerprint IS DISTINCT FROM OLD.fingerprint
     OR NEW.pseudo IS DISTINCT FROM OLD.pseudo
     OR NEW.pubkey IS DISTINCT FROM OLD.pubkey
     OR NEW.joined_at IS DISTINCT FROM OLD.joined_at THEN
    RAISE EXCEPTION 'participant_identity_immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS room_participants_immutable_identity_before_update ON public.room_participants;
CREATE TRIGGER room_participants_immutable_identity_before_update
  BEFORE UPDATE ON public.room_participants
  FOR EACH ROW EXECUTE FUNCTION public.room_participants_immutable_identity();

-- 3. No public deletes/updates on messages; cleanup runs with service role / cron
REVOKE DELETE, UPDATE ON public.messages FROM anon, authenticated;
REVOKE DELETE ON public.room_participants FROM anon, authenticated;
GRANT ALL ON public.messages TO service_role;
GRANT ALL ON public.room_participants TO service_role;

DROP POLICY IF EXISTS "No one can delete messages" ON public.messages;
CREATE POLICY "No one can delete messages"
  ON public.messages FOR DELETE TO anon, authenticated USING (false);

DROP POLICY IF EXISTS "No one can update messages" ON public.messages;
CREATE POLICY "No one can update messages"
  ON public.messages FOR UPDATE TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "No one can delete participants" ON public.room_participants;
CREATE POLICY "No one can delete participants"
  ON public.room_participants FOR DELETE TO anon, authenticated USING (false);