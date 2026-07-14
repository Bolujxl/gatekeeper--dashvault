import { describe, expect, it } from "vitest";
import { signupSchema, loginSchema } from "./schemas";

describe("signupSchema", () => {
  const valid = { name: "Ada", email: "ada@example.com", password: "Abcdefg1" };

  it("accepts a fully valid signup", () => {
    expect(signupSchema.safeParse(valid).success).toBe(true);
  });

  it("trims and lowercases the email", () => {
    const result = signupSchema.safeParse({
      ...valid,
      email: "  Ada@Example.com  ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("ada@example.com");
    }
  });

  it("rejects a password missing complexity (drift check vs PASSWORD_RULES)", () => {
    const result = signupSchema.safeParse({ ...valid, password: "alllower1" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.message.includes("uppercase"))
      ).toBe(true);
    }
  });

  it("rejects a password over the max length", () => {
    const result = signupSchema.safeParse({
      ...valid,
      password: "Aa1" + "a".repeat(130),
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty name", () => {
    expect(signupSchema.safeParse({ ...valid, name: "" }).success).toBe(false);
  });

  it("rejects a malformed email", () => {
    expect(
      signupSchema.safeParse({ ...valid, email: "not-an-email" }).success
    ).toBe(false);
  });
});

describe("loginSchema", () => {
  it("only requires a non-empty password, no complexity rules", () => {
    const result = loginSchema.safeParse({
      email: "ada@example.com",
      password: "a",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty password", () => {
    const result = loginSchema.safeParse({
      email: "ada@example.com",
      password: "",
    });
    expect(result.success).toBe(false);
  });
});
