import type { CSSProperties } from 'react';

/**
 * Brand logo (feedback round 15, item 5): ONLY the official reference logo
 * asset is used — the envelope + orange wing mark from the brand reference
 * file. No self-drawn SVG marks anywhere.
 *
 * - default        → reference mark + «پُست‌یار» wordmark as crisp HTML text
 * - withWordmark=false → reference mark only
 * - full           → the complete reference lockup (mark + wordmark + tagline)
 *
 * variant 'dark'  → for light backgrounds (dark wordmark text)
 * variant 'light' → for dark backgrounds/footers (white wordmark text)
 *
 * Asset URLs are resolved through new URL(..., import.meta.url) so they work
 * at any route depth with the relative Vite base.
 */
const markUrl = new URL('../assets/brand/logo-mark.webp', import.meta.url).href;
const fullUrl = new URL('../assets/brand/logo-full.webp', import.meta.url).href;

export function Logo({
  variant = 'dark',
  size = 36,
  withWordmark = true,
  wordmarkSize,
  full = false,
  className,
  style,
}: {
  variant?: 'dark' | 'light';
  /** Height in px of the mark (or of the full lockup when `full` is set). */
  size?: number;
  withWordmark?: boolean;
  wordmarkSize?: number;
  /** Render the complete reference lockup image (mark + wordmark + tagline). */
  full?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const isLight = variant === 'light';

  if (full) {
    return (
      <img
        src={fullUrl}
        alt="پُست‌یار — همیار هوشمند ارسال شما"
        className={className}
        style={{ display: 'block', height: size * 1.5, width: 'auto', ...style }}
        draggable={false}
      />
    );
  }

  return (
    <span
      className={className}
      style={{ display: 'inline-flex', alignItems: 'center', gap: Math.max(7, size * 0.24), ...style }}
    >
      <img
        src={markUrl}
        alt="لوگوی پُست‌یار"
        style={{ display: 'block', height: size, width: 'auto', flexShrink: 0 }}
        draggable={false}
      />
      {withWordmark && (
        <span
          style={{
            fontSize: wordmarkSize ?? Math.round(size * 0.56),
            fontWeight: 900,
            lineHeight: 1.2,
            color: isLight ? '#ffffff' : 'var(--text)',
            letterSpacing: '-0.2px',
            whiteSpace: 'nowrap',
          }}
        >
          پُست‌یار
        </span>
      )}
    </span>
  );
}
