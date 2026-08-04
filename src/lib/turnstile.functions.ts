import { createServerFn } from "@tanstack/react-start";

export const verifyTurnstile = createServerFn({ method: "POST" })
  .inputValidator((data: { token: string }) => {
    if (!data || typeof data.token !== "string" || data.token.length === 0) {
      throw new Error("missing_turnstile_token");
    }
    return { token: data.token };
  })
  .handler(async ({ data }) => {
    const { verifyTurnstileToken } = await import("./turnstile.server");
    return { success: await verifyTurnstileToken(data.token) };
  });
