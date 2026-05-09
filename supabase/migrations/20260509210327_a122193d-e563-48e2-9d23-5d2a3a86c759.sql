-- Restrict room creation policy to valid CipherRoom settings instead of allowing every payload.
DROP POLICY IF EXISTS "Anyone can create a room" ON public.rooms;
CREATE POLICY "Anyone can create valid ephemeral rooms"
  ON public.rooms FOR INSERT
  WITH CHECK (
    expires_at > now()
    AND expires_at <= now() + interval '24 hours'
    AND max_participants BETWEEN 2 AND 16
    AND message_ttl_seconds IN (0, 30, 300)
    AND fingerprint ~ '^[0-9a-f]{16}$'
  );

-- The participant-limit trigger function is internal-only.
REVOKE ALL ON FUNCTION public.enforce_room_participant_limit() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_room_participant_limit() FROM anon;
REVOKE ALL ON FUNCTION public.enforce_room_participant_limit() FROM authenticated;