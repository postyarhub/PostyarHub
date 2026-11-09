import type { Platform } from '../providers/types.js';

/**
 * Keep Bale photo posts as individual messages.
 *
 * Bale's client exposes native per-message actions (share / magazine / story)
 * for ordinary channel messages. sendMediaGroup turns several deliveries into
 * one grouped album and this integration retains only the first message id.
 * Telegram albums remain enabled; Rubika has no documented Bot API album method.
 */
export function shouldUseMediaGroup(
  platform: Platform,
  input: {
    providerSupportsMediaGroup: boolean;
    mediaCount: number;
    allPhotos: boolean;
    hasInlineButtons: boolean;
  },
): boolean {
  return platform === 'telegram'
    && input.providerSupportsMediaGroup
    && input.mediaCount >= 2
    && input.mediaCount <= 10
    && input.allPhotos
    && !input.hasInlineButtons;
}

/**
 * Bale documents sendPhoto captions up to 4096 characters.
 * Telegram media captions are limited to 1024. Rubika's sendFile text limit is
 * not stated in the public Bot API reference, so retain the conservative 1024
 * character inline threshold there until its contract is clarified.
 */
export function mediaInlineTextLimit(platform: Platform): number {
  return platform === 'bale' ? 4096 : 1024;
}

/** Maximum editable text length for the stored message kind on each provider. */
export function publishedMessageTextLimit(platform: Platform, kind: 'TEXT' | 'CAPTION'): number {
  if (kind === 'CAPTION' && platform !== 'bale') return 1024;
  return 4096;
}
