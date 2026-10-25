import { createServerFn } from "@tanstack/react-start";

const ALLOWED_DURATIONS = [300, 900, 3600, 86400];
const ALLOWED_TTL = [0, 30, 300];
const ALLOWED_MAX = [2, 4, 8, 16];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FP_RE = /^[0-9a-f]{16}$/;

/**
 * The client generates the room SECRET and only sends its one-way derived public id and
 * fingerprint. The server never receives the secret, so it cannot derive the room key.
 */
export const createRoom = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      token: string;
      publicId: string;
      fingerprint: string;
      durationSeconds: number;
      ttlSeconds: number;
      maxParticipants: number;
    }) => {
      if (!data || typeof data.token !== "string" || data.token.length === 0) {
        throw new Error("missing_turnstile_token");
      }
      if (typeof data.publicId !== "string" || !UUID_RE.test(data.publicId)) throw new Error("bad_id");
      if (typeof data.fingerprint !== "string" || !FP_RE.test(data.fingerprint)) throw new Error("bad_fp");
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
    const { generateRoomSaltServer } = await import("./rooms.server");
    const { createExternalAdmin } = await import("@/integrations/supabase/external.server");

    let admin;
    try {
      admin = createExternalAdmin();
    } catch {
      console.error("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY is not set: cannot create rooms.");
      return { ok: false as const, error: "server_misconfigured" };
    }
    const { error } = await admin.from("rooms").insert({
      id: data.publicId,
      expires_at: new Date(Date.now() + data.durationSeconds * 1000).toISOString(),
      max_participants: data.maxParticipants,
      message_ttl_seconds: data.ttlSeconds,
      fingerprint: data.fingerprint,
      salt: generateRoomSaltServer(),
    });
    if (error) {
      console.error("room insert failed:", error.code, error.message);
      return { ok: false as const, error: "insert_failed" };
    }
    return { ok: true as const };
  });
