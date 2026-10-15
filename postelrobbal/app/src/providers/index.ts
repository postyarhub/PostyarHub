import { ProviderAdapter, Platform } from './types.js';
import { TelegramAdapter } from './telegram/telegram.js';
import { BaleAdapter } from './bale/bale.js';
import { RubikaAdapter } from './rubika/rubika.js';

const adapters: Record<Platform, ProviderAdapter> = {
  telegram: new TelegramAdapter(),
  bale: new BaleAdapter(),
  rubika: new RubikaAdapter(),
};

export function getProvider(platform: Platform): ProviderAdapter {
  return adapters[platform];
}

export const PLATFORM_LABELS_FA: Record<Platform, string> = {
  telegram: 'تلگرام',
  bale: 'بله',
  rubika: 'روبیکا',
};
