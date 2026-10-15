import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { postTargets, posts } from '../db/schema.js';

/** Recompute the post aggregate from target state. Safe to call after any target transition. */
export async function refreshPostAggregate(postId: string): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    // Serialize aggregate recalculation itself. Without a row lock, two target
    // transitions could each calculate from an interleaved snapshot and the
    // slower refresh could overwrite a newer aggregate state. Every authoritative
    // target transition calls this function, so the second refresh re-reads after
    // the first commits and converges to the correct state.
    const [post] = await tx.select().from(posts).where(eq(posts.id, postId)).limit(1).for('update');
    if (!post) return;

    const rows = await tx
      .select({ state: postTargets.state })
      .from(postTargets)
      .where(eq(postTargets.postId, postId));
    if (rows.length === 0) return;

    const sent = rows.filter((r) => r.state === 'SENT').length;
    const closed = rows.filter((r) => r.state === 'FAILED' || r.state === 'CANCELLED').length;
    const open = rows.length - sent - closed;

    let next: typeof post.state;
    if (sent === rows.length) next = 'PUBLISHED';
    else if (sent > 0) next = 'PARTIAL';
    else if (open === 0) next = 'FAILED';
    else next = 'PUBLISHING';

    const setPublishedAt = post.publishedAt === null && (next === 'PUBLISHED' || next === 'PARTIAL');
    if (next !== post.state || setPublishedAt) {
    await tx
      .update(posts)
      .set({ state: next, ...(setPublishedAt ? { publishedAt: new Date() } : {}) })
      .where(
        and(
          eq(posts.id, postId),
          inArray(posts.state, ['QUEUED', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'PARTIAL', 'FAILED'])
        )
      );
    }
  });
}
