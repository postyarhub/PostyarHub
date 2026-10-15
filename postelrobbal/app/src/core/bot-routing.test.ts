import { describe, expect, it } from 'vitest';
import { assertBotReplyRoute, assertBotEventScope } from './bot-routing.js';

describe('bot reply routing isolation', () => {
  const context = { botId: 'B1', platform: 'telegram' as const, chatRef: '-100123' };

  it('allows the exact originating bot/platform/chat', () => {
    expect(() => assertBotReplyRoute(context, context)).not.toThrow();
  });

  it('blocks a different platform even when chatRef matches', () => {
    expect(() => assertBotReplyRoute(context, { ...context, platform: 'bale' })).toThrow('BOT_ROUTE_MISMATCH');
  });

  it('blocks a different bot', () => {
    expect(() => assertBotReplyRoute(context, { ...context, botId: 'B2' })).toThrow('BOT_ROUTE_MISMATCH');
  });

  it('blocks a different chat', () => {
    expect(() => assertBotReplyRoute(context, { ...context, chatRef: '-100999' })).toThrow('BOT_ROUTE_MISMATCH');
  });
});


describe('three-platform cross-talk matrix', () => {
  const cases = [
    { botId: 'TG-A', platform: 'telegram' as const, chatRef: 'TG-CHAT', platformUserId: 'USER-A' },
    { botId: 'BALE-B', platform: 'bale' as const, chatRef: 'BALE-CHAT', platformUserId: 'USER-B' },
    { botId: 'RUBIKA-C', platform: 'rubika' as const, chatRef: 'RUBIKA-CHAT', platformUserId: 'USER-C' },
  ];

  it('allows only the originating bot/platform/chat in every case', () => {
    for (const own of cases) {
      expect(() => assertBotReplyRoute(own, own)).not.toThrow();
      for (const other of cases) {
        if (other.botId === own.botId) continue;
        expect(() => assertBotReplyRoute(own, other)).toThrow('BOT_ROUTE_MISMATCH');
      }
    }
  });
});

describe('bot event scope isolation', () => {
  const own = {
    tenantId: 'TENANT-A',
    botId: 'TG-A',
    platform: 'telegram' as const,
    chatRef: 'CHAT-A',
    platformUserId: 'USER-A',
  };

  it('accepts the exact event envelope', () => {
    expect(() => assertBotEventScope(own, own)).not.toThrow();
  });

  it('rejects a different tenant, bot, platform, chat, or user', () => {
    expect(() => assertBotEventScope(own, { ...own, tenantId: 'TENANT-B' })).toThrow('BOT_EVENT_SCOPE_MISMATCH');
    expect(() => assertBotEventScope(own, { ...own, botId: 'BALE-B' })).toThrow('BOT_EVENT_SCOPE_MISMATCH');
    expect(() => assertBotEventScope(own, { ...own, platform: 'bale' })).toThrow('BOT_EVENT_SCOPE_MISMATCH');
    expect(() => assertBotEventScope(own, { ...own, chatRef: 'CHAT-B' })).toThrow('BOT_EVENT_SCOPE_MISMATCH');
    expect(() => assertBotEventScope(own, { ...own, platformUserId: 'USER-B' })).toThrow('BOT_EVENT_USER_SCOPE_MISMATCH');
    expect(() => assertBotEventScope(own, { ...own, platformUserId: null })).toThrow('BOT_EVENT_USER_SCOPE_MISMATCH');
    expect(() => assertBotEventScope({ ...own, platformUserId: null }, own)).toThrow('BOT_EVENT_USER_SCOPE_MISMATCH');
  });
});
