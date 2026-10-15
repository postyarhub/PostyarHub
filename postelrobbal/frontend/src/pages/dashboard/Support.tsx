import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiRequestError } from '../../lib/api';
import { Button, Card, ConfirmDialog, EmptyState, Field, Input, Modal, PageLoading, Pagination, Select, StatusBadge } from '../../components/ui';
import { faDateTime, faFileSize, faLabel, faRelative, TICKET_STATE_FA } from '../../lib/format';
import { ContentComposerTextarea } from '../../components/ContentComposerTextarea';
import { useToast } from '../../lib/toast';

const CATEGORY_FA: Record<string, string> = {
  GENERAL: 'عمومی',
  BILLING: 'مالی',
  TECHNICAL: 'فنی',
  FEATURE: 'درخواست امکان',
  BOT: 'ربات و پاسخگوی خودکار',
};

const AUTHOR_ROLE_FA: Record<string, string> = {
  USER: 'شما',
  SUPPORT: 'پشتیبانی',
  SUPER_ADMIN: 'مدیر',
  SYSTEM: 'سیستم',
};

interface TicketRow {
  id: string;
  subject?: string | null;
  category?: string | null;
  state?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
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

/** Contract 14-contract item 7: multipart "file" — images/پی‌دی‌اف ≤10MB. */
const ATTACH_MIME_ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const ATTACH_MAX_BYTES = 10 * 1024 * 1024;
const ATTACH_ACCEPT = '.jpg,.jpeg,.png,.webp,.pdf';

function PaperclipIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

export default function Support() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<TicketRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  const [categories, setCategories] = useState<Array<{ key: string; labelFa: string }>>(Object.entries(CATEGORY_FA).map(([key, labelFa]) => ({ key, labelFa })));

