import Fastify, { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { randomUUID } from 'node:crypto';
import { parse as parseQueryString } from 'node:querystring';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { loadEnv, isProduction } from '../config/env.js';
import { AppError, toPublicError, ERR } from '../core/errors.js';
import { resolveSession, SessionUser } from '../security/sessions.js';
import { verifyCsrfToken } from '../security/csrf.js';
import { roleHasPermission, Permission } from '../security/permissions.js';
import { healthRoutes } from './health.js';
import { getRedis } from '../queue/connection.js';
import { safeInternalErrorFields } from '../core/diagnostic-scrub.js';

export interface AuthedRequest extends FastifyRequest {
  user?: SessionUser;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: SessionUser;
  }
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const INTERNAL_ERROR_LOG_PATH = path.resolve(__dirname, '../../../logs/api-internal-errors.jsonl');
const INTERNAL_ERROR_LOG_MAX_BYTES = 1024 * 1024;

/** Persist only server-side 5xx diagnostics; never record request bodies or credentials. */
async function persistInternalErrorTrace(req: FastifyRequest, err: unknown, status: number, code: string): Promise<void> {
  try {
    const error = err instanceof Error ? err : new Error(String(err));
    const directory = path.dirname(INTERNAL_ERROR_LOG_PATH);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    try {
      const current = await fs.stat(INTERNAL_ERROR_LOG_PATH);
      if (current.size >= INTERNAL_ERROR_LOG_MAX_BYTES) {
        const rotated = `${INTERNAL_ERROR_LOG_PATH}.1`;
        await fs.unlink(rotated).catch(() => undefined);
        await fs.rename(INTERNAL_ERROR_LOG_PATH, rotated).catch(async () => {
          await fs.truncate(INTERNAL_ERROR_LOG_PATH, 0).catch(() => undefined);
        });
      }
    } catch {
      // The log does not exist yet; appendFile creates it below.
    }
    const { errorName, errorMessage, stackPresent } = safeInternalErrorFields(error);
    const record = {
      timestamp: new Date().toISOString(),
      requestId: req.id,
      method: req.method,
      route: req.routeOptions?.url ?? req.url.split('?')[0],
      status,
      code,
      errorName,
      errorMessage,
      stackPresent,
    };
    await fs.appendFile(INTERNAL_ERROR_LOG_PATH, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
    await fs.chmod(INTERNAL_ERROR_LOG_PATH, 0o600);
  } catch (writeError) {
    req.log.error({ writeErrorName: writeError instanceof Error ? safeInternalErrorFields(writeError).errorName : 'NonError', requestId: req.id }, 'internal_error_trace_write_failed');
  }
}


export async function buildApp(): Promise<FastifyInstance> {
  const env = loadEnv();
  const trustedProxyIps = new Set(env.TRUST_PROXY_IPS.split(',').map((v) => v.trim()).filter(Boolean));
  const app = Fastify({
    logger: { level: env.LOG_LEVEL },
    trustProxy: (address) => trustedProxyIps.has(address),
    bodyLimit: 2 * 1024 * 1024,
    requestTimeout: env.REQUEST_TIMEOUT_MS,
    keepAliveTimeout: env.KEEP_ALIVE_TIMEOUT_MS,
    connectionTimeout: 10_000,
    genReqId: () => randomUUID(),
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
      },
    },
    hsts: isProduction(env) ? { maxAge: 31536000, includeSubDomains: true } : false,
  });

  await app.register(cors, {
    origin: env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
  });

  await app.register(cookie, { secret: env.SESSION_SECRET, parseOptions: { sameSite: 'lax' } });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

  // WinaPay posts its callback as application/x-www-form-urlencoded. Keep this parser
  // local and dependency-free so the webhook can coexist with the JSON API.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    try {
      done(null, parseQueryString(String(body)));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  // request id + observability (§129)
  app.addHook('onRequest', async (req) => {
    (req.raw as unknown as { startedAt: number }).startedAt = Date.now();
  });
  app.addHook('onSend', async (req, reply) => {
    if (req.url.startsWith('/api/')) {
      reply.header('cache-control', 'private, no-store, max-age=0');
    }
  });

  app.addHook('onResponse', async (req, reply) => {
    const startedAt = (req.raw as unknown as { startedAt?: number }).startedAt ?? Date.now();
    reply.log.info({
      method: req.method,
      url: req.url,
      status: reply.statusCode,
      durationMs: Date.now() - startedAt,
      requestId: req.id,
    }, 'http_request');
  });

  // session resolution
  app.addHook('onRequest', async (req) => {
    const token = req.cookies['py_session'];
    const session = await resolveSession(token);
    if (session) {
      req.user = session;
      // CSRF for mutating requests (skip provider webhooks registered separately)
      if (MUTATING.has(req.method) && !req.url.startsWith('/api/v1/webhooks') && !req.url.startsWith('/api/v1/payments/callback')) {
        const header = req.headers['x-csrf-token'];
        if (!verifyCsrfToken(Array.isArray(header) ? header[0] : header, session.csrfSecret)) {
          throw new AppError(ERR.CSRF_INVALID());
        }
      }
    }
  });

  // Register rate limiting after session resolution so authenticated route
  // key generators can safely use req.user. Public auth routes still fall back
  // to req.ip because no session exists yet.
  await app.register(rateLimit, {
    global: false,
    max: 300,
    timeWindow: '1 minute',
    redis: getRedis(),
  });

  // auth decorators
  app.decorate('requireAuth', async (req: FastifyRequest) => {
    if (!req.user) throw new AppError(ERR.AUTH_REQUIRED());
  });
  app.decorate('requirePermission', (permission: Permission) => async (req: FastifyRequest) => {
    if (!req.user) throw new AppError(ERR.AUTH_REQUIRED());
    if (!roleHasPermission(req.user.role, permission)) throw new AppError(ERR.FORBIDDEN());
  });

  // unified error handler (§58): stable code + safe Persian message + requestId
  app.setErrorHandler(async (err, req, reply: FastifyReply) => {
    if (err instanceof AppError) {
      if (err.httpStatus >= 500) {
        req.log.error({ requestId: req.id, code: err.code, errorClass: err.errorClass, err }, 'app_internal_error');
        await persistInternalErrorTrace(req, err, err.httpStatus, err.code);
      }
      void reply.status(err.httpStatus).send({
        success: false,
        error: { code: err.code, message: err.userMessage, requestId: req.id },
      });
      return;
    }
    if (typeof (err as { statusCode?: number }).statusCode === 'number') {
      const status = (err as { statusCode?: number }).statusCode as number;
      if (status === 429) {
        void reply.status(429).send({
          success: false,
          error: { code: 'RATE_LIMITED', message: 'تعداد درخواست‌ها بیش از حد مجاز است. کمی بعد تلاش کنید.', requestId: req.id },
        });
        return;
      }
      if (status === 413) {
        void reply.status(413).send({
          success: false,
          error: { code: 'PAYLOAD_TOO_LARGE', message: 'حجم فایل یا دادهٔ ارسالی بیش از حد مجاز است.', requestId: req.id },
        });
        return;
      }
      if (status >= 400 && status < 500) {
        void reply.status(status).send({
          success: false,
          error: { code: 'BAD_REQUEST', message: 'درخواست معتبر نیست.', requestId: req.id },
        });
        return;
      }
    }
    req.log.error({ err }, 'unhandled_error');
    const pub = toPublicError(err);
    if (pub.httpStatus >= 500) await persistInternalErrorTrace(req, err, pub.httpStatus, pub.code);
    void reply.status(pub.httpStatus).send({
      success: false,
      error: { code: pub.code, message: pub.userMessage, requestId: req.id },
    });
  });

  app.setNotFoundHandler((req, reply) => {
    void reply.status(404).send({
      success: false,
      error: { code: 'NOT_FOUND', message: 'مسیر مورد نظر یافت نشد.', requestId: req.id },
    });
  });

  await app.register(healthRoutes, { prefix: '/api/health' });

  return app;
}

// Fastify type augmentation for decorators
declare module 'fastify' {
  interface FastifyInstance {
    requireAuth: (req: FastifyRequest) => Promise<void>;
    requirePermission: (permission: Permission) => (req: FastifyRequest) => Promise<void>;
  }
}
