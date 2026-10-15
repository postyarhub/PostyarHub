import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  Modal,
  PageLoading,
  Pagination,
  Select,
  StatusBadge,
} from '../../components/ui';
import { faDateTime, faFileSize, faLabel, faNumber, faRelative } from '../../lib/format';
import { useToast } from '../../lib/toast';
import {
  PAGE_SIZE,
  TICKET_STATE_FA,
  errText,
  strField,
  type AdminUserRow,
} from './shared';
import { ContentComposerTextarea } from '../../components/ContentComposerTextarea';

/* ------------------------------------------------------------------ */
/* تیکت‌های پشتیبانی — admin conversation view (round 18 + 19).         */
/* List with state chips + search, conversation modal with reply       */
/* (text + optional file), close, staff-initiated tickets, and a       */
/* category manager. Backend contract:                                 */
/*   GET    /admin/support/tickets?page&pageSize&state&search          */
/*   POST   /admin/support/tickets            (multipart tenantId…)    */
/*   GET    /admin/support/tickets/:id                                 */
/*   POST   /admin/support/tickets/:id/messages  (multipart body+file) */
/*   POST   /admin/support/tickets/:id/close                           */
/*   GET/PUT /admin/support/categories                                 */
/* ------------------------------------------------------------------ */

interface AdminTicketRow {
  id: string;
  subject?: string | null;
  category?: string | null;
  state?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  tenantId?: string | null;
  tenantName?: string | null;
  tenantEmail?: string | null;
  messageCount?: number | null;
  lastMessageAt?: string | null;
}

interface TicketAttachment {
  id: string;
  fileName: string;
  size: number;
  mime: string;
  url: string;
}

interface TicketMessage {
  id: string;
  authorRole?: string | null;
  authorId?: string | null;
  body?: string | null;
  createdAt?: string | null;
  attachment?: TicketAttachment | null;
}

interface TicketCategory {
  key: string;
  labelFa: string;
}

const AUTHOR_ROLE_FA: Record<string, string> = {
  USER: 'کاربر',
  SUPPORT: 'پشتیبانی',
  SUPER_ADMIN: 'مدیر',
  SYSTEM: 'سیستم',
};

const STATE_FILTERS: Array<{ key: string; label: string }> = [
  { key: '', label: 'همه' },
  { key: 'OPEN', label: TICKET_STATE_FA.OPEN },
  { key: 'ANSWERED', label: TICKET_STATE_FA.ANSWERED },
  { key: 'CLOSED', label: TICKET_STATE_FA.CLOSED },
];

/** Attachments share the user-path rules: images/پی‌دی‌اف ≤10MB. */
const ATTACH_MIME_ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']);
const ATTACH_MAX_BYTES = 10 * 1024 * 1024;
const ATTACH_ACCEPT = '.jpg,.jpeg,.png,.webp,.gif,.pdf';

function PaperclipIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

/** Shared attachment picker chip (reply + new-ticket modals). */
function AttachChip({ file, onRemove }: { file: File; onRemove: () => void }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <span className="file-chip">
        <span aria-hidden="true">{file.type === 'application/pdf' ? '📄' : '🖼️'}</span>
        <span className="file-chip__name">{file.name}</span>
        <span className="file-chip__meta">{faFileSize(file.size)}</span>
        <button type="button" className="file-chip__remove" onClick={onRemove} aria-label={`حذف فایل ${file.name}`}>
          ✕
        </button>
      </span>
    </div>
  );
}

/** Inline attachment preview inside the message thread. */
function MessageAttachment({ att }: { att: TicketAttachment }) {
  if (att.mime === 'application/pdf') {
    return (
      <a className="adm-ticket-msg__attach" href={att.url} target="_blank" rel="noreferrer">
        پیوست: {strField(att.fileName) || 'فایل'} ({faFileSize(att.size)})
      </a>
    );
  }
  return (
    <a
      className="msg-attach"
      href={att.url}
      target="_blank"
      rel="noopener noreferrer"
      title="مشاهده پیوست (تب جدید)"
    >
      <img src={att.url} alt={strField(att.fileName) || 'پیوست'} loading="lazy" />
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontWeight: 700, maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {strField(att.fileName) || 'فایل'}
        </span>
        <span style={{ display: 'block', fontSize: 11, color: 'var(--text-2)' }}>
          {faFileSize(att.size)} — کلیک و مشاهده
        </span>
      </span>
    </a>
  );
}

