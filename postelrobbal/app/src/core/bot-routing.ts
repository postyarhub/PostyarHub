import type { Platform } from '../providers/types.js';

export interface BotRoutingContext {
  botId: string;
  platform: Platform;
  chatRef: string;
}

/**
 * Fail-closed routing invariant for automated bot replies.
 * A reply may only use the bot/platform/chat identity that originated the event.
 */
export function assertBotReplyRoute(
  context: BotRoutingContext,
  attempted: { botId: string; platform: Platform; chatRef: string },
): void {
  if (!context.botId || !context.chatRef) throw new Error('BOT_ROUTE_CONTEXT_INVALID');
  if (attempted.botId !== context.botId || attempted.platform !== context.platform || attempted.chatRef !== context.chatRef) {
    throw new Error('BOT_ROUTE_MISMATCH');
  }
}

export interface BotEventScope {
  tenantId: string;
  botId: string;
  platform: Platform;
  chatRef: string | null;
  platformUserId?: string | null;
}

/**
 * Validate the durable event envelope against the resolved bot and provider
 * payload. Message events are rejected closed when their tenant/bot/platform,
 * chat, or user identity diverges.
 */
export function assertBotEventScope(expected: BotEventScope, actual: BotEventScope): void {
  if (!expected.tenantId || !expected.botId || !expected.chatRef) throw new Error('BOT_EVENT_SCOPE_INVALID');
  if (
    actual.tenantId !== expected.tenantId ||
    actual.botId !== expected.botId ||
    actual.platform !== expected.platform ||
    actual.chatRef !== expected.chatRef
  ) {
    throw new Error('BOT_EVENT_SCOPE_MISMATCH');
  }

  const expectedUser = expected.platformUserId ?? null;
  const actualUser = actual.platformUserId ?? null;
  if (expectedUser !== actualUser) {
    throw new Error('BOT_EVENT_USER_SCOPE_MISMATCH');
  }
}