  const [newOpen, setNewOpen] = useState(false);
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState('GENERAL');
  const [body, setBody] = useState('');
  const [creating, setCreating] = useState(false);

  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailTicket, setDetailTicket] = useState<TicketRow | null>(null);
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [reply, setReply] = useState('');
  const [replying, setReplying] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Attachment upload (contract 14-contract item 7 + round 19: also on create)
  const [attachFile, setAttachFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const attachInputRef = useRef<HTMLInputElement | null>(null);
  const newAttachInputRef = useRef<HTMLInputElement | null>(null);
  const [newAttachFile, setNewAttachFile] = useState<File | null>(null);

  const pickAttach = useCallback(
    (file: File | null | undefined, target: 'reply' | 'new' = 'reply') => {
      const setFile = target === 'new' ? setNewAttachFile : setAttachFile;
      if (!file) return;
      if (!ATTACH_MIME_ALLOWED.has(file.type)) {
        toast.error('فرمت فایل مجاز نیست. تصویر (تصویر و سند مجاز (جی‌پی‌جی، پی‌ان‌جی، وب‌پی یا پی‌دی‌اف) انتخاب کنید.');
        return;
      }
      if (file.size > ATTACH_MAX_BYTES) {
        toast.error('حجم فایل باید حداکثر ۱۰ مگابایت باشد.');
        return;
      }
      setFile(file);
    },
    [toast]
  );

  const load = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const d = await api.get<{ items?: TicketRow[]; total?: number; page?: number; categories?: Array<{ key: string; labelFa: string }> }>(`/api/v1/support/tickets?page=${p}`);
      setItems(d.items ?? []);
      setTotal(Number(d.total ?? 0));
      setPage(Number(d.page ?? p));
      if (Array.isArray(d.categories) && d.categories.length > 0) setCategories(d.categories);
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'دریافت تیکت‌ها ناموفق بود.');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load(1);
  }, [load]);

  const openDetail = async (id: string) => {
    setDetailId(id);
    setDetailLoading(true);
    setReply('');
    setAttachFile(null);
    setDragOver(false);
    try {
      const d = await api.get<{ ticket?: TicketRow; messages?: TicketMessage[] }>(`/api/v1/support/tickets/${id}`);
      setDetailTicket(d.ticket ?? null);
      setMessages(d.messages ?? []);
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'دریافت جزئیات تیکت ناموفق بود.');
      setDetailId(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const refreshDetail = useCallback(async (id: string) => {
    const d = await api.get<{ ticket?: TicketRow; messages?: TicketMessage[] }>(`/api/v1/support/tickets/${id}`);
    setDetailTicket(d.ticket ?? null);
    setMessages(d.messages ?? []);
  }, []);

  const createTicket = async () => {
    if (subject.trim().length < 3) {
      toast.error('موضوع تیکت را کامل وارد کنید.');
      return;
    }
    if (body.trim().length < 5) {
      toast.error('متن تیکت را کامل وارد کنید.');
      return;
    }
    setCreating(true);
    try {
      // Round 19: multipart so the ticket can open with an attachment.
      const fd = new FormData();
      fd.append('subject', subject.trim());
      fd.append('category', category);
      fd.append('body', body.trim());
      if (newAttachFile) fd.append('file', newAttachFile);
      await api.postForm('/api/v1/support/tickets', fd);
      toast.success('تیکت شما ثبت شد؛ به‌زودی پاسخ می‌دهیم.');
      setNewOpen(false);
      setSubject('');
      setBody('');
      setCategory('GENERAL');
      setNewAttachFile(null);
      await load(1);
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'ثبت تیکت ناموفق بود.');
    } finally {
      setCreating(false);
    }
  };

  const sendReply = async () => {
    if (!detailId || !reply.trim()) return;
    setReplying(true);
    try {
      // Multipart per contract item 7: "body" text + optional "file".
      const fd = new FormData();
      fd.append('body', reply.trim());
      if (attachFile) fd.append('file', attachFile);
      await api.postForm(`/api/v1/support/tickets/${detailId}/messages`, fd);
      setReply('');
      setAttachFile(null);
      await refreshDetail(detailId);
      toast.success('پاسخ شما ثبت شد.');
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'ارسال پاسخ ناموفق بود.');
    } finally {
      setReplying(false);
    }
  };

  const closeTicket = async () => {
    if (!detailId) return;
    setBusy(true);
    try {
      await api.post(`/api/v1/support/tickets/${detailId}/close`);
      toast.success('تیکت بسته شد.');
      setCloseOpen(false);
      await Promise.all([refreshDetail(detailId), load(page)]);
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'بستن تیکت ناموفق بود.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: 21, fontWeight: 800 }}>پشتیبانی و تیکت‌ها</h1>
          <p style={{ color: 'var(--text-2)', fontSize: 13.5 }}>سؤال یا مشکل خود را ثبت کنید؛ تیم پشتیبانی پاسخ می‌دهد.</p>
        </div>
        <Button onClick={() => { setNewAttachFile(null); setNewOpen(true); }}>+ تیکت جدید</Button>
      </div>

      {loading ? (
        <PageLoading />
      ) : items.length === 0 ? (
        <EmptyState
          icon="🎫"
          title="تیکتی ثبت نکرده‌اید"
          description="هر سؤال یا مشکلی دربارهٔ حساب، پرداخت یا ارسال پیام دارید، از اینجا بپرسید."
          action={<Button onClick={() => { setNewAttachFile(null); setNewOpen(true); }}>ثبت اولین تیکت</Button>}
        />
      ) : (
        <Card>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>موضوع</th>
                  <th>دسته</th>
                  <th>وضعیت</th>
                  <th>آخرین به‌روزرسانی</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((t) => (
                  <tr key={t.id}>
                    <td style={{ fontWeight: 700 }}>{t.subject || '—'}</td>
                    <td>{faLabel(t.category, CATEGORY_FA, 'دسته‌بندی نامشخص')}</td>
                    <td><StatusBadge state={t.state ?? ''} labels={TICKET_STATE_FA} /></td>
                    <td>{faRelative(t.updatedAt)}</td>
                    <td><Button size="sm" variant="soft" onClick={() => void openDetail(t.id)}>مشاهده گفتگو</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={20} total={total} onPage={(p) => void load(p)} />
        </Card>
      )}

      <Modal open={newOpen} onClose={() => setNewOpen(false)} title="ثبت تیکت جدید" large>
        <Field label="موضوع" required>
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="خلاصهٔ موضوع در یک جمله" />
        </Field>
        <Field label="دسته" required>
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            {categories.map((c) => (
              <option key={c.key} value={c.key}>{c.labelFa}</option>
            ))}
          </Select>
        </Field>
        <Field label="متن تیکت" required hint="توضیح کامل بدهید تا سریع‌تر پاسخ بگیرید؛ در صورت خطای ارسال، متن خطا را هم بنویسید.">
          <ContentComposerTextarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>

        <Field label="پیوست (اختیاری)" hint="جی‌پی‌جی، پی‌ان‌جی، وب‌پی یا پی‌دی‌اف · حداکثر ۱۰ مگابایت">
          <div
            className={`attach-zone${dragOver ? ' is-dragover' : ''}`}
            role="button"
            tabIndex={0}
            aria-label="افزودن پیوست به تیکت: فایل را بکشید و رها کنید یا کلیک کنید"
            onClick={() => newAttachInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                newAttachInputRef.current?.click();
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              pickAttach(e.dataTransfer.files?.[0], 'new');
            }}
          >
            <span className="attach-zone__icon" aria-hidden="true">
              <PaperclipIcon />
            </span>
            <span>
              <span className="attach-zone__title">فایل را بکشید و اینجا رها کنید یا کلیک کنید</span>
              <span className="attach-zone__hint">تصویر یا پی‌دی‌اف پیوست تیکت</span>
            </span>
          </div>
          <input
            ref={newAttachInputRef}
            type="file"
            accept={ATTACH_ACCEPT}
            style={{ display: 'none' }}
            onChange={(e) => {
              pickAttach(e.target.files?.[0], 'new');
              e.target.value = '';
            }}
          />
        </Field>

        {newAttachFile && (
          <div style={{ marginBottom: 12 }}>
            <span className="file-chip">
              <span aria-hidden="true">{newAttachFile.type === 'application/pdf' ? '📄' : '🖼️'}</span>
              <span className="file-chip__name">{newAttachFile.name}</span>
              <span className="file-chip__meta">{faFileSize(newAttachFile.size)}</span>
              <button
                type="button"
                className="file-chip__remove"
                onClick={() => setNewAttachFile(null)}
                aria-label={`حذف پیوست ${newAttachFile.name}`}
              >
                ✕
              </button>
            </span>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10 }}>
          <Button onClick={() => void createTicket()} loading={creating}>ثبت تیکت</Button>
          <Button variant="ghost" onClick={() => setNewOpen(false)}>انصراف</Button>
        </div>
      </Modal>

      <Modal open={Boolean(detailId)} onClose={() => setDetailId(null)} title={detailTicket?.subject ?? 'گفتگوی تیکت'} large>
        {detailLoading ? (
          <PageLoading />
        ) : (
          <>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
              <StatusBadge state={detailTicket?.state ?? ''} labels={TICKET_STATE_FA} />
              <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>{faLabel(detailTicket?.category, CATEGORY_FA, 'دسته‌بندی نامشخص')}</span>
              <div style={{ flex: 1 }} />
              {(detailTicket?.state ?? '') !== 'CLOSED' && (
                <Button size="sm" variant="ghost" onClick={() => setCloseOpen(true)}>بستن تیکت</Button>
              )}
            </div>

            <div style={{ display: 'grid', gap: 10, maxHeight: 380, overflowY: 'auto', marginBottom: 14 }}>
              {messages.length === 0 ? (
                <p style={{ color: 'var(--text-2)', fontSize: 13, textAlign: 'center' }}>پیامی رد و بدل نشده است.</p>
              ) : (
                messages.map((m) => {
                  const isUser = m.authorRole === 'USER';
                  return (
                    <div
                      key={m.id}
                      style={{
                        alignSelf: isUser ? 'flex-start' : 'flex-end',
                        maxWidth: '85%',
                        background: isUser ? 'var(--brand-soft)' : 'var(--surface-2)',
                        borderRadius: 12,
                        padding: '10px 14px',
                        border: `1px solid ${isUser ? 'var(--brand)' : 'var(--border)'}`,
                      }}
                    >
                      <div style={{ display: 'flex', gap: 8, fontSize: 11.5, color: 'var(--text-2)', marginBottom: 4, flexWrap: 'wrap' }}>
                        <strong>{faLabel(m.authorRole, AUTHOR_ROLE_FA, 'نقش نامشخص')}</strong>
                        <span>{faDateTime(m.createdAt)}</span>
                      </div>
                      <div style={{ fontSize: 13.5, whiteSpace: 'pre-wrap' }}>{m.body}</div>
                      {m.attachment && (
                        <a
                          className="msg-attach"
                          href={m.attachment.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="مشاهده پیوست (تب جدید)"
                        >
                          {m.attachment.mime === 'application/pdf' ? (
                            <span className="msg-attach__pdficon" aria-hidden="true">پی‌دی‌اف</span>
                          ) : (
                            <img src={m.attachment.url} alt={m.attachment.fileName} loading="lazy" />
                          )}
                          <span style={{ minWidth: 0 }}>
                            <span
                              style={{
                                display: 'block',
                                fontWeight: 700,
                                maxWidth: 170,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {m.attachment.fileName}
                            </span>
                            <span style={{ display: 'block', fontSize: 11, color: 'var(--text-2)' }}>
                              {faFileSize(m.attachment.size)} — کلیک و مشاهده
                            </span>
                          </span>
                        </a>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {(detailTicket?.state ?? '') !== 'CLOSED' && (
              <>
                <Field label="پاسخ شما">
                  <div
                    className={`attach-zone${dragOver ? ' is-dragover' : ''}`}
                    role="button"
                    tabIndex={0}
                    aria-label="افزودن پیوست: فایل را بکشید و رها کنید یا کلیک کنید"
                    onClick={() => attachInputRef.current?.click()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        attachInputRef.current?.click();
                      }
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOver(true);
                    }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragOver(false);
                      pickAttach(e.dataTransfer.files?.[0]);
                    }}
                  >
                    <span className="attach-zone__icon" aria-hidden="true">
                      <PaperclipIcon />
                    </span>
                    <span>
                      <span className="attach-zone__title">فایل را بکشید و اینجا رها کنید یا کلیک کنید</span>
                      <span className="attach-zone__hint">جی‌پی‌جی، پی‌ان‌جی، وب‌پی یا پی‌دی‌اف · حداکثر ۱۰ مگابایت</span>
                    </span>
                  </div>
                  <div style={{ height: 10 }} aria-hidden="true" />
                  <ContentComposerTextarea rows={3} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="پاسخ یا توضیح تکمیلی…" />
                </Field>

                {attachFile && (
                  <div style={{ marginBottom: 12 }}>
                    <span className="file-chip">
                      <span aria-hidden="true">{attachFile.type === 'application/pdf' ? '📄' : '🖼️'}</span>
                      <span className="file-chip__name">{attachFile.name}</span>
                      <span className="file-chip__meta">{faFileSize(attachFile.size)}</span>
                      <button
                        type="button"
                        className="file-chip__remove"
                        onClick={() => setAttachFile(null)}
                        aria-label={`حذف پیوست ${attachFile.name}`}
                      >
                        ✕
                      </button>
                    </span>
                  </div>
                )}

                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <Button onClick={() => void sendReply()} loading={replying} disabled={!reply.trim()}>
                    ارسال پاسخ
                  </Button>
                  <Button variant="ghost" onClick={() => attachInputRef.current?.click()}>
                    <PaperclipIcon /> پیوست فایل
                  </Button>
                </div>
                <input
                  ref={attachInputRef}
                  type="file"
                  accept={ATTACH_ACCEPT}
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    pickAttach(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </>
            )}
          </>
        )}
      </Modal>

      <ConfirmDialog
        open={closeOpen}
        onClose={() => setCloseOpen(false)}
        onConfirm={() => void closeTicket()}
        title="بستن تیکت"
        message="با بستن تیکت، گفتگو پایان می‌یابد و امکان ارسال پیام جدید وجود نخواهد داشت. ادامه می‌دهید؟"
        danger
        busy={busy}
      />
    </div>
  );
}
