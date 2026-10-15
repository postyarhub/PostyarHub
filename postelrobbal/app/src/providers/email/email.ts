import net from 'node:net';
import tls from 'node:tls';
import { loadEnv } from '../../config/env.js';
import { createLogger } from '../../core/logger.js';

/**
 * Email adapter (honest v1, §27): no fake success. Without MAIL_HOST the send
 * is reported as NOT_CONFIGURED. With MAIL_HOST a minimal SMTP client
 * (implicit TLS on 465, STARTTLS otherwise, AUTH LOGIN) performs a real
 * delivery. Reset tokens or credentials are never logged (§62).
 */

const log = createLogger('email-provider');

export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
}

export interface SendEmailResult {
  ok: boolean;
  reason?: string;
}

const SMTP_TIMEOUT_MS = 20_000;

class SmtpClient {
  constructor(private socket: net.Socket | tls.TLSSocket) {}

  rawSocket(): net.Socket | tls.TLSSocket {
    return this.socket;
  }

  private readReply(): Promise<string> {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        this.socket.off('data', onData);
        this.socket.off('error', onError);
        this.socket.off('timeout', onTimeout);
      };
      const onData = (chunk: Buffer | string) => {
        this.buffer += chunk.toString('utf8');
        const endsWithCrlf = /\r?\n$/.test(this.buffer);
        if (!endsWithCrlf) return;
        const lines = this.buffer.split(/\r?\n/).filter((l) => l.length > 0);
        const last = lines[lines.length - 1];
        if (lines.length >= 1 && last && /^\d{3} /.test(last)) {
          this.buffer = '';
          cleanup();
          resolve(lines.join('\n'));
        }
      };
      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };
      const onTimeout = () => {
        cleanup();
        reject(new Error('SMTP_TIMEOUT'));
      };
      this.socket.on('data', onData);
      this.socket.on('error', onError);
      this.socket.once('timeout', onTimeout);
    });
  }

  private buffer = '';

  async command(payload: string | null, okCodes: number[]): Promise<string> {
    if (payload !== null) this.socket.write(`${payload}\r\n`);
    const reply = await this.readReply();
    const code = Number.parseInt(reply.slice(0, 3), 10);
    if (!okCodes.includes(code)) {
      throw new Error(`SMTP_UNEXPECTED_REPLY: ${reply.slice(0, 120)}`);
    }
    return reply;
  }

  end(): void {
    this.socket.end();
  }
}

function connect(host: string, port: number, implicitTls: boolean): Promise<SmtpClient> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => reject(err);
    const onTimeout = () => reject(new Error('SMTP_CONNECT_TIMEOUT'));
    const socket: net.Socket | tls.TLSSocket = implicitTls
      ? tls.connect({ host, port, servername: host })
      : net.connect({ host, port });
    socket.setTimeout(SMTP_TIMEOUT_MS);
    socket.once('error', onError);
    socket.once('timeout', onTimeout);
    const onReady = () => {
      socket.off('error', onError);
      socket.off('timeout', onTimeout);
      resolve(new SmtpClient(socket));
    };
    socket.once(implicitTls ? 'secureConnect' : 'connect', onReady);
  });
}

function upgradeTls(client: SmtpClient, host: string): Promise<SmtpClient> {
  return new Promise((resolve, reject) => {
    const plain = client.rawSocket();
    const onError = (err: Error) => reject(err);
    const secure = tls.connect({ socket: plain, servername: host });
    secure.setTimeout(SMTP_TIMEOUT_MS);
    secure.once('error', onError);
    secure.once('secureConnect', () => {
      secure.off('error', onError);
      resolve(new SmtpClient(secure));
    });
  });
}

function encodeHeader(value: string): string {
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function buildMessage(from: string, to: string, subject: string, text: string): string {
  const body = Buffer.from(text, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
  return [
    `From: Postyar <${from}>`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    body,
  ].join('\r\n');
}

/** RFC 5321 dot-stuffing (kept for robustness even with base64 bodies). */
function dotStuff(message: string): string {
  return message
    .split('\r\n')
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join('\r\n');
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const env = loadEnv();
  if (!env.MAIL_HOST) {
    log.warn({ event: 'email_queued_unconfigured' }, 'email_queued_unconfigured');
    return { ok: false, reason: 'NOT_CONFIGURED' };
  }

  const port = env.MAIL_PORT ?? 587;
  const user = env.MAIL_USER;
  const password = env.MAIL_PASSWORD;
  const from = user ?? 'no-reply@postyar.ir';
  let client: SmtpClient | null = null;

  try {
    client = await connect(env.MAIL_HOST, port, port === 465);
    await client.command(null, [220]); // greeting
    let ehlo = await client.command('EHLO postyar.ir', [250]);

    if (port !== 465 && /STARTTLS/i.test(ehlo)) {
      await client.command('STARTTLS', [220]);
      client = await upgradeTls(client, env.MAIL_HOST);
      ehlo = await client.command('EHLO postyar.ir', [250]);
    }
    void ehlo;

    if (user && password) {
      await client.command('AUTH LOGIN', [334]);
      await client.command(Buffer.from(user, 'utf8').toString('base64'), [334]);
      await client.command(Buffer.from(password, 'utf8').toString('base64'), [235]);
    }

    await client.command(`MAIL FROM:<${from}>`, [250]);
    await client.command(`RCPT TO:<${input.to}>`, [250, 251]);
    await client.command('DATA', [354]);
    const message = buildMessage(from, input.to, input.subject, input.text);
    await client.command(`${dotStuff(message)}\r\n.`, [250]);
    client.command('QUIT', [221]).catch(() => undefined); // closing handshake is best-effort
    client.end();
    return { ok: true };
  } catch (err) {
    client?.end();
    const reason = err instanceof Error ? err.message.slice(0, 120) : 'SMTP_ERROR';
    log.warn({ event: 'email_send_failed', reason }, 'email_send_failed');
    return { ok: false, reason };
  }
}
