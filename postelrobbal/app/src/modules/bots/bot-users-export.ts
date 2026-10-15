export interface BotUserExportRow {
  displayName: string | null;
  platformUserId: string;
  username: string | null;
  firstSeenAt: Date | string | null;
  lastSeenAt: Date | string | null;
}

export const MAX_BOT_USER_EXPORT = 10_000;

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString();
  return String(value);
}

/** Always quote CSV fields and neutralize spreadsheet formula prefixes. */
export function csvCell(value: unknown): string {
  let text = cellText(value);
  if (/^[\s\uFEFF]*[=+\-@]/u.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function buildBotUsersCsv(rows: readonly BotUserExportRow[]): string {
  const headers = ['نام نمایشی', 'شناسه پیام‌رسان', 'نام کاربری', 'اولین حضور (UTC)', 'آخرین حضور (UTC)'];
  const body = rows.map((row) => [
    row.displayName,
    row.platformUserId,
    row.username,
    row.firstSeenAt,
    row.lastSeenAt,
  ].map(csvCell).join(','));
  return `\uFEFF${headers.map(csvCell).join(',')}\r\n${body.length ? `${body.join('\r\n')}\r\n` : ''}`;
}
