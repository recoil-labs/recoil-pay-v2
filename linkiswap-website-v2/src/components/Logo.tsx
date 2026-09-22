interface LogoProps {
  /** Mark height in px; the wordmark scales from it. */
  height?: number;
  /** Mark only, for the collapsed mobile bar. */
  markOnly?: boolean;
}

/**
 * The RecoilPay lockup, shared with v1.
 *
 * The previous logo drew "LinkiSwap" as vector letterform paths, which meant
 * the brand could not be renamed without redrawing glyphs and the wordmark
 * never followed the theme. The mark is the only vector now; the word is real
 * text in the site's own face, so it inherits colour and optical sizing.
 *
 * The mark is two counter-facing arrows on a shared axis — the return stroke
 * that gives "recoil" its meaning, and the exchange the product performs.
 * Identical to v1's so the two properties read as one brand.
 */
export default function Logo({ height = 22, markOnly = false }: LogoProps) {
  return (
    <span className="inline-flex items-center gap-2 select-none" aria-label="RecoilPay">
      <img src="/logo.png" alt="" width={height} height={height} aria-hidden="true" className="shrink-0 rounded-[22%]" />

      {!markOnly && (
        <span className="flex items-baseline gap-1.5">
          <span
            className="font-sans leading-none text-app-text"
            style={{ fontSize: height * 0.82, fontWeight: 500, letterSpacing: 'var(--tracking-ui)' }}
          >
            Recoil<span className="text-primary">Pay</span>
          </span>
          {/* A quiet mono tag rather than a coloured badge: it labels the
              surface (this is the intent product) without shouting. */}
          <span className="font-mono text-[10px] leading-none text-text-muted" aria-hidden="true">
            intents
          </span>
        </span>
      )}
    </span>
  );
}
