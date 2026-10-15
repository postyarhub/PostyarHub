import { useCallback, useEffect, useState } from 'react';
import { api, ApiRequestError, type BotDto, type ChannelDto } from '../../lib/api';
import { Button, Card, ConfirmDialog, EmptyState, Field, Input, Modal, PageLoading, Select, StatusBadge } from '../../components/ui';
import { PLATFORM_ICONS } from '../../components/PlatformIcons';
import { useToast } from '../../lib/toast';
import { faDate, faNumber, PLATFORM_FA } from '../../lib/format';

type Platform = ChannelDto['platform'];

const CHANNEL_STATE_FA: Record<string, string> = {
  PENDING_VERIFY: 'در انتظار تأیید',
  ACTIVE: 'فعال',
  DISABLED: 'غیرفعال',
  ERROR: 'خطا',
};

const PLATFORM_LABEL: Record<Platform, string> = { telegram: 'تلگرام', bale: 'بله', rubika: 'روبیکا' };

/** Shape returned by GET /api/v1/channels/capabilities?platform=X */
interface CapabilitiesDto {
  sendText: boolean;
  sendMedia: boolean;
  editMessage: boolean;
  deleteMessage: boolean;
  inlineButtons: boolean;
  htmlParseMode: boolean;
}

function errText(e: unknown): string {
  if (e instanceof ApiRequestError) return e.message;
  return 'خطای غیرمنتظره رخ داد. دوباره تلاش کنید.';
}

/** Persian capability hints shown in the connect modal (negatives matter most). */
function capabilityHints(c: CapabilitiesDto): string[] {
  const hints: string[] = [];
  hints.push(c.sendText ? 'ارسال متن پشتیبانی می‌شود.' : 'ارسال متن پشتیبانی نمی‌شود.');
  hints.push(c.sendMedia ? 'ارسال تصویر و ویدیو پشتیبانی می‌شود.' : 'ارسال تصویر و ویدیو پشتیبانی نمی‌شود.');
  if (!c.inlineButtons) hints.push('دکمه شیشه‌ای (لینک) پشتیبانی نمی‌شود.');
  if (!c.deleteMessage) hints.push('حذف پیام پشتیبانی نمی‌شود.');
  if (!c.editMessage) hints.push('ویرایش پیام پس از ارسال پشتیبانی نمی‌شود.');
  if (!c.htmlParseMode) hints.push('قالب‌بندی پیشرفتهٔ متن (اچ‌تی‌ام‌ال) پشتیبانی نمی‌شود.');
  return hints;
}


function PlatformIcon({ platform, size = 24 }: { platform: Platform; size?: number }) {
  const Icon = PLATFORM_ICONS[platform];
  return <Icon size={size} />;
}

