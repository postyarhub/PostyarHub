import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { loadEnv } from '../config/env.js';
import * as schema from './schema.js';

/**
 * Conservative connection pool (§109): shared hosting budget, default max 5.
 * Single module-level pool; API/worker/scheduler each create their own process pool.
 */
let pool: mysql.Pool | null = null;

export function getPool(): mysql.Pool {
  if (pool) return pool;
  const env = loadEnv();
  // mysql2 accepts nodejs-style URL or connection string
  pool = mysql.createPool({
    uri: env.DATABASE_URL,
    connectionLimit: env.DB_POOL_MAX,
    waitForConnections: true,
    queueLimit: 20,
    timezone: 'Z',
    charset: 'utf8mb4_unicode_ci',
    enableKeepAlive: true,
  });
  // MariaDB may run with a server-local timezone on shared hosting. Session
  // timestamps must nevertheless be UTC so mysql2's Z timezone is truthful.
  pool.on('connection', (connection) => {
    void connection.query("SET time_zone = '+00:00'");
  });
  return pool;
}


/** Initialize the pool connections with a UTC session timezone before serving traffic.
 * Shared-host databases may use a local server timezone while the app serializes
 * timestamps as UTC. Sequential warm-up removes the first-request race that an
 * asynchronous pool "connection" listener alone can have.
 */
export async function initializeDbSessions(): Promise<void> {
  const p = getPool();
  const max = Math.max(1, loadEnv().DB_POOL_MAX);
  const held: mysql.PoolConnection[] = [];
  try {
    for (let i = 0; i < max; i += 1) {
      const c = await p.getConnection();
      await c.query("SET time_zone = '+00:00'");
      held.push(c);
    }
  } finally {
    for (const c of held) c.release();
  }
}

export type Db = ReturnType<typeof drizzle>;

export function getDb(): Db {
  return drizzle(getPool(), { schema, mode: 'default' });
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export { schema };
