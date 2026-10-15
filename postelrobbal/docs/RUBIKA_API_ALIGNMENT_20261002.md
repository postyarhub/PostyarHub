# PostYar — Rubika Bot API Alignment

Date: 2026-10-02

This integration is aligned to the official Rubika Bot API documentation:

- https://rubika.ir/botapi
- https://rubika.ir/botapi/methods
- https://rubika.ir/botapi/models
- https://rubika.ir/botapi/group-channel

## Implemented alignment

- Bot identity uses `getMe` and reads the documented `bot.bot_id`, `bot.bot_title`, and `bot.username` fields.
- Production ingestion uses the documented endpoint-registration flow through `updateBotEndpoints`.
- `ReceiveUpdate` and `ReceiveInlineMessage` are registered separately for webhook delivery.
- Rubika update polling uses the documented string cursor `offset_id` and persists `next_offset_id`.
- File media uses the documented `requestSendFile` → multipart upload → `sendFile` sequence.
- URL actions use Rubika metadata links; callback buttons use `Simple` inline-keypad buttons.
- Inline button metadata is calculated with JavaScript UTF-16 code-unit offsets, matching the documented Rubika metadata contract.
- `deleteMessage` and `editMessageText` use the documented method names.
- Rubika remains webhook-first in production. Polling mode is not exposed as an alternative because the official documentation used by this integration does not document a webhook-deletion method.
- Webhook URLs are required to be public HTTPS URLs, matching the official production webhook requirement.
- Group/channel operation assumes the bot has been manually added by an administrator; full message visibility requires the corresponding BotFather setting described by Rubika.

## Failure handling

Provider failures are classified into stable application categories (`UNAUTHORIZED`, `NOT_FOUND`, `BLOCKED`, `RATE_LIMITED`, `TRANSIENT`, `VALIDATION`, `UNKNOWN`) and stored in bot health metadata without exposing tokens.
