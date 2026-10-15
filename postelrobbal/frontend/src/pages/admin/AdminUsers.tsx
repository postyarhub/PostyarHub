import { useEffect, useState } from 'react';
import { api, avatarPhotoUrl } from '../../lib/api';
import { Button, Card, ConfirmDialog, EmptyState, Field, Modal, PageLoading, Pagination, Select, StatusBadge, Input } from '../../components/ui';
import { Avatar } from '../../components/Avatar';
import { faDate, faDigits } from '../../lib/format';
import { useToast } from '../../lib/toast';
import { PAGE_SIZE, ROLE_FA, USER_STATUS_FA, errText, type AdminPlanDto, type AdminUserRow } from './shared';
import { UserProfile360 } from './UserProfile360';

/* ------------------------------------------------------------------ */
/* کاربران — search, suspend/activate, gift subscription (Task 16-b).  */
/* ------------------------------------------------------------------ */

export default function AdminUsers() {
  const toast = useToast();

  const [items, setItems] = useState<AdminUserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(true);

  const [plans, setPlans] = useState<AdminPlanDto[]>([]);

  // suspend / activate confirm
  const [confirmAction, setConfirmAction] = useState<{ user: AdminUserRow; suspend: boolean } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  // gift subscription modal
  const [grantUser, setGrantUser] = useState<AdminUserRow | null>(null);
  const [grantPlan, setGrantPlan] = useState('');
  const [grantMonths, setGrantMonths] = useState(1);
  const [grantBusy, setGrantBusy] = useState(false);

  // پروفایل ۳۶۰° modal (round 18-c) — quick actions reuse the same
  // grant/confirm dialogs below (single-sourced behavior).
  const [profileUser, setProfileUser] = useState<AdminUserRow | null>(null);

  const loadUsers = async (p: number, term: string) => {
    setLoading(true);
    try {
      const q = new URLSearchParams();
      q.set('page', String(p));
      q.set('pageSize', String(PAGE_SIZE));
      if (term) q.set('search', term);
      const d = await api.get<{ items?: AdminUserRow[]; total?: number; page?: number }>(`/api/v1/admin/users?${q.toString()}`);
      setItems(d.items ?? []);
      setTotal(Number(d.total ?? 0));
      // clamp out-of-range page after filtering (single convergence, no loop)
      const pages = Math.ceil(Number(d.total ?? 0) / PAGE_SIZE);
      if (pages > 0 && p > pages) setPage(pages);
    } catch (err) {
      toast.error(errText(err, 'دریافت کاربران ناموفق بود.'));
    } finally {
      setLoading(false);
    }
  };

  // debounced search → reset to page 1
  useEffect(() => {
    const t = window.setTimeout(() => { setSearch(searchInput.trim()); setPage(1); }, 400);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    void loadUsers(page, search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search]);

  // plans for the gift modal
  useEffect(() => {
    void api
      .get<{ plans?: AdminPlanDto[] }>('/api/v1/admin/plans')
      .then((d) => setPlans(d.plans ?? []))
      .catch(() => undefined);
  }, []);

  const runToggle = async () => {
    if (!confirmAction || confirmAction.user.role === 'SUPER_ADMIN') {
      setConfirmAction(null);
      return;
    }
    setConfirmBusy(true);
    try {
      await api.post(`/api/v1/admin/users/${confirmAction.user.id}/${confirmAction.suspend ? 'suspend' : 'activate'}`);
      toast.success(confirmAction.suspend ? 'کاربر تعلیق شد.' : 'کاربر فعال شد.');
      setConfirmAction(null);
      void loadUsers(page, search);
    } catch (err) {
      toast.error(errText(err, 'عملیات ناموفق بود.'));
    } finally {
      setConfirmBusy(false);
    }
  };

  const submitGrant = async () => {
    if (!grantUser || grantUser.role === 'SUPER_ADMIN') {
      setGrantUser(null);
      return;
    }
    if (!grantPlan) {
      toast.error('پلن را انتخاب کنید.');
      return;
    }
    setGrantBusy(true);
    try {
      await api.post(`/api/v1/admin/users/${grantUser.id}/grant-subscription`, { planCode: grantPlan, months: grantMonths });
      toast.success(`اشتراک هدیه برای «${`${grantUser.firstName ?? ''} ${grantUser.lastName ?? ''}`.trim() || 'این کاربر'}» ثبت شد.`);
      setGrantUser(null);
    } catch (err) {
      toast.error(errText(err, 'ثبت هدیه ناموفق بود.'));
    } finally {
      setGrantBusy(false);
    }
  };

  return (
    <>
      <div className="adm-page-head">
        <h2>کاربران</h2>
        <p>جستجو و مدیریت حساب کاربران؛ حساب‌های مدیریتی فقط خواندنی هستند.</p>
      </div>

      <Card>
        <form
          className="adm-toolbar"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(searchInput.trim());
            setPage(1);
          }}
        >
          <div style={{ flex: 1, minWidth: 200 }}>
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="جستجو: نام، ایمیل یا موبایل…"
              aria-label="جستجوی کاربر"
            />
          </div>
          <Button type="submit" variant="soft">جستجو</Button>
        </form>

        {loading ? (
          <PageLoading />
        ) : items.length === 0 ? (
          <EmptyState icon="👤" title="کاربری پیدا نشد" description="عبارت جستجو را تغییر دهید یا فیلتر را بردارید." />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table adm-table--cards">
                <thead>
                  <tr>
                    <th><span className="sr-only">تصویر</span></th>
                    <th>نام</th>
                    <th>ایمیل</th>
                    <th>موبایل</th>
                    <th>نقش</th>
                    <th>وضعیت</th>
                    <th>تاریخ عضویت</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((u) => {
                    const name = `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim();
                    const photo = u.avatarKind === 'photo' ? avatarPhotoUrl(u.id, u.avatarMediaId) : undefined;
                    return (
                      <tr key={u.id}>
                        <td data-label="تصویر">
                          <Avatar kind={u.avatarKind} value={u.avatarValue} photoUrl={photo} name={name} size={32} />
                        </td>
                        <td data-label="نام" style={{ fontWeight: 600 }}>{name || '—'}</td>
                        <td data-label="ایمیل" dir="ltr" style={{ textAlign: 'right', fontSize: 12.5 }}>{u.email || '—'}</td>
                        <td data-label="موبایل" dir="ltr" style={{ textAlign: 'right', fontSize: 12.5 }}>{u.mobile ? faDigits(u.mobile) : '—'}</td>
                        <td data-label="نقش"><span className="badge badge-brand">{ROLE_FA[u.role ?? ''] ?? u.role}</span></td>
                        <td data-label="وضعیت"><StatusBadge state={u.status ?? ''} labels={USER_STATUS_FA} /></td>
                        <td data-label="تاریخ عضویت">{faDate(u.createdAt)}</td>
                        <td>
                          <div className="adm-table-actions">
                            <Button size="sm" variant="ghost" onClick={() => setProfileUser(u)}>
                              پروفایل ۳۶۰°
                            </Button>
                            {u.role !== 'USER' ? (
                              <span className="badge badge-info">مدیر ارشد · فقط خواندنی</span>
                            ) : (
                              <>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setConfirmAction({ user: u, suspend: u.status !== 'SUSPENDED' })}
                                >
                                  {u.status === 'SUSPENDED' ? 'فعال‌سازی' : 'تعلیق'}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="soft"
                                  onClick={() => {
                                    setGrantUser(u);
                                    setGrantPlan(plans[0]?.code ?? '');
                                    setGrantMonths(1);
                                  }}
                                >
                                  هدیهٔ اشتراک
                                </Button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={(p) => setPage(p)} />
          </>
        )}
      </Card>

      <ConfirmDialog
        open={confirmAction !== null}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => void runToggle()}
        title={confirmAction?.suspend ? 'تعلیق کاربر' : 'فعال‌سازی کاربر'}
        message={
          confirmAction?.suspend
            ? `حساب «${`${confirmAction.user.firstName ?? ''} ${confirmAction.user.lastName ?? ''}`.trim() || 'این کاربر'}» تعلیق می‌شود و تا فعال‌سازی مجدد به سامانه دسترسی نخواهد داشت. ادامه می‌دهید؟`
            : `حساب «${`${confirmAction?.user.firstName ?? ''} ${confirmAction?.user.lastName ?? ''}`.trim() || 'این کاربر'}» فعال می‌شود. ادامه می‌دهید؟`
        }
        danger={confirmAction?.suspend}
        busy={confirmBusy}
      />

      <Modal open={grantUser !== null} onClose={() => setGrantUser(null)} title="هدیهٔ اشتراک">
        <p style={{ fontSize: 13.5, color: 'var(--text-2)', marginBottom: 14 }}>
          اشتراک هدیه برای «{`${grantUser?.firstName ?? ''} ${grantUser?.lastName ?? ''}`.trim() || 'این کاربر'}» فعال می‌شود.
        </p>
        <Field label="پلن" required>
          <Select value={grantPlan} onChange={(e) => setGrantPlan(e.target.value)} aria-label="انتخاب پلن هدیه">
            <option value="">— انتخاب پلن —</option>
            {plans.map((p) => (
              <option key={p.id} value={p.code}>{p.nameFa}</option>
            ))}
          </Select>
        </Field>
        <Field label="مدت (ماه)" required>
          <Select value={String(grantMonths)} onChange={(e) => setGrantMonths(Number(e.target.value))} aria-label="مدت هدیه به ماه">
            {[1, 3, 6, 12].map((m) => (
              <option key={m} value={m}>{faDigits(m)} ماه</option>
            ))}
          </Select>
        </Field>
        <div style={{ display: 'flex', gap: 10 }}>
          <Button onClick={() => void submitGrant()} loading={grantBusy}>ثبت هدیه</Button>
          <Button variant="ghost" onClick={() => setGrantUser(null)}>انصراف</Button>
        </div>
      </Modal>

      <UserProfile360
        user={profileUser}
        onClose={() => setProfileUser(null)}
        onGift={(u) => {
          if (u.role !== 'USER') return;
          // asovin triggerGiftFromProfile flow: close 360, open the existing grant modal
          setProfileUser(null);
          setGrantUser(u);
          setGrantPlan(plans[0]?.code ?? '');
          setGrantMonths(1);
        }}
        onToggleStatus={(u) => {
          // close 360, open the existing suspend/activate ConfirmDialog
          setProfileUser(null);
          if (u.role === 'USER') setConfirmAction({ user: u, suspend: u.status !== 'SUSPENDED' });
        }}
      />
    </>
  );
}
