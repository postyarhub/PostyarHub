import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiRequestError, type BotDto } from '../../lib/api';
import { Button, Card, ConfirmDialog, EmptyState, PageLoading, Pagination } from '../../components/ui';
import { faNumber, faRelative } from '../../lib/format';
import { useToast } from '../../lib/toast';

interface WorkflowRow {
  id: string;
  botId?: string | null;
  nameFa?: string | null;
  isEnabled?: number | boolean | null;
  runCount?: number | null;
  createdAt?: string | null;
}

export default function Workflows() {
  const toast = useToast();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<WorkflowRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [botTitles, setBotTitles] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const [wf, bots] = await Promise.all([
        api.get<{ items?: WorkflowRow[]; total?: number; page?: number }>(`/api/v1/workflows?page=${p}`),
        api.get<{ items?: BotDto[]; bots?: BotDto[] }>('/api/v1/bots').catch(() => null),
      ]);
      const list = bots?.items ?? bots?.bots ?? [];
      const titles: Record<string, string> = {};
      for (const b of list) titles[b.id] = b.title;
      setBotTitles(titles);
      setItems(wf.items ?? []);
      setTotal(Number(wf.total ?? 0));
      setPage(Number(wf.page ?? p));
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'دریافت گردش‌کارها ناموفق بود.');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load(1);
  }, [load]);

  const toggle = async (wf: WorkflowRow) => {
    const enabled = Boolean(wf.isEnabled);
    setBusyId(wf.id);
    try {
      await api.post(`/api/v1/workflows/${wf.id}/${enabled ? 'disable' : 'enable'}`);
      toast.success(enabled ? 'گردش‌کار غیرفعال شد.' : 'گردش‌کار فعال شد.');
      await load(page);
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'عملیات ناموفق بود.');
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    setBusyId(deleteId);
    try {
      await api.del(`/api/v1/workflows/${deleteId}`);
      toast.success('گردش‌کار حذف شد.');
      setDeleteId(null);
      await load(page);
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'حذف ناموفق بود.');
    } finally {
      setBusyId(null);
    }
  };

  const target = items.find((w) => w.id === deleteId);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: 21, fontWeight: 800 }}>گردش‌کارها</h1>
          <p style={{ color: 'var(--text-2)', fontSize: 13.5 }}>اتوماسیون ارسال پیام بدون کدنویسی؛ زنجیره‌ای از پیام‌ها، شرط‌ها و توقف‌ها.</p>
        </div>
        <Link to="/dashboard/workflows/new" className="btn btn-primary" style={{ display: 'inline-flex' }}>+ گردش‌کار جدید</Link>
      </div>

      {loading ? (
        <PageLoading />
      ) : items.length === 0 ? (
        <EmptyState
          icon="🔀"
          title="هنوز گردش‌کاری نساخته‌اید"
          description="گردش‌کار برای خوش‌آمدگویی، پاسخ خودکار، پیشنهاد محصول و هر سناریوی چندمرحله‌ای کاربرد دارد."
          action={<Link to="/dashboard/workflows/new" className="btn btn-primary" style={{ display: 'inline-flex' }}>ساخت اولین گردش‌کار</Link>}
        />
      ) : (
        <Card>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>نام</th>
                  <th>ربات</th>
                  <th>وضعیت</th>
                  <th>تعداد اجرا</th>
                  <th>ایجاد</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((wf) => {
                  const enabled = Boolean(wf.isEnabled);
                  return (
                    <tr key={wf.id}>
                      <td style={{ fontWeight: 700 }}>{wf.nameFa || 'بدون نام'}</td>
                      <td>{(wf.botId && botTitles[wf.botId]) || '—'}</td>
                      <td>
                        <span className={`badge ${enabled ? 'badge-success' : 'badge-muted'}`}>{enabled ? 'فعال' : 'غیرفعال'}</span>
                      </td>
                      <td>{faNumber(wf.runCount ?? 0)}</td>
                      <td>{faRelative(wf.createdAt)}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <Button size="sm" variant="ghost" loading={busyId === wf.id} onClick={() => void toggle(wf)}>
                            {enabled ? 'غیرفعال‌سازی' : 'فعال‌سازی'}
                          </Button>
                          <Button size="sm" variant="soft" onClick={() => navigate(`/dashboard/workflows/new?id=${wf.id}`)}>ویرایش</Button>
                          <Button size="sm" variant="danger" onClick={() => setDeleteId(wf.id)}>حذف</Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={20} total={total} onPage={(p) => void load(p)} />
        </Card>
      )}

      <ConfirmDialog
        open={Boolean(deleteId)}
        onClose={() => setDeleteId(null)}
        onConfirm={() => void confirmDelete()}
        title="حذف گردش‌کار"
        message={`آیا از حذف «${target?.nameFa ?? 'این گردش‌کار'}» مطمئن هستید؟ این عمل بازگشت‌پذیر نیست.`}
        danger
        busy={busyId === deleteId}
      />
    </div>
  );
}
