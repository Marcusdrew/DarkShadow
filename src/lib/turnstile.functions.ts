import { createServerFn } from "@tanstack/react-start";

/** Cloudflare Turnstile testing secret (always passes) used when no secret is configured. */
const TEST_SECRET = "1x0000000000000000000000000000000AA";

export const verifyTurnstile = createServerFn({ method: "POST" })
  .inputValidator((data: { token: string }) => {
    if (!data || typeof data.token !== "string" || data.token.length === 0) {
      throw new Error("missing_turnstile_token");
    }
    return { token: data.token };
  })
  .handler(async ({ data }) => {
    const secret = process.env["TURNSTILE_SECRET_KEY"] || TEST_SECRET;
    const body = new URLSearchParams({ secret, response: data.token });
    const res = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      { method: "POST", body },
    );
    const json = (await res.json()) as { success?: boolean };
    return { success: json.success === true };
  });
