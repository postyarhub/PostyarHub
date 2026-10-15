import { useCallback, useEffect, useState } from 'react';
import { api, ApiRequestError, type NotificationDto, type Page } from '../../lib/api';
import { Button, Card, EmptyState, PageLoading, Pagination } from '../../components/ui';
import { useToast } from '../../lib/toast';
import { faDigits, faNumber, faRelative } from '../../lib/format';

type NotificationsPage = Page<NotificationDto> & { unread?: number };

function errText(e: unknown): string {
  if (e instanceof ApiRequestError) return e.message;
  return 'خطای غیرمنتظره رخ داد. دوباره تلاش کنید.';
}

export default function Notifications() {
  const toast = useToast();
  const [items, setItems] = useState<NotificationDto[]>([]);
  const [total, setTotal] = useState(0);
  const [unread, setUnread] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [markingAll, setMarkingAll] = useState(false);
  const pageSize = 15;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<NotificationsPage>(`/api/v1/notifications?page=${page}&pageSize=${pageSize}`);
      const list = data.items ?? [];
      setItems(list);
      setTotal(data.total ?? 0);
      // Some responses carry a server-side unread counter; otherwise count locally (defensive).
      setUnread(typeof data.unread === 'number' ? data.unread : list.filter((n) => !n.readAt).length);
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setLoading(false);
    }
  }, [page, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const markRead = async (n: NotificationDto) => {
    if (n.readAt) return;
    setBusyId(n.id);
    try {
      await api.post(`/api/v1/notifications/${n.id}/read`);
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)));
      setUnread((u) => Math.max(0, u - 1));
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusyId('');
    }
  };

  const markAllRead = async () => {
    setMarkingAll(true);
    try {
      await api.post('/api/v1/notifications/read-all');
      toast.success('همهٔ اعلان‌ها خوانده شد.');
      await load();
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setMarkingAll(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 4px' }}>اعلان‌ها</h1>
          <p style={{ color: 'var(--text-2)', fontSize: 13, margin: 0 }}>
            {unread > 0 ? `${faNumber(unread)} اعلان خوانده‌نشده` : 'همهٔ اعلان‌ها خوانده شده‌اند'}
          </p>
        </div>
        {unread > 0 && (
          <Button variant="soft" loading={markingAll} onClick={() => void markAllRead()}>
            خواندن همه
          </Button>
        )}
      </div>

      {loading ? (
        <PageLoading />
      ) : items.length === 0 ? (
        <EmptyState
          icon="🔔"
          title="اعلانی ندارید"
          description="پیام‌های سیستمی مانند وضعیت ارسال پست‌ها و اطلاع‌رسانی اشتراک در این بخش نمایش داده می‌شود."
        />
      ) : (
        <Card pad="lg">
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {items.map((n) => {
              const isUnread = !n.readAt;
              return (
                <li
                  key={n.id}
                  style={{
                    display: 'flex', gap: 12, alignItems: 'flex-start',
                    padding: '12px 0', borderBottom: '1px solid var(--border)',
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: 9, height: 9, borderRadius: 999, marginTop: 6, flexShrink: 0,
                      background: isUnread ? 'var(--brand)' : 'transparent',
                      border: isUnread ? 'none' : '1px solid var(--border)',
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: isUnread ? 700 : 500, fontSize: 14 }}>{n.titleFa}</div>
                    <p style={{ margin: '3px 0 0', fontSize: 13, color: 'var(--text-2)', lineHeight: 1.9 }}>{n.bodyFa}</p>
                    <div style={{ marginTop: 4, fontSize: 11.5, color: 'var(--text-2)' }}>{faRelative(n.createdAt)}</div>
                  </div>
                  {isUnread && (
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={busyId === n.id}
                      onClick={() => void markRead(n)}
                      aria-label={`علامت‌گذاری «${n.titleFa}» به‌عنوان خوانده‌شده`}
                    >
                      علامت‌گذاری به‌عنوان خوانده‌شده
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
          <div style={{ fontSize: 12, color: 'var(--text-2)', textAlign: 'center', marginTop: 8 }}>
            نمایش {faDigits(items.length)} از {faNumber(total)} اعلان
          </div>
          <Pagination page={page} pageSize={pageSize} total={total} onPage={setPage} />
        </Card>
      )}
    </div>
  );
}
