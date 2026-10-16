import { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { loadEnv } from '../config/env.js';

/**
 * Health endpoints (§56, §128). /live is dependency-independent.
 * /ready performs REAL checks — never fakes readiness.
 */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/live', async (_req, reply) => {
    reply.header('cache-control', 'no-store');
    return { status: 'live', time: new Date().toISOString() };
  });

  app.get('/ready', async (_req, reply) => {
    const checks: Record<string, { ok: boolean; latencyMs?: number; code?: string }> = {};
    let ready = true;

    const started = Date.now();
    try {
      const db = getDb();
      await db.execute(sql`SELECT 1`);
      checks.mysql = { ok: true, latencyMs: Date.now() - started };
    } catch (err) {
      ready = false;
      checks.mysql = { ok: false, code: 'MYSQL_UNAVAILABLE' };
      app.log.error({ err }, 'health_mysql_unavailable');
    }

    try {
      const { getRedis } = await import('../queue/connection.js');
      const redis = getRedis();
      const pong = await redis.ping();
      checks.redis = { ok: pong === 'PONG' };
      if (pong !== 'PONG') { ready = false; checks.redis.code = 'REDIS_UNAVAILABLE'; }
    } catch (err) {
      ready = false;
      checks.redis = { ok: false, code: 'REDIS_UNAVAILABLE' };
      app.log.error({ err }, 'health_redis_unavailable');
    }

    const env = loadEnv();
    reply.header('cache-control', 'no-store');
    reply.code(ready ? 200 : 503);
    if (env.NODE_ENV === 'production') {
      // Anonymous probes need only readiness status. Dependency names and
      // individual diagnostics belong in authenticated/host-side telemetry.
      return { status: ready ? 'ready' : 'degraded' };
    }
    return { status: ready ? 'ready' : 'degraded', checks, env: env.NODE_ENV };
  });

  app.get('/', async () => ({ status: 'ok', service: 'postyar-api' }));
}
