import { and, count, desc, eq, sql } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import { payments, systemSettings, tickets, users, surveys } from '../../db/schema.js';

/**
 * Admin bell (round 18, asovin «اعلان‌های سیستمی مدیر» parity, extended).
 *
 * Read-model only: three counters + the newest 5 entities of each category,
 * with a per-admin seen marker stored in system_settings key 'admin_bell_seen'
 * as a JSON document { seenAt: <ISO string> } (no DB migration this round).
 * unread = rows created AFTER the last seen marker; with no marker yet,
 * everything currently present counts as unread.
 */

export interface BellEntityRef {
  id: string;
  title: string;
  sub: string;
  amountRial?: number;
  createdAt: string | null;
}

export interface AdminBellSnapshot {
  lastSeenAt: string | null;
  pendingPayments: { count: number; unread: number; latest: BellEntityRef[] };
  pendingSurveys: { count: number; unread: number; latest: BellEntityRef[] };
  openTickets: { count: number; unread: number; latest: BellEntityRef[] };
  newUsers: { count: number; unread: number; latest: BellEntityRef[] };
  unreadTotal: number;
}

function bellSeenKey(adminId: string): string {
  return `admin_bell_seen:${adminId}`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** lastSeenAt from the seen-marker document; null when absent/unparsable. */
async function readBellSeenAt(adminId: string): Promise<string | null> {
  const db = getDb();
  const [row] = await db
    .select({ valueJson: systemSettings.valueJson })
    .from(systemSettings)
    .where(eq(systemSettings.settingKey, bellSeenKey(adminId)))
    .limit(1);
  const raw = isRecord(row?.valueJson) ? row.valueJson['seenAt'] : undefined;
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const ts = Date.parse(raw);
  return Number.isNaN(ts) ? null : raw;
}

type AggRow = { total: number; unread: number };

/** Maps a payments row (joined with its tenant user) to a bell ref. */
function paymentRef(row: {
  id: string;
  amountRial: number | string;
  createdAt: Date | null;
  email: string | null;
}): BellEntityRef {
  return {
    id: row.id,
    title: 'فیش واریزی',
    sub: row.email ?? '—',
    amountRial: Number(row.amountRial),
    createdAt: row.createdAt ? row.createdAt.toISOString() : null,
  };
}

/** Maps a tickets row (joined with its tenant user) to a bell ref. */
function ticketRef(row: { id: string; subject: string; createdAt: Date | null; email: string | null }): BellEntityRef {
  return {
    id: row.id,
    title: row.subject,
    sub: row.email ?? '—',
    createdAt: row.createdAt ? row.createdAt.toISOString() : null,
  };
}

const num = (v: unknown): number => Number(v ?? 0);

export async function getAdminBellSnapshot(adminId: string, includeManagementDetails = true): Promise<AdminBellSnapshot> {
  const db = getDb();
  const lastSeenAt = await readBellSeenAt(adminId);
  const seenDate = lastSeenAt ? new Date(lastSeenAt) : new Date(0);
  const since7d = new Date(Date.now() - 7 * 86400_000);

  // One seen-marker read, plus count/latest queries for the categories the
  // caller is authorized to view. SUPPORT requests only ticket data; payment,
  // user and survey queries are skipped rather than queried and then redacted.
  const payAggRows = includeManagementDetails ? await db
    .select({
      total: count(),
      unread: sql<string | number | null>`COALESCE(SUM(CASE WHEN ${payments.createdAt} > ${seenDate} THEN 1 ELSE 0 END), 0)`,
    })
    .from(payments)
    .where(eq(payments.state, 'PENDING_REVIEW')) : [];

  const payLatest = includeManagementDetails ? await db
    .select({
      id: payments.id,
      amountRial: payments.amountRial,
      createdAt: payments.createdAt,
      email: users.email,
    })
    .from(payments)
    .leftJoin(users, eq(users.id, payments.tenantId))
    .where(eq(payments.state, 'PENDING_REVIEW'))
    .orderBy(desc(payments.createdAt))
    .limit(5) : [];

  const ticketAggRows = await db
    .select({
      total: count(),
      unread: sql<string | number | null>`COALESCE(SUM(CASE WHEN ${tickets.createdAt} > ${seenDate} THEN 1 ELSE 0 END), 0)`,
    })
    .from(tickets)
    .where(eq(tickets.state, 'OPEN'));

  const ticketLatest = await db
    .select({
      id: tickets.id,
      subject: tickets.subject,
      createdAt: tickets.createdAt,
      email: users.email,
    })
    .from(tickets)
    .leftJoin(users, eq(users.id, tickets.tenantId))
    .where(eq(tickets.state, 'OPEN'))
    .orderBy(desc(tickets.createdAt))
    .limit(5);

  const userAggRows = includeManagementDetails ? await db
    .select({
      total: count(),
      unread: sql<string | number | null>`COALESCE(SUM(CASE WHEN ${users.createdAt} > ${seenDate} THEN 1 ELSE 0 END), 0)`,
    })
    .from(users)
    .where(and(eq(users.role, 'USER'), sql`${users.createdAt} >= ${since7d}`)) : [];

  const userLatest = includeManagementDetails ? await db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(and(eq(users.role, 'USER'), sql`${users.createdAt} >= ${since7d}`))
    .orderBy(desc(users.createdAt))
    .limit(5) : [];

  const surveyAggRows = includeManagementDetails ? await db
    .select({
      total: count(),
      unread: sql<string | number | null>`COALESCE(SUM(CASE WHEN ${surveys.createdAt} > ${seenDate} THEN 1 ELSE 0 END), 0)`,
    })
    .from(surveys)
    .where(eq(surveys.status, 'PENDING')) : [];

  const surveyLatest = includeManagementDetails ? await db
    .select({
      id: surveys.id,
      question: surveys.question,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      createdAt: surveys.createdAt,
    })
    .from(surveys)
    .leftJoin(users, eq(users.id, surveys.creatorId))
    .where(eq(surveys.status, 'PENDING'))
    .orderBy(desc(surveys.createdAt))
    .limit(5) : [];

  const toAgg = (rows: Array<{ total: number; unread: string | number | null }>): AggRow => ({
    total: num(rows[0]?.total),
    unread: num(rows[0]?.unread),
  });

  const pendingPayments = {
    count: toAgg(payAggRows).total,
    unread: toAgg(payAggRows).unread,
    latest: payLatest.map(paymentRef),
  };
  const openTickets = {
    count: toAgg(ticketAggRows).total,
    unread: toAgg(ticketAggRows).unread,
    latest: ticketLatest.map(ticketRef),
  };
  const newUsers = {
    count: toAgg(userAggRows).total,
    unread: toAgg(userAggRows).unread,
    latest: userLatest.map((r) => ({
      id: r.id,
      title: `${r.firstName} ${r.lastName}`.trim() || 'کاربر جدید',
      sub: r.email,
      createdAt: r.createdAt ? r.createdAt.toISOString() : null,
    })),
  };
  const pendingSurveys = {
    count: toAgg(surveyAggRows).total,
    unread: toAgg(surveyAggRows).unread,
    latest: surveyLatest.map((r) => ({
      id: r.id,
      title: r.question,
      sub: r.email ?? (`${r.firstName ?? ''} ${r.lastName ?? ''}`.trim() || 'ثبت‌کنندهٔ نظرسنجی'),
      createdAt: r.createdAt ? r.createdAt.toISOString() : null,
    })),
  };

  return {
    lastSeenAt,
    pendingPayments,
    pendingSurveys,
    openTickets,
    newUsers,
    unreadTotal: pendingPayments.unread + pendingSurveys.unread + openTickets.unread + newUsers.unread,
  };
}

/** Upserts the seen marker to «now»; returns the stored timestamp. */
export async function markAdminBellSeen(adminId: string): Promise<{ lastSeenAt: string }> {
  const db = getDb();
  const lastSeenAt = new Date().toISOString();
  await db
    .insert(systemSettings)
    .values({ settingKey: bellSeenKey(adminId), valueJson: { seenAt: lastSeenAt } })
    .onDuplicateKeyUpdate({ set: { valueJson: { seenAt: lastSeenAt } } });
  return { lastSeenAt };
}
