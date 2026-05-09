-- Enforce max participant count at database level for anonymous rooms.
-- Existing participants may refresh/rejoin their own row; new participants are blocked when the room is full.
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
  WHERE r.id = NEW.room_id;

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

  SELECT count(*)
    INTO current_participants
  FROM public.room_participants p
  WHERE p.room_id = NEW.room_id;

  IF current_participants >= participant_limit THEN
    RAISE EXCEPTION 'room_participant_limit_reached';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_room_participant_limit_before_insert ON public.room_participants;
CREATE TRIGGER enforce_room_participant_limit_before_insert
BEFORE INSERT ON public.room_participants
FOR EACH ROW
EXECUTE FUNCTION public.enforce_room_participant_limit();

-- Tighten participant updates so clients can only refresh existing active-room participants.
DROP POLICY IF EXISTS "Anyone can update last_seen of participants" ON public.room_participants;
CREATE POLICY "Anyone can update last_seen of active participants"
  ON public.room_participants FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.rooms r
      WHERE r.id = room_participants.room_id AND r.expires_at > now()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.rooms r
      WHERE r.id = room_participants.room_id AND r.expires_at > now()
    )
  );