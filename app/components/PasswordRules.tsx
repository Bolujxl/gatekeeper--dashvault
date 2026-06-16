"use client";

interface PasswordRulesProps {
  password: string;
}

interface Rule {
  label: string;
  test: (password: string) => boolean;
}

const RULES: Rule[] = [
  { label: "At least 8 characters", test: (p) => p.length >= 8 },
  { label: "An uppercase letter", test: (p) => /[A-Z]/.test(p) },
  { label: "A lowercase letter", test: (p) => /[a-z]/.test(p) },
  { label: "A number", test: (p) => /[0-9]/.test(p) },
];

export default function PasswordRules({ password }: PasswordRulesProps) {
  return (
    <ul className="space-y-1.5 mt-3" aria-label="Password requirements">
      {RULES.map((rule) => {
        const met = rule.test(password);
        return (
          <li
            key={rule.label}
            className="flex items-center gap-2 text-sm transition-colors"
          >
            <span
              className={`
                w-4 h-4 rounded-full flex items-center justify-center text-xs flex-shrink-0
                ${met
                  ? "bg-primary text-on-primary"
                  : "bg-surface-variant text-on-surface-variant"
                }
              `}
              aria-hidden="true"
            >
              {met ? "\u2713" : "\u00B7"}
            </span>
            <span
              className={met ? "text-on-surface" : "text-on-surface-variant"}
            >
              {rule.label}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
