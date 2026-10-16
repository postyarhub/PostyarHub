import { desc, eq, sql } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import { walletAccounts, walletLedger, pointLedger } from '../../db/schema.js';
import { AppError, ERR } from '../../core/errors.js';
import { newId } from '../../core/ids.js';
import type { Tx } from '../subscriptions/plan.service.js';

export type WalletEntryKind = 'CREDIT' | 'DEBIT' | 'REFUND' | 'BONUS' | 'PAYMENT' | 'ADJUSTMENT';

export interface MoneyRef {
  type?: string;
  id?: string;
}

export interface MoveResult {
  id: string;
  balanceAfter: number;
  replayed: boolean;
}

/** MySQL duplicate-entry detector (used for unique-ref idempotency). */
function isDuplicateError(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  return e?.code === 'ER_DUP_ENTRY' || /Duplicate entry/i.test(String(e?.message ?? ''));
}

const CREDIT_KINDS = new Set<WalletEntryKind>(['CREDIT', 'REFUND', 'BONUS']);

/**
 * Money movement inside an existing transaction (§119). Row-level lock on the
 * wallet account serializes concurrent updates; balance_after is computed from
 * the locked row (never in PHP outside the lock). uq_ledger_ref(ref_type,
 * ref_id, entry_kind) makes referenced moves exactly-once — a duplicate is
 * treated as a successful replay.
 */
export async function moveMoneyTx(
  tx: Tx,
  tenantId: string,
  entryKind: WalletEntryKind,
  amountRial: number,
  ref: MoneyRef,
  memoFa: string
): Promise<MoveResult> {
  if (!Number.isInteger(amountRial) || amountRial === 0) {
    throw new AppError(ERR.VALIDATION('مبلغ تراکنش معتبر نیست.'));
  }
  const refType = ref.type ?? null;
  const refId = ref.id ?? null;
  if ((refType === null) !== (refId === null)) {
    throw new AppError(ERR.VALIDATION('مرجع تراکنش باید کامل باشد.'));
  }

  // The wallet account is the serialization row. The idempotency lookup must
  // happen AFTER this lock; otherwise two concurrent identical callbacks can
  // both pass the early lookup, update the balance twice, then have the second
  // ledger insert fail on the unique key while still committing its balance.
  await tx.execute(
    sql`INSERT IGNORE INTO wallet_accounts (tenant_id, balance_rial) VALUES (${tenantId}, 0)`
  );

  // drizzle mysql2 tx.execute() returns the raw tuple [rows, fields]
  const lockedRaw = await tx.execute(
    sql`SELECT balance_rial FROM wallet_accounts WHERE tenant_id = ${tenantId} FOR UPDATE`
  );
  const lockedRows = (Array.isArray(lockedRaw) ? lockedRaw[0] : (lockedRaw as { rows?: Array<{ balance_rial: number | string }> }).rows ?? []) as Array<{ balance_rial: number | string }>;
  const current = Number(lockedRows[0]?.balance_rial ?? 0);

  // Re-check the idempotency reference while holding the account lock. This is
  // intentionally before any balance mutation. The tenant is part of the
  // lookup even on legacy schemas whose unique index did not include it.
  if (refType && refId) {
    const [existing] = await tx
      .select({ id: walletLedger.id, balanceAfter: walletLedger.balanceAfter })
      .from(walletLedger)
      .where(
        sql`${walletLedger.tenantId} = ${tenantId} AND ${walletLedger.refType} = ${refType} AND ${walletLedger.refId} = ${refId} AND ${walletLedger.entryKind} = ${entryKind}`
      )
      .limit(1);
    if (existing) return { id: existing.id, balanceAfter: Number(existing.balanceAfter), replayed: true };
  }

  let delta: number;
  if (entryKind === 'ADJUSTMENT') {
    delta = amountRial; // signed
  } else if (CREDIT_KINDS.has(entryKind)) {
    delta = Math.abs(amountRial);
  } else {
    delta = -Math.abs(amountRial);
  }
  const newBalance = current + delta;
  if (newBalance < 0) throw new AppError(ERR.WALLET_INSUFFICIENT());

  await tx
    .update(walletAccounts)
    .set({ balanceRial: newBalance })
    .where(eq(walletAccounts.tenantId, tenantId));

  const id = newId();
  try {
    await tx.insert(walletLedger).values({
      id,
      tenantId,
      entryKind,
      amountRial: entryKind === 'ADJUSTMENT' ? amountRial : Math.abs(amountRial),
      balanceAfter: newBalance,
      refType,
      refId,
      memoFa: memoFa.slice(0, 250),
    });
  } catch (err) {
    if (isDuplicateError(err) && refType && refId) {
      const [existing] = await tx
        .select({ id: walletLedger.id, balanceAfter: walletLedger.balanceAfter })
        .from(walletLedger)
        .where(
          sql`${walletLedger.tenantId} = ${tenantId} AND ${walletLedger.refType} = ${refType} AND ${walletLedger.refId} = ${refId} AND ${walletLedger.entryKind} = ${entryKind}`
        )
        .limit(1);
      if (existing) return { id: existing.id, balanceAfter: Number(existing.balanceAfter), replayed: true };
    }
    throw err;
  }
  return { id, balanceAfter: newBalance, replayed: false };
}

