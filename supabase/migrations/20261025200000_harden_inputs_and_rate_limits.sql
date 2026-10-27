-- Hardening after the security audit.
-- The room SECRET is now client-side only; `rooms.id` is a one-way public id (SHA-256 of the
-- secret), so reading `rooms`/`messages` no longer exposes any decryption key.

-- 1. Input validation (NOT VALID: existing rows are not re-checked, new writes are).
ALTER TABLE public.rooms
  DROP CONSTRAINT IF EXISTS rooms_fingerprint_format,
  ADD CONSTRAINT rooms_fingerprint_format CHECK (fingerprint ~ '^[0-9a-f]{16}$') NOT VALID,
  DROP CONSTRAINT IF EXISTS rooms_salt_present,
  ADD CONSTRAINT rooms_salt_present CHECK (salt IS NOT NULL AND length(salt) BETWEEN 16 AND 64) NOT VALID;

ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_size_limits,
  ADD CONSTRAINT messages_size_limits CHECK (
    length(ciphertext) BETWEEN 1 AND 16000
    AND length(iv) BETWEEN 12 AND 32
    AND sender_fingerprint ~ '^[0-9a-f]{16}$'
    AND length(sender_pseudo) BETWEEN 1 AND 40
  ) NOT VALID;

ALTER TABLE public.room_participants
  DROP CONSTRAINT IF EXISTS participants_format,
  ADD CONSTRAINT participants_format CHECK (
    fingerprint ~ '^[0-9a-f]{16}$'
    AND length(pseudo) BETWEEN 1 AND 40
    AND length(pubkey) BETWEEN 1 AND 200
  ) NOT VALID;

-- 2. Rate limits (public roles are anonymous, so limits are per room).
CREATE OR REPLACE FUNCTION public.rate_limit_messages()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (SELECT count(*) FROM public.messages m
        WHERE m.room_id = NEW.room_id
          AND m.created_at > now() - interval '10 seconds') >= 60 THEN
    RAISE EXCEPTION 'rate_limited';
  END IF;
  IF (SELECT count(*) FROM public.messages m
        WHERE m.room_id = NEW.room_id
          AND m.sender_fingerprint = NEW.sender_fingerprint
          AND m.created_at > now() - interval '10 seconds') >= 15 THEN
    RAISE EXCEPTION 'rate_limited';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rate_limit_messages_before_insert ON public.messages;
CREATE TRIGGER rate_limit_messages_before_insert
  BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.rate_limit_messages();

REVOKE ALL ON FUNCTION public.rate_limit_messages() FROM PUBLIC, anon, authenticated;

-- 3. Cap stored messages per room (storage abuse).
CREATE OR REPLACE FUNCTION public.cap_messages_per_room()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (SELECT count(*) FROM public.messages m WHERE m.room_id = NEW.room_id) >= 5000 THEN
    RAISE EXCEPTION 'room_message_cap_reached';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cap_messages_per_room_before_insert ON public.messages;
CREATE TRIGGER cap_messages_per_room_before_insert
  BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.cap_messages_per_room();

REVOKE ALL ON FUNCTION public.cap_messages_per_room() FROM PUBLIC, anon, authenticated;
