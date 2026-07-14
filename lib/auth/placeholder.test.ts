import { describe, expect, it } from "vitest";
import { getPlaceholderHash } from "./placeholder";
import { verifyPassword } from "./password";

describe("getPlaceholderHash", () => {
  it("returns a structurally valid bcrypt hash", async () => {
    const hash = await getPlaceholderHash();
    expect(hash).toMatch(/^\$2[aby]\$10\$/);
  });

  it("is computed once and cached across calls", async () => {
    const [a, b] = await Promise.all([
      getPlaceholderHash(),
      getPlaceholderHash(),
    ]);
    expect(a).toBe(b);
  });

  it("never matches an empty or guessable password", async () => {
    const hash = await getPlaceholderHash();
    await expect(verifyPassword("", hash)).resolves.toBe(false);
    await expect(verifyPassword("password", hash)).resolves.toBe(false);
  });
});