/** Public entry: own transaction. */
export async function moveMoney(
  tenantId: string,
  entryKind: WalletEntryKind,
  amountRial: number,
  ref: MoneyRef,
  memoFa: string
): Promise<MoveResult> {
  const db = getDb();
  return db.transaction((tx) => moveMoneyTx(tx, tenantId, entryKind, amountRial, ref, memoFa));
}

// ---- points ----

export interface PointRef {
  type?: string;
  id?: string;
}

export interface PointResult {
  id: string;
  balanceAfter: number;
}

/**
 * Point balance is maintained via the last ledger row's balance_after. The
 * last row is read with FOR UPDATE inside the caller's transaction so
 * concurrent awards serialize instead of lost-updating.
 */
async function currentPointsTx(tx: Tx, tenantId: string): Promise<number> {
  // Use the wallet account singleton as the serialization row even before the
  // first point entry exists. Without this, two concurrent first awards both
  // observe balance=0 and write conflicting balance_after values.
  await tx.execute(sql`INSERT IGNORE INTO wallet_accounts (tenant_id, balance_rial) VALUES (${tenantId}, 0)`);
  await tx.execute(sql`SELECT tenant_id FROM wallet_accounts WHERE tenant_id = ${tenantId} FOR UPDATE`);
  const lockedRaw = await tx.execute(
    sql`SELECT balance_after FROM point_ledger WHERE tenant_id = ${tenantId} ORDER BY created_at DESC, id DESC LIMIT 1 FOR UPDATE`
  );
  const lockedRows = (Array.isArray(lockedRaw) ? lockedRaw[0] : (lockedRaw as { rows?: Array<{ balance_after: number | string }> }).rows ?? []) as Array<{ balance_after: number | string }>;
  return Number(lockedRows[0]?.balance_after ?? 0);
}

async function insertPointRow(
  tx: Tx,
  tenantId: string,
  entryKind: 'EARN' | 'SPEND' | 'ADJUSTMENT',
  amount: number,
  balanceAfter: number,
  ref: PointRef,
  memoFa: string
): Promise<string> {
  const id = newId();
  await tx.insert(pointLedger).values({
    id,
    tenantId,
    entryKind,
    amount,
    balanceAfter,
    refType: ref.type ?? null,
    refId: ref.id ?? null,
    memoFa: memoFa.slice(0, 250),
  });
  return id;
}

export async function pointCreditTx(
  tx: Tx,
  tenantId: string,
  points: number,
  ref: PointRef,
  memoFa: string
): Promise<PointResult> {
  if (!Number.isInteger(points) || points <= 0) {
    throw new AppError(ERR.VALIDATION('تعداد امتیاز معتبر نیست.'));
  }
  const current = await currentPointsTx(tx, tenantId);
  if (ref.type && ref.id) {
    const [existing] = await tx
      .select({ id: pointLedger.id, balanceAfter: pointLedger.balanceAfter })
      .from(pointLedger)
      .where(sql`${pointLedger.tenantId} = ${tenantId} AND ${pointLedger.refType} = ${ref.type} AND ${pointLedger.refId} = ${ref.id} AND ${pointLedger.entryKind} = 'EARN'`)
      .limit(1);
    if (existing) return { id: existing.id, balanceAfter: Number(existing.balanceAfter) };
  }
  const balanceAfter = current + points;
  const id = await insertPointRow(tx, tenantId, 'EARN', points, balanceAfter, ref, memoFa);
  return { id, balanceAfter };
}

