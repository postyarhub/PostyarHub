import { describe, expect, it } from 'vitest';
import { mediaInlineTextLimit, shouldUseMediaGroup } from './published-delivery-policy.js';

describe('published delivery policy', () => {
  const supportedAlbum = {
    providerSupportsMediaGroup: true,
    mediaCount: 3,
    allPhotos: true,
    hasInlineButtons: false,
  };

  it('keeps Telegram photo albums on the official album API', () => {
    expect(shouldUseMediaGroup('telegram', supportedAlbum)).toBe(true);
  });

  it('keeps Bale photos as independent messages for native per-message actions', () => {
    expect(shouldUseMediaGroup('bale', supportedAlbum)).toBe(false);
  });

  it('does not invent an album operation for Rubika', () => {
    expect(shouldUseMediaGroup('rubika', supportedAlbum)).toBe(false);
  });

  it('does not group a single photo or destinations with inline buttons', () => {
    expect(shouldUseMediaGroup('telegram', { ...supportedAlbum, mediaCount: 1 })).toBe(false);
    expect(shouldUseMediaGroup('telegram', { ...supportedAlbum, hasInlineButtons: true })).toBe(false);
    expect(shouldUseMediaGroup('telegram', { ...supportedAlbum, providerSupportsMediaGroup: false })).toBe(false);
  });

  it('uses the documented 4096-character sendPhoto caption limit for Bale', () => {
    expect(mediaInlineTextLimit('bale')).toBe(4096);
    expect(mediaInlineTextLimit('telegram')).toBe(1024);
    expect(mediaInlineTextLimit('rubika')).toBe(1024);
  });
});
