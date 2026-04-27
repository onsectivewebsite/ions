/**
 * Decorative side panel for the sign-in page. Pure SVG + CSS gradients —
 * no raster images. Adapts to the active theme via CSS vars.
 */
export function AuthHero() {
  return (
    <div className="relative h-full w-full overflow-hidden rounded-[var(--radius-xl)]">
      {/* Background gradient */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 80% at 0% 0%, color-mix(in srgb, var(--color-primary) 18%, transparent) 0%, transparent 60%), radial-gradient(120% 80% at 100% 100%, color-mix(in srgb, var(--color-accent) 18%, transparent) 0%, transparent 60%), linear-gradient(180deg, var(--color-surface) 0%, var(--color-surface-muted) 100%)',
        }}
      />

      {/* Geometric mesh */}
      <svg
        className="absolute inset-0 h-full w-full opacity-[0.5]"
        viewBox="0 0 600 800"
        preserveAspectRatio="xMidYMid slice"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden
      >
        <defs>
          <linearGradient id="hero-line" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--color-primary)" stopOpacity="0.55" />
            <stop offset="1" stopColor="var(--color-accent)" stopOpacity="0.05" />
          </linearGradient>
          <pattern id="hero-grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" stroke="var(--color-border)" strokeWidth="0.4" fill="none" />
          </pattern>
        </defs>
        <rect width="600" height="800" fill="url(#hero-grid)" />
        <g stroke="url(#hero-line)" strokeWidth="1.4" fill="none">
          <path d="M -50 200 Q 200 80 320 220 T 700 280" />
          <path d="M -50 320 Q 200 200 320 340 T 700 400" />
          <path d="M -50 440 Q 200 320 320 460 T 700 520" />
          <path d="M -50 560 Q 200 440 320 580 T 700 640" />
        </g>
        <g fill="var(--color-primary)" opacity="0.9">
          <circle cx="120" cy="220" r="3.5" />
          <circle cx="320" cy="340" r="3.5" />
          <circle cx="240" cy="460" r="3.5" />
          <circle cx="440" cy="580" r="3.5" />
          <circle cx="160" cy="640" r="3.5" />
        </g>
      </svg>

      {/* Foreground content */}
      <div className="relative flex h-full flex-col justify-between p-10">
        <div className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1 text-xs font-medium text-[var(--color-text-muted)] w-fit">
          <span className="inline-block h-2 w-2 rounded-full bg-[var(--color-success)]" />
          PIPEDA-ready · Canada
        </div>

        <div className="space-y-4">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight text-[var(--color-text)]">
            One workspace for the whole<br />immigration practice.
          </h2>
          <p className="max-w-md text-sm leading-relaxed text-[var(--color-text-muted)]">
            Leads, intake, consultations, retainers, document collection, and
            IRCC submissions — wired together for Canadian law firms, with
            AI on tap when you want it.
          </p>

          <ul className="space-y-2.5 pt-2">
            {[
              'Phone-first client lookup with full history',
              'In-house e-signed retainers',
              'Filing gated on cleared balance',
              'Calls + recordings via your Twilio',
            ].map((line) => (
              <li
                key={line}
                className="flex items-start gap-2.5 text-sm text-[var(--color-text)]"
              >
                <svg
                  className="mt-0.5 flex-shrink-0"
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  aria-hidden
                >
                  <circle cx="8" cy="8" r="7" fill="var(--color-primary)" opacity="0.12" />
                  <path d="M5 8.5L7 10.5L11 6" stroke="var(--color-primary)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {line}
              </li>
            ))}
          </ul>
        </div>

        <div className="text-xs text-[var(--color-text-muted)]">
          Built by Onsective Inc. · Hosted in Canada
        </div>
      </div>
    </div>
  );
}