export async function pointSpendTx(
  tx: Tx,
  tenantId: string,
  points: number,
  ref: PointRef,
  memoFa: string
): Promise<PointResult> {
  if (!Number.isInteger(points) || points <= 0) {
    throw new AppError(ERR.VALIDATION('تعداد امتیاز معتبر نیست.'));
  }
  const current = await currentPointsTx(tx, tenantId);
  if (ref.type && ref.id) {
    const [existing] = await tx
      .select({ id: pointLedger.id, balanceAfter: pointLedger.balanceAfter })
      .from(pointLedger)
      .where(sql`${pointLedger.tenantId} = ${tenantId} AND ${pointLedger.refType} = ${ref.type} AND ${pointLedger.refId} = ${ref.id} AND ${pointLedger.entryKind} = 'SPEND'`)
      .limit(1);
    if (existing) return { id: existing.id, balanceAfter: Number(existing.balanceAfter) };
  }
  if (current < points) {
    throw new AppError(ERR.VALIDATION('امتیاز کافی برای این کار ندارید.'));
  }
  const balanceAfter = current - points;
  const id = await insertPointRow(tx, tenantId, 'SPEND', points, balanceAfter, ref, memoFa);
  return { id, balanceAfter };
}

export async function point_credit(
  tenantId: string,
  points: number,
  ref: PointRef,
  memoFa: string
): Promise<PointResult> {
  const db = getDb();
  return db.transaction((tx) => pointCreditTx(tx, tenantId, points, ref, memoFa));
}

export async function point_spend(
  tenantId: string,
  points: number,
  ref: PointRef,
  memoFa: string
): Promise<PointResult> {
  const db = getDb();
  return db.transaction((tx) => pointSpendTx(tx, tenantId, points, ref, memoFa));
}

/** Points balance derived from ledger sum (single cheap aggregate). */
export async function getPointsBalance(tenantId: string): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({
      value: sql<string | number>`COALESCE(SUM(CASE WHEN ${pointLedger.entryKind} = 'SPEND' THEN -${pointLedger.amount} ELSE ${pointLedger.amount} END), 0)`,
    })
    .from(pointLedger)
    .where(eq(pointLedger.tenantId, tenantId));
  return Number(row?.value ?? 0);
}

export interface WalletSummary {
  balanceRial: number;
  pointsBalance: number;
  ledger: Array<{
    id: string;
    entryKind: WalletEntryKind;
    amountRial: number;
    balanceAfter: number;
    refType: string | null;
    refId: string | null;
    memoFa: string;
    createdAt: Date;
  }>;
}

export async function getWalletSummary(tenantId: string): Promise<WalletSummary> {
  const db = getDb();
  const [account] = await db
    .select({ balanceRial: walletAccounts.balanceRial })
    .from(walletAccounts)
    .where(eq(walletAccounts.tenantId, tenantId))
    .limit(1);
  const rows = await db
    .select()
    .from(walletLedger)
    .where(eq(walletLedger.tenantId, tenantId))
    .orderBy(desc(walletLedger.createdAt), desc(walletLedger.id))
    .limit(20);

  return {
    balanceRial: Number(account?.balanceRial ?? 0),
    pointsBalance: await getPointsBalance(tenantId),
    ledger: rows.map((r) => ({
      id: r.id,
      entryKind: r.entryKind,
      amountRial: Number(r.amountRial),
      balanceAfter: Number(r.balanceAfter),
      refType: r.refType,
      refId: r.refId,
      memoFa: r.memoFa,
      createdAt: r.createdAt,
    })),
  };
}

/** Points → wallet balance (min 100 points, ۱۰ ریال per point). */
export async function convertPoints(tenantId: string, points: number): Promise<{ amountRial: number; balanceRial: number; pointsRemaining: number }> {
  if (!Number.isInteger(points) || points < 100) {
    throw new AppError(ERR.VALIDATION('حداقل امتیاز قابل تبدیل ۱۰۰ امتیاز است.'));
  }
  const amountRial = points * 10;
  const db = getDb();
  const result = await db.transaction(async (tx) => {
    const ref = { type: 'points_convert', id: newId() };
    await pointSpendTx(tx, tenantId, points, ref, 'تبدیل امتیاز به موجودی');
    const moved = await moveMoneyTx(tx, tenantId, 'CREDIT', amountRial, ref, 'تبدیل امتیاز به موجودی');
    return moved.balanceAfter;
  });
  const pointsRemaining = await getPointsBalance(tenantId);
  return { amountRial, balanceRial: result, pointsRemaining };
}
