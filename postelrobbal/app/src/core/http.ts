import { request, Agent } from 'undici';
import { lookup } from 'node:dns/promises';
import { isIP, type LookupFunction } from 'node:net';
import { request as httpsRequest, Agent as HttpsAgent } from 'node:https';
import { randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { AppError, ERR } from './errors.js';

/**
 * Hardened outbound HTTP (§60, §110): explicit timeout, SSRF guard for
 * user-influenced URLs, bounded response size, no unbounded redirects.
 */
const agent = new Agent({
  connections: 32,
  pipelining: 1,
  connect: { autoSelectFamily: true, autoSelectFamilyAttemptTimeout: 300 },
});
const nativeAgent = new HttpsAgent({ keepAlive: false, maxSockets: 16 });
const MAX_REDIRECTS = 3;
const MAX_RESPONSE_BYTES = 2_000_000;

// Conservative outbound policy: deny non-global/reserved IPv4 blocks from IANA's Special-Purpose Address Registry.
const BLOCKED_IPV4_CIDRS = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.0.2.0/24',
  '192.88.99.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '224.0.0.0/4',
  '240.0.0.0/4',
] as const;

function ipv4ToUint32(ip: string): number {
  const parts = ip.split('.').map(Number);
  return ((((parts[0] ?? 0) * 256 + (parts[1] ?? 0)) * 256 + (parts[2] ?? 0)) * 256 + (parts[3] ?? 0)) >>> 0;
}

function ipv4MatchesCidr(ipValue: number, cidr: string): boolean {
  const slash = cidr.lastIndexOf('/');
  const prefix = Number(cidr.slice(slash + 1));
  const network = ipv4ToUint32(cidr.slice(0, slash));
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (((ipValue & mask) >>> 0) === ((network & mask) >>> 0));
}

export interface HttpResult {
  status: number;
  body: string;
  contentType: string;
}
export class HttpJsonParseError extends Error {
  readonly code = 'HTTP_NON_JSON';
  constructor(readonly status: number, readonly contentType: string, readonly bodyPreview: string) {
    super(`Provider returned a non-JSON response (HTTP ${status}, ${contentType || 'unknown content type'})`);
    this.name = 'HttpJsonParseError';
  }
}

function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v6 = ip.toLowerCase();
    // Only globally-routable unicast IPv6 (2000::/3) may be used for outbound
    // requests. This also rejects every IPv4-mapped/compatible IPv6 literal
    // such as ::ffff:7f00:1, which Node canonicalizes from ::ffff:127.0.0.1.
    // Treating mapped addresses as unsafe avoids parser/representation bypasses.
    const groups = v6.split(':');
    const firstGroup = Number.parseInt(groups[0] || '0', 16);
    const secondGroup = Number.parseInt(groups[1] || '0', 16);
    if (!Number.isFinite(firstGroup) || firstGroup < 0x2000 || firstGroup > 0x3fff) return true;

    // Exclude IPv6 transition and special-purpose ranges. 2001::/23 includes
    // IETF protocol assignments, Teredo, benchmarking and ORCHID ranges; the
    // documentation prefixes must also never be used as outbound destinations.
    // These forms can encapsulate/translate IPv4 or behave differently across
    // networks, so accepting them would weaken the IPv4 SSRF boundary.
    if (
      v6.startsWith('2002:') ||
      v6.startsWith('3fff:') ||
      v6.startsWith('2001:db8:') ||
      (firstGroup === 0x2001 && secondGroup <= 0x01ff)
    ) return true;
    return false;
  }
  if (isIP(ip) !== 4) return true; // unknown families are treated as unsafe
  const value = ipv4ToUint32(ip);
  return BLOCKED_IPV4_CIDRS.some((cidr) => ipv4MatchesCidr(value, cidr));
}

const BLOCKED_HOST_SUFFIXES = [
  'metadata.google.internal',
  'metadata.goog',
];

