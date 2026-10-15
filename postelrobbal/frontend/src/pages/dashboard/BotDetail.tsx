import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiRequestError, type BotDto, type BotButtonDto, type BotConversationDto, type BotMessageDto, type BotStatsDto, type BotUserDto } from '../../lib/api';
import { Button, Card, EmptyState, Field, Input, Modal, PageLoading, Pagination, Select, StatCard, StatusBadge } from '../../components/ui';
import { faCompact, faLabel, PLATFORM_FA, faRelative } from '../../lib/format';
import { ContentComposerTextarea } from '../../components/ContentComposerTextarea';
import { useToast } from '../../lib/toast';

const BOT_STATUS_FA: Record<string, string> = {
  PENDING_VERIFY: 'در انتظار تأیید',
  ACTIVE: 'فعال',
  DISABLED: 'غیرفعال',
  ERROR: 'خطا',
};

const BOT_MODE_FA: Record<string, string> = { WEBHOOK: 'وبهوک', POLLING: 'بررسی دوره‌ای' };

const RESPONSE_KIND_FA: Record<string, string> = {
  TEXT: 'متن',
  BUTTONS: 'دکمه',
  AI: 'هوش مصنوعی',
  WORKFLOW: 'گردش‌کار',
};

const MATCH_KIND_FA: Record<string, string> = { EXACT: 'دقیق', CONTAINS: 'شامل' };

const CAPABILITY_FA: Record<string, string> = {
  sendText: 'ارسال پیام متنی',
  sendMedia: 'ارسال عکس و ویدیو',
  editMessage: 'ویرایش پیام',
  deleteMessage: 'حذف پیام',
  inlineButtons: 'دکمهٔ شیشه‌ای (اینلاین)',
  replyKeyboard: 'کیبورد پاسخ سریع',
  webhook: 'وبهوک',
  polling: 'بررسی دوره‌ای پیام‌ها',
  botIdentity: 'دریافت هویت ربات',
  htmlParseMode: 'قالب‌بندی پیشرفتهٔ متن',
};

const AI_PROMPT_HINT = 'رفتار دستیار را توصیف کنید؛ مثلاً: «تو مشاور فروش فروشگاه هستی؛ کوتاه، مؤدب و به فارسی پاسخ بده و از اطلاعات محصول کمک بگیر.»';

interface CommandRow {
  id: string;
  command: string;
  descriptionFa?: string | null;
  responseKind?: string | null;
  responsePayload?: unknown;
  isEnabled?: number | boolean | null;
}

interface KeywordRow {
  id: string;
  keyword: string;
  matchKind?: string | null;
  responseKind?: string | null;
  responsePayload?: unknown;
  isEnabled?: number | boolean | null;
}

type BotUserRow = BotUserDto;

interface PayloadDraft {
  text: string;
  systemPrompt: string;
  buttons: Array<{ label: string; type: 'URL' | 'CALLBACK'; value: string }>;
}

type TabKey = 'commands' | 'keywords' | 'users' | 'conversations' | 'stats' | 'ai';

function payloadText(payload: unknown): string {
  if (payload && typeof payload === 'object') {
    const t = (payload as { text?: unknown }).text;
    if (typeof t === 'string') return t;
  }
  return '';
}

function buildPayload(kind: string, draft: PayloadDraft): Record<string, unknown> | undefined {
  if (kind === 'TEXT') {
    if (!draft.text.trim()) return undefined;
    return { text: draft.text.trim() };
  }
  if (kind === 'BUTTONS') {
    const buttons: BotButtonDto[] = draft.buttons
      .filter((b) => b.label.trim() && b.value.trim())
      .map((b) => b.type === 'CALLBACK'
        ? { label: b.label.trim(), callback: b.value.trim() }
        : { label: b.label.trim(), url: b.value.trim() });
    if (!draft.text.trim() && buttons.length === 0) return undefined;
    return { ...(draft.text.trim() ? { text: draft.text.trim() } : {}), ...(buttons.length ? { buttons } : {}) };
  }
  if (kind === 'AI') {
    return draft.systemPrompt.trim() ? { systemPrompt: draft.systemPrompt.trim() } : undefined;
  }
  return undefined;
}

