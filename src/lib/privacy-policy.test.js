import { describe, expect, test } from "bun:test";
import { canRevealChannel } from "./privacy-policy";

describe("mobile privacy shield", () => {
  test("background documents cannot reveal a channel", () => {
    expect(canRevealChannel("hidden", true)).toBe(false);
  });
  test("unfocused documents cannot reveal a channel", () => {
    expect(canRevealChannel("visible", false)).toBe(false);
  });
  test("a visible focused document allows explicit resumption", () => {
    expect(canRevealChannel("visible", true)).toBe(true);
  });
});