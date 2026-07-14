import { describe, expect, it } from "vitest";
import { PASSWORD_RULES } from "./password-rules";

function metRuleIds(password: string): string[] {
  return PASSWORD_RULES.filter((rule) => rule.test(password)).map(
    (r) => r.id
  );
}

describe("PASSWORD_RULES", () => {
  it("all pass for a fully compliant password", () => {
    expect(metRuleIds("Abcdefg1")).toEqual(
      PASSWORD_RULES.map((r) => r.id)
    );
  });

  it("flags a too-short password", () => {
    expect(metRuleIds("Ab1")).not.toContain("length");
  });

  it("flags a password with no uppercase letter", () => {
    expect(metRuleIds("abcdefg1")).not.toContain("uppercase");
  });

  it("flags a password with no lowercase letter", () => {
    expect(metRuleIds("ABCDEFG1")).not.toContain("lowercase");
  });

  it("flags a password with no digit", () => {
    expect(metRuleIds("Abcdefgh")).not.toContain("number");
  });
});
