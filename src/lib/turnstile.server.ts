/** Cloudflare Turnstile testing secret (always passes). Only ever used in local development. */
const TEST_SECRET = "1x0000000000000000000000000000000AA";

/** Verify a Turnstile token against Cloudflare. Server-only. Fails closed in production. */
export async function verifyTurnstileToken(token: string): Promise<boolean> {
  if (!token) return false;
  const configured = process.env["TURNSTILE_SECRET_KEY"];
  const isProd = process.env["NODE_ENV"] === "production";
  if (!configured && isProd) {
    console.error("TURNSTILE_SECRET_KEY is not set: refusing to create rooms.");
    return false;
  }
  const secret = configured || TEST_SECRET;
  const body = new URLSearchParams({ secret, response: token });
  try {
    const res = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      { method: "POST", body },
    );
    const json = (await res.json()) as { success?: boolean };
    return json.success === true;
  } catch {
    return false;
  }
}
