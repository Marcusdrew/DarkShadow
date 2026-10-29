/** Cloudflare Turnstile testing secret (always passes). Only ever used in local development. */
const TEST_SECRET = "1x0000000000000000000000000000000AA";

export const TURNSTILE_ACTION = "create_room";

/**
 * Verify a Turnstile token against Cloudflare. Server-only. Fails closed in production.
 * The token must have been issued for our action and, when TURNSTILE_ALLOWED_HOSTNAMES is set
 * (comma-separated), for one of our hostnames — so tokens farmed on another site are rejected.
 */
export async function verifyTurnstileToken(token: string, remoteIp?: string | null): Promise<boolean> {
  if (!token || token.length > 2048) return false;
  const configured = process.env["TURNSTILE_SECRET_KEY"];
  const isProd = process.env["NODE_ENV"] === "production";
  if (!configured && isProd) {
    console.error("TURNSTILE_SECRET_KEY is not set: refusing to create rooms.");
    return false;
  }
  const secret = configured || TEST_SECRET;
  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp) body.set("remoteip", remoteIp);
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
      signal: AbortSignal.timeout(8000),
    });
    const json = (await res.json()) as { success?: boolean; action?: string; hostname?: string };
    if (json.success !== true) return false;
    if (configured) {
      if (json.action !== TURNSTILE_ACTION) return false;
      const allowed = (process.env["TURNSTILE_ALLOWED_HOSTNAMES"] ?? "")
        .split(",")
        .map((h) => h.trim().toLowerCase())
        .filter(Boolean);
      if (allowed.length > 0 && !allowed.includes((json.hostname ?? "").toLowerCase())) return false;
    }
    return true;
  } catch {
    return false;
  }
}