function ResponsePayloadEditor({ kind, draft, setDraft }: { kind: string; draft: PayloadDraft; setDraft: (d: PayloadDraft) => void }) {
  if (kind === 'TEXT' || kind === 'BUTTONS') {
    return (
      <>
        <Field label={kind === 'BUTTONS' ? 'متن همراه دکمه‌ها' : 'متن پاسخ'} required={kind === 'TEXT'}>
          <ContentComposerTextarea value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} placeholder="متن پاسخ ربات…" />
        </Field>
        {kind === 'BUTTONS' && (
          <Field label="دکمه‌ها" hint="هر دکمه یا لینک مستقیم دارد یا Callback داخلی؛ حداکثر ۸ دکمه.">
            <div style={{ display: 'grid', gap: 8 }}>
              {draft.buttons.map((b, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 1fr) 150px minmax(160px, 1.4fr) auto', gap: 8 }}>
                  <Input value={b.label} onChange={(e) => setDraft({ ...draft, buttons: draft.buttons.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} placeholder="عنوان دکمه" />
                  <Select value={b.type} onChange={(e) => setDraft({ ...draft, buttons: draft.buttons.map((x, j) => (j === i ? { ...x, type: e.target.value as 'URL' | 'CALLBACK' } : x)) })}>
                    <option value="URL">لینک</option>
                    <option value="CALLBACK">Callback</option>
                  </Select>
                  <Input dir="ltr" value={b.value} onChange={(e) => setDraft({ ...draft, buttons: draft.buttons.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} placeholder={b.type === 'CALLBACK' ? 'menu:products' : 'https://…'} />
                  <Button variant="ghost" size="sm" onClick={() => setDraft({ ...draft, buttons: draft.buttons.filter((_, j) => j !== i) })} aria-label="حذف دکمه">✕</Button>
                </div>
              ))}
              {draft.buttons.length < 8 && (
                <Button variant="soft" size="sm" onClick={() => setDraft({ ...draft, buttons: [...draft.buttons, { label: '', type: 'URL', value: '' }] })}>+ افزودن دکمه</Button>
              )}
            </div>
          </Field>
        )}
      </>
    );
  }
  if (kind === 'AI') {
    return (
      <>
        <Field label="راهنمای دستیار (اختیاری)" hint="اگر خالی بماند، راهنمای تنظیم‌شده در بخش «تنظیمات هوش مصنوعی» ربات استفاده می‌شود.">
          <ContentComposerTextarea value={draft.systemPrompt} onChange={(e) => setDraft({ ...draft, systemPrompt: e.target.value })} placeholder={AI_PROMPT_HINT} />
        </Field>
      </>
    );
  }
  return (
    <Field label="گردش‌کار">
      <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: 'var(--text-2)' }}>
        پاسخ این دستور توسط گردش‌کارهای بخش «گردش‌کارها» ساخته می‌شود؛ برای اتصال، از صفحهٔ گردش‌کارها یک گردش‌کار با محرک «دریافت پیام» تعریف کنید.
      </div>
    </Field>
  );
}

