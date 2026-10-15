import { and, count, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import { systemSettings, tickets, ticketMessages, ticketMessageAttachments, users } from '../../db/schema.js';
import { AppError, ERR } from '../../core/errors.js';
import { newId } from '../../core/ids.js';
import { hashPassword, passwordPolicyOk } from '../../security/passwords.js';
import { notifyTenant } from '../notifications/delivery.js';

export type ActorRole = 'SUPER_ADMIN' | 'SUPPORT' | 'USER';
export type TicketState = 'OPEN' | 'ANSWERED' | 'CLOSED';

export interface TicketCategory {
  key: string;
  labelFa: string;
}

/** Built-in fallback used until the admin defines (or while none exist). */
export const TICKET_CATEGORIES: TicketCategory[] = [
  { key: 'GENERAL', labelFa: 'عمومی' },
  { key: 'BILLING', labelFa: 'مالی و اشتراک' },
  { key: 'TECHNICAL', labelFa: 'فنی و ارسال' },
  { key: 'BOT', labelFa: 'ربات و پاسخگوی خودکار' },
  { key: 'FEATURE', labelFa: 'درخواست امکان جدید' },
];

const CATEGORY_SETTINGS_KEY = 'ticket_categories';
const CATEGORY_KEY_RE = /^[A-Z0-9_]{2,40}$/;

/**
 * Round 19 — admin-defined ticket categories (system_settings key
 * 'ticket_categories', value { categories }). When nothing valid is stored the
 * built-in defaults apply, so both ticket paths behave exactly as before.
 */
export async function getTicketCategories(): Promise<TicketCategory[]> {
  const db = getDb();
  const [row] = await db
    .select({ valueJson: systemSettings.valueJson })
    .from(systemSettings)
    .where(eq(systemSettings.settingKey, CATEGORY_SETTINGS_KEY))
    .limit(1);
  const doc = row?.valueJson as { categories?: unknown } | undefined;
  const raw = doc?.categories;
  if (!Array.isArray(raw) || raw.length === 0) return TICKET_CATEGORIES;
  const parsed: TicketCategory[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const { key, labelFa } = item as Record<string, unknown>;
    if (typeof key !== 'string' || typeof labelFa !== 'string') continue;
    if (!CATEGORY_KEY_RE.test(key) || seen.has(key)) continue;
    seen.add(key);
    parsed.push({ key, labelFa: labelFa.trim().slice(0, 60) || key });
  }
  return parsed.length > 0 ? parsed : TICKET_CATEGORIES;
}

/** Validates + persists the category list authored in the admin panel. */
export async function putTicketCategories(input: unknown): Promise<TicketCategory[]> {
  if (!Array.isArray(input) || input.length === 0 || input.length > 20) {
    throw new AppError(ERR.VALIDATION('فهرست دسته‌بندی‌ها باید بین ۱ تا ۲۰ مورد باشد.'));
  }
  const categories: TicketCategory[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    if (typeof item !== 'object' || item === null) {
      throw new AppError(ERR.VALIDATION('قالب دسته‌بندی معتبر نیست.'));
    }
    const { key, labelFa } = item as Record<string, unknown>;
    if (typeof key !== 'string' || !CATEGORY_KEY_RE.test(key)) {
      throw new AppError(ERR.VALIDATION('کلید دسته‌بندی باید ۲ تا ۴۰ نویسهٔ لاتین بزرگ، رقم یا ـ باشد.'));
    }
    if (typeof labelFa !== 'string' || labelFa.trim().length < 2 || labelFa.trim().length > 60) {
      throw new AppError(ERR.VALIDATION('عنوان فارسی دسته‌بندی باید ۲ تا ۶۰ نویسه باشد.'));
    }
    if (seen.has(key)) {
      throw new AppError(ERR.VALIDATION(`کلید «${key}» تکراری است.`));
    }
    seen.add(key);
    categories.push({ key, labelFa: labelFa.trim() });
  }
  const db = getDb();
  await db
    .insert(systemSettings)
    .values({ settingKey: CATEGORY_SETTINGS_KEY, valueJson: { categories } })
    .onDuplicateKeyUpdate({ set: { valueJson: { categories } } });
  return categories;
}

export interface TicketListItem {
  id: string;
  subject: string;
  category: string;
  state: TicketState;
  createdAt: Date;
  updatedAt: Date;
}

export async function listTickets(
  tenantId: string,
  page: number,
  pageSize: number
): Promise<{ items: TicketListItem[]; total: number; page: number; pageSize: number }> {
  const db = getDb();
  const p = Math.max(1, page);
  const size = Math.min(100, Math.max(1, pageSize));
  const [totalRow] = await db.select({ value: count() }).from(tickets).where(eq(tickets.tenantId, tenantId));
  const rows = await db
    .select()
    .from(tickets)
    .where(eq(tickets.tenantId, tenantId))
    .orderBy(desc(tickets.updatedAt))
    .limit(size)
    .offset((p - 1) * size);
  return { items: rows, total: Number(totalRow?.value ?? 0), page: p, pageSize: size };
}

/** Creates the ticket and its first message (optionally with one attachment) atomically. */
export async function createTicket(
  tenantId: string,
  authorId: string,
  input: { subject: string; category: string; body: string },
  attachment?: { mediaId: string; fileName: string; sizeBytes: number; mime: string }
): Promise<{ id: string }> {
  const db = getDb();
  const categories = await getTicketCategories();
  const known = categories.some((c) => c.key === input.category);
  const category = known ? input.category : 'GENERAL';
  const id = newId();
  const messageId = newId();
  await db.transaction(async (tx) => {
    await tx.insert(tickets).values({
      id,
      tenantId,
      subject: input.subject.trim().slice(0, 190),
      category,
      state: 'OPEN',
    });
    await tx.insert(ticketMessages).values({
      id: messageId,
      ticketId: id,
      authorId,
      authorRole: 'USER',
      body: input.body.trim(),
    });
    if (attachment) {
      await tx.insert(ticketMessageAttachments).values({
        id: newId(),
        messageId,
        mediaId: attachment.mediaId,
        fileName: attachment.fileName.slice(0, 255),
        sizeBytes: attachment.sizeBytes,
        mime: attachment.mime,
      });
    }
  });
  return { id };
}

export interface TicketAttachmentDto {
  id: string;
  fileName: string;
  size: number;
  mime: string;
  url: string;
}

export interface TicketMessageDto {
  id: string;
  authorRole: string;
  authorId: string | null;
  body: string;
  createdAt: Date;
  attachment: TicketAttachmentDto | null;
}

function attachmentDto(row: {
  mediaId: string;
  fileName: string;
  sizeBytes: number | string;
  mime: string;
}): TicketAttachmentDto {
  return {
    id: row.mediaId,
    fileName: row.fileName,
    size: Number(row.sizeBytes),
    mime: row.mime,
    url: `/api/v1/media/${row.mediaId}`,
  };
}

/** Shared message mapping (user path + admin 360 path) — identical shape. */
async function fetchTicketMessages(ticketId: string): Promise<TicketMessageDto[]> {
  const db = getDb();
  const messages = await db
    .select({
      id: ticketMessages.id,
      authorRole: ticketMessages.authorRole,
      authorId: ticketMessages.authorId,
      body: ticketMessages.body,
      createdAt: ticketMessages.createdAt,
      attMediaId: ticketMessageAttachments.mediaId,
      attFileName: ticketMessageAttachments.fileName,
      attSizeBytes: ticketMessageAttachments.sizeBytes,
      attMime: ticketMessageAttachments.mime,
    })
    .from(ticketMessages)
    .leftJoin(ticketMessageAttachments, eq(ticketMessageAttachments.messageId, ticketMessages.id))
    .where(eq(ticketMessages.ticketId, ticketId))
    .orderBy(ticketMessages.createdAt)
    .limit(200);

  return messages.map((m) => ({
    id: m.id,
    authorRole: m.authorRole,
    authorId: m.authorId,
    body: m.body,
    createdAt: m.createdAt,
    attachment:
      m.attMediaId && m.attFileName && m.attMime !== null
        ? attachmentDto({ mediaId: m.attMediaId, fileName: m.attFileName, sizeBytes: m.attSizeBytes ?? 0, mime: m.attMime })
        : null,
  }));
}

/** Ownership enforced here; support roles may open any ticket. */
export async function getTicket(
  tenantId: string,
  ticketId: string,
  isSupport: boolean
): Promise<{ ticket: TicketListItem; messages: TicketMessageDto[] }> {
  const db = getDb();
  const where = isSupport ? eq(tickets.id, ticketId) : and(eq(tickets.id, ticketId), eq(tickets.tenantId, tenantId));
  const [ticket] = await db.select().from(tickets).where(where).limit(1);
  // Not-found for both missing and foreign tickets — no existence leak (§180).
  if (!ticket) throw new AppError(ERR.NOT_FOUND('تیکت'));

  return {
    ticket: {
      id: ticket.id,
      subject: ticket.subject,
      category: ticket.category,
      state: ticket.state,
      createdAt: ticket.createdAt,
      updatedAt: ticket.updatedAt,
    },
    messages: await fetchTicketMessages(ticket.id),
  };
}

/**
 * Role-aware reply (§145): USER reply reopens the ticket (OPEN);
 * SUPPORT/SUPER_ADMIN reply marks it ANSWERED.
 * Optional attachment (contract 14-contract item 7): media is uploaded by the
 * route via media.service; the attachment row is written in the same
 * transaction as the message (one attachment per message — uq_tatt_message).
 */
export async function addTicketMessage(
  tenantId: string,
  ticketId: string,
  author: { id: string; role: ActorRole },
  body: string,
  attachment?: { mediaId: string; fileName: string; sizeBytes: number; mime: string }
): Promise<{ state: TicketState; message: TicketMessageDto }> {
  const db = getDb();
  const isSupport = author.role !== 'USER';
  const where = isSupport ? eq(tickets.id, ticketId) : and(eq(tickets.id, ticketId), eq(tickets.tenantId, tenantId));
  const [ticket] = await db.select().from(tickets).where(where).limit(1);
  if (!ticket) throw new AppError(ERR.NOT_FOUND('تیکت'));
  if (ticket.state === 'CLOSED' && !isSupport) {
    throw new AppError(ERR.CONFLICT('این تیکت بسته شده است. برای ادامه، تیکت جدیدی بسازید.'));
  }

  const nextState: TicketState = isSupport ? 'ANSWERED' : 'OPEN';
  const messageId = newId();
  await db.transaction(async (tx) => {
    await tx.insert(ticketMessages).values({
      id: messageId,
      ticketId: ticket.id,
      authorId: author.id,
      authorRole: author.role,
      body: body.trim().slice(0, 5000),
    });
    if (attachment) {
      await tx.insert(ticketMessageAttachments).values({
        id: newId(),
        messageId,
        mediaId: attachment.mediaId,
        fileName: attachment.fileName.slice(0, 255),
        sizeBytes: attachment.sizeBytes,
        mime: attachment.mime,
      });
    }
    await tx.update(tickets).set({ state: nextState }).where(eq(tickets.id, ticket.id));
  });

  const message: TicketMessageDto = {
    id: messageId,
    authorRole: author.role,
    authorId: author.id,
    body: body.trim().slice(0, 5000),
    createdAt: new Date(),
    attachment: attachment
      ? {
          id: attachment.mediaId,
          fileName: attachment.fileName.slice(0, 255),
          size: attachment.sizeBytes,
          mime: attachment.mime,
          url: `/api/v1/media/${attachment.mediaId}`,
        }
      : null,
  };
  return { state: nextState, message };
}

export async function closeTicket(
  tenantId: string,
  ticketId: string,
  actor: { id: string; role: ActorRole }
): Promise<void> {
  const db = getDb();
  const isSupport = actor.role !== 'USER';
  const where = isSupport ? eq(tickets.id, ticketId) : and(eq(tickets.id, ticketId), eq(tickets.tenantId, tenantId));
  const [ticket] = await db.select().from(tickets).where(where).limit(1);
  if (!ticket) throw new AppError(ERR.NOT_FOUND('تیکت'));
  await db.update(tickets).set({ state: 'CLOSED' }).where(eq(tickets.id, ticket.id));
}

// ---------------------------------------------------------------------------
// Round 18 — admin-side ticket management (asovin «تیکت‌های پشتیبانی» parity).
// User-path functions above are untouched; these run without tenant scope.
// ---------------------------------------------------------------------------

export type AdminTicketState = 'OPEN' | 'ANSWERED' | 'CLOSED';

export interface AdminTicketListItem {
  id: string;
  subject: string;
  category: string;
  state: TicketState;
  createdAt: Date;
  updatedAt: Date;
  tenantId: string;
  tenantName: string;
  tenantEmail: string;
  messageCount: number;
  lastMessageAt: Date | null;
}

const toDate = (v: unknown): Date | null => {
  if (v instanceof Date) return v;
  if (typeof v === 'string' || typeof v === 'number') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
};

const tenantNameOf = (firstName: string | null, lastName: string | null): string =>
  `${firstName ?? ''} ${lastName ?? ''}`.trim();

/** Admin ticket list: tenant join, search across subject/tenant, one grouped
 *  message-count query for the page ids (no N+1). Ordered by updatedAt desc. */
export async function adminListTickets(opts: {
  state?: AdminTicketState;
  search?: string;
  page: number;
  pageSize: number;
}): Promise<{ items: AdminTicketListItem[]; total: number; page: number; pageSize: number }> {
  const db = getDb();
  const p = Math.max(1, opts.page);
  const size = Math.min(100, Math.max(1, opts.pageSize));
  const term = opts.search?.trim();
  const like = term ? `%${term.replace(/[%_]/g, '')}%` : null;
  const where = and(
    opts.state ? eq(tickets.state, opts.state) : undefined,
    like
      ? or(
          sql`${tickets.subject} LIKE ${like}`,
          sql`${users.email} LIKE ${like}`,
          sql`${users.firstName} LIKE ${like}`,
          sql`${users.lastName} LIKE ${like}`
        )
      : undefined
  );

  const [totalRow] = await db
    .select({ value: count() })
    .from(tickets)
    .innerJoin(users, eq(users.id, tickets.tenantId))
    .where(where);
  const rows = await db
    .select({
      id: tickets.id,
      subject: tickets.subject,
      category: tickets.category,
      state: tickets.state,
      createdAt: tickets.createdAt,
      updatedAt: tickets.updatedAt,
      tenantId: tickets.tenantId,
      tenantFirstName: users.firstName,
      tenantLastName: users.lastName,
      tenantEmail: users.email,
    })
    .from(tickets)
    .innerJoin(users, eq(users.id, tickets.tenantId))
    .where(where)
    .orderBy(desc(tickets.updatedAt))
    .limit(size)
    .offset((p - 1) * size);

  // One grouped query for the page's ticket ids: COUNT + MAX(created_at).
  const ids = rows.map((r) => r.id);
  const msgRows = ids.length
    ? await db
        .select({
          ticketId: ticketMessages.ticketId,
          cnt: count(),
          lastAt: sql<string | number | null>`MAX(${ticketMessages.createdAt})`,
        })
        .from(ticketMessages)
        .where(inArray(ticketMessages.ticketId, ids))
        .groupBy(ticketMessages.ticketId)
    : [];
  const msgByTicket = new Map(msgRows.map((m) => [m.ticketId, m]));

  return {
    items: rows.map((r) => ({
      id: r.id,
      subject: r.subject,
      category: r.category,
      state: r.state,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      tenantId: r.tenantId,
      tenantName: tenantNameOf(r.tenantFirstName, r.tenantLastName),
      tenantEmail: r.tenantEmail,
      messageCount: Number(msgByTicket.get(r.id)?.cnt ?? 0),
      lastMessageAt: toDate(msgByTicket.get(r.id)?.lastAt),
    })),
    total: Number(totalRow?.value ?? 0),
    page: p,
    pageSize: size,
  };
}

/** Admin detail view: ticket row + tenant identity + the SAME message shape
 *  as the user-path getTicket (attachments included). */
export async function adminGetTicket(ticketId: string): Promise<{
  ticket: AdminTicketListItem;
  messages: TicketMessageDto[];
}> {
  const db = getDb();
  const [row] = await db
    .select({
      id: tickets.id,
      subject: tickets.subject,
      category: tickets.category,
      state: tickets.state,
      createdAt: tickets.createdAt,
      updatedAt: tickets.updatedAt,
      tenantId: tickets.tenantId,
      tenantFirstName: users.firstName,
      tenantLastName: users.lastName,
      tenantEmail: users.email,
    })
    .from(tickets)
    .innerJoin(users, eq(users.id, tickets.tenantId))
    .where(eq(tickets.id, ticketId))
    .limit(1);
  if (!row) throw new AppError(ERR.NOT_FOUND('تیکت'));

  const [msgAgg] = await db
    .select({
      cnt: count(),
      lastAt: sql<string | number | null>`MAX(${ticketMessages.createdAt})`,
    })
    .from(ticketMessages)
    .where(eq(ticketMessages.ticketId, row.id));

  return {
    ticket: {
      id: row.id,
      subject: row.subject,
      category: row.category,
      state: row.state,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      tenantId: row.tenantId,
      tenantName: tenantNameOf(row.tenantFirstName, row.tenantLastName),
      tenantEmail: row.tenantEmail,
      messageCount: Number(msgAgg?.cnt ?? 0),
      lastMessageAt: toDate(msgAgg?.lastAt),
    },
    messages: await fetchTicketMessages(row.id),
  };
}

/**
 * Admin reply. Parity checks against the user-path addTicketMessage:
 *  - SUPPORT/SUPER_ADMIN reply marks the ticket ANSWERED (same as user flow);
 *  - authorRole is stored exactly as passed (SUPER_ADMIN stays SUPER_ADMIN);
 *  - round 19: optional attachment row written in the same transaction.
 */
export async function adminAddTicketMessage(
  ticketId: string,
  actor: { id: string; role: 'SUPER_ADMIN' | 'SUPPORT' },
  body: string,
  attachment?: { mediaId: string; fileName: string; sizeBytes: number; mime: string }
): Promise<{ ok: true }> {
  const db = getDb();
  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1);
  if (!ticket) throw new AppError(ERR.NOT_FOUND('تیکت'));
  if (ticket.state === 'CLOSED') {
    throw new AppError(ERR.VALIDATION('تیکت بسته شده است و امکان ارسال پاسخ وجود ندارد.'));
  }

  const messageId = newId();
  await db.transaction(async (tx) => {
    await tx.insert(ticketMessages).values({
      id: messageId,
      ticketId: ticket.id,
      authorId: actor.id,
      authorRole: actor.role,
      body: body.trim().slice(0, 5000),
    });
    if (attachment) {
      await tx.insert(ticketMessageAttachments).values({
        id: newId(),
        messageId,
        mediaId: attachment.mediaId,
        fileName: attachment.fileName.slice(0, 255),
        sizeBytes: attachment.sizeBytes,
        mime: attachment.mime,
      });
    }
    // Explicit bump (the column also auto-updates on write) + ANSWERED state.
    await tx.update(tickets).set({ state: 'ANSWERED', updatedAt: new Date() }).where(eq(tickets.id, ticket.id));
  });
  return { ok: true };
}

