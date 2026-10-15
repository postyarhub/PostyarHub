import { getDb } from '../db/client.js';
import { auditLogs } from '../db/schema.js';
import { newId } from './ids.js';

/** Audit logging for sensitive actions (§63). No credentials in meta. */
export async function audit(input: {
  action: string;
  actorId?: string | null;
  actorRole?: string | null;
  subjectType?: string;
  subjectId?: string;
  ip?: string;
  meta?: Record<string, unknown>;
}): Promise<void> {
  const clean: Record<string, unknown> = {};
  if (input.meta) {
    for (const [k, v] of Object.entries(input.meta)) {
      if (/secret|token|password|key|credential/i.test(k)) continue;
      clean[k] = typeof v === 'string' && v.length > 500 ? v.slice(0, 500) : v;
    }
  }
  await getDb()
    .insert(auditLogs)
    .values({
      id: newId(),
      actorId: input.actorId ?? null,
      actorRole: input.actorRole ?? null,
      action: input.action,
      subjectType: input.subjectType ?? null,
      subjectId: input.subjectId ?? null,
      ip: input.ip ?? null,
      metaJson: Object.keys(clean).length ? clean : null,
    })
    .catch(() => undefined); // auditing must never break the request path
}
