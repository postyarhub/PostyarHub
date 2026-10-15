import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Badge, Button, Card, ConfirmDialog, EmptyState, Field, Input, Modal, PageLoading } from '../../components/ui';
import { faDate, faDigits, faNumber } from '../../lib/format';
import { useToast } from '../../lib/toast';
import { errText, strField } from './shared';

/* ------------------------------------------------------------------ */
/* تیم پشتیبانی (پشتیبان‌ها) — round 19.                                */
/* Staff accounts with the SUPPORT role: list, create (credentials),   */
/* and demote back to USER. Backend:                                   */
/*   GET   /admin/support/team                                         */
/*   POST  /admin/support/team      (users.manage permission)          */
/*   PATCH /admin/support/team/:id  {role: SUPPORT|USER}               */
/* ------------------------------------------------------------------ */

interface TeamMember {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  mobile?: string | null;
  status?: string | null;
  createdAt?: string | null;
  lastLoginAt?: string | null;
  messagesCount?: number | null;
}

const EMPTY_FORM = { firstName: '', lastName: '', email: '', mobile: '', password: '' };

export default function AdminSupportTeam() {
  const toast = useToast();

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [demoteTarget, setDemoteTarget] = useState<TeamMember | null>(null);
  const [demoteBusy, setDemoteBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.get<TeamMember[]>('/api/v1/admin/support/team');
      setMembers(Array.isArray(d) ? d : []);
    } catch (err) {
      toast.error(errText(err, 'دریافت تیم پشتیبانی ناموفق بود.'));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submitSupporter = async () => {
    if (form.firstName.trim().length < 2 || form.lastName.trim().length < 2) {
      toast.error('نام و نام خانوادگی را کامل وارد کنید.');
      return;
    }
    if (!form.email.trim().includes('@')) {
      toast.error('ایمیل معتبر وارد کنید.');
      return;
    }
    if (form.mobile.trim().length < 10) {
      toast.error('شمارهٔ موبایل را کامل وارد کنید.');
      return;
    }
    if (form.password.length < 8) {
      toast.error('گذرواژه حداقل ۸ نویسه باشد.');
      return;
    }
    setSaving(true);
    try {
      await api.post<{ id: string }>('/api/v1/admin/support/team', {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim(),
        mobile: form.mobile.trim(),
        password: form.password,
      });
      toast.success('پشتیبان جدید ساخته شد و می‌تواند وارد پنل شود.');
      setModalOpen(false);
      setForm(EMPTY_FORM);
      await load();
    } catch (err) {
      toast.error(errText(err, 'ساخت پشتیبان ناموفق بود.'));
    } finally {
      setSaving(false);
    }
  };

  const demoteSupporter = async () => {
    if (!demoteTarget) return;
    setDemoteBusy(true);
    try {
      await api.patch(`/api/v1/admin/support/team/${demoteTarget.id}`, { role: 'USER' });
      toast.success('دسترسی پشتیبانی دریافت شد و کاربر به نقش عادی برگشت.');
      setDemoteTarget(null);
      await load();
    } catch (err) {
      toast.error(errText(err, 'تغییر نقش ناموفق بود.'));
    } finally {
      setDemoteBusy(false);
    }
  };

  return (
    <>
      <div className="adm-page-head adm-page-head--row">
        <div>
          <h2>تیم پشتیبانی</h2>
          <p>ساخت و تعریف پشتیبان‌ها — حساب‌های پشتیبانی به گفتگوی تیکت‌ها دسترسی دارند</p>
        </div>
        <Button onClick={() => { setForm(EMPTY_FORM); setModalOpen(true); }}>+ پشتیبان جدید</Button>
      </div>

      <Card>
        {loading ? (
          <PageLoading />
        ) : members.length === 0 ? (
          <EmptyState
            icon="🎧"
            title="هنوز پشتیبانی تعریف نشده"
            description="با دکمهٔ «پشتیبان جدید» یک حساب پشتیبانی بسازید تا پاسخ‌گویی تیکت‌ها تقسیم شود."
            action={<Button variant="soft" onClick={() => { setForm(EMPTY_FORM); setModalOpen(true); }}>افزودن پشتیبان</Button>}
          />
        ) : (
          <div className="table-wrap">
            <table className="table adm-table--cards">
              <thead>
                <tr>
                  <th>نام</th>
                  <th>ایمیل</th>
                  <th>موبایل</th>
                  <th>وضعیت</th>
                  <th>پیام‌های ثبت‌شده</th>
                  <th>تاریخ عضویت</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id}>
                    <td data-label="نام" style={{ fontWeight: 700 }}>
                      {`${strField(m.firstName)} ${strField(m.lastName)}`.trim() || '—'}
                    </td>
                    <td data-label="ایمیل" dir="ltr" style={{ textAlign: 'right', fontSize: 12.5 }}>{strField(m.email) || '—'}</td>
                    <td data-label="موبایل" dir="ltr" style={{ textAlign: 'right', fontSize: 12.5 }}>{strField(m.mobile) ? faDigits(strField(m.mobile)) : '—'}</td>
                    <td data-label="وضعیت">
                      {m.status === 'SUSPENDED' ? <Badge tone="danger">معلق</Badge> : <Badge tone="success">فعال</Badge>}
                    </td>
                    <td data-label="پیام‌های ثبت‌شده">{faNumber(Number(m.messagesCount ?? 0))}</td>
                    <td data-label="تاریخ عضویت">{faDate(m.createdAt)}</td>
                    <td>
                      <Button size="sm" variant="ghost" onClick={() => setDemoteTarget(m)}>
                        سلب دسترسی پشتیبانی
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="افزودن پشتیبان جدید">
        <p style={{ fontSize: 12.5, color: 'var(--text-2)', margin: '0 0 12px' }}>
          حساب ساخته‌شده با نقش «پشتیبانی» وارد پنل می‌شود و به گفتگوی تیکت‌ها دسترسی دارد؛ به تنظیمات مالی و مدیریت کاربران دسترسی ندارد.
        </p>
        <div style={{ display: 'grid', gap: 0, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
          <Field label="نام" required>
            <Input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
          </Field>
          <Field label="نام خانوادگی" required>
            <Input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
          </Field>
          <Field label="ایمیل" required hint="برای ورود به پنل استفاده می‌شود.">
            <Input dir="ltr" style={{ textAlign: 'left' }} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="support@postyar.ir" />
          </Field>
          <Field label="موبایل" required>
            <Input dir="ltr" style={{ textAlign: 'left' }} inputMode="numeric" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} placeholder="09123456789" />
          </Field>
          <Field label="گذرواژه" required hint="حداقل ۸ نویسه شامل حرف و رقم">
            <Input type="password" dir="ltr" style={{ textAlign: 'left' }} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </Field>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
          <Button onClick={() => void submitSupporter()} loading={saving}>ساخت حساب پشتیبانی</Button>
          <Button variant="ghost" onClick={() => setModalOpen(false)}>انصراف</Button>
        </div>
      </Modal>

      <ConfirmDialog
        open={demoteTarget !== null}
        onClose={() => setDemoteTarget(null)}
        onConfirm={() => void demoteSupporter()}
        title="سلب دسترسی پشتیبانی"
        message={`نقش «${`${strField(demoteTarget?.firstName)} ${strField(demoteTarget?.lastName)}`.trim()}» به «کاربر عادی» تغییر می‌کند و دسترسی به تیکت‌ها قطع می‌شود. ادامه می‌دهید؟`}
        danger
        busy={demoteBusy}
      />
    </>
  );
}
