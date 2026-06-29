"use client";

interface PasswordRulesProps {
  password: string;
}

interface Rule {
  label: string;
  test: (password: string) => boolean;
}

const RULES: Rule[] = [
  { label: "8+ characters", test: (p) => p.length >= 8 },
  { label: "Uppercase", test: (p) => /[A-Z]/.test(p) },
  { label: "Lowercase", test: (p) => /[a-z]/.test(p) },
  { label: "Number", test: (p) => /[0-9]/.test(p) },
];

export default function PasswordRules({ password }: PasswordRulesProps) {
  return (
    <div className="mt-3" aria-label="Password requirements">
      <p className="text-xs text-on-surface-variant mb-2 font-medium">
        Your password needs
      </p>
      <div className="flex flex-wrap gap-1.5">
        {RULES.map((rule) => {
          const met = rule.test(password);
          return (
            <span
              key={rule.label}
              className={`
                inline-flex items-center
                px-2.5 py-1 rounded-md
                text-[11px]
                border transition-all duration-200
                ${
                  met
                    ? "bg-primary-container border-primary text-on-primary-container font-semibold"
                    : "bg-transparent border-outline-variant text-on-surface-variant font-medium"
                }
              `}
              aria-label={`${rule.label}: ${met ? "met" : "not met"}`}
            >
              {rule.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}
