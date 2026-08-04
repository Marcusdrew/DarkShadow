import { createServerFn } from "@tanstack/react-start";

const ALLOWED_DURATIONS = [300, 900, 3600, 86400];
const ALLOWED_TTL = [0, 30, 300];
const ALLOWED_MAX = [2, 4, 8, 16];

export const createRoom = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      token: string;
      durationSeconds: number;
      ttlSeconds: number;
      maxParticipants: number;
    }) => {
      if (!data || typeof data.token !== "string" || data.token.length === 0) {
        throw new Error("missing_turnstile_token");
      }
      if (!ALLOWED_DURATIONS.includes(data.durationSeconds)) throw new Error("bad_duration");
      if (!ALLOWED_TTL.includes(data.ttlSeconds)) throw new Error("bad_ttl");
      if (!ALLOWED_MAX.includes(data.maxParticipants)) throw new Error("bad_max");
      return data;
    },
  )
  .handler(async ({ data }) => {
    const { verifyTurnstileToken } = await import("./turnstile.server");
    if (!(await verifyTurnstileToken(data.token))) {
      return { ok: false as const, error: "captcha_failed" };
    }
    const { generateRoomSaltServer, roomFingerprintServer } = await import("./rooms.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const id = crypto.randomUUID();
    const { error } = await supabaseAdmin.from("rooms").insert({
      id,
      expires_at: new Date(Date.now() + data.durationSeconds * 1000).toISOString(),
      max_participants: data.maxParticipants,
      message_ttl_seconds: data.ttlSeconds,
      fingerprint: await roomFingerprintServer(id),
      salt: generateRoomSaltServer(),
    });
    if (error) return { ok: false as const, error: "insert_failed" };
    return { ok: true as const, roomId: id };
  });
