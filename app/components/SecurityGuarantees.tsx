const GUARANTEES = [
  "Your password is hashed, never stored.",
  "Your session lives in a secure cookie.",
  "The server validates everything.",
];

export default function SecurityGuarantees() {
  return (
    <ul className="space-y-2.5">
      {GUARANTEES.map((line) => (
        <li
          key={line}
          className="flex items-start gap-3 text-sm text-on-surface-variant"
        >
          <span
            className="text-primary mt-1 text-xs leading-none flex-shrink-0"
            aria-hidden="true"
          >
            {"\u25C7"}
          </span>
          <span>{line}</span>
        </li>
      ))}
    </ul>
  );
}