/** Validate + pin a user-influenced URL to one already-validated public address. */
async function resolveSafeUrl(rawUrl: string): Promise<{ url: URL; address?: string; family?: 4 | 6 }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new AppError(ERR.VALIDATION('آدرس واردشده معتبر نیست.'));
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new AppError(ERR.VALIDATION('فقط آدرس‌های http و https مجاز هستند.'));
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
    throw new AppError(ERR.VALIDATION('این آدرس مجاز نیست.'));
  }
  if (BLOCKED_HOST_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`))) {
    throw new AppError(ERR.VALIDATION('این آدرس مجاز نیست.'));
  }
  if (isIP(host)) {
    if (isPrivateIp(host)) throw new AppError(ERR.VALIDATION('این آدرس مجاز نیست.'));
    return { url, address: host, family: isIP(host) as 4 | 6 };
  }

  try {
    const records = await lookup(host, { all: true, verbatim: true });
    if (records.length === 0) throw new Error('no records');
    const publicRecords = records.filter((r) => !isPrivateIp(r.address));
    if (publicRecords.length === 0) throw new AppError(ERR.VALIDATION('این آدرس مجاز نیست.'));
    // Prefer IPv4 because the shared-host transport is intentionally IPv4-first,
    // but accept a public IPv6-only hostname when that is all DNS exposes.
    const chosen = publicRecords.find((r) => r.family === 4) ?? publicRecords[0];
    if (!chosen) throw new AppError(ERR.VALIDATION('میزبان آدرس قابل‌شناسایی نیست.'));
    return { url, address: chosen.address, family: chosen.family === 6 ? 6 : 4 };
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError(ERR.VALIDATION('میزبان آدرس قابل‌شناسایی نیست.'));
  }
}

/** Backward-compatible validation helper used by callers that only need a yes/no guard. */
export async function assertSafeUrl(rawUrl: string): Promise<URL> {
  const resolved = await resolveSafeUrl(rawUrl);
  return resolved.url;
}

export interface HttpOptions {
  timeoutMs?: number;
  headers?: Record<string, string>;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: string | Buffer;
  /** When true, uses SSRF validation and pins the destination IP. Set only for URL-controlled call sites. */
  ssrfGuard?: boolean;
}

export async function httpJson<T>(
  url: string,
  options: HttpOptions = {}
): Promise<{ status: number; data: T }> {
  const res = await httpRaw(url, options);
  let data: unknown;
  try {
    data = JSON.parse(res.body);
  } catch {
    // Preserve bounded transport evidence for provider classification. Never
    // expose the response body to the user.
    throw new HttpJsonParseError(res.status, res.contentType, res.body.slice(0, 240));
  }
  return { status: res.status, data: data as T };
}


export interface HttpMultipartFile {
  fieldName: string;
  filename: string;
  contentType: string;
  data: Buffer;
}

function encodeMultipartBody(fields: Record<string, string>, file: HttpMultipartFile): { body: Buffer; contentType: string } {
  const boundary = `----PostYarBoundary${randomBytes(12).toString('hex')}`;
  const chunks: Buffer[] = [];
  const pushText = (value: string) => chunks.push(Buffer.from(value, 'utf8'));
  for (const [key, value] of Object.entries(fields)) {
    pushText(`--${boundary}\r\n`);
    pushText(`Content-Disposition: form-data; name=\"${key.replace(/[\"\r\n]/g, '')}\"\r\n\r\n`);
    pushText(value);
    pushText('\r\n');
  }
  const field = file.fieldName.replace(/[\"\r\n]/g, '');
  const filename = file.filename.replace(/[\"\r\n]/g, '_').slice(0, 180) || 'postyar-media';
  const contentType = file.contentType.replace(/[\r\n]/g, '').slice(0, 120) || 'application/octet-stream';
  pushText(`--${boundary}\r\n`);
  pushText(`Content-Disposition: form-data; name=\"${field}\"; filename=\"${filename}\"\r\n`);
  pushText(`Content-Type: ${contentType}\r\n\r\n`);
  chunks.push(file.data);
  pushText('\r\n');
  pushText(`--${boundary}--\r\n`);
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

/**
 * Multipart JSON-response POST for fixed, code-controlled provider endpoints.
 * This is intentionally separate from httpBuffer: it is used to upload media
 * directly to the provider, avoiding provider-side fetching of our private URL.
 */
export async function httpMultipartJson<T>(
  url: string,
  fields: Record<string, string>,
  file: HttpMultipartFile,
  timeoutMs = 30_000,
  ssrfGuard = true,
): Promise<{ status: number; data: T }> {
  const encoded = encodeMultipartBody(fields, file);
  const res = await httpRaw(url, {
    method: 'POST',
    timeoutMs,
    ssrfGuard,
    headers: { 'content-type': encoded.contentType },
    body: encoded.body,
  });
  let data: unknown;
  try {
    data = JSON.parse(res.body);
  } catch {
    throw new HttpJsonParseError(res.status, res.contentType, res.body.slice(0, 240));
  }
  return { status: res.status, data: data as T };
}


export interface HttpBufferResult {
  status: number;
  body: Buffer;
  contentType: string;
  location?: string | null;
}

async function nativeHttpBuffer(url: string, options: HttpOptions, resolvedAddress?: string, resolvedFamily?: 4 | 6): Promise<HttpBufferResult> {
  const target = new URL(url);
  const isHttps = target.protocol === 'https:';
  const timeoutMs = options.timeoutMs ?? 25_000;
  const headers: Record<string, string> = {
    'user-agent': 'Postyar/1.0 (+https://postyarhub.ir)',
    ...(options.headers ?? {}),
    ...(resolvedAddress ? { host: target.host } : {}),
  };
  const transport = isHttps ? httpsRequest : httpRequest;
  const forceIpv4 = !isIP(target.hostname);
  const pinnedLookup: LookupFunction | undefined = resolvedAddress
    ? (_hostname, _options, callback) => callback(null, resolvedAddress, resolvedFamily)
    : undefined;
  const MAX_BINARY_RESPONSE_BYTES = 8 * 1024 * 1024;

  return new Promise((resolve, reject) => {
    const req = transport({
      protocol: target.protocol,
      hostname: resolvedAddress ?? target.hostname,
      port: target.port ? Number(target.port) : undefined,
      path: `${target.pathname}${target.search}`,
      method: options.method ?? 'GET',
      headers,
      ...(isHttps ? { agent: nativeAgent, servername: target.hostname } : {}),
      ...(pinnedLookup ? { lookup: pinnedLookup } : (forceIpv4 ? { family: 4 } : {})),
      timeout: timeoutMs,
    }, (res) => {
      const chunks: Buffer[] = [];
      let total = 0;
      res.on('data', (chunk: Buffer | string) => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += buf.length;
        if (total > MAX_BINARY_RESPONSE_BYTES) {
          req.destroy(new Error('binary response too large'));
          return;
        }
        chunks.push(buf);
      });
      res.on('end', () => resolve({
        status: res.statusCode ?? 0,
        body: Buffer.concat(chunks),
        contentType: String(res.headers['content-type'] ?? ''),
        location: typeof res.headers.location === 'string' ? res.headers.location : null,
      }));
      res.on('error', reject);
    });
    req.setNoDelay(true);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

/** Safe binary GET for user-influenced media URLs. DNS is resolved once and
 * pinned into the socket, so validation and connection do not use two resolvers. */
export async function httpBuffer(url: string, options: HttpOptions = {}): Promise<HttpBufferResult> {
  let currentUrl = url;
  const totalTimeoutMs = options.timeoutMs ?? 25_000;
  const startedAt = Date.now();
  let requestOptions = options;
  let previousOrigin: string | null = null;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const remainingMs = totalTimeoutMs - (Date.now() - startedAt);
    if (remainingMs <= 0) throw new AppError(ERR.PROVIDER_UNAVAILABLE());
    const guarded = await resolveSafeUrl(currentUrl);
    const currentOrigin = guarded.url.origin;
    if (previousOrigin !== null && currentOrigin !== previousOrigin) {
      // Never forward credentials or cookies to a redirect-selected origin.
      const safeHeaders = Object.fromEntries(Object.entries(requestOptions.headers ?? {})
        .filter(([name]) => !/^(authorization|proxy-authorization|cookie|cookie2|x-api-key|x-auth-token|x-access-token)$/i.test(name)));
      requestOptions = { ...requestOptions, headers: safeHeaders };
    }
    const res = await nativeHttpBuffer(
      currentUrl,
      { ...requestOptions, timeoutMs: remainingMs },
      guarded.address,
      guarded.family,
    );
    if (res.status >= 300 && res.status < 400) {
      const location = res.location;
      if (!location) return res;
      if (redirects === MAX_REDIRECTS) return res;
      previousOrigin = currentOrigin;
      let next: URL;
      try {
        next = new URL(location, guarded.url);
      } catch {
        throw new AppError(ERR.PROVIDER_UNAVAILABLE());
      }
      currentUrl = next.toString();
      continue;
    }
    return res;
  }
  throw new AppError(ERR.PROVIDER_UNAVAILABLE());
}

async function nativeHttpRaw(url: string, options: HttpOptions, resolvedAddress?: string, resolvedFamily?: 4 | 6): Promise<HttpResult> {
  const target = new URL(url);
  const isHttps = target.protocol === 'https:';
  const timeoutMs = options.timeoutMs ?? 15_000;
  const body = options.body;
  const headers: Record<string, string> = {
    'user-agent': 'Postyar/1.0 (+https://postyarhub.ir)',
    accept: 'application/json',
    ...(body !== undefined ? { 'content-length': String(Buffer.isBuffer(body) ? body.length : Buffer.byteLength(body, 'utf8')) } : {}),
    ...(options.headers ?? {}),
    ...(resolvedAddress ? { host: target.host } : {}),
  };
  const transport = isHttps ? httpsRequest : httpRequest;
  const forceIpv4 = !isIP(target.hostname);
  const pinnedLookup: LookupFunction | undefined = resolvedAddress
    ? (_hostname, _options, callback) => callback(null, resolvedAddress, resolvedFamily)
    : undefined;

  return new Promise((resolve, reject) => {
    const req = transport({
      protocol: target.protocol,
      hostname: resolvedAddress ?? target.hostname,
      port: target.port ? Number(target.port) : undefined,
      path: `${target.pathname}${target.search}`,
      method: options.method ?? 'GET',
      headers,
      ...(isHttps ? { agent: nativeAgent, servername: target.hostname } : {}),
      ...(pinnedLookup ? { lookup: pinnedLookup } : (forceIpv4 ? { family: 4 } : {})),
      timeout: timeoutMs,
    }, (res) => {
      const chunks: Buffer[] = [];
      let total = 0;
      res.on('data', (chunk: Buffer | string) => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += buf.length;
        if (total > MAX_RESPONSE_BYTES) {
          req.destroy(new Error('response too large'));
          return;
        }
        chunks.push(buf);
      });
      res.on('end', () => resolve({
        status: res.statusCode ?? 0,
        body: Buffer.concat(chunks).toString('utf8'),
        contentType: String(res.headers['content-type'] ?? ''),
      }));
      res.on('error', reject);
    });
    req.setNoDelay(true);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

export async function httpRaw(url: string, options: HttpOptions = {}): Promise<HttpResult> {
  let currentUrl = url;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const guarded = options.ssrfGuard ? await resolveSafeUrl(currentUrl) : undefined;
    const guardUrl = guarded?.url;
    try {
      // Fixed provider endpoints use native Node HTTPS first. On CloudLinux/shared
      // hosting this avoids intermittent IPv6/undici socket issues while preserving
      // normal TLS/SNI validation.
      const res = await nativeHttpRaw(currentUrl, options, guarded?.address, guarded?.family);
      if (res.status >= 300 && res.status < 400) {
        return res;
      }
      return res;
    } catch (nativeError) {
      // User-influenced URLs must never fall back to a second resolver/connect
      // path after the SSRF DNS check. A second resolution can reintroduce a
      // DNS-rebinding TOCTOU gap (safe IP at validation time, private IP at
      // connection time). Fixed, code-controlled provider URLs may still use
      // undici as the resilience fallback.
      if (guardUrl) throw nativeError;
      try {
        const raw = await request(currentUrl, {
          method: options.method ?? 'GET',
          headers: { 'user-agent': 'Postyar/1.0 (+https://postyarhub.ir)', ...(options.headers ?? {}) },
          body: options.body,
          signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
          dispatcher: agent,
          ...(guardUrl ? { servername: new URL(currentUrl).hostname } : {}),
        });
        const chunks: Buffer[] = [];
        let total = 0;
        for await (const chunk of raw.body) {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          total += buf.length;
          if (total > MAX_RESPONSE_BYTES) {
            raw.body.destroy();
            throw new AppError(ERR.PROVIDER_UNAVAILABLE());
          }
          chunks.push(buf);
        }
        return {
          status: raw.statusCode,
          body: Buffer.concat(chunks).toString('utf8'),
          contentType: String(raw.headers['content-type'] ?? ''),
        };
      } catch (undiciError) {
        const e = undiciError instanceof Error ? undiciError : new Error(String(undiciError));
        (e as { cause?: unknown }).cause = nativeError;
        throw e;
      }
    }
  }
  throw new AppError(ERR.PROVIDER_UNAVAILABLE());
}
