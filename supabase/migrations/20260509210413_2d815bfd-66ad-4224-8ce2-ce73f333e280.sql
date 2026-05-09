-- Serialize participant joins per room so max_participants cannot be bypassed by simultaneous joins.
CREATE OR REPLACE FUNCTION public.enforce_room_participant_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  participant_limit integer;
  current_participants integer;
  room_active boolean;
BEGIN
  SELECT r.max_participants, r.expires_at > now()
    INTO participant_limit, room_active
  FROM public.rooms r
  WHERE r.id = NEW.room_id
  FOR UPDATE;

  IF participant_limit IS NULL THEN
    RAISE EXCEPTION 'room_not_found';
  END IF;

  IF NOT room_active THEN
    RAISE EXCEPTION 'room_expired';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.room_participants p
    WHERE p.room_id = NEW.room_id
      AND p.fingerprint = NEW.fingerprint
  ) THEN
    RETURN NEW;
  END IF;

  SELECT count(DISTINCT p.fingerprint)
    INTO current_participants
  FROM public.room_participants p
  WHERE p.room_id = NEW.room_id;

  IF current_participants >= participant_limit THEN
    RAISE EXCEPTION 'room_participant_limit_reached';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_room_participant_limit() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_room_participant_limit() FROM anon;
REVOKE ALL ON FUNCTION public.enforce_room_participant_limit() FROM authenticated;