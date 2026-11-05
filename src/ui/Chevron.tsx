export function Chevron({ right = false }: { right?: boolean }) {
  return (
    <svg
      className="chevron"
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={right ? "m9 18 6-6-6-6" : "m6 9 6 6 6-6"} />
    </svg>
  );
}
