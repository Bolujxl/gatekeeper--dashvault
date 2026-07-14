import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("hashPassword / verifyPassword", () => {
  it("produces a bcrypt hash, never the plaintext", async () => {
    const hash = await hashPassword("CorrectHorseBattery9");
    expect(hash).not.toBe("CorrectHorseBattery9");
    expect(hash).toMatch(/^\$2[aby]\$10\$/);
  });

  it("verifies the correct password", async () => {
    const hash = await hashPassword("CorrectHorseBattery9");
    await expect(verifyPassword("CorrectHorseBattery9", hash)).resolves.toBe(
      true
    );
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("CorrectHorseBattery9");
    await expect(verifyPassword("WrongPassword1", hash)).resolves.toBe(false);
  });

  it("rejects the hash itself submitted as a password", async () => {
    // Regression guard for docs/05-tinker.md's "bcrypt leak" experiment:
    // comparison must go through bcrypt, not `plaintext === hash`.
    const hash = await hashPassword("CorrectHorseBattery9");
    await expect(verifyPassword(hash, hash)).resolves.toBe(false);
  });

  it("produces different hashes for the same password (unique salts)", async () => {
    const [a, b] = await Promise.all([
      hashPassword("SamePassword1"),
      hashPassword("SamePassword1"),
    ]);
    expect(a).not.toBe(b);
  });
});
