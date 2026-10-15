import type { ReactNode } from 'react';
import { faLabel, PLATFORM_FA } from '../lib/format';
import { TelegramIcon, BaleIcon, RubikaIcon } from './PlatformIcons';

type Platform = 'telegram' | 'bale' | 'rubika';

const iconMap: Record<Platform, ReactNode> = {
  telegram: <TelegramIcon size={16} />,
  bale: <BaleIcon size={16} />,
  rubika: <RubikaIcon size={16} />,
};

export function PlatformBadge({ platform }: { platform: Platform | string }) {
  const key = platform as Platform;
  return (
    <span className={`platform-badge platform-badge--${key}`} title={faLabel(key, PLATFORM_FA)}>
      {iconMap[key] ?? null}
      <strong>{faLabel(key, PLATFORM_FA)}</strong>
    </span>
  );
}
