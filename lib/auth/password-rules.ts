export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export interface PasswordRule {
  id: string;
  label: string;
  message: string;
  test: (password: string) => boolean;
}

/**
 * Single source of truth for password complexity. Both the Zod schema
 * (server-side enforcement) and PasswordRules.tsx (live UI feedback) read
 * from this list so the two can't silently drift apart.
 */
export const PASSWORD_RULES: PasswordRule[] = [
  {
    id: "length",
    label: `${PASSWORD_MIN_LENGTH}+ characters`,
    message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
    test: (p) => p.length >= PASSWORD_MIN_LENGTH,
  },
  {
    id: "uppercase",
    label: "Uppercase",
    message: "Password must contain an uppercase letter",
    test: (p) => /[A-Z]/.test(p),
  },
  {
    id: "lowercase",
    label: "Lowercase",
    message: "Password must contain a lowercase letter",
    test: (p) => /[a-z]/.test(p),
  },
  {
    id: "number",
    label: "Number",
    message: "Password must contain a number",
    test: (p) => /[0-9]/.test(p),
  },
];
