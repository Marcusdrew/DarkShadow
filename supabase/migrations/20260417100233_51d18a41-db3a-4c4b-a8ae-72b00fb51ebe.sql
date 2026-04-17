
-- Rooms: ephemeral chat rooms
CREATE TABLE public.rooms (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  expires_at TIMESTAMPTZ NOT NULL,
  max_participants INT NOT NULL DEFAULT 8,
  message_ttl_seconds INT NOT NULL DEFAULT 0, -- 0 = session, otherwise seconds
  fingerprint TEXT NOT NULL, -- room key fingerprint (for verification)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Messages: encrypted payloads
CREATE TABLE public.messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  sender_fingerprint TEXT NOT NULL,
  sender_pseudo TEXT NOT NULL,
  ciphertext TEXT NOT NULL, -- base64 AES-GCM ciphertext
  iv TEXT NOT NULL, -- base64 IV
  expires_at TIMESTAMPTZ, -- nullable for session-persistent
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_messages_room_id ON public.messages(room_id);
CREATE INDEX idx_messages_expires_at ON public.messages(expires_at);

-- Room participants
CREATE TABLE public.room_participants (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  pseudo TEXT NOT NULL,
  pubkey TEXT NOT NULL,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(room_id, fingerprint)
);

CREATE INDEX idx_participants_room_id ON public.room_participants(room_id);

-- Enable RLS
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_participants ENABLE ROW LEVEL SECURITY;

-- RLS: room id is the shared secret. Anyone who knows it can interact.
-- Rooms: anyone can create, anyone can read non-expired, no updates, no deletes (auto-expire).
CREATE POLICY "Anyone can create a room"
  ON public.rooms FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can read non-expired rooms"
  ON public.rooms FOR SELECT
  USING (expires_at > now());

-- Messages: anyone can insert/read messages in non-expired rooms
CREATE POLICY "Anyone can insert messages in active rooms"
  ON public.messages FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.rooms r
      WHERE r.id = messages.room_id AND r.expires_at > now()
    )
  );

CREATE POLICY "Anyone can read non-expired messages in active rooms"
  ON public.messages FOR SELECT
  USING (
    (expires_at IS NULL OR expires_at > now())
    AND EXISTS (
      SELECT 1 FROM public.rooms r
      WHERE r.id = messages.room_id AND r.expires_at > now()
    )
  );

-- Participants: anyone can join/read participants in active rooms
CREATE POLICY "Anyone can join active rooms"
  ON public.room_participants FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.rooms r
      WHERE r.id = room_participants.room_id AND r.expires_at > now()
    )
  );

CREATE POLICY "Anyone can read participants of active rooms"
  ON public.room_participants FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.rooms r
      WHERE r.id = room_participants.room_id AND r.expires_at > now()
    )
  );

CREATE POLICY "Anyone can update last_seen of participants"
  ON public.room_participants FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.rooms r
      WHERE r.id = room_participants.room_id AND r.expires_at > now()
    )
  );

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.room_participants;
ALTER TABLE public.messages REPLICA IDENTITY FULL;
ALTER TABLE public.room_participants REPLICA IDENTITY FULL;
