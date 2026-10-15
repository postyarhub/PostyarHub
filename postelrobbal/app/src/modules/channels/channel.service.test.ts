import { describe, expect, it } from 'vitest';
import { normalizeChannelRef, parseRubikaDiscoveryCommand } from './channel.service.js';

describe('channel reference normalization', () => {
  it('leaves Telegram/Bale public refs unchanged', () => {
    expect(normalizeChannelRef('telegram', '@postyarhub')).toBe('@postyarhub');
    expect(normalizeChannelRef('bale', '@postyarhub')).toBe('@postyarhub');
  });

  it('rejects obvious public usernames and URLs before provider verification', () => {
    expect(() => normalizeChannelRef('rubika', '@postyarhub')).toThrow('chat_id');
    expect(() => normalizeChannelRef('rubika', '@@postyarhub')).toThrow('chat_id');
    expect(() => normalizeChannelRef('rubika', 'https://rubika.ir/postyarhub')).toThrow('chat_id');
  });

  it('accepts arbitrary non-empty Rubika provider identifiers without undocumented regex assumptions', () => {
    expect(normalizeChannelRef('rubika', 'chat-xyz-123')).toBe('chat-xyz-123');
    expect(normalizeChannelRef('rubika', ' c0QFtn0C1I022abcd29f1d60c9ce5b08 ')).toBe('c0QFtn0C1I022abcd29f1d60c9ce5b08');
  });

  it('extracts chat_id from a direct Rubika web link before provider verification', () => {
    expect(normalizeChannelRef('rubika', 'https://web.rubika.ir/#c=c0QFtn0C1I022abcd29f1d60c9ce5b08')).toBe('c0QFtn0C1I022abcd29f1d60c9ce5b08');
    expect(normalizeChannelRef('rubika', '#c=c0QFtn0C1I022abcd29f1d60c9ce5b08')).toBe('c0QFtn0C1I022abcd29f1d60c9ce5b08');
  });
});


describe('Rubika discovery command parsing', () => {
  it('accepts the generated one-time command format', () => {
    expect(parseRubikaDiscoveryCommand('/postyar-connect ABC7K9_X')).toBe('ABC7K9_X');
    expect(parseRubikaDiscoveryCommand('/postyar-connect@postyar_bot ABC7K9-X')).toBe('ABC7K9-X');
  });

  it('rejects incomplete or unrelated commands', () => {
    expect(parseRubikaDiscoveryCommand('/postyar-connect')).toBeNull();
    expect(parseRubikaDiscoveryCommand('postyar-connect ABC7K9')).toBeNull();
    expect(parseRubikaDiscoveryCommand('/start ABC7K9')).toBeNull();
  });
});
