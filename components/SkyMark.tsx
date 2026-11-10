export function SkyMark({ className = "size-8" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 24h14a6 6 0 0 0 .7-12A8 8 0 0 0 8.4 9.6 7.3 7.3 0 0 0 9 24Z" />
      <path d="m12 16 3 3 5-6" />
    </svg>
  );
}
