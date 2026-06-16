import { ButtonHTMLAttributes, forwardRef } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost";
  loading?: boolean;
}

const VARIANTS = {
  primary: "bg-primary text-on-primary hover:opacity-90 active:opacity-80",
  secondary: "border border-outline text-on-surface hover:bg-surface-variant",
  ghost: "text-on-surface hover:bg-surface-variant",
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      loading = false,
      disabled,
      children,
      className = "",
      ...props
    },
    ref
  ) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={`
          w-full px-4 py-2.5 rounded-lg
          font-semibold text-sm
          ${VARIANTS[variant]}
          disabled:opacity-50 disabled:cursor-not-allowed
          transition-all
          flex items-center justify-center gap-2
          ${className}
        `}
        {...props}
      >
        {loading ? (
          <>
            <span
              className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"
              aria-hidden="true"
            />
            <span>Loading…</span>
          </>
        ) : (
          children
        )}
      </button>
    );
  }
);

Button.displayName = "Button";

export default Button;