export default function Channels() {
  const toast = useToast();
  const [channels, setChannels] = useState<ChannelDto[]>([]);
  const [loading, setLoading] = useState(true);

  // connect modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [platform, setPlatform] = useState<Platform>('telegram');
  const [channelRef, setChannelRef] = useState('');
  const [manualChatId, setManualChatId] = useState('');
  const [manualOpen, setManualOpen] = useState(false);
  const [rubikaBots, setRubikaBots] = useState<Array<{ id: string; title: string; username: string | null }>>([]);
  const [rubikaBotId, setRubikaBotId] = useState('');
  const [channelBots, setChannelBots] = useState<BotDto[]>([]);
  const [channelBotId, setChannelBotId] = useState('');
  const [channelBotsLoading, setChannelBotsLoading] = useState(false);
  const [channelBotsError, setChannelBotsError] = useState('');
  const [channelBotsReload, setChannelBotsReload] = useState(0);
  const [discovery, setDiscovery] = useState<{ discoveryId: string; status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'ERROR' | 'EXPIRED'; command: string; expiresAt: string; lastError: string | null; channelId: string | null; channelRef: string | null; channelTitle: string | null } | null>(null);
  const [discoveryNotified, setDiscoveryNotified] = useState(false);
  const [title, setTitle] = useState('');
  const [editTarget, setEditTarget] = useState<ChannelDto | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const [caps, setCaps] = useState<CapabilitiesDto | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // action state
  const [busyId, setBusyId] = useState('');
  const [confirmTarget, setConfirmTarget] = useState<ChannelDto | null>(null);
  const [removing, setRemoving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<{ channels: ChannelDto[] }>('/api/v1/channels');
      setChannels(data.channels ?? []);
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  // Load channel capabilities and active bot candidates for the selected platform.
  // Multiple active bots are valid; a channel must be explicitly bound when needed.
  useEffect(() => {
    if (!modalOpen) return;
    let cancelled = false;
    setCaps(null);
    api
      .get<{ platform: string; capabilities: CapabilitiesDto }>(`/api/v1/channels/capabilities?platform=${platform}`)
      .then((d) => {
        if (!cancelled) setCaps(d.capabilities);
      })
      .catch(() => undefined);

    if (platform === 'rubika') {
      setChannelBotsLoading(false);
      setRubikaBots([]);
      setRubikaBotId('');
      api.get<{ items: BotDto[] }>('/api/v1/bots')
        .then((d) => {
          if (cancelled) return;
          const items = (d.items ?? []).filter((bot) => bot.platform === 'rubika' && bot.status === 'ACTIVE' && bot.mode === 'WEBHOOK');
          setRubikaBots(items.map((bot) => ({ id: bot.id, title: bot.title, username: bot.username })));
          if (items.length === 1) setRubikaBotId(items[0].id);
        })
        .catch(() => { if (!cancelled) setRubikaBots([]); });
    } else {
      setChannelBots([]);
      setChannelBotId('');
      setChannelBotsError('');
      setChannelBotsLoading(true);
      api.get<{ items: BotDto[] }>('/api/v1/bots')
        .then((d) => {
          if (cancelled) return;
          const items = (d.items ?? []).filter((bot) => bot.platform === platform && bot.status === 'ACTIVE');
          setChannelBots(items);
          setChannelBotId(items.length === 1 ? items[0].id : '');
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setChannelBotsError(errText(error));
            setChannelBots([]);
            setChannelBotId('');
          }
        })
        .finally(() => { if (!cancelled) setChannelBotsLoading(false); });
    }
    return () => {
      cancelled = true;
    };
  }, [modalOpen, platform, channelBotsReload]);

  useEffect(() => {
    if (!discovery?.discoveryId || discovery.status === 'COMPLETED' || discovery.status === 'EXPIRED') return;
    let cancelled = false;
    const poll = async () => {
      try {
        const d = await api.get<{ discovery: typeof discovery }>(`/api/v1/channels/rubika/discovery/${discovery.discoveryId}`);
        if (cancelled) return;
        setDiscovery(d.discovery);
        if (d.discovery.status === 'COMPLETED' && !discoveryNotified) {
          setDiscoveryNotified(true);
          toast.success(`کانال «${d.discovery.channelTitle ?? 'روبیکا'}» با موفقیت متصل شد.`);
          await load();
        }
      } catch (e) {
        if (!cancelled) setFormError(errText(e));
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [discovery?.discoveryId, discovery?.status, discoveryNotified, load, toast]);

  const openModal = () => {
    setPlatform('telegram');
    setChannelRef('');
    setManualChatId('');
    setManualOpen(false);
    setRubikaBotId('');
    setRubikaBots([]);
    setChannelBots([]);
    setChannelBotId('');
    setChannelBotsLoading(true);
    setChannelBotsError('');
    setDiscovery(null);
    setDiscoveryNotified(false);
    setTitle('');
    setFormError('');
    setModalOpen(true);
  };

  const submitConnect = async () => {
    setSaving(true);
    setFormError('');
    try {
      if (platform !== 'rubika') {
        if (channelBotsLoading) {
          setFormError('در حال دریافت فهرست ربات‌ها هستیم؛ چند لحظه صبر کنید.');
          return;
        }
        if (channelBotsError) {
          setFormError('فهرست ربات‌ها دریافت نشد. ابتدا «تلاش مجدد» را بزنید.');
          return;
        }
        if (channelBots.length > 1 && !channelBotId) {
          setFormError('ربات مقصد این کانال را انتخاب کنید.');
          return;
        }
      }
      if (platform === 'rubika' && manualOpen && rubikaBots.length > 1 && !rubikaBotId) {
        setFormError('ربات روبیکا را برای این کانال انتخاب کنید.');
        return;
      }
      if (platform === 'rubika' && !manualOpen) {
        if (!rubikaBotId) {
          setFormError(rubikaBots.length ? 'ربات روبیکا را انتخاب کنید.' : 'ابتدا یک ربات فعال روبیکا را از صفحه «ربات‌ها» متصل کنید.');
          return;
        }
        const response = await api.post<{ discovery: typeof discovery }>('/api/v1/channels/rubika/discovery', {
          botId: rubikaBotId,
          ...(title.trim() ? { title: title.trim() } : {}),
        });
        setDiscovery(response.discovery);
        setDiscoveryNotified(false);
        return;
      }

      const ref = platform === 'rubika' ? manualChatId.trim() : channelRef.trim();
      if (!ref) {
        setFormError(platform === 'rubika' ? 'chat_id کانال را وارد کنید یا از روش شناسایی خودکار استفاده کنید.' : 'آدرس کانال را وارد کنید.');
        return;
      }
      const selectedBotId = platform === 'rubika' ? rubikaBotId : channelBotId;
      await api.post('/api/v1/channels', {
        platform,
        channelRef: ref,
        title: title.trim() || ref,
        ...(selectedBotId ? { botId: selectedBotId } : {}),
      });
      toast.success('کانال با موفقیت متصل شد.');
      setModalOpen(false);
      await load();
    } catch (e) {
      setFormError(errText(e));
    } finally {
      setSaving(false);
    }
  };

  const discoveryStatusText = discovery?.status === 'PROCESSING'
    ? 'در حال بررسی کانال…'
    : discovery?.status === 'COMPLETED'
      ? 'کانال با موفقیت متصل شد.'
      : discovery?.status === 'ERROR'
        ? (discovery.lastError ?? 'شناسایی انجام نشد. ربات را در کانال Admin کنید و دوباره دستور را ارسال کنید.')
        : discovery?.status === 'EXPIRED'
          ? 'زمان این درخواست تمام شده است. یک درخواست جدید شروع کنید.'
          : 'در انتظار پیام شناسایی از کانال…';

  const startNewDiscovery = () => {
    setDiscovery(null);
    setDiscoveryNotified(false);
    setFormError('');
  };


  const openEdit = (ch: ChannelDto) => {
    setEditTarget(ch);
    setEditTitle(ch.title);
  };

  const submitEdit = async () => {
    if (!editTarget) return;
    const next = editTitle.trim();
    if (!next) { toast.error('عنوان کانال را وارد کنید.'); return; }
    setEditBusy(true);
    try {
      await api.patch(`/api/v1/channels/${editTarget.id}`, { title: next });
      toast.success('عنوان کانال به‌روزرسانی شد.');
      setEditTarget(null);
      await load();
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setEditBusy(false);
    }
  };

  const verifyChannel = async (ch: ChannelDto) => {
    setBusyId(ch.id);
    try {
      await api.post(`/api/v1/channels/${ch.id}/verify`);
      toast.success(`وضعیت «${ch.title}» به‌روزرسانی شد.`);
      await load();
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusyId('');
    }
  };

  const disconnect = async () => {
    if (!confirmTarget) return;
    setRemoving(true);
    try {
      await api.del(`/api/v1/channels/${confirmTarget.id}`);
      toast.success(`کانال «${confirmTarget.title}» قطع شد.`);
      setConfirmTarget(null);
      await load();
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setRemoving(false);
    }
  };

  if (loading) return <PageLoading />;

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 4px' }}>مدیریت کانال‌ها</h1>
          <p style={{ color: 'var(--text-2)', fontSize: 13, margin: 0 }}>
            کانال‌های متصل به حساب شما برای انتشار پست
          </p>
        </div>
        <Button onClick={openModal}>+ اتصال کانال جدید</Button>
      </div>

      {channels.length === 0 ? (
        <EmptyState
          icon="📻"
          title="هنوز کانالی متصل نکرده‌اید"
          description="اولین کانال خود را از تلگرام، بله یا روبیکا متصل کنید تا بتوانید پست منتشر کنید."
          action={<Button onClick={openModal}>اتصال کانال</Button>}
        />
      ) : (
        <div className="platform-columns-grid">
          {(['telegram', 'bale', 'rubika'] as const).map((platformGroup) => {
            const grouped = channels.filter((channel) => channel.platform === platformGroup);
            return <section key={platformGroup} aria-label={`کانال‌های ${PLATFORM_FA[platformGroup]}`} style={{ display: 'grid', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
                <PlatformIcon platform={platformGroup} size={28} />
                <h2 style={{ fontSize: 15, fontWeight: 800, margin: 0 }}>{PLATFORM_FA[platformGroup]}</h2>
                <span className="badge">{faNumber(grouped.length)} کانال</span>
              </div>
              <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'minmax(0, 1fr)' }}>
          {grouped.length ? grouped.map((ch) => (
            <Card key={ch.id} pad="lg">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <PlatformIcon platform={ch.platform} size={30} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ch.title}</div>
                  <div dir="ltr" style={{ textAlign: 'right', fontSize: 12.5, color: 'var(--text-2)' }}>{ch.channelRef}</div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                <StatusBadge state={ch.status} labels={CHANNEL_STATE_FA} />
                <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{PLATFORM_FA[ch.platform]}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 12 }}>تاریخ افزودن: {faDate(ch.createdAt)}</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Button size="sm" variant="ghost" onClick={() => openEdit(ch)}>
                  ویرایش
                </Button>
                {ch.status !== 'ACTIVE' && (
                  <Button size="sm" variant="soft" loading={busyId === ch.id} onClick={() => void verifyChannel(ch)}>
                    بررسی و تأیید
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => setConfirmTarget(ch)}>
                  قطع اتصال
                </Button>
              </div>
            </Card>
          )) : <div style={{border:'1px dashed var(--border)',borderRadius:10,padding:12,color:'var(--text-2)',fontSize:12,lineHeight:1.8}}>هنوز کانالی برای این پلتفرم متصل نشده است.</div>}
              </div>
            </section>;
          })}
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="اتصال کانال جدید">
        <Field label="پلتفرم" required>
          <Select value={platform} onChange={(e) => { const next = e.target.value as Platform; setPlatform(next); setFormError(''); setDiscovery(null); setManualOpen(false); setManualChatId(''); setChannelBotId(''); setChannelBotsError(''); }}>
            <option value="telegram">تلگرام</option>
            <option value="bale">بله</option>
            <option value="rubika">روبیکا</option>
          </Select>
        </Field>

        {platform === 'rubika' ? (
          <>
            <div style={{ background: 'var(--surface-2)', borderRadius: 12, padding: '14px 15px', marginBottom: 14, border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 6 }}>اتصال کانال روبیکا</div>
              <div style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.9, marginBottom: 12 }}>
                برای روبیکا لازم نیست شناسهٔ داخلی کانال را پیدا کنید. پُست‌یار می‌تواند آن را خودکار از همان کانال دریافت و تأیید کند.
              </div>
              {rubikaBots.length > 1 && (
                <Field label="ربات روبیکا" required hint="رباتی را انتخاب کنید که داخل کانال قرار می‌دهید.">
                  <Select value={rubikaBotId} onChange={(e) => setRubikaBotId(e.target.value)}>
                    <option value="">انتخاب ربات…</option>
                    {rubikaBots.map((bot) => <option key={bot.id} value={bot.id}>{bot.title}{bot.username ? ` (@${bot.username.replace(/^@+/, '')})` : ''}</option>)}
                  </Select>
                </Field>
              )}
              {rubikaBots.length === 0 ? (
                <div style={{ background: 'var(--danger-soft)', color: 'var(--danger)', borderRadius: 10, padding: '10px 12px', fontSize: 12.5, lineHeight: 1.8 }}>
                  ابتدا از صفحه «ربات‌ها» یک ربات فعال روبیکا را متصل کنید. اتصال کانال بعد از آن در همین صفحه انجام می‌شود.
                </div>
              ) : (
                <>
                  <div style={{ display: 'grid', gap: 9, fontSize: 12.5, lineHeight: 1.85 }}>
                    <div><strong>۱. ربات را به کانال اضافه کنید</strong><br />ربات {rubikaBots.length === 1 ? <strong>{rubikaBots[0].title}</strong> : 'انتخاب‌شده'} را داخل کانال اضافه کنید و آن را <strong>Admin</strong> کنید.</div>
                    <div><strong>۲. کانال را شناسایی کنید</strong><br />دستور نمایش‌داده‌شده را در همان کانال ارسال کنید.</div>
                  </div>
                  {discovery ? (
                    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 7 }}>{discoveryStatusText}</div>
                      {discovery.status !== 'COMPLETED' && discovery.status !== 'EXPIRED' && (
                        <div>
                          <div dir="ltr" style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 9, padding: '9px 10px', fontFamily: 'monospace', fontSize: 13, wordBreak: 'break-word', marginBottom: 8 }}>{discovery.command}</div>
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <Button size="sm" variant="soft" onClick={() => { void navigator.clipboard?.writeText(discovery.command); toast.success('دستور کپی شد.'); }}>کپی دستور</Button>
                            {discovery.status === 'ERROR' && <Button size="sm" variant="ghost" onClick={startNewDiscovery}>شروع دوباره</Button>}
                          </div>
                        </div>
                      )}
                      {discovery.status === 'COMPLETED' && <div style={{ background: 'var(--success-soft)', color: 'var(--success)', borderRadius: 9, padding: '9px 11px', fontSize: 12.5 }}>کانال «{discovery.channelTitle ?? 'روبیکا'}» متصل و آمادهٔ انتشار است.</div>}
                    </div>
                  ) : (
                    <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-2)' }}>با زدن «شناسایی و اتصال کانال»، پُست‌یار یک دستور مخصوص همین اتصال ایجاد می‌کند.</div>
                  )}
                </>
              )}
            </div>

            <details open={manualOpen} onToggle={(e) => setManualOpen((e.currentTarget as HTMLDetailsElement).open)} style={{ marginBottom: 14 }}>
              <summary style={{ cursor: 'pointer', fontSize: 12.5, fontWeight: 700 }}>اتصال با chat_id (روش دستی)</summary>
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.8, marginBottom: 8 }}>
                  <strong>روش پیشنهادی:</strong> chat_id را پیدا نکنید؛ ربات را داخل کانال Admin کنید و از بخش بالا «شناسایی و اتصال کانال» را بزنید. پُست‌یار chat_id واقعی را از پیام همان کانال دریافت و با Rubika بررسی می‌کند.
                </div>
                <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, padding: '9px 11px', fontSize: 11.5, color: 'var(--text-2)', lineHeight: 1.85, marginBottom: 10 }}>
                  <strong style={{ color: 'var(--text)' }}>chat_id را از کجا بگیرم؟</strong><br />
                  Rubika در API عمومی راهی برای تبدیل نام‌کاربری کانال به chat_id تعریف نکرده است. در پیام وبهوک، شناسهٔ کانال در <code dir="ltr">update.chat_id</code> قرار می‌گیرد. لینک عمومی <code dir="ltr">rubika.ir/…</code> یا <code dir="ltr">@نام‌کاربری</code> خود chat_id نیست. اگر لینک مستقیم <code dir="ltr">web.rubika.ir/#c=…</code> را دارید، می‌توانید همان را وارد کنید؛ پُست‌یار بخش شناسه را استخراج و سپس با <code dir="ltr">getChat</code> تأیید می‌کند.
                </div>
                <Field label="chat_id / لینک مستقیم کانال روبیکا" required error={manualOpen ? (formError || undefined) : undefined}>
                  <Input dir="ltr" value={manualChatId} error={Boolean(formError)} onChange={(e) => setManualChatId(e.target.value)} placeholder="c0… یا https://web.rubika.ir/#c=…" />
                </Field>
              </div>
            </details>

            {formError && <div role="alert" style={{ color: 'var(--danger)', fontSize: 12.5, marginBottom: 10 }}>{formError}</div>}
            <div style={{ display: 'flex', gap: 10 }}>
              <Button onClick={() => void submitConnect()} loading={saving} disabled={rubikaBots.length === 0 && !manualOpen}>{manualOpen ? 'اتصال کانال' : 'شناسایی و اتصال کانال'}</Button>
              <Button variant="ghost" onClick={() => setModalOpen(false)}>انصراف</Button>
            </div>
          </>
        ) : (
          <>
            <Field label="آدرس کانال" required hint="مثال: @mychannel" error={formError || undefined}>
              <Input dir="ltr" value={channelRef} error={Boolean(formError)} onChange={(e) => setChannelRef(e.target.value)} placeholder="@mychannel" />
            </Field>
            <Field label="نام نمایشی کانال" hint="اگر خالی بماند، همان آدرس کانال استفاده می‌شود.">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="مثلاً: کانال اخبار فروشگاه" />
            </Field>
            <div style={{ marginBottom: 14 }}>
                {channelBotsLoading ? (
                  <div role="status" style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '11px 13px', color: 'var(--text-2)', fontSize: 12.5 }}>در حال دریافت ربات‌های فعال {PLATFORM_FA[platform]}…</div>
                ) : channelBotsError ? (
                  <div role="alert" style={{ background: 'var(--danger-soft)', color: 'var(--danger)', borderRadius: 10, padding: '11px 13px', fontSize: 12.5, lineHeight: 1.8 }}>
                    دریافت فهرست ربات‌ها ناموفق بود؛ تا مشخص‌شدن ربات مقصد، کانال ثبت نمی‌شود.
                    <div style={{ marginTop: 8 }}><Button size="sm" variant="soft" onClick={() => { setChannelBotsLoading(true); setChannelBotsError(''); setChannelBotsReload((value) => value + 1); }}>تلاش مجدد</Button></div>
                  </div>
                ) : channelBots.length > 1 ? (
                  <>
                    <Field label="ربات مقصد" required hint="رباتی را انتخاب کنید که این کانال با آن مدیریت و منتشر شود. ربات‌های دیگر فعال می‌مانند.">
                      <Select value={channelBotId} onChange={(e) => { setChannelBotId(e.target.value); setFormError(''); }}>
                        <option value="">انتخاب ربات مقصد…</option>
                        {channelBots.map((bot) => <option key={bot.id} value={bot.id}>{bot.title}{bot.username ? ` (@${bot.username.replace(/^@+/, '')})` : ''}</option>)}
                      </Select>
                    </Field>
                    {!channelBotId && <div style={{ color: 'var(--text-2)', fontSize: 11.5, marginTop: -8 }}>برای ادامه، ربات مربوط به همین کانال را انتخاب کنید؛ نیازی به غیرفعال‌کردن ربات‌های دیگر نیست.</div>}
                  </>
                ) : channelBots.length === 1 ? (
                  <div style={{ background: 'var(--info-soft)', borderRadius: 10, padding: '10px 13px', fontSize: 12.5, lineHeight: 1.8 }}>
                    <strong>ربات مقصد:</strong> {channelBots[0].title}{channelBots[0].username ? ` (@${channelBots[0].username.replace(/^@+/, '')})` : ''} — به‌طور خودکار انتخاب شد. سایر ربات‌ها نیازی به غیرفعال‌کردن ندارند.
                  </div>
                ) : (
                  <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '10px 13px', fontSize: 12, color: 'var(--text-2)', lineHeight: 1.8 }}>
                    ربات فعال برای این پلتفرم پیدا نشد. می‌توانید کانال را ثبت کنید، اما برای انتشار باید ربات فعال را به آن متصل و کانال را تأیید کنید.
                  </div>
                )}
              </div>
            <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '10px 14px', marginBottom: 14 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 4 }}>قابلیت‌های {PLATFORM_FA[platform]}:</div>
              {caps ? (
                <ul style={{ margin: 0, paddingInlineStart: 18, fontSize: 12, color: 'var(--text-2)', display: 'grid', gap: 2 }}>
                  {capabilityHints(caps).map((h) => <li key={h}>{h}</li>)}
                </ul>
              ) : (
                <div style={{ fontSize: 12, color: 'var(--text-2)' }}>در حال دریافت قابلیت‌ها…</div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <Button onClick={() => void submitConnect()} loading={saving || channelBotsLoading} disabled={channelBotsLoading || Boolean(channelBotsError) || (channelBots.length > 1 && !channelBotId)}>ثبت کانال</Button>
              <Button variant="ghost" onClick={() => setModalOpen(false)}>انصراف</Button>
            </div>
          </>
        )}
      </Modal>


      <Modal open={editTarget !== null} onClose={() => setEditTarget(null)} title="ویرایش کانال">
        {editTarget && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <PlatformIcon platform={editTarget.platform} size={34} />
              <div>
                <strong>{PLATFORM_LABEL[editTarget.platform]}</strong>
                <div style={{ color: 'var(--text-2)', fontSize: 12.5, direction: 'ltr' }}>{editTarget.channelRef}</div>
              </div>
            </div>
            <Field label="عنوان نمایشی" required>
              <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} maxLength={160} />
            </Field>
            <div style={{ display: 'flex', gap: 10 }}>
              <Button onClick={() => void submitEdit()} loading={editBusy}>ذخیره</Button>
              <Button variant="ghost" onClick={() => setEditTarget(null)}>انصراف</Button>
            </div>
          </>
        )}
      </Modal>

      <ConfirmDialog
        open={confirmTarget !== null}
        onClose={() => setConfirmTarget(null)}
        onConfirm={() => void disconnect()}
        busy={removing}
        danger
        title="قطع اتصال کانال"
        message={`آیا از قطع اتصال کانال «${confirmTarget?.title ?? ''}» مطمئن هستید؟ این کانال دیگر برای انتشار پست استفاده نخواهد شد.`}
      />
    </div>
  );
}
