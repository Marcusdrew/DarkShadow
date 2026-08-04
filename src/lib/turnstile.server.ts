/** Cloudflare Turnstile testing secret (always passes) used when no secret is configured. */
const TEST_SECRET = "1x0000000000000000000000000000000AA";

/** Verify a Turnstile token against Cloudflare. Server-only. */
export async function verifyTurnstileToken(token: string): Promise<boolean> {
  if (!token) return false;
  const secret = process.env["TURNSTILE_SECRET_KEY"] || TEST_SECRET;
  const body = new URLSearchParams({ secret, response: token });
  const res = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    { method: "POST", body },
  );
  const json = (await res.json()) as { success?: boolean };
  return json.success === true;
}
