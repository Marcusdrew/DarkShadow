-- Security audit #2 — lock the tables down and expose a narrow RPC API.
--
-- Before: the anon role could SELECT every active room, message and participant (room
-- enumeration), subscribe to every INSERT through Realtime, write any column (backdated
-- created_at to dodge rate limits, NULL expires_at to dodge auto-destruction), post as
-- any fingerprint, and still held TRUNCATE/UPDATE/DELETE/TRIGGER grants.
-- After: no direct table access at all for anon/authenticated. Everything goes through
-- SECURITY DEFINER functions that require the room's public id (a hash of the secret,
-- no longer listable), validate every field and set server-side values themselves.
-- Live updates go through Realtime broadcast on the topic 'room:<id>', sent by the DB.

-- 1. Revoke every direct privilege from public roles.
REVOKE ALL ON public.rooms, public.messages, public.room_participants FROM anon, authenticated;
GRANT ALL ON public.rooms, public.messages, public.room_participants TO service_role;

-- 2. Stop streaming table changes (postgres_changes leaked every room's traffic).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'messages') THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.messages;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'room_participants') THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.room_participants;
  END IF;
END $$;

-- 3. Drop the now-useless permissive policies (RLS stays enabled = deny by default).
DROP POLICY IF EXISTS "Anyone can read non-expired rooms" ON public.rooms;
DROP POLICY IF EXISTS "Anyone can insert messages in active rooms" ON public.messages;
DROP POLICY IF EXISTS "Anyone can read non-expired messages in active rooms" ON public.messages;
DROP POLICY IF EXISTS "Anyone can join active rooms" ON public.room_participants;
DROP POLICY IF EXISTS "Anyone can read participants of active rooms" ON public.room_participants;
DROP POLICY IF EXISTS "Anyone can update last_seen of active participants" ON public.room_participants;

-- 4. Message authenticity: each message carries the sender's public key and an ECDSA
--    P-256 signature (verified by every client). Replays of the same IV are rejected.
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS sender_pubkey text;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS signature text;
ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_signature_format,
  ADD CONSTRAINT messages_signature_format CHECK (
    sender_pubkey IS NOT NULL AND length(sender_pubkey) BETWEEN 80 AND 100
    AND signature IS NOT NULL AND length(signature) BETWEEN 80 AND 100
  ) NOT VALID;
CREATE UNIQUE INDEX IF NOT EXISTS messages_room_iv_unique ON public.messages (room_id, iv);

-- 5. Helper: fingerprint = first 16 hex chars of SHA-256(raw public key).
CREATE OR REPLACE FUNCTION public.cr_fingerprint_of(p_pubkey text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions
AS $$
  SELECT left(encode(extensions.digest(decode(p_pubkey, 'base64'), 'sha256'), 'hex'), 16);
$$;

-- 6. Read the metadata of one active room.
CREATE OR REPLACE FUNCTION public.cr_get_room(p_room uuid)
RETURNS TABLE (expires_at timestamptz, message_ttl_seconds int, fingerprint text, max_participants int, salt text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.expires_at, r.message_ttl_seconds, r.fingerprint, r.max_participants, r.salt
  FROM public.rooms r
  WHERE r.id = p_room AND r.expires_at > now();
$$;

-- 7. Join (or re-join) a room. The fingerprint must match the public key.
CREATE OR REPLACE FUNCTION public.cr_join_room(p_room uuid, p_fingerprint text, p_pseudo text, p_pubkey text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  inserted boolean := false;
  v_joined timestamptz;
BEGIN
  IF p_fingerprint IS NULL OR p_fingerprint !~ '^[0-9a-f]{16}$' THEN RAISE EXCEPTION 'bad_fingerprint'; END IF;
  IF p_pseudo IS NULL OR p_pseudo !~ '^[a-z]+-[a-z]+-[0-9]{4}$' THEN RAISE EXCEPTION 'bad_pseudo'; END IF;
  IF p_pubkey IS NULL OR length(p_pubkey) NOT BETWEEN 80 AND 100 THEN RAISE EXCEPTION 'bad_pubkey'; END IF;
  IF public.cr_fingerprint_of(p_pubkey) <> p_fingerprint THEN RAISE EXCEPTION 'fingerprint_mismatch'; END IF;

  IF EXISTS (SELECT 1 FROM public.room_participants p WHERE p.room_id = p_room AND p.fingerprint = p_fingerprint) THEN
    UPDATE public.room_participants SET last_seen_at = now()
      WHERE room_id = p_room AND fingerprint = p_fingerprint;
  ELSE
    -- The BEFORE INSERT trigger enforces room existence, expiry and the participant limit.
    INSERT INTO public.room_participants (room_id, fingerprint, pseudo, pubkey, joined_at, last_seen_at)
      VALUES (p_room, p_fingerprint, p_pseudo, p_pubkey, now(), now())
      RETURNING joined_at INTO v_joined;
    inserted := true;
  END IF;

  IF inserted THEN
    PERFORM realtime.send(
      jsonb_build_object('fingerprint', p_fingerprint, 'joined_at', v_joined),
      'participant', 'room:' || p_room::text, false);
  END IF;
END;
$$;

-- 8. List participants of an active room (no public keys needed by the UI).
CREATE OR REPLACE FUNCTION public.cr_list_participants(p_room uuid)
RETURNS TABLE (fingerprint text, pseudo text, joined_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.fingerprint, p.pseudo, p.joined_at
  FROM public.room_participants p
  JOIN public.rooms r ON r.id = p.room_id AND r.expires_at > now()
  WHERE p.room_id = p_room
  ORDER BY p.joined_at;
$$;

-- 9. List the live messages of an active room.
CREATE OR REPLACE FUNCTION public.cr_list_messages(p_room uuid)
RETURNS TABLE (id uuid, sender_fingerprint text, sender_pubkey text, ciphertext text, iv text, signature text, created_at timestamptz, expires_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.id, m.sender_fingerprint, m.sender_pubkey, m.ciphertext, m.iv, m.signature, m.created_at, m.expires_at
  FROM public.messages m
  JOIN public.rooms r ON r.id = m.room_id AND r.expires_at > now()
  WHERE m.room_id = p_room
    AND (m.expires_at IS NULL OR m.expires_at > now())
    AND m.signature IS NOT NULL
  ORDER BY m.created_at
  LIMIT 5000;
$$;

-- 10. Post a message. Only an existing participant may post; the server sets the id,
--     timestamps and expiry (from the room's TTL) and broadcasts it to the room.
CREATE OR REPLACE FUNCTION public.cr_post_message(p_room uuid, p_fingerprint text, p_ciphertext text, p_iv text, p_signature text)
RETURNS TABLE (id uuid, created_at timestamptz, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_pseudo text;
  v_pubkey text;
  v_ttl int;
  v_id uuid;
  v_created timestamptz;
  v_expires timestamptz;
BEGIN
  SELECT p.pseudo, p.pubkey INTO v_pseudo, v_pubkey
    FROM public.room_participants p
    WHERE p.room_id = p_room AND p.fingerprint = p_fingerprint;
  IF v_pubkey IS NULL THEN RAISE EXCEPTION 'not_a_participant'; END IF;

  SELECT r.message_ttl_seconds INTO v_ttl
    FROM public.rooms r WHERE r.id = p_room AND r.expires_at > now();
  IF v_ttl IS NULL THEN RAISE EXCEPTION 'room_expired'; END IF;

  v_expires := CASE WHEN v_ttl > 0 THEN now() + make_interval(secs => v_ttl) ELSE NULL END;

  -- Size/format constraints and rate-limit triggers on public.messages still apply.
  INSERT INTO public.messages (room_id, sender_fingerprint, sender_pseudo, sender_pubkey, ciphertext, iv, signature, expires_at)
    VALUES (p_room, p_fingerprint, v_pseudo, v_pubkey, p_ciphertext, p_iv, p_signature, v_expires)
    RETURNING messages.id, messages.created_at INTO v_id, v_created;

  PERFORM realtime.send(
    jsonb_build_object(
      'id', v_id, 'sender_fingerprint', p_fingerprint, 'sender_pubkey', v_pubkey,
      'ciphertext', p_ciphertext, 'iv', p_iv, 'signature', p_signature,
      'created_at', v_created, 'expires_at', v_expires),
    'message', 'room:' || p_room::text, false);

  RETURN QUERY SELECT v_id, v_created, v_expires;
END;
$$;

-- 11. Rate-limit new participants (flooding DoS): at most 30 new participants per room
--     per minute; the room's max_participants limit still applies on top.
CREATE OR REPLACE FUNCTION public.rate_limit_joins()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (SELECT count(*) FROM public.room_participants p
        WHERE p.room_id = NEW.room_id AND p.joined_at > now() - interval '1 minute') >= 30 THEN
    RAISE EXCEPTION 'rate_limited';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS rate_limit_joins_before_insert ON public.room_participants;
CREATE TRIGGER rate_limit_joins_before_insert
  BEFORE INSERT ON public.room_participants
  FOR EACH ROW EXECUTE FUNCTION public.rate_limit_joins();

-- 12. Function privileges: internal helpers stay private, the API is callable by anon.
REVOKE ALL ON FUNCTION public.cr_fingerprint_of(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rate_limit_joins() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.room_participants_immutable_identity() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cr_get_room(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cr_join_room(uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cr_list_participants(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cr_list_messages(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cr_post_message(uuid, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cr_get_room(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cr_join_room(uuid, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cr_list_participants(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cr_list_messages(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cr_post_message(uuid, text, text, text, text) TO anon, authenticated;