export default function BotDetail() {
  const params = useParams<{ id: string }>();
  const botId = params.id ?? '';
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [bot, setBot] = useState<BotDto | null>(null);
  const [tab, setTab] = useState<TabKey>('commands');
  const [capabilities, setCapabilities] = useState<Record<string, boolean> | null>(null);

  const [commands, setCommands] = useState<CommandRow[]>([]);
  const [keywords, setKeywords] = useState<KeywordRow[]>([]);
  const [users, setUsers] = useState<BotUserRow[]>([]);
  const [conversations, setConversations] = useState<BotConversationDto[]>([]);
  const [conversationsTotal, setConversationsTotal] = useState(0);
  const [conversationsPage, setConversationsPage] = useState(1);
  const [conversationUserFilter, setConversationUserFilter] = useState<string>('');
  const [selectedConversation, setSelectedConversation] = useState<BotConversationDto | null>(null);
  const [conversationMessages, setConversationMessages] = useState<BotMessageDto[]>([]);
  const [conversationMessagesTotal, setConversationMessagesTotal] = useState(0);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [usersTotal, setUsersTotal] = useState(0);
  const [usersPage, setUsersPage] = useState(1);
  const [usersExporting, setUsersExporting] = useState(false);
  const [stats, setStats] = useState<BotStatsDto | null>(null);
  const [modeSaving, setModeSaving] = useState(false);

  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiSaving, setAiSaving] = useState(false);

  // add-command modal
  const [cmdOpen, setCmdOpen] = useState(false);
  const [cmdName, setCmdName] = useState('');
  const [cmdDesc, setCmdDesc] = useState('');
  const [cmdKind, setCmdKind] = useState('TEXT');
  const [cmdDraft, setCmdDraft] = useState<PayloadDraft>({ text: '', systemPrompt: '', buttons: [{ label: '', type: 'URL', value: '' }] });
  const [cmdSaving, setCmdSaving] = useState(false);

  // add-keyword modal
  const [kwOpen, setKwOpen] = useState(false);
  const [kwText, setKwText] = useState('');
  const [kwMatch, setKwMatch] = useState('CONTAINS');
  const [kwKind, setKwKind] = useState('TEXT');
  const [kwDraft, setKwDraft] = useState<PayloadDraft>({ text: '', systemPrompt: '', buttons: [{ label: '', type: 'URL', value: '' }] });
  const [kwSaving, setKwSaving] = useState(false);

  const [busyId, setBusyId] = useState<string | null>(null);

  const loadBots = useCallback(async () => {
    const d = await api.get<{ items?: BotDto[]; bots?: BotDto[] }>('/api/v1/bots');
    const list = d.items ?? d.bots ?? [];
    const found = list.find((b) => b.id === botId) ?? null;
    setBot(found);
    if (found) {
      setAiEnabled(Boolean(found.aiEnabled));
      const detail = found as BotDto & { aiSystemPrompt?: string | null };
      setAiPrompt(typeof detail.aiSystemPrompt === 'string' ? detail.aiSystemPrompt : '');
    }
    return found;
  }, [botId]);

  const loadCommands = useCallback(async () => {
    const d = await api.get<{ items?: CommandRow[] }>(`/api/v1/bots/${botId}/commands`);
    setCommands(d.items ?? []);
  }, [botId]);

  const loadKeywords = useCallback(async () => {
    const d = await api.get<{ items?: KeywordRow[] }>(`/api/v1/bots/${botId}/keywords`);
    setKeywords(d.items ?? []);
  }, [botId]);

  const loadUsers = useCallback(async (page: number) => {
    const d = await api.get<{ items?: BotUserRow[]; total?: number }>(`/api/v1/bots/${botId}/users?page=${page}`);
    setUsers(d.items ?? []);
    setUsersTotal(Number(d.total ?? 0));
    setUsersPage(page);
  }, [botId]);

  const exportBotUsers = useCallback(async () => {
    setUsersExporting(true);
    try {
      const response = await fetch(`/api/v1/bots/${encodeURIComponent(botId)}/users/export`, {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'text/csv' },
      });
      if (!response.ok) {
        let message = 'دریافت خروجی کاربران ربات ناموفق بود.';
        try {
          const body = await response.json() as { error?: { message?: string }; message?: string };
          message = body.error?.message ?? body.message ?? message;
        } catch { /* Non-JSON errors use the generic localized message. */ }
        throw new Error(message);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `postyar-bot-users-${botId}.csv`;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success('فایل کاربران ربات آماده شد.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'دریافت خروجی کاربران ربات ناموفق بود.');
    } finally {
      setUsersExporting(false);
    }
  }, [botId, toast]);

  const loadStats = useCallback(async () => {
    try {
      const d = await api.get<BotStatsDto>(`/api/v1/bots/${botId}/stats`);
      setStats(d);
    } catch {
      // Polling/refresh failures must not create unhandled rejections or clear the current view.
    }
  }, [botId]);

  const loadConversations = useCallback(async (page: number, platformUserId?: string) => {
    try {
      const qs = new URLSearchParams({ page: String(page), pageSize: '20' });
      const filter = platformUserId ?? conversationUserFilter;
      if (filter) qs.set('platformUserId', filter);
      const d = await api.get<{ items?: BotConversationDto[]; total?: number; page?: number }>(`/api/v1/bots/${botId}/conversations?${qs.toString()}`);
      setConversations(d.items ?? []);
      setConversationsTotal(Number(d.total ?? 0));
      setConversationsPage(Number(d.page ?? page));
    } catch {
      // Preserve the last visible conversation list on transient refresh failures.
    }
  }, [botId, conversationUserFilter]);

  const loadConversationMessages = useCallback(async (conversationId: string) => {
    setConversationLoading(true);
    try {
      const d = await api.get<{ items?: BotMessageDto[]; total?: number }>(`/api/v1/bots/${botId}/conversations/${conversationId}/messages?page=1&pageSize=100`);
      setConversationMessages((d.items ?? []).slice().reverse());
      setConversationMessagesTotal(Number(d.total ?? 0));
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'بارگذاری پیام‌های گفتگو ناموفق بود.');
    } finally {
      setConversationLoading(false);
    }
  }, [botId, toast]);

  useEffect(() => {
    if (!botId) {
      setLoading(false);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const found = await loadBots();
        if (!alive) return;
        if (found) {
          await Promise.all([
            loadCommands().catch(() => undefined),
            loadKeywords().catch(() => undefined),
            loadUsers(1).catch(() => undefined),
            loadStats().catch(() => undefined),
            loadConversations(1).catch(() => undefined),
            api
              .get<{ capabilities?: Record<string, boolean> }>(`/api/v1/bots/${botId}/capabilities`)
              .then((d) => {
                if (alive) setCapabilities(d.capabilities ?? null);
              })
              .catch(() => undefined),
          ]);
        }
      } catch {
        // bot stays null → not-found state
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [botId, loadBots, loadCommands, loadUsers, loadKeywords, loadStats, loadConversations]);

  useEffect(() => {
    if (!botId || !bot) return;
    if (tab !== 'stats' && tab !== 'conversations') return;
    const timer = window.setInterval(() => {
      if (tab === 'stats') void loadStats();
      else {
        void loadConversations(conversationsPage, conversationUserFilter || undefined);
        if (selectedConversation) void loadConversationMessages(selectedConversation.id);
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [botId, bot, tab, conversationsPage, conversationUserFilter, selectedConversation, loadStats, loadConversations, loadConversationMessages]);

  const submitCommand = async () => {
    const name = cmdName.trim();
    if (!name.startsWith('/')) {
      toast.error('دستور باید با «/» شروع شود؛ مثلاً /start');
      return;
    }
    setCmdSaving(true);
    try {
      await api.post(`/api/v1/bots/${botId}/commands`, {
        command: name,
        ...(cmdDesc.trim() ? { descriptionFa: cmdDesc.trim() } : {}),
        responseKind: cmdKind,
        responsePayload: buildPayload(cmdKind, cmdDraft) ?? null,
      });
      toast.success('دستور ذخیره شد.');
      setCmdOpen(false);
      setCmdName('');
      setCmdDesc('');
      setCmdKind('TEXT');
      setCmdDraft({ text: '', systemPrompt: '', buttons: [{ label: '', type: 'URL', value: '' }] });
      await loadCommands();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'ذخیرهٔ دستور ناموفق بود.');
    } finally {
      setCmdSaving(false);
    }
  };

  const submitKeyword = async () => {
    if (kwText.trim().length < 2) {
      toast.error('کلمهٔ کلیدی باید حداقل ۲ نویسه باشد.');
      return;
    }
    setKwSaving(true);
    try {
      await api.post(`/api/v1/bots/${botId}/keywords`, {
        keyword: kwText.trim(),
        matchKind: kwMatch,
        responseKind: kwKind,
        responsePayload: buildPayload(kwKind, kwDraft) ?? null,
      });
      toast.success('کلیدواژه ذخیره شد.');
      setKwOpen(false);
      setKwText('');
      setKwMatch('CONTAINS');
      setKwKind('TEXT');
      setKwDraft({ text: '', systemPrompt: '', buttons: [{ label: '', type: 'URL', value: '' }] });
      await loadKeywords();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'ذخیرهٔ کلیدواژه ناموفق بود.');
    } finally {
      setKwSaving(false);
    }
  };

  const deleteRow = async (id: string, kind: 'command' | 'keyword') => {
    setBusyId(id);
    try {
      if (kind === 'command') {
        await api.del(`/api/v1/bots/${botId}/commands?commandId=${encodeURIComponent(id)}`);
        await loadCommands();
      } else {
        await api.del(`/api/v1/bots/${botId}/keywords?keywordId=${encodeURIComponent(id)}`);
        await loadKeywords();
      }
      toast.success('حذف شد.');
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'حذف ناموفق بود.');
    } finally {
      setBusyId(null);
    }
  };

  const changeMode = async (mode: 'WEBHOOK' | 'POLLING') => {
    if (!bot || bot.mode === mode || (bot.platform === 'rubika' && mode === 'POLLING')) return;
    setModeSaving(true);
    try {
      const d = await api.post<{ bot: BotDto }>(`/api/v1/bots/${botId}/mode`, { mode });
      setBot(d.bot);
      toast.success('حالت دریافت پیام تغییر کرد.');
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'تغییر حالت ربات ناموفق بود.');
    } finally {
      setModeSaving(false);
    }
  };

  const saveAi = async () => {
    setAiSaving(true);
    try {
      await api.put(`/api/v1/bots/${botId}/ai`, {
        aiEnabled,
        aiSystemPrompt: aiPrompt.trim() ? aiPrompt.trim() : null,
      });
      toast.success('تنظیمات هوش مصنوعی ذخیره شد.');
      await loadBots();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'ذخیرهٔ تنظیمات ناموفق بود.');
    } finally {
      setAiSaving(false);
    }
  };

  if (loading) return <PageLoading />;

  if (!bot) {
    return (
      <EmptyState
        icon="🤖"
        title="ربات پیدا نشد"
        description="این ربات وجود ندارد یا به حساب شما تعلق ندارد."
        action={<Link to="/dashboard/bots" className="btn btn-primary">بازگشت به فهرست ربات‌ها</Link>}
      />
    );
  }

  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: 'commands', label: 'دستورها' },
    { key: 'keywords', label: 'پاسخگوی کلیدواژه' },
    { key: 'users', label: 'کاربران ربات' },
    { key: 'conversations', label: 'گفتگوها' },
    { key: 'stats', label: 'آمار و فعالیت' },
    { key: 'ai', label: 'تنظیمات هوش مصنوعی' },
  ];


  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Link to="/dashboard/bots" style={{ fontSize: 13 }}>← بازگشت به ربات‌ها</Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 21, fontWeight: 800 }}>{bot.title || 'ربات'}</h1>
          <StatusBadge state={bot.status} labels={BOT_STATUS_FA} />
          <span className="badge badge-brand">{faLabel(bot.mode, BOT_MODE_FA)}</span>
          <span style={{ fontSize: 13, color: 'var(--text-2)' }}>
            {faLabel(bot.platform, PLATFORM_FA)}
            {bot.username ? ` · @${bot.username}` : ''}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
          <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>حالت دریافت پیام:</span>
          <Select value={bot.mode} onChange={(e) => void changeMode(e.target.value as 'WEBHOOK' | 'POLLING')} disabled={modeSaving || bot.status !== 'ACTIVE' || bot.platform === 'rubika'}>
            <option value="WEBHOOK">وبهوک</option>
            <option value="POLLING">بررسی دوره‌ای</option>
          </Select>
          {bot.status !== 'ACTIVE' && <span style={{ fontSize: 11.5, color: 'var(--text-2)' }}>برای تغییر حالت، ربات باید فعال باشد.</span>}
        </div>
      </div>

      {capabilities && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>توانایی‌های این پلتفرم</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, fontSize: 13 }}>
            {Object.entries(CAPABILITY_FA).map(([key, label]) => {
              const on = capabilities[key] === true;
              return (
                <span key={key} style={{ color: on ? 'var(--success)' : 'var(--text-2)' }}>
                  <span aria-hidden="true">{on ? '✔' : '✖'}</span> {label}
                </span>
              );
            })}
          </div>
        </div>
      )}

      <div role="tablist" aria-label="بخش‌های ربات" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={`btn btn-sm ${tab === t.key ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'commands' && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700 }}>دستورهای ربات</h2>
            <Button size="sm" onClick={() => setCmdOpen(true)}>+ دستور جدید</Button>
          </div>
          {commands.length === 0 ? (
            <EmptyState icon="⌨️" title="دستوری تعریف نشده است" description="با دستورهایی مثل /start به پیام‌های کاربر پاسخ خودکار بدهید." />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>دستور</th>
                    <th>توضیح</th>
                    <th>نوع پاسخ</th>
                    <th>پیش‌نمایش</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {commands.map((c) => (
                    <tr key={c.id}>
                      <td style={{ fontWeight: 700, fontFamily: 'monospace' }}>{c.command}</td>
                      <td>{c.descriptionFa || '—'}</td>
                      <td><span className="badge badge-brand">{faLabel(c.responseKind ?? 'TEXT', RESPONSE_KIND_FA)}</span></td>
                      <td style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{payloadText(c.responsePayload) || '—'}</td>
                      <td>
                        <Button size="sm" variant="danger" loading={busyId === c.id} onClick={() => void deleteRow(c.id, 'command')}>حذف</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === 'keywords' && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700 }}>پاسخگوی کلیدواژه</h2>
            <Button size="sm" onClick={() => setKwOpen(true)}>+ کلیدواژهٔ جدید</Button>
          </div>
          {keywords.length === 0 ? (
            <EmptyState icon="💬" title="کلیدواژه‌ای تعریف نشده است" description="هر وقت کاربر یکی از این کلیدواژه‌ها را بفرستد، ربات پاسخ می‌دهد." />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>کلیدواژه</th>
                    <th>نوع تطبیق</th>
                    <th>نوع پاسخ</th>
                    <th>پیش‌نمایش</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {keywords.map((k) => (
                    <tr key={k.id}>
                      <td style={{ fontWeight: 700 }}>{k.keyword}</td>
                      <td><span className="badge badge-info">{faLabel(k.matchKind ?? 'CONTAINS', MATCH_KIND_FA)}</span></td>
                      <td><span className="badge badge-brand">{faLabel(k.responseKind ?? 'TEXT', RESPONSE_KIND_FA)}</span></td>
                      <td style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{payloadText(k.responsePayload) || '—'}</td>
                      <td>
                        <Button size="sm" variant="danger" loading={busyId === k.id} onClick={() => void deleteRow(k.id, 'keyword')}>حذف</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === 'users' && (
        <Card>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>کاربران ربات</h2>
            <Button size="sm" variant="soft" disabled={usersExporting} onClick={() => void exportBotUsers()}>
              {usersExporting ? 'در حال آماده‌سازی…' : 'خروجی Excel (CSV)'}
            </Button>
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.8, margin: '0 0 12px' }}>
            خروجی شامل نام نمایشی، شناسهٔ پیام‌رسان، نام کاربری و زمان اولین/آخرین حضور است. برای محافظت از فایل، خروجی به ۱۰٬۰۰۰ کاربر محدود است.
          </p>
          {users.length === 0 ? (
            <EmptyState icon="👥" title="هنوز کاری با ربات نکرده‌اند" description="به‌محض اولین پیام کاربران به ربات، اینجا فهرست می‌شوند." />
          ) : (
            <>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>نام نمایشی</th>
                      <th>شناسه کاربر</th>
                      <th>نام کاربری</th>
                      <th>اولین بازدید</th>
                      <th>آخرین بازدید</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <tr key={u.id}>
                        <td>{u.displayName || '—'}</td>
                        <td dir="ltr">{u.platformUserId}</td>
                        <td dir="ltr" style={{ textAlign: 'right' }}>{u.username ? `@${u.username}` : '—'}</td>
                        <td>{faRelative(u.firstSeenAt)}</td>
                        <td>{faRelative(u.lastSeenAt)}</td>
                        <td><Button size="sm" variant="soft" onClick={() => { setConversationUserFilter(u.platformUserId); setSelectedConversation(null); setConversationMessages([]); setConversationsPage(1); setTab('conversations'); void loadConversations(1, u.platformUserId); }}>گفتگو</Button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={usersPage} pageSize={20} total={usersTotal} onPage={(p) => void loadUsers(p)} />
            </>
          )}
        </Card>
      )}

      {tab === 'conversations' && (
        <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginBottom: 12 }}>
              <div><h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>گفتگوها</h2>{conversationUserFilter && <div style={{ fontSize: 11.5, color: 'var(--text-2)', marginTop: 3 }} dir="ltr">فیلتر کاربر: {conversationUserFilter}</div>}</div>
              <div style={{ display: 'flex', gap: 6 }}>
                {conversationUserFilter && <Button size="sm" variant="ghost" onClick={() => { setConversationUserFilter(''); setConversationsPage(1); void loadConversations(1, ''); }}>همه</Button>}
                <Button size="sm" variant="ghost" onClick={() => void loadConversations(conversationsPage)}>به‌روزرسانی</Button>
              </div>
            </div>
            {conversations.length === 0 ? (
              <EmptyState icon="💬" title="گفتگویی ثبت نشده است" description="با دریافت اولین پیام کاربر، گفتگو در این بخش ساخته می‌شود." />
            ) : (
              <>
                <div style={{ display: 'grid', gap: 8 }}>
                  {conversations.map((c) => (
                    <button key={c.id} type="button" onClick={() => { setSelectedConversation(c); void loadConversationMessages(c.id); }} style={{ textAlign: 'right', border: selectedConversation?.id === c.id ? '1px solid var(--brand)' : '1px solid var(--border)', background: selectedConversation?.id === c.id ? 'var(--brand-soft)' : 'var(--surface)', borderRadius: 12, padding: 10, cursor: 'pointer' }}>
                      <strong style={{ display: 'block' }}>{c.displayName || (c.username ? `@${c.username}` : c.platformUserId)}</strong>
                      <span style={{ display: 'block', color: 'var(--text-2)', fontSize: 12.5 }} dir="ltr">{c.platform} · {c.chatRef}</span>
                      <span style={{ display: 'block', color: 'var(--text-2)', fontSize: 12, marginTop: 3 }}>{faRelative(c.lastActivityAt)}</span>
                    </button>
                  ))}
                </div>
                <Pagination page={conversationsPage} pageSize={20} total={conversationsTotal} onPage={(p) => void loadConversations(p, conversationUserFilter || undefined)} />
              </>
            )}
          </Card>
          <Card>
            {!selectedConversation ? (
              <EmptyState icon="↔" title="یک گفتگو را انتخاب کنید" description="پیام‌های همان کاربر و همان مقصد، با تفکیک ورودی و خروجی نمایش داده می‌شوند." />
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start', marginBottom: 12 }}>
                  <div><h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{selectedConversation.displayName || 'گفتگو'}</h2><div style={{ fontSize: 12, color: 'var(--text-2)' }} dir="ltr">{selectedConversation.chatRef} · {selectedConversation.platformUserId}</div></div>
                  <Button size="sm" variant="ghost" loading={conversationLoading} onClick={() => void loadConversationMessages(selectedConversation.id)}>به‌روزرسانی</Button>
                </div>
                {conversationMessages.length === 0 ? <p style={{ color: 'var(--text-2)', fontSize: 13 }}>پیامی برای این گفتگو ثبت نشده است.</p> : (
                  <div style={{ display: 'grid', gap: 8, maxHeight: 560, overflowY: 'auto', padding: 2 }}>
                    {conversationMessages.map((m) => (
                      <div key={m.id} style={{ display: 'flex', justifyContent: m.direction === 'OUTBOUND' ? 'flex-start' : 'flex-end' }}>
                        <div style={{ maxWidth: '82%', border: '1px solid var(--border)', borderRadius: 12, padding: '8px 10px', background: m.direction === 'OUTBOUND' ? 'var(--brand-soft)' : 'var(--surface-2)' }}>
                          <div style={{ fontSize: 11.5, color: 'var(--text-2)', marginBottom: 3 }}>{m.direction === 'OUTBOUND' ? 'پاسخ ربات' : 'پیام کاربر'} · {m.actionType || 'پیام'} · {m.status}</div>
                          <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.9, fontSize: 13.5 }}>{m.text || '—'}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 3 }}>{faRelative(m.createdAt)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--text-2)' }}>تعداد کل پیام‌ها: {faCompact(conversationMessagesTotal)}{conversationMessagesTotal > conversationMessages.length ? ' · نمایش ۱۰۰ پیام اخیر' : ''}</div>
              </>
            )}
          </Card>
        </div>
      )}

      {tab === 'stats' && (
        <Card>
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>گزارش عملکرد ربات</h2>
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', marginBottom: 18 }}>
            <StatCard icon="↙" bg="var(--brand-soft)" label="پیام دریافتی · ۳۰ روز" value={faCompact(stats?.messagesReceived30d ?? 0)} />
            <StatCard icon="↗" bg="var(--success-soft)" label="پیام ارسالی · ۳۰ روز" value={faCompact(stats?.messagesSent30d ?? 0)} />
            <StatCard icon="/" bg="var(--warning-soft)" label="دستور اجراشده" value={faCompact(stats?.commandsMatched30d ?? 0)} />
            <StatCard icon="⚙" bg="var(--info-soft, var(--surface-2))" label="گردش‌کار اجراشده" value={faCompact(stats?.workflowsRun30d ?? 0)} />
            <StatCard icon="#" bg="var(--surface-2)" label="کاربران" value={faCompact(stats?.userCount ?? 0)} />
          </div>
          <h3 style={{ fontSize: 14, fontWeight: 700, margin: '8px 0 10px' }}>آخرین اقدامات</h3>
          {!stats?.recentActivity?.length ? (
            <p style={{ margin: 0, color: 'var(--text-2)', fontSize: 13 }}>هنوز فعالیتی برای این ربات ثبت نشده است.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>زمان</th><th>جهت</th><th>اقدام</th><th>پیام</th><th>وضعیت</th></tr></thead>
                <tbody>{stats.recentActivity.map((a) => (
                  <tr key={a.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{faRelative(a.createdAt)}</td>
                    <td>{a.direction === 'INBOUND' ? 'دریافتی' : 'ارسالی'}</td>
                    <td>{a.actionType === 'COMMAND' ? 'دستور' : a.actionType === 'KEYWORD' ? 'کلیدواژه' : a.actionType === 'WORKFLOW' ? 'گردش‌کار' : 'پیام'}</td>
                    <td style={{ maxWidth: 360, whiteSpace: 'pre-wrap' }}>{a.text || '—'}</td>
                    <td>{a.status === 'SENT' ? 'ارسال شد' : a.status === 'RECEIVED' ? 'دریافت شد' : 'ناموفق'}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === 'ai' && (
        <div className="card" style={{ maxWidth: 640 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>تنظیمات هوش مصنوعی</h2>
          <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 14 }}>
            با فعال‌کردن این گزینه، پیام‌هایی که با دستور یا کلیدواژه جواب نمی‌گیرند به‌وسیلهٔ هوش مصنوعی پاسخ داده می‌شوند.
          </p>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, cursor: 'pointer' }}>
            <input type="checkbox" checked={aiEnabled} onChange={(e) => setAiEnabled(e.target.checked)} style={{ width: 18, height: 18, accentColor: 'var(--brand)' }} />
            <span style={{ fontWeight: 600, fontSize: 14 }}>پاسخگویی خودکار با هوش مصنوعی</span>
          </label>
          <Field label="راهنمای رفتار دستیار" hint={AI_PROMPT_HINT}>
            <ContentComposerTextarea value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} rows={6} placeholder="مثلاً: تو پشتیبان فروشگاه هستی؛ کوتاه و مؤدب پاسخ بده." />
          </Field>
          <Button onClick={() => void saveAi()} loading={aiSaving}>ذخیرهٔ تنظیمات</Button>
        </div>
      )}

      <Modal open={cmdOpen} onClose={() => setCmdOpen(false)} title="دستور جدید" large>
        <Field label="نام دستور" required hint="با «/» شروع می‌شود؛ فقط حروف انگلیسی، عدد و زیرخط.">
          <Input dir="ltr" value={cmdName} onChange={(e) => setCmdName(e.target.value)} placeholder="/start" />
        </Field>
        <Field label="توضیح (فارسی)">
          <Input value={cmdDesc} onChange={(e) => setCmdDesc(e.target.value)} placeholder="مثلاً: شروع گفتگو و نمایش منو" />
        </Field>
        <Field label="نوع پاسخ" required>
          <Select value={cmdKind} onChange={(e) => setCmdKind(e.target.value)}>
            <option value="TEXT">متن</option>
            <option value="BUTTONS">دکمه</option>
            <option value="AI">هوش مصنوعی</option>
            <option value="WORKFLOW">گردش‌کار</option>
          </Select>
        </Field>
        <ResponsePayloadEditor kind={cmdKind} draft={cmdDraft} setDraft={setCmdDraft} />
        <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
          <Button onClick={() => void submitCommand()} loading={cmdSaving}>ذخیرهٔ دستور</Button>
          <Button variant="ghost" onClick={() => setCmdOpen(false)}>انصراف</Button>
        </div>
      </Modal>

      <Modal open={kwOpen} onClose={() => setKwOpen(false)} title="کلیدواژهٔ جدید" large>
        <Field label="کلیدواژه" required hint="کلمه یا عبارتی که اگر کاربر بفرستد، ربات پاسخ می‌دهد.">
          <Input value={kwText} onChange={(e) => setKwText(e.target.value)} placeholder="مثلاً قیمت" />
        </Field>
        <Field label="نوع تطبیق" required>
          <Select value={kwMatch} onChange={(e) => setKwMatch(e.target.value)}>
            <option value="CONTAINS">شامل — هر پیامی که این عبارت را داشته باشد</option>
            <option value="EXACT">دقیق — فقط پیام کاملاً برابر این عبارت</option>
          </Select>
        </Field>
        <Field label="نوع پاسخ" required>
          <Select value={kwKind} onChange={(e) => setKwKind(e.target.value)}>
            <option value="TEXT">متن</option>
            <option value="BUTTONS">دکمه</option>
            <option value="AI">هوش مصنوعی</option>
            <option value="WORKFLOW">گردش‌کار</option>
          </Select>
        </Field>
        <ResponsePayloadEditor kind={kwKind} draft={kwDraft} setDraft={setKwDraft} />
        <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
          <Button onClick={() => void submitKeyword()} loading={kwSaving}>ذخیرهٔ کلیدواژه</Button>
          <Button variant="ghost" onClick={() => setKwOpen(false)}>انصراف</Button>
        </div>
      </Modal>
    </div>
  );
}