/**
 * Round 19 — admin-initiated ticket (تیکت از سمت مدیر/پشتیبان): the staff
 * member picks a user and opens a conversation on their behalf. The first
 * message is authored by the staff role, so the ticket lands ANSWERED and the
 * user sees the staff's opening message immediately. The tenant is notified
 * in-app (unlike staff replies, without this the ticket is undiscoverable).
 */
export async function adminCreateTicket(
  tenantId: string,
  actor: { id: string; role: 'SUPER_ADMIN' | 'SUPPORT' },
  input: { subject: string; category: string; body: string },
  attachment?: { mediaId: string; fileName: string; sizeBytes: number; mime: string }
): Promise<{ id: string }> {
  const db = getDb();
  const [tenant] = await db.select({ id: users.id }).from(users).where(eq(users.id, tenantId)).limit(1);
  if (!tenant) throw new AppError(ERR.NOT_FOUND('کاربر'));

  const categories = await getTicketCategories();
  const known = categories.some((c) => c.key === input.category);
  const category = known ? input.category : 'GENERAL';
  const id = newId();
  const messageId = newId();
  await db.transaction(async (tx) => {
    await tx.insert(tickets).values({
      id,
      tenantId,
      subject: input.subject.trim().slice(0, 190),
      category,
      state: 'ANSWERED', // staff authored the first message
    });
    await tx.insert(ticketMessages).values({
      id: messageId,
      ticketId: id,
      authorId: actor.id,
      authorRole: actor.role,
      body: input.body.trim().slice(0, 5000),
    });
    if (attachment) {
      await tx.insert(ticketMessageAttachments).values({
        id: newId(),
        messageId,
        mediaId: attachment.mediaId,
        fileName: attachment.fileName.slice(0, 255),
        sizeBytes: attachment.sizeBytes,
        mime: attachment.mime,
      });
    }
  });
  await notifyTenant({
    tenantId,
    kind: 'TICKET_STAFF_CREATED',
    titleFa: 'تیکت جدید از سمت پشتیبانی',
    bodyFa: `تیکت «${input.subject.trim().slice(0, 120)}» توسط پشتیبانی برای شما ثبت شد و پیامی برایتان دارد.`,
  });
  return { id };
}