export default function AdminTickets() {
  const toast = useToast();

  const [items, setItems] = useState<AdminTicketRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [state, setState] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<Record<string, string>>({});
  const [categoryList, setCategoryList] = useState<TicketCategory[]>([]);

  // per-state totals for the chips (cheap: pageSize=1, no search)
  const [counts, setCounts] = useState<Record<string, number>>({ OPEN: 0, ANSWERED: 0, CLOSED: 0 });

  // conversation modal
  const [openId, setOpenId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailTicket, setDetailTicket] = useState<AdminTicketRow | null>(null);
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [reply, setReply] = useState('');
  const [replying, setReplying] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [closing, setClosing] = useState(false);

  // reply attachment (round 19)
  const [replyFile, setReplyFile] = useState<File | null>(null);
  const replyInputRef = useRef<HTMLInputElement | null>(null);
  const newFileInputRef = useRef<HTMLInputElement | null>(null);

  // staff-initiated ticket modal (round 19)
  const [newOpen, setNewOpen] = useState(false);
  const [newTenant, setNewTenant] = useState<AdminUserRow | null>(null);
  const [newSubject, setNewSubject] = useState('');
  const [newCategory, setNewCategory] = useState('GENERAL');
  const [newBody, setNewBody] = useState('');
  const [newFile, setNewFile] = useState<File | null>(null);
  const [creating, setCreating] = useState(false);
  const [userQuery, setUserQuery] = useState('');
  const [userResults, setUserResults] = useState<AdminUserRow[]>([]);
  const [userSearching, setUserSearching] = useState(false);
  const userSeq = useRef(0);

  // category manager modal (round 19)
  const [catOpen, setCatOpen] = useState(false);
  const [catDraft, setCatDraft] = useState<TicketCategory[]>([]);
  const [catNewLabel, setCatNewLabel] = useState('');
  const [catSaving, setCatSaving] = useState(false);

  const applyCategories = useCallback((list: TicketCategory[]) => {
    setCategoryList(list);
    setCategories((prev) => {
      const map: Record<string, string> = { ...prev };
      for (const c of list) map[c.key] = c.labelFa;
      return map;
    });
  }, []);

  const loadList = useCallback(
    async (p: number, st: string, term: string) => {
      setLoading(true);
      try {
        const q = new URLSearchParams();
        q.set('page', String(p));
        q.set('pageSize', String(PAGE_SIZE));
        if (st) q.set('state', st);
        if (term) q.set('search', term);
        const d = await api.get<{
          items?: AdminTicketRow[];
          total?: number;
          page?: number;
          categories?: TicketCategory[];
        }>(`/api/v1/admin/support/tickets?${q.toString()}`);
        setItems(d.items ?? []);
        setTotal(Number(d.total ?? 0));
        setPage(Number(d.page ?? p));
        if (Array.isArray(d.categories) && d.categories.length > 0) {
          const map: Record<string, string> = {};
          for (const c of d.categories) map[c.key] = c.labelFa;
          setCategories(map);
          setCategoryList(d.categories);
        }
      } catch (err) {
        toast.error(errText(err, 'دریافت تیکت‌ها ناموفق بود.'));
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  /** Chip counts: one tiny request per state (pageSize=1, no search). */
  const loadCounts = useCallback(async () => {
    const states = ['OPEN', 'ANSWERED', 'CLOSED'];
    const results = await Promise.allSettled(
      states.map((s) =>
        api.get<{ total?: number }>(`/api/v1/admin/support/tickets?page=1&pageSize=1&state=${s}`)
      )
    );
    const next: Record<string, number> = {};
    states.forEach((s, i) => {
      next[s] = results[i].status === 'fulfilled' ? Number(results[i].value.total ?? 0) : 0;
    });
    setCounts(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // debounced search → reset to page 1
  useEffect(() => {
    const t = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 400);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    void loadList(page, state, search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, state, search]);

  useEffect(() => {
    void loadCounts();
    api
      .get<TicketCategory[]>('/api/v1/admin/support/categories')
      .then((list) => {
        if (Array.isArray(list) && list.length > 0) applyCategories(list);
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshAll = useCallback(
    async (p = page) => {
      await Promise.all([loadList(p, state, search), loadCounts()]);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [loadList, loadCounts, page, state, search]
  );

  const openTicket = async (id: string) => {
    setOpenId(id);
    setDetailLoading(true);
    setReply('');
    setReplyFile(null);
    try {
      const d = await api.get<{ ticket?: AdminTicketRow; messages?: TicketMessage[] }>(
        `/api/v1/admin/support/tickets/${id}`
      );
      setDetailTicket(d.ticket ?? null);
      setMessages(d.messages ?? []);
    } catch (err) {
      toast.error(errText(err, 'دریافت گفتگوی تیکت ناموفق بود.'));
      setOpenId(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const refreshTicket = useCallback(async (id: string) => {
    const d = await api.get<{ ticket?: AdminTicketRow; messages?: TicketMessage[] }>(
      `/api/v1/admin/support/tickets/${id}`
    );
    setDetailTicket(d.ticket ?? null);
    setMessages(d.messages ?? []);
  }, []);

  const pickFile = (file: File | null | undefined, setter: (f: File | null) => void): boolean => {
    if (!file) return false;
    if (!ATTACH_MIME_ALLOWED.has(file.type)) {
      toast.error('فرمت فایل مجاز نیست. تصویر (تصویر و سند مجاز (جی‌پی‌جی، پی‌ان‌جی، وب‌پی، گیف یا پی‌دی‌اف) انتخاب کنید.');
      return false;
    }
    if (file.size > ATTACH_MAX_BYTES) {
      toast.error('حجم فایل باید حداکثر ۱۰ مگابایت باشد.');
      return false;
    }
    setter(file);
    return true;
  };

  const sendReply = async () => {
    if (!openId || !reply.trim()) return;
    setReplying(true);
    try {
      // Multipart per round 19: "body" text + optional "file".
      const fd = new FormData();
      fd.append('body', reply.trim());
      if (replyFile) fd.append('file', replyFile);
      await api.postForm(`/api/v1/admin/support/tickets/${openId}/messages`, fd);
      setReply('');
      setReplyFile(null);
      toast.success('پاسخ ثبت و برای کاربر ارسال شد.');
      await refreshTicket(openId);
      void refreshAll();
    } catch (err) {
      toast.error(errText(err, 'ارسال پاسخ ناموفق بود.'));
    } finally {
      setReplying(false);
    }
  };

  const closeTicket = async () => {
    if (!openId) return;
    setClosing(true);
    try {
      await api.post(`/api/v1/admin/support/tickets/${openId}/close`);
      toast.success('تیکت بسته شد.');
      setCloseOpen(false);
      await refreshTicket(openId);
      void refreshAll();
    } catch (err) {
      toast.error(errText(err, 'بستن تیکت ناموفق بود.'));
    } finally {
      setClosing(false);
    }
  };

  // ----- staff-initiated ticket -----
  const openNewTicket = () => {
    setNewTenant(null);
    setNewSubject('');
    setNewCategory(categoryList[0]?.key ?? 'GENERAL');
    setNewBody('');
    setNewFile(null);
    setUserQuery('');
    setUserResults([]);
    setNewOpen(true);
  };

  // debounced user search for the picker
  useEffect(() => {
    const term = userQuery.trim();
    if (!newOpen || term.length < 2) {
      setUserResults([]);
      return;
    }
    const seq = ++userSeq.current;
    setUserSearching(true);
    const t = window.setTimeout(async () => {
      try {
        const d = await api.get<{ items?: AdminUserRow[] }>(
          `/api/v1/admin/users?search=${encodeURIComponent(term)}&page=1&pageSize=8`
        );
        if (userSeq.current === seq) setUserResults(d.items ?? []);
      } catch {
        if (userSeq.current === seq) setUserResults([]);
      } finally {
        if (userSeq.current === seq) setUserSearching(false);
      }
    }, 350);
    return () => window.clearTimeout(t);
  }, [userQuery, newOpen]);

  const createTicket = async () => {
    if (!newTenant) {
      toast.error('کاربر گیرندهٔ تیکت را انتخاب کنید.');
      return;
    }
    if (newSubject.trim().length < 3) {
      toast.error('موضوع تیکت را کامل وارد کنید.');
      return;
    }
    if (newBody.trim().length < 1) {
      toast.error('متن پیام را وارد کنید.');
      return;
    }
    setCreating(true);
    try {
      const fd = new FormData();
      fd.append('tenantId', newTenant.id);
      fd.append('subject', newSubject.trim());
      fd.append('category', newCategory);
      fd.append('body', newBody.trim());
      if (newFile) fd.append('file', newFile);
      await api.postForm<{ id: string }>('/api/v1/admin/support/tickets', fd);
      toast.success('تیکت برای کاربر ثبت شد و اعلان دریافت کرد.');
      setNewOpen(false);
      await refreshAll(1);
    } catch (err) {
      toast.error(errText(err, 'ثبت تیکت ناموفق بود.'));
    } finally {
      setCreating(false);
    }
  };

  // ----- category manager -----
  const openCategories = () => {
    setCatDraft(categoryList.map((c) => ({ ...c })));
    setCatNewLabel('');
    setCatOpen(true);
  };

  const saveCategories = async () => {
    if (catDraft.length === 0) {
      toast.error('حداقل یک دسته‌بندی لازم است.');
      return;
    }
    setCatSaving(true);
    try {
      const saved = await api.put<TicketCategory[]>('/api/v1/admin/support/categories', { categories: catDraft });
      applyCategories(saved);
      toast.success('دسته‌بندی‌ها ذخیره شد.');
      setCatOpen(false);
      await loadList(page, state, search);
    } catch (err) {
      toast.error(errText(err, 'ذخیرهٔ دسته‌بندی‌ها ناموفق بود.'));
    } finally {
      setCatSaving(false);
    }
  };

  const nextCategoryKey = (): string => {
    let i = catDraft.length + 1;
    let key = `CUSTOM_${i}`;
    while (catDraft.some((c) => c.key === key)) {
      i += 1;
      key = `CUSTOM_${i}`;
    }
    return key;
  };

  const ticketClosed = (detailTicket?.state ?? '') === 'CLOSED';

  return (
    <>
      <div className="adm-page-head adm-page-head--row">
        <div>
          <h2>تیکت‌های پشتیبانی</h2>
          <p>گفتگو با کاربران، پاسخ و بستن تیکت‌ها، ثبت تیکت از سمت پشتیبانی</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="soft" onClick={openCategories}>دسته‌بندی‌ها</Button>
          <Button onClick={openNewTicket}>+ تیکت جدید</Button>
        </div>
      </div>

      <Card>
        <div className="adm-filters">
          <div className="adm-filters__chips" role="group" aria-label="فیلتر وضعیت تیکت">
            {STATE_FILTERS.map((f) => {
              const count = f.key === '' ? counts.OPEN + counts.ANSWERED + counts.CLOSED : counts[f.key];
              return (
                <button
                  key={f.key || 'all'}
                  type="button"
                  className={`adm-chip${state === f.key ? ' is-active' : ''}`}
                  onClick={() => {
                    setState(f.key);
                    setPage(1);
                  }}
                >
                  {f.label}
                  {count > 0 && <span className="adm-chip__count">{faNumber(count)}</span>}
                </button>
              );
            })}
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="جستجو: موضوع یا نام/ایمیل کاربر…"
              aria-label="جستجوی تیکت"
            />
          </div>
        </div>

        {loading ? (
          <PageLoading />
        ) : items.length === 0 ? (
          <EmptyState
            icon="🎫"
            title="تیکتی پیدا نشد"
            description="با تغییر وضعیت یا عبارت جستجو دوباره بررسی کنید."
          />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table adm-table--cards">
                <thead>
                  <tr>
                    <th>موضوع</th>
                    <th>کاربر</th>
                    <th>دسته‌بندی</th>
                    <th>وضعیت</th>
                    <th>تعداد پیام</th>
                    <th>آخرین فعالیت</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((t) => (
                    <tr key={t.id}>
                      <td data-label="موضوع" style={{ fontWeight: 700 }}>
                        {strField(t.subject) || '—'}
                      </td>
                      <td data-label="کاربر">
                        <div style={{ fontSize: 12.5, fontWeight: 600 }}>{strField(t.tenantName) || '—'}</div>
                        {t.tenantEmail && (
                          <div dir="ltr" style={{ textAlign: 'right', fontSize: 11.5, color: 'var(--text-2)' }}>
                            {t.tenantEmail}
                          </div>
                        )}
                      </td>
                      <td data-label="دسته‌بندی">{(categories[t.category ?? ''] ?? strField(t.category)) || '—'}</td>
                      <td data-label="وضعیت">
                        <StatusBadge state={t.state ?? ''} labels={TICKET_STATE_FA} />
                      </td>
                      <td data-label="تعداد پیام">{faNumber(Number(t.messageCount ?? 0))}</td>
                      <td data-label="آخرین فعالیت">{faRelative(t.lastMessageAt ?? t.updatedAt)}</td>
                      <td>
                        <Button size="sm" variant="soft" onClick={() => void openTicket(t.id)}>
                          مشاهده و پاسخ
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={(p) => setPage(p)} />
          </>
        )}
      </Card>

      <Modal open={openId !== null} onClose={() => setOpenId(null)} title={strField(detailTicket?.subject) || 'گفتگوی تیکت'} large>
        {detailLoading ? (
          <PageLoading />
        ) : (
          <>
            {/* conversation header: user + state + close action */}
            <div className="adm-ticket-head">
              <div className="adm-ticket-head__who">
                <strong>{strField(detailTicket?.tenantName) || 'کاربر'}</strong>
                {detailTicket?.tenantEmail && (
                  <span dir="ltr" style={{ textAlign: 'right' }}>
                    {detailTicket.tenantEmail}
                  </span>
                )}
              </div>
              <div className="adm-ticket-head__side">
                <StatusBadge state={detailTicket?.state ?? ''} labels={TICKET_STATE_FA} />
                <Badge tone="muted">{(categories[detailTicket?.category ?? ''] ?? detailTicket?.category) || '—'}</Badge>
                {!ticketClosed && (
                  <Button size="sm" variant="ghost" onClick={() => setCloseOpen(true)}>
                    بستن تیکت
                  </Button>
                )}
              </div>
            </div>

            {ticketClosed && (
              <div className="adm-note adm-note--info" role="status" style={{ marginBottom: 12 }}>
                <span aria-hidden="true">ℹ️</span>
                <span>این تیکت بسته شده است.</span>
              </div>
            )}

            {/* messages thread (scrollable) */}
            <div className="adm-ticket-thread" aria-live="polite">
              {messages.length === 0 ? (
                <p className="adm-ticket-thread__empty">پیامی رد و بدل نشده است.</p>
              ) : (
                messages.map((m) => {
                  const staff = m.authorRole === 'SUPPORT' || m.authorRole === 'SUPER_ADMIN';
                  return (
                    <div key={m.id} className={`adm-ticket-msg${staff ? ' adm-ticket-msg--staff' : ''}`}>
                      <div className="adm-ticket-msg__meta">
                        <strong>{faLabel(m.authorRole, AUTHOR_ROLE_FA, 'نقش نامشخص')}</strong>
                        <span>{faDateTime(m.createdAt)}</span>
                      </div>
                      <div className="adm-ticket-msg__body">{strField(m.body)}</div>
                      {m.attachment && <MessageAttachment att={m.attachment} />}
                    </div>
                  );
                })
              )}
            </div>

            {/* reply form with optional attachment — hidden once the ticket is closed */}
            {!ticketClosed && (
              <div style={{ marginTop: 14 }}>
                <Field label="پاسخ مدیر" hint="پاسخ شما مستقیماً برای کاربر ارسال و تیکت به حالت «پاسخ داده‌شده» تغییر می‌کند.">
                  <ContentComposerTextarea
                    rows={4}
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    placeholder="متن پاسخ به کاربر…"
                    aria-label="متن پاسخ"
                  />
                </Field>

                {replyFile && <AttachChip file={replyFile} onRemove={() => setReplyFile(null)} />}

                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <Button onClick={() => void sendReply()} loading={replying} disabled={!reply.trim()}>
                    ارسال پاسخ
                  </Button>
                  <Button variant="ghost" onClick={() => replyInputRef.current?.click()}>
                    <PaperclipIcon /> پیوست فایل
                  </Button>
                </div>
                <input
                  ref={replyInputRef}
                  type="file"
                  accept={ATTACH_ACCEPT}
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    pickFile(e.target.files?.[0], setReplyFile);
                    e.target.value = '';
                  }}
                />
              </div>
            )}
          </>
        )}
      </Modal>

      {/* staff-initiated ticket modal */}
      <Modal open={newOpen} onClose={() => setNewOpen(false)} title="ثبت تیکت جدید برای کاربر" large>
        <Field label="کاربر گیرنده" required hint="نام یا ایمیل کاربر را جستجو و انتخاب کنید.">
          {newTenant ? (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 8,
                border: '1px solid var(--border)',
                borderRadius: 10,
                padding: '8px 12px',
              }}
            >
              <span style={{ fontSize: 13 }}>
                <strong>
                  {`${strField(newTenant.firstName)} ${strField(newTenant.lastName)}`.trim() || strField(newTenant.email)}
                </strong>
                <span dir="ltr" style={{ color: 'var(--text-2)', fontSize: 11.5, marginRight: 8 }}>
                  {strField(newTenant.email)}
                </span>
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setNewTenant(null)}
                aria-label="تغییر کاربر انتخاب‌شده"
              >
                تغییر
              </Button>
            </div>
          ) : (
            <>
              <Input
                value={userQuery}
                onChange={(e) => setUserQuery(e.target.value)}
                placeholder="جستجو: نام یا ایمیل کاربر…"
                aria-label="جستجوی کاربر"
              />
              {userSearching && <p style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 6 }}>در حال جستجو…</p>}
              {userResults.length > 0 && (
                <div style={{ border: '1px solid var(--border)', borderRadius: 10, maxHeight: 200, overflowY: 'auto', marginTop: 8 }}>
                  {userResults.map((u) => {
                    const name = `${strField(u.firstName)} ${strField(u.lastName)}`.trim() || strField(u.email) || u.id;
                    return (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => {
                          setNewTenant(u);
                          setUserQuery('');
                          setUserResults([]);
                        }}
                        style={{
                          display: 'flex',
                          width: '100%',
                          justifyContent: 'space-between',
                          gap: 8,
                          padding: '9px 12px',
                          background: 'transparent',
                          border: 'none',
                          borderBottom: '1px solid var(--border)',
                          cursor: 'pointer',
                          textAlign: 'right',
                          color: 'var(--text)',
                          fontSize: 13,
                        }}
                      >
                        <strong>{name}</strong>
                        <span dir="ltr" style={{ color: 'var(--text-2)', fontSize: 11.5 }}>{strField(u.email)}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </Field>

        <Field label="موضوع" required>
          <Input value={newSubject} onChange={(e) => setNewSubject(e.target.value)} placeholder="خلاصهٔ موضوع در یک جمله" />
        </Field>
        <Field label="دسته‌بندی" required>
          <Select value={newCategory} onChange={(e) => setNewCategory(e.target.value)} aria-label="انتخاب دسته‌بندی">
            {categoryList.map((c) => (
              <option key={c.key} value={c.key}>{c.labelFa}</option>
            ))}
          </Select>
        </Field>
        <Field label="متن پیام" required hint="این پیام به‌عنوان نخستین پیام تیکت برای کاربر ارسال می‌شود و اعلان دریافت می‌کند.">
          <ContentComposerTextarea rows={5} value={newBody} onChange={(e) => setNewBody(e.target.value)} placeholder="متن پیام پشتیبانی…" />
        </Field>

        {newFile && <AttachChip file={newFile} onRemove={() => setNewFile(null)} />}

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
          <Button onClick={() => void createTicket()} loading={creating} disabled={!newTenant}>
            ثبت و ارسال تیکت
          </Button>
          <Button variant="ghost" onClick={() => newFileInputRef.current?.click()}>
            <PaperclipIcon /> پیوست فایل
          </Button>
          <Button variant="ghost" onClick={() => setNewOpen(false)}>انصراف</Button>
        </div>
        <input
          ref={newFileInputRef}
          type="file"
          accept={ATTACH_ACCEPT}
          style={{ display: 'none' }}
          onChange={(e) => {
            pickFile(e.target.files?.[0], setNewFile);
            e.target.value = '';
          }}
        />
      </Modal>

      {/* category manager modal */}
      <Modal open={catOpen} onClose={() => setCatOpen(false)} title="مدیریت دسته‌بندی‌های تیکت" large>
        <p style={{ fontSize: 12.5, color: 'var(--text-2)', margin: '0 0 12px' }}>
          دسته‌بندی‌ها در فرم تیکت کاربران و فهرست مدیریت استفاده می‌شوند. حذف دسته‌بندیِ در حال استفاده، عنوان آن را در تیکت‌های موجود به کلید انگلیسی برمی‌گرداند.
        </p>
        <div style={{ display: 'grid', gap: 8, marginBottom: 14 }}>
          {catDraft.map((c, idx) => (
            <div key={c.key} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Input
                value={c.labelFa}
                onChange={(e) => {
                  const draft = [...catDraft];
                  draft[idx] = { ...draft[idx], labelFa: e.target.value };
                  setCatDraft(draft);
                }}
                aria-label={`عنوان دسته‌بندی ${c.key}`}
                style={{ flex: 1, minWidth: 160 }}
              />
              <code dir="ltr" style={{ fontSize: 11, color: 'var(--text-2)', minWidth: 90, textAlign: 'left' }}>{c.key}</code>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setCatDraft(catDraft.filter((_, i) => i !== idx))}
                disabled={catDraft.length <= 1}
                aria-label={`حذف دسته‌بندی ${c.labelFa}`}
              >
                حذف
              </Button>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
          <Input
            value={catNewLabel}
            onChange={(e) => setCatNewLabel(e.target.value)}
            placeholder="عنوان دسته‌بندی جدید…"
            aria-label="عنوان دسته‌بندی جدید"
            style={{ flex: 1, minWidth: 160 }}
          />
          <Button
            variant="soft"
            onClick={() => {
              const label = catNewLabel.trim();
              if (label.length < 2) {
                toast.error('عنوان دسته‌بندی حداقل ۲ نویسه باشد.');
                return;
              }
              if (catDraft.length >= 20) {
                toast.error('حداکثر ۲۰ دسته‌بندی مجاز است.');
                return;
              }
              setCatDraft([...catDraft, { key: nextCategoryKey(), labelFa: label }]);
              setCatNewLabel('');
            }}
          >
            + افزودن
          </Button>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <Button onClick={() => void saveCategories()} loading={catSaving}>ذخیرهٔ دسته‌بندی‌ها</Button>
          <Button variant="ghost" onClick={() => setCatOpen(false)}>انصراف</Button>
        </div>
      </Modal>

      <ConfirmDialog
        open={closeOpen}
        onClose={() => setCloseOpen(false)}
        onConfirm={() => void closeTicket()}
        title="بستن تیکت"
        message="با بستن تیکت، گفتگو پایان می‌یابد و کاربر دیگر نمی‌تواند پیام جدیدی ارسال کند. ادامه می‌دهید؟"
        danger
        busy={closing}
      />
    </>
  );
}
