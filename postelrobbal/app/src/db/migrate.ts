import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createConnection, type RowDataPacket } from 'mysql2/promise';
import { loadEnv } from '../config/env.js';
import { getPool, closeDb } from './client.js';

/**
 * Deterministic migration runner (§66).
 * Applies committed .sql files in lexical order, exactly once.
 * Detects drift: if the DB is ahead/unknown, aborts instead of guessing (§201).
 */
export async function runMigrations(migrationsDir: string): Promise<string[]> {
  const pool = getPool();
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name VARCHAR(190) PRIMARY KEY,
    applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
  const [appliedRows] = await pool.query<RowDataPacket[]>('SELECT name FROM schema_migrations');
  const applied = new Set(appliedRows.map((r) => String(r.name)));

  const unknown = [...applied].filter((a) => !files.includes(a));
  if (unknown.length > 0) {
    throw new Error(`Schema drift detected: applied migration(s) not present in release: ${unknown.join(', ')}. Aborting.`);
  }

  const newlyApplied: string[] = [];
  let pending = files.filter((f) => !applied.has(f));
  if (pending.length === 0) return newlyApplied;

  // Migration files are multi-statement SQL. The application pool keeps
  // multipleStatements disabled as a SQL-injection hardening measure, so
  // migrations run on a dedicated connection with it enabled — and on
  // nothing else (§66).
  const env = loadEnv();
  const conn = await createConnection({ uri: env.DATABASE_URL, multipleStatements: true });
  let advisoryLockAcquired = false;
  try {
    const [lockRows] = await conn.query<RowDataPacket[]>('SELECT GET_LOCK(?, 30) AS acquired', ['postyar:schema-migrations']);
    advisoryLockAcquired = Number((lockRows[0] as { acquired?: number } | undefined)?.acquired ?? 0) === 1;
    if (!advisoryLockAcquired) throw new Error('Could not acquire schema migration lock within 30 seconds.');
    const [lockedAppliedRows] = await conn.query<RowDataPacket[]>('SELECT name FROM schema_migrations');
    const lockedApplied = new Set(lockedAppliedRows.map((r) => String(r.name)));
    const lockedUnknown = [...lockedApplied].filter((a) => !files.includes(a));
    if (lockedUnknown.length > 0) {
      throw new Error(`Schema drift detected after acquiring migration lock: ${lockedUnknown.join(', ')}. Aborting.`);
    }
    pending = files.filter((f) => !lockedApplied.has(f));
    if (pending.length === 0) return newlyApplied;
    for (const file of pending) {
      const sqlText = await readFile(path.join(migrationsDir, file), 'utf8');
      try {
        await conn.beginTransaction();
        await conn.query(sqlText);
        await conn.query('INSERT INTO schema_migrations (name) VALUES (?)', [file]);
        await conn.commit();
        newlyApplied.push(file);
      } catch (err) {
        await conn.rollback();
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
    }
  } finally {
    if (advisoryLockAcquired) {
      await conn.query('SELECT RELEASE_LOCK(?)', ['postyar:schema-migrations']).catch(() => undefined);
    }
    await conn.end();
  }
  return newlyApplied;
}

if (process.argv[1] && /migrate-cli\.(ts|js)$/.test(process.argv[1])) {
  const dir = process.env.MIGRATIONS_DIR ?? path.resolve(process.cwd(), '../database/migrations');
  runMigrations(dir)
    .then((applied) => {
      // eslint-disable-next-line no-console
      console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Already up to date.');
      return closeDb();
    })
    .then(() => process.exit(0))
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(err.message);
      process.exit(1);
    });
}