/** Closes a ticket (idempotent: already-closed → no-op success); bumps updatedAt. */
export async function adminCloseTicket(
  ticketId: string,
  _actor: { id: string; role: 'SUPER_ADMIN' | 'SUPPORT' }
): Promise<{ ok: true }> {
  const db = getDb();
  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1);
  if (!ticket) throw new AppError(ERR.NOT_FOUND('تیکت'));
  if (ticket.state !== 'CLOSED') {
    await db.update(tickets).set({ state: 'CLOSED', updatedAt: new Date() }).where(eq(tickets.id, ticket.id));
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Round 19 — support team (پشتیبان‌ها): staff accounts with the SUPPORT role.
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MOBILE_RE = /^09\d{9}$/;

function normalizeMobile(m: string): string {
  const fa = '۰۱۲۳۴۵۶۷۸۹';
  const ar = '٠١٢٣٤٥٦٧٨٩';
  const latin = m
    .replace(/[۰-۹]/g, (d) => String(fa.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(ar.indexOf(d)))
    .replace(/[-\s()+]/g, '');
  if (latin.startsWith('+98')) return `0${latin.slice(3)}`;
  if (latin.startsWith('98') && latin.length === 12) return `0${latin.slice(2)}`;
  return latin;
}

export interface SupportTeamMember {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  mobile: string;
  status: string;
  createdAt: Date;
  lastLoginAt: Date | null;
  messagesCount: number;
}

/** Lists the support staff (role SUPPORT) with one grouped message count. */
export async function listSupportTeam(): Promise<SupportTeamMember[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      mobile: users.mobile,
      status: users.status,
      createdAt: users.createdAt,
      lastLoginAt: users.lastLoginAt,
    })
    .from(users)
    .where(eq(users.role, 'SUPPORT'))
    .orderBy(desc(users.createdAt));
  const ids = rows.map((r) => r.id);
  const msgRows = ids.length
    ? await db
        .select({ authorId: ticketMessages.authorId, value: count() })
        .from(ticketMessages)
        .where(inArray(ticketMessages.authorId, ids))
        .groupBy(ticketMessages.authorId)
    : [];
  const byAuthor = new Map(msgRows.map((m) => [m.authorId, Number(m.value)]));
  return rows.map((r) => ({ ...r, messagesCount: byAuthor.get(r.id) ?? 0 }));
}

