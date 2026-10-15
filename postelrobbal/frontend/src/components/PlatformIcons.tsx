import type { CSSProperties } from 'react';

/**
 * OFFICIAL platform logos (feedback round 15, item 3): no self-drawn icons.
 * - Telegram: official round logo from telegram.org (t_logo)
 * - Bale:     official teal logo from blog.bale.ai official download page
 * - Rubika:   official cube logo from rubika.ir/logo
 * All are official files, trimmed to a square symbol with transparency and
 * shipped from src/assets/platforms (resolved depth-proof via import.meta.url).
 */
const telegramUrl = new URL('../assets/platforms/telegram.png', import.meta.url).href;
const baleUrl = new URL('../assets/platforms/bale.png', import.meta.url).href;
const rubikaUrl = new URL('../assets/platforms/rubika.png', import.meta.url).href;
const rubikaLockupUrl = new URL('../assets/platforms/rubika-lockup.png', import.meta.url).href;
const baleLockupUrl = new URL('../assets/platforms/bale-lockup.png', import.meta.url).href;

type IconProps = { size?: number; className?: string; style?: CSSProperties };

function img(src: string, alt: string, { size = 24, className, style }: IconProps) {
  return (
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      className={className}
      style={{ display: 'block', width: size, height: size, objectFit: 'contain', flexShrink: 0, ...style }}
      draggable={false}
    />
  );
}

export function TelegramIcon(props: IconProps) {
  return img(telegramUrl, 'تلگرام', props);
}

export function BaleIcon(props: IconProps) {
  return img(baleUrl, 'بله', props);
}

export function RubikaIcon(props: IconProps) {
  return img(rubikaUrl, 'روبیکا', props);
}

/** Full official lockups (symbol + brand wordmark) for larger showcases. */
export function RubikaLockup({ height = 40, className, style }: { height?: number; className?: string; style?: CSSProperties }) {
  return (
    <img
      src={rubikaLockupUrl}
      alt="روبیکا"
      className={className}
      style={{ display: 'block', height, width: 'auto', ...style }}
      draggable={false}
    />
  );
}

export function BaleLockup({ height = 40, className, style }: { height?: number; className?: string; style?: CSSProperties }) {
  return (
    <img
      src={baleLockupUrl}
      alt="بله"
      className={className}
      style={{ display: 'block', height, width: 'auto', ...style }}
      draggable={false}
    />
  );
}

/** Convenience map for strips/footers. */
export const PLATFORM_ICONS = {
  telegram: TelegramIcon,
  bale: BaleIcon,
  rubika: RubikaIcon,
} as const;
