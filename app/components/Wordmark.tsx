import Link from "next/link";
import Logo from "./Logo";

interface WordmarkProps {
  size?: "sm" | "md" | "lg";
}

const SIZES = {
  sm: { logo: 18, text: "text-base" },
  md: { logo: 24, text: "text-lg" },
  lg: { logo: 32, text: "text-2xl" },
};

export default function Wordmark({ size = "md" }: WordmarkProps) {
  const { logo, text } = SIZES[size];

  return (
    <Link href="/" className="flex items-center gap-2.5 hover:opacity-80 transition-opacity">
      <Logo size={logo} />
      <span
        className={`${text} font-semibold text-on-background tracking-tight`}
      >
        Dashvault
      </span>
    </Link>
  );
}