/** Creates a new SUPPORT staff account (پشتیبان جدید). */
export async function createSupporter(input: {
  firstName: string;
  lastName: string;
  email: string;
  mobile: string;
  password: string;
}): Promise<{ id: string }> {
  const db = getDb();
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const email = input.email.trim().toLowerCase();
  const mobile = normalizeMobile(input.mobile);
  if (firstName.length < 2 || lastName.length < 2) {
    throw new AppError(ERR.VALIDATION('نام و نام خانوادگی پشتیبان را کامل وارد کنید.'));
  }
  if (!EMAIL_RE.test(email)) throw new AppError(ERR.VALIDATION('ایمیل معتبر نیست.'));
  if (!MOBILE_RE.test(mobile)) throw new AppError(ERR.VALIDATION('شمارهٔ موبایل معتبر نیست (مثال: ۰۹۱۲۳۴۵۶۷۸۹).'));
  if (!passwordPolicyOk(input.password)) {
    throw new AppError(ERR.VALIDATION('گذرواژه ضعیف است؛ حداقل ۸ نویسه شامل حرف و رقم وارد کنید.'));
  }

  const passwordHash = await hashPassword(input.password);
  const id = newId();
  try {
    await db.insert(users).values({
      id,
      firstName: firstName.slice(0, 80),
      lastName: lastName.slice(0, 80),
      mobile,
      email,
      businessName: 'تیم پشتیبانی پُست‌یار',
      businessType: 'پشتیبانی',
      passwordHash,
      role: 'SUPPORT',
      status: 'ACTIVE',
    });
  } catch (err) {
    const msg = String((err as Error).message ?? '');
    if (msg.includes('uq_users_email')) throw new AppError(ERR.DUPLICATE('این ایمیل'));
    if (msg.includes('uq_users_mobile')) throw new AppError(ERR.DUPLICATE('این شمارهٔ موبایل'));
    throw err;
  }
  return { id };
}

/** Promotes a USER to SUPPORT or demotes a SUPPORT back to USER. */
export async function setSupporterRole(userId: string, role: 'SUPPORT' | 'USER'): Promise<void> {
  const db = getDb();
  const [user] = await db.select({ id: users.id, role: users.role }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new AppError(ERR.NOT_FOUND('کاربر'));
  if (user.role === 'SUPER_ADMIN') {
    throw new AppError(ERR.VALIDATION('نقش مدیر ارشد قابل تغییر نیست.'));
  }
  if (user.role !== role) {
    await db.update(users).set({ role }).where(eq(users.id, userId));
  }
}
