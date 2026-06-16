interface LogoProps {
  size?: number;
  className?: string;
}

export default function Logo({ size = 24, className = "" }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <g transform="rotate(15 12 12)">
        <rect
          x="3"
          y="3"
          width="18"
          height="18"
          rx="4"
          fill="currentColor"
          className="text-primary"
        />
        <rect
          x="10"
          y="2"
          width="4"
          height="3"
          rx="1"
          fill="currentColor"
          className="text-background"
        />
      </g>
    </svg>
  );
}
