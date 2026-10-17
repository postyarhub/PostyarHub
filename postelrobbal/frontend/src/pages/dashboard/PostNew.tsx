import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  api,
  ApiRequestError,
  getCsrfToken,
  type ApiError,
  type ChannelDto,
} from '../../lib/api';
import { Button, Card, EmptyState, Field, Input, PageLoading, Spinner } from '../../components/ui';
import { ContentComposerTextarea } from '../../components/ContentComposerTextarea';
import { JalaliDateTimePicker } from '../../components/JalaliDateTimePicker';
import { useToast } from '../../lib/toast';
import { faDigits, faNumber, PLATFORM_FA } from '../../lib/format';
import { ChannelButtonEditor } from '../../components/ChannelButtonEditor';
import { PlatformBadge } from '../../components/PlatformBadge';
import { WebsiteContentPicker, type WebsiteDraftItem } from '../../components/WebsiteContentPicker';
import { buttonTargetPreview, normalizeButtonTarget, type ButtonRow } from '../../lib/channelButtons';

const MAX_BODY = 4000;
const MAX_CHANNEL_FOOTER = 500;

interface MediaDto {
  id: string;
  filename: string;
  mime: string;
  sizeBytes: number;
}

/** Upload response is `{media}` — tolerant of a flat shape too. */
type MediaResponse = { media?: MediaDto; id?: string; filename?: string; mime?: string; sizeBytes?: number };

type EditablePostButton = {
  label: string;
  target?: { type: string; value: string };
  url?: string;
  callback?: string;
};

type EditablePostButtons = {
  byChannel?: Record<string, EditablePostButton[]>;
  footerByChannel?: Record<string, string>;
  byPlatform?: Record<string, EditablePostButton[] | undefined>;
  inline?: EditablePostButton[];
  links?: Array<{ label: string; url: string }>;
} | null;

type EditablePostResponse = {
  post: {
    id: string;
    title: string | null;
    body: string;
    parseMode: 'NONE' | 'HTML' | 'MARKDOWN';
    state: string;
    source: string;
    scheduledAt: string | null;
    mediaId: string | null;
    mediaIds?: string[] | null;
    buttonsJson: EditablePostButtons;
  };
  targets: Array<{ channelId: string; state: string }>;
  media: MediaDto | null;
  mediaItems?: MediaDto[];
};

function errText(e: unknown): string {
  if (e instanceof ApiRequestError) return e.message;
  return 'خطای غیرمنتظره رخ داد. دوباره تلاش کنید.';
}

/** Describe the actual destination semantics without issuing a provider request. */
function previewButtonDestination(platform: ChannelDto['platform'], row: ButtonRow): string {
  const value = normalizeButtonTarget(row.targetType, row.value);
  if (!value) return '';
  if (row.targetType === 'PHONE') {
    if (platform === 'telegram') return `tg://resolve?phone=${encodeURIComponent(value.replace(/^\+/, ''))}`;
    return `پیوند واسط تماس پُست‌یار ← ${value}`;
  }
  return buttonTargetPreview(row.targetType, value);
}

/** api.post cannot carry multipart FormData, so media upload uses fetch directly (same CSRF/cookie contract). */
async function uploadMedia(file: File): Promise<MediaDto | null> {
  const fd = new FormData();
  fd.append('file', file);
  const headers: Record<string, string> = { accept: 'application/json' };
  const csrf = getCsrfToken();
  if (csrf) headers['x-csrf-token'] = csrf;
  const res = await fetch('/api/v1/media', { method: 'POST', headers, credentials: 'include', body: fd });
  const payload: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (payload as { error?: ApiError } | null)?.error;
    throw new ApiRequestError(err?.code ?? 'UNKNOWN', err?.message ?? 'بارگذاری رسانه ناموفق بود.', res.status);
  }
  const data = (payload as { data: MediaResponse }).data;
  if (data.media) return data.media;
  if (data.id) return { id: data.id, filename: data.filename ?? '', mime: data.mime ?? '', sizeBytes: data.sizeBytes ?? 0 };
  return null;
}

export default function PostNew() {
  const toast = useToast();
  const navigate = useNavigate();
  const { id: editPostId } = useParams<{ id?: string }>();
  const editMode = Boolean(editPostId);

  const [channels, setChannels] = useState<ChannelDto[] | null>(null);
  const [channelsLoadError, setChannelsLoadError] = useState('');
  const [channelsReloadKey, setChannelsReloadKey] = useState(0);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [websiteDraftItems, setWebsiteDraftItems] = useState<WebsiteDraftItem[]>([]);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [parseMode, setParseMode] = useState<'NONE' | 'HTML' | 'MARKDOWN'>('NONE');
  const [editHydrated, setEditHydrated] = useState(false);
  const [editLoading, setEditLoading] = useState(false);

  const [mediaItems, setMediaItems] = useState<MediaDto[]>([]);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);

  const [buttonsByChannel, setButtonsByChannel] = useState<Record<string, ButtonRow[]>>({});
  const [footerTextByChannel, setFooterTextByChannel] = useState<Record<string, string>>({});
  const [rowsError, setRowsError] = useState('');

  const [scheduledAt, setScheduledAt] = useState<Date | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [scheduling, setScheduling] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ channels: ChannelDto[] }>('/api/v1/channels')
      .then((d) => {
        if (cancelled) return;
        const active = (d.channels ?? []).filter((c) => c.status === 'ACTIVE');
        setChannelsLoadError('');
        setChannels(active);
      })
      .catch((e) => {
        if (!cancelled) {
          setChannels([]);
          setChannelsLoadError(errText(e));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [channelsReloadKey]);

  useEffect(() => {
    if (!editPostId || channels === null) return;
    let cancelled = false;
    setEditLoading(true);
    api.get<EditablePostResponse>(`/api/v1/posts/${editPostId}`)
      .then(async (data) => {
        if (cancelled) return;
        const post = data.post;
        const scheduledTime = post.scheduledAt ? new Date(post.scheduledAt) : null;
        const activeTargets = data.targets.filter((target) => target.state !== 'CANCELLED');
        const editable = post.state === 'SCHEDULED'
          && scheduledTime !== null
          && !Number.isNaN(scheduledTime.getTime())
          && scheduledTime.getTime() > Date.now()
          && activeTargets.length > 0
          && activeTargets.every((target) => target.state === 'PENDING');
        if (!editable) {
          toast.error('فقط پست زمان‌بندی‌شدهٔ آینده که همهٔ مقصدهای آن هنوز در انتظار ارسال هستند قابل ویرایش است.');
          navigate(`/dashboard/posts/${editPostId}`, { replace: true });
          return;
        }

        const channelIds = activeTargets.map((target) => target.channelId);
        if (channelIds.some((channelId) => !channels.some((channel) => channel.id === channelId))) {
          toast.error('یکی از کانال‌های این زمان‌بندی دیگر فعال یا در دسترس نیست؛ برای جلوگیری از تغییر ناخواسته، ویرایش باز نشد.');
          navigate(`/dashboard/posts/${editPostId}`, { replace: true });
          return;
        }

        const hydratedMedia = data.mediaItems?.length ? data.mediaItems : data.media ? [data.media] : [];
        const expectedMediaIds = Array.isArray(post.mediaIds) && post.mediaIds.length
          ? post.mediaIds
          : post.mediaId ? [post.mediaId] : [];
        if (expectedMediaIds.length !== hydratedMedia.length || expectedMediaIds.some((mediaId) => !hydratedMedia.some((item) => item.id === mediaId))) {
          toast.error('رسانه‌های متصل به این پست کامل بازیابی نشدند؛ برای جلوگیری از حذف ناخواسته، ویرایش باز نشد.');
          navigate(`/dashboard/posts/${editPostId}`, { replace: true });
          return;
        }

        const buttons = post.buttonsJson;
        const legacyButtonsExist = Boolean(
          buttons && (
            Object.values(buttons.byPlatform ?? {}).some((rows) => Boolean(rows?.length))
            || buttons.inline?.length
            || buttons.links?.length
          )
        );
        if (legacyButtonsExist) {
          toast.error('ساختار دکمه‌های این پست با ویرایشگر کانال‌محور یکسان نیست؛ برای جلوگیری از حذف ناخواستهٔ دکمه‌ها، ویرایش باز نشد.');
          navigate('/dashboard/posts/' + editPostId, { replace: true });
          return;
        }
        const footerChannelIds = Object.keys(buttons?.footerByChannel ?? {});
        if (footerChannelIds.some((channelId) => !channelIds.includes(channelId))) {
          toast.error('متن انتهایی یکی از کانال‌های این پست دیگر قابل بازیابی در مقصدهای فعال نیست؛ برای جلوگیری از حذف ناخواسته، ویرایش باز نشد.');
          navigate('/dashboard/posts/' + editPostId, { replace: true });
          return;
        }

        const nextButtons: Record<string, ButtonRow[]> = {};
        for (const [channelId, rows] of Object.entries(buttons?.byChannel ?? {})) {
          const mapped: ButtonRow[] = [];
          for (const row of rows) {
            if (row.target && ['URL', 'PHONE', 'TELEGRAM_ID', 'BALE_ID', 'RUBIKA_ID'].includes(row.target.type)) {
              mapped.push({ label: row.label, targetType: row.target.type as ButtonRow['targetType'], value: row.target.value });
            } else if (row.url) {
              mapped.push({ label: row.label, targetType: 'URL', value: row.url });
            } else {
              toast.error('یکی از دکمه‌های قدیمی قابل بازسازی امن در ویرایشگر نیست؛ برای جلوگیری از حذف آن، ویرایش باز نشد.');
              navigate(`/dashboard/posts/${editPostId}`, { replace: true });
              return;
            }
          }
          nextButtons[channelId] = mapped;
        }

        setTitle(post.title ?? '');
        setBody(post.body ?? '');
        setParseMode(post.parseMode ?? 'NONE');
        setSelectedIds(channelIds);
        setButtonsByChannel(nextButtons);
        setFooterTextByChannel({ ...(buttons?.footerByChannel ?? {}) });
        setScheduledAt(scheduledTime);
        setMediaItems(hydratedMedia);
        const nextPreviewUrls: Record<string, string> = {};
        await Promise.all(hydratedMedia.filter((item) => item.mime.startsWith('image/')).map(async (item) => {
          try {
            const access = await api.get<{ url: string }>(`/api/v1/media/${item.id}/token`);
            nextPreviewUrls[item.id] = access.url;
          } catch {
            // Preview is optional; preserve the attached media even if token retrieval fails.
          }
        }));
        if (!cancelled) {
          setPreviewUrls(nextPreviewUrls);
          setEditHydrated(true);
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        toast.error(errText(error));
        navigate('/dashboard/posts', { replace: true });
      })
      .finally(() => {
        if (!cancelled) setEditLoading(false);
      });
    return () => { cancelled = true; };
  }, [editPostId, channels, navigate, toast]);

  const retryChannelsLoad = () => {
    setChannelsLoadError('');
    setChannels(null);
    setChannelsReloadKey((current) => current + 1);
  };

  const activeChannels = channels ?? [];
  const selectedChannels = useMemo(
    () => activeChannels.filter((c) => selectedIds.includes(c.id)),
    [activeChannels, selectedIds]
  );
  const toggleChannel = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const onFilesPicked = async (files: File[]) => {
    if (files.length === 0) return;
    const MAX_MEDIA_COUNT = 10;
    const MAX_MEDIA_FILE_BYTES = 8 * 1024 * 1024;
    const MAX_MEDIA_TOTAL_BYTES = 20 * 1024 * 1024;
    if (files.length + mediaItems.length > MAX_MEDIA_COUNT) {
      toast.error('برای هر پست حداکثر ۱۰ تصویر قابل انتخاب است.');
      return;
    }
    if (files.some((file) => file.size <= 0 || file.size > MAX_MEDIA_FILE_BYTES)) {
      toast.error('حجم هر فایل باید بیشتر از صفر و حداکثر ۸ مگابایت باشد.');
      return;
    }
    const hasExistingVideo = mediaItems.some((item) => item.mime === 'video/mp4');
    const hasNewVideo = files.some((file) => file.type === 'video/mp4');
    const hasNewNonImage = files.some((file) => !file.type.startsWith('image/') && file.type !== 'video/mp4');
    if (hasNewNonImage || (hasNewVideo && (files.length !== 1 || mediaItems.length > 0)) || (hasExistingVideo && files.length > 0)) {
      toast.error('یک ویدئوی MP4 باید به‌تنهایی انتخاب شود؛ ارسال همزمان چند فایل فقط برای تصاویر است.');
      return;
    }
    const existingSize = mediaItems.reduce((sum, item) => sum + item.sizeBytes, 0);
    if (existingSize + files.reduce((sum, file) => sum + file.size, 0) > MAX_MEDIA_TOTAL_BYTES) {
      toast.error('حجم مجموع رسانه‌های یک پست نباید بیشتر از ۲۰ مگابایت باشد.');
      return;
    }
    setUploading(true);
    const uploaded: MediaDto[] = [];
    const refreshPreviews = async (items: MediaDto[]) => {
      const nextPreviews: Record<string, string> = {};
      await Promise.all(items.filter((item) => item.mime.startsWith('image/')).map(async (item) => {
        try {
          const access = await api.get<{ url: string }>(`/api/v1/media/${item.id}/token`);
          nextPreviews[item.id] = access.url;
        } catch {
          // Preview is optional; uploaded media remains attached.
        }
      }));
      setPreviewUrls((current) => ({ ...current, ...nextPreviews }));
    };
    try {
      for (const file of files) {
        const item = await uploadMedia(file);
        if (!item) throw new ApiRequestError('MEDIA_UPLOAD_FAILED', 'بارگذاری یکی از فایل‌ها ناموفق بود.', 422);
        uploaded.push(item);
      }
      setMediaItems((current) => [...current, ...uploaded]);
      await refreshPreviews(uploaded);
      toast.success(`${faNumber(uploaded.length)} رسانه پیوست شد.`);
    } catch (error) {
      if (uploaded.length > 0) {
        setMediaItems((current) => [...current, ...uploaded]);
        await refreshPreviews(uploaded);
        toast.error(`${faNumber(uploaded.length)} فایل از ${faNumber(files.length)} فایل بارگذاری شد؛ بقیه ناموفق بود. ${errText(error)}`);
      } else {
        toast.error(errText(error));
      }
    } finally {
      setUploading(false);
    }
  };

  const removeMedia = (mediaId: string) => {
    setMediaItems((current) => current.filter((item) => item.id !== mediaId));
    setPreviewUrls((current) => {
      const next = { ...current };
      delete next[mediaId];
      return next;
    });
  };

  const validateRows = (): boolean => {
    for (const channel of selectedChannels) {
      const rows = buttonsByChannel[channel.id] ?? [];
      for (const row of rows) {
        const raw = row.value.trim();
        const value = normalizeButtonTarget(row.targetType, raw);
        if (row.label.trim() === '' && raw === '') continue;
        if (row.label.trim() === '' || raw === '') {
          setRowsError(`برای کانال «${channel.title}»، عنوان و مقصد هر دکمه را کامل کنید یا ردیف خالی را حذف کنید.`);
          return false;
        }
        if (row.targetType === 'URL' && !value) {
          setRowsError(`لینک دکمهٔ «${row.label.trim()}» برای کانال «${channel.title}» معتبر نیست. لینک را با http:// یا https:// وارد کنید؛ دامنهٔ ساده هم به‌صورت خودکار با https:// تکمیل می‌شود.`);
          return false;
        }
        if (row.targetType === 'PHONE' && !/^\+?[1-9]\d{6,14}$/.test(value)) {
          setRowsError(`شمارهٔ تلفن دکمهٔ «${row.label.trim()}» معتبر نیست.`);
          return false;
        }
        if (['TELEGRAM_ID', 'BALE_ID', 'RUBIKA_ID'].includes(row.targetType) && !/^[A-Za-z0-9_\u200c\u0600-\u06ff.]{2,190}$/.test(value)) {
          setRowsError(`شناسهٔ دکمهٔ «${row.label.trim()}» معتبر نیست. فقط شناسه را وارد کنید؛ @ در ابتدای شناسه اختیاری است.`);
          return false;
        }
      }
    }
    setRowsError('');
    return true;
  };

  const buildPayload = useCallback((forUpdate = false): Record<string, unknown> => {
    const payload: Record<string, unknown> = { body: body.trim(), parseMode };
    if (title.trim()) payload.title = title.trim();
    else if (forUpdate) payload.title = null;
    const selectedMediaIds = mediaItems.map((item) => item.id);
    payload.mediaIds = selectedMediaIds;
    if (selectedMediaIds.length > 0) payload.mediaId = selectedMediaIds[0];
    else if (forUpdate) payload.mediaId = null;
    const byChannel = selectedChannels.reduce<Record<string, Array<{ label: string; target: { type: ButtonRow['targetType']; value: string } }>>>((acc, channel) => {
      const rows = (buttonsByChannel[channel.id] ?? [])
        .map((row) => ({ label: row.label.trim(), target: { type: row.targetType, value: normalizeButtonTarget(row.targetType, row.value) } }))
        .filter((row) => row.label && row.target.value);
      if (rows.length > 0) acc[channel.id] = rows;
      return acc;
    }, {});
    const footerByChannel = selectedChannels.reduce<Record<string, string>>((acc, channel) => {
      const footer = (footerTextByChannel[channel.id] ?? '').trim();
      if (footer) acc[channel.id] = footer;
      return acc;
    }, {});
    const buttonsPayload: Record<string, unknown> = {};
    if (Object.keys(byChannel).length > 0) buttonsPayload.byChannel = byChannel;
    if (Object.keys(footerByChannel).length > 0) buttonsPayload.footerByChannel = footerByChannel;
    if (Object.keys(buttonsPayload).length > 0) payload.buttons = buttonsPayload;
    else if (forUpdate) payload.buttons = null;
    return payload;
  }, [body, parseMode, title, mediaItems, selectedChannels, buttonsByChannel, footerTextByChannel]);

  const buildWebsitePayload = async (item: WebsiteDraftItem): Promise<Record<string, unknown>> => {
    const payload = buildPayload();
    if (item.title.trim()) payload.title = item.title.trim();
    else delete payload.title;
    payload.body = item.body.trim();
    payload.parseMode = 'NONE';
    // Remote WordPress/WooCommerce image URLs cannot be sent reliably to every
    // provider. Import the database-owned source image into private Postyar
    // media first, then use the normal delivery worker's mediaId path.
    delete payload.mediaId;
    delete payload.mediaIds;
    if (item.imageUrl.trim()) {
      const imported = await api.post<{ media: MediaDto }>('/api/v1/wordpress/import-featured-image', {
        siteId: item.siteId,
        itemType: item.type,
        sourceId: item.sourceId,
      });
      if (!imported.media?.id) throw new ApiRequestError('MEDIA_IMPORT_FAILED', `دریافت تصویر شاخص «${item.title || 'محتوای انتخاب‌شده'}» کامل نشد.`, 422);
      payload.mediaId = imported.media.id;
      payload.mediaIds = [imported.media.id];
    }
    const currentButtons = (payload.buttons && typeof payload.buttons === 'object' ? payload.buttons : {}) as { byChannel?: Record<string, Array<{ label: string; target: { type: string; value: string } }>>; footerByChannel?: Record<string, string> };
    const byChannel = { ...(currentButtons.byChannel ?? {}) };
    const targetValue = item.buttonUrl.trim() ? normalizeButtonTarget('URL', item.buttonUrl) : '';
    if (item.buttonLabel.trim() && targetValue) {
      for (const channel of selectedChannels) {
        const rows = [...(byChannel[channel.id] ?? [])];
        const alreadyHasTarget = rows.some((row) => row.target?.type === 'URL' && normalizeButtonTarget('URL', row.target.value) === targetValue);
        if (!alreadyHasTarget) rows.push({ label: item.buttonLabel.trim().slice(0, 64), target: { type: 'URL', value: targetValue } });
        byChannel[channel.id] = rows;
      }
    }
    const nextButtons: Record<string, unknown> = {};
    if (Object.keys(byChannel).length > 0) nextButtons.byChannel = byChannel;
    if (Object.keys(currentButtons.footerByChannel ?? {}).length > 0) nextButtons.footerByChannel = currentButtons.footerByChannel;
    if (Object.keys(nextButtons).length > 0) payload.buttons = nextButtons;
    else delete payload.buttons;
    return payload;
  };

  const createPost = useCallback(async (payload?: Record<string, unknown>): Promise<string | null> => {
    const data = await api.post<{ post: { id: string } }>('/api/v1/posts', payload ?? buildPayload());
    return data.post?.id ?? null;
  }, [buildPayload]);

  const guard = (): boolean => {
    if (websiteDraftItems.length === 0 && body.trim() === '' && mediaItems.length === 0) {
      toast.error('پست باید حداقل متن یا رسانه داشته باشد؛ یا از بخش انتخاب محصول/مقاله محتوا انتخاب کنید.');
      return false;
    }
    if (selectedIds.length === 0) {
      toast.error('حداقل یک کانال برای انتشار انتخاب کنید.');
      return false;
    }
    const footerBodies = websiteDraftItems.length > 0 ? websiteDraftItems.map((item) => item.body.trim()) : [body.trim()];
    for (const channel of selectedChannels) {
      const footer = (footerTextByChannel[channel.id] ?? '').trim();
      if (footer.length > MAX_CHANNEL_FOOTER) {
        toast.error('متن انتهایی کانال «' + channel.title + '» نباید بیشتر از ' + MAX_CHANNEL_FOOTER + ' نویسه باشد.');
        return false;
      }
      if (footer && footerBodies.some((base) => base.length + (base ? 2 : 0) + footer.length > MAX_BODY)) {
        toast.error('مجموع متن پایه و متن انتهایی کانال «' + channel.title + '» نباید از ' + MAX_BODY + ' نویسه بیشتر شود.');
        return false;
      }
    }
    if (websiteDraftItems.length > 20) {
      toast.error('در هر نوبت حداکثر ۲۰ محصول یا مقاله انتخاب کنید.');
      return false;
    }
    if (websiteDraftItems.length > 0) {
      for (const item of websiteDraftItems) {
        if (!item.body.trim()) {
          toast.error(`متن پست «${item.title || 'مورد انتخاب‌شده'}» خالی است؛ برای انتشار یا زمان‌بندی، متن را وارد کنید.`);
          return false;
        }
        const label = item.buttonLabel.trim();
        const rawUrl = item.buttonUrl.trim();
        if (Boolean(label) !== Boolean(rawUrl)) {
          toast.error(`عنوان و پیوند دکمه برای «${item.title || 'مورد انتخاب‌شده'}» باید هر دو تکمیل یا هر دو خالی باشند.`);
          return false;
        }
        if (rawUrl && !normalizeButtonTarget('URL', rawUrl)) {
          toast.error(`پیوند دکمهٔ «${item.title}» معتبر نیست.`);
          return false;
        }
        if (rawUrl && selectedChannels.some((channel) => (buttonsByChannel[channel.id] ?? []).filter((row) => row.label.trim() && normalizeButtonTarget(row.targetType, row.value)).length >= 8)) {
          toast.error('برای هر کانال حداکثر ۸ دکمه قابل ارسال است. یک دکمه از تنظیمات کانال حذف کنید یا دکمهٔ محصول را خالی بگذارید.');
          return false;
        }
      }
    }
    if (!validateRows()) return false;
    return true;
  };

  const publishNow = async () => {
    if (!guard()) return;
    setPublishing(true);
    try {
      if (websiteDraftItems.length > 0) {
        let created = 0;
        let queued = 0;
        const ids: string[] = [];
        try {
          for (const item of websiteDraftItems) {
            const id = await createPost(await buildWebsitePayload(item));
            if (!id) throw new ApiRequestError('UNKNOWN', 'ساخت یکی از پست‌ها ناموفق بود.', 500);
            created++;
            ids.push(id);
            await api.post(`/api/v1/posts/${id}/publish`, { channelIds: selectedIds });
            queued++;
          }
        } catch (error) {
          if (created === 0) throw error;
          toast.error(`اجرای گروهی متوقف شد: ${faNumber(queued)} مورد در صف قرار گرفت و ${faNumber(created - queued)} پست ایجاد شد اما پذیرش انتشار آن تأیید نشد. از اجرای دوباره خودداری کنید؛ وضعیت را در فهرست پست‌ها بررسی کنید. ${errText(error)}`);
          navigate('/dashboard/posts');
          return;
        }
        toast.success(`${faNumber(queued)} پست مستقل برای انتشار در صف قرار گرفت.`);
        navigate(queued === 1 && ids[0] ? `/dashboard/posts/${ids[0]}` : '/dashboard/posts');
        return;
      }
      const id = await createPost();
      if (!id) throw new ApiRequestError('UNKNOWN', 'ساخت پست ناموفق بود.', 500);
      await api.post(`/api/v1/posts/${id}/publish`, { channelIds: selectedIds });
      toast.success('پست برای انتشار ارسال شد و در صف پردازش قرار گرفت.');
      navigate(`/dashboard/posts/${id}`);
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setPublishing(false);
    }
  };

  const schedule = async () => {
    if (!guard()) return;
    if (!scheduledAt) {
      toast.error('تاریخ و ساعت انتشار را مشخص کنید.');
      return;
    }
    const when = scheduledAt;
    if (!when || Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) {
      toast.error('زمان انتشار باید در آینده باشد.');
      return;
    }
    setScheduling(true);
    try {
      if (editPostId) {
        const payload = buildPayload(true);
        payload.channelIds = selectedIds;
        payload.scheduledAt = when.toISOString();
        await api.put(`/api/v1/posts/${editPostId}/schedule`, payload);
        toast.success('تغییرات زمان‌بندی با موفقیت ذخیره شد.');
        navigate(`/dashboard/posts/${editPostId}`);
      } else if (websiteDraftItems.length > 0) {
        let created = 0;
        let scheduled = 0;
        const ids: string[] = [];
        try {
          for (const item of websiteDraftItems) {
            const id = await createPost(await buildWebsitePayload(item));
            if (!id) throw new ApiRequestError('UNKNOWN', 'ساخت یکی از پست‌ها ناموفق بود.', 500);
            created++;
            ids.push(id);
            await api.post(`/api/v1/posts/${id}/schedule`, { channelIds: selectedIds, scheduledAt: when.toISOString() });
            scheduled++;
          }
        } catch (error) {
          if (created === 0) throw error;
          toast.error(`زمان‌بندی گروهی متوقف شد: ${faNumber(scheduled)} مورد زمان‌بندی شد و ${faNumber(created - scheduled)} پست ایجاد شد اما پذیرش زمان‌بندی آن تأیید نشد. از اجرای دوباره خودداری کنید؛ وضعیت را در فهرست پست‌ها بررسی کنید. ${errText(error)}`);
          navigate('/dashboard/posts');
          return;
        }
        toast.success(`${faNumber(scheduled)} پست مستقل برای زمان ${faDigits(when.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }))} زمان‌بندی شد.`);
        navigate(scheduled === 1 && ids[0] ? `/dashboard/posts/${ids[0]}` : '/dashboard/posts');
      } else {
        const id = await createPost();
        if (!id) throw new ApiRequestError('UNKNOWN', 'ساخت پست ناموفق بود.', 500);
        await api.post(`/api/v1/posts/${id}/schedule`, { channelIds: selectedIds, scheduledAt: when.toISOString() });
        toast.success('پست با موفقیت زمان‌بندی شد.');
        navigate(`/dashboard/posts/${id}`);
      }
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setScheduling(false);
    }
  };

  if (channels === null || editLoading || (editMode && !editHydrated)) return <PageLoading />;

  if (channelsLoadError) {
    return (
      <EmptyState
        icon="⚠️"
        title="بارگذاری کانال‌ها ناموفق بود"
        description={`فهرست کانال‌ها دریافت نشد. ${channelsLoadError} اتصال را بررسی کنید و دوباره تلاش کنید.`}
        action={<Button onClick={retryChannelsLoad}>تلاش مجدد</Button>}
      />
    );
  }

  if (activeChannels.length === 0) {
    return (
      <EmptyState
        icon="📻"
        title="کانال فعالی ندارید"
        description="برای ساخت و انتشار پست، ابتدا یک کانال فعال در بخش مدیریت کانال‌ها ثبت کنید."
        action={<a href="/dashboard/channels" className="btn btn-primary">رفتن به مدیریت کانال‌ها</a>}
      />
    );
  }

  return (
    <div style={{ display: 'grid', gap: 18, maxWidth: 860 }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 4px' }}>{editMode ? 'ویرایش زمان‌بندی' : 'ساخت پست جدید'}</h1>
        <p style={{ color: 'var(--text-2)', fontSize: 13, margin: 0 }}>{editMode ? 'متن، رسانه، دکمه‌ها، کانال‌های مقصد و زمان انتشار را تغییر دهید؛ فقط تا پیش از شروع ارسال.' : 'متن پست را بنویسید، رسانه پیوست کنید و کانال‌های مقصد را انتخاب کنید.'}</p>
      </div>

      <WebsiteContentPicker selectedItems={websiteDraftItems} onChange={setWebsiteDraftItems} disabled={editMode || publishing || scheduling} />

      {websiteDraftItems.length > 0 ? (
        <Card pad="lg"><strong>{faNumber(websiteDraftItems.length)} مورد انتخاب شده</strong><p style={{ margin: '6px 0 0', color: 'var(--text-2)', fontSize: 13, lineHeight: 1.9 }}>هر مورد به‌صورت یک پست جداگانه با عنوان، متن و دکمهٔ اختصاصی ارسال می‌شود. دکمه‌های کانال‌محور پایین در کنار دکمهٔ هر مورد قرار می‌گیرند.</p><Button size="sm" variant="ghost" onClick={() => setWebsiteDraftItems([])}>لغو انتخاب و ساخت پست معمولی</Button></Card>
      ) : (
      <Card pad="lg">
        <Field label="عنوان (اختیاری)">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={190} placeholder="عنوان پست" />
        </Field>
        <Field label="متن پست" required hint={`${faDigits(body.length)} از ${faDigits(MAX_BODY)} نویسه`}>
          <ContentComposerTextarea
            value={body}
            onChange={(e) => setBody(e.target.value.slice(0, MAX_BODY))}
            maxLength={MAX_BODY}
            placeholder="متن پست را اینجا بنویسید…"
            aria-label="متن پست"
          />
        </Field>

        <Field label="رسانه (تصاویر یا یک ویدیو)" hint="حداکثر ۱۰ تصویر، ۸ مگابایت برای هر فایل و ۲۰ مگابایت برای مجموع رسانه‌ها؛ ویدیو باید به‌تنهایی باشد.">
          {mediaItems.length > 0 && (
            <div style={{ display: 'grid', gap: 10 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(115px, 1fr))', gap: 10 }}>
                {mediaItems.map((item, index) => (
                  <div key={item.id} style={{ minWidth: 0, border: '1px solid var(--border)', borderRadius: 10, padding: 8, display: 'grid', gap: 6 }}>
                    {previewUrls[item.id] ? (
                      <img
                        src={previewUrls[item.id]}
                        alt={`پیش‌نمایش تصویر ${faNumber(index + 1)}`}
                        style={{ width: '100%', height: 82, objectFit: 'cover', borderRadius: 6 }}
                      />
                    ) : (
                      <div style={{ height: 82, display: 'grid', placeItems: 'center', borderRadius: 6, background: 'var(--surface-2, var(--border))', color: 'var(--text-2)', fontSize: 12 }}>
                        {item.mime === 'video/mp4' ? 'ویدیو' : 'پیش‌نمایش در دسترس نیست'}
                      </div>
                    )}
                    <span dir="ltr" style={{ color: 'var(--text-2)', fontSize: 12, overflowWrap: 'anywhere' }}>{item.filename}</span>
                    <span style={{ color: 'var(--text-2)', fontSize: 11 }}>({faNumber(item.sizeBytes)} بایت)</span>
                    <Button size="sm" variant="ghost" disabled={uploading} onClick={() => removeMedia(item.id)}>حذف</Button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {mediaItems.length < 10 && !mediaItems.some((item) => item.mime === 'video/mp4') && (
            <label className="btn btn-ghost" style={{ justifyContent: 'center', cursor: uploading ? 'wait' : 'pointer', marginTop: mediaItems.length ? 10 : 0 }}>
              {uploading ? <Spinner /> : mediaItems.length ? 'افزودن تصویر' : '📎 انتخاب تصویر یا ویدیو'}
              <input
                type="file"
                accept={mediaItems.length ? 'image/*' : 'image/*,video/mp4'}
                multiple
                style={{ display: 'none' }}
                disabled={uploading}
                onChange={(e) => {
                  void onFilesPicked(Array.from(e.target.files ?? []));
                  e.target.value = '';
                }}
              />
            </label>
          )}
        </Field>
      </Card>
      )}

      <Card pad="lg">
        <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>انتخاب کانال‌های مقصد</h3>
        <div role="group" aria-label="کانال‌های مقصد" style={{ display: 'grid', gap: 10, gridTemplateColumns: 'minmax(0, 1fr)' }}>
          {activeChannels.map((ch) => (
            <label
              key={ch.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                border: `1px solid ${selectedIds.includes(ch.id) ? 'var(--brand)' : 'var(--border)'}`,
                borderRadius: 10, cursor: 'pointer', background: selectedIds.includes(ch.id) ? 'var(--brand-soft)' : 'var(--surface)',
              }}
            >
              <input
                type="checkbox"
                checked={selectedIds.includes(ch.id)}
                onChange={() => toggleChannel(ch.id)}
                style={{ width: 16, height: 16, accentColor: 'var(--brand)' }}
              />
              <span style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <PlatformBadge platform={ch.platform} />
                <span style={{ fontWeight: 600, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ch.title}</span>
              </span>
            </label>
          ))}
        </div>
      </Card>

      <Card pad="lg">
        <h3 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 700 }}>دکمه‌ها و متن انتهایی اختصاصی کانال‌ها</h3>
        <p style={{ margin: '0 0 12px', fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.9 }}>
          متن اصلی را یک‌بار بنویسید؛ سپس برای هر کانال، متن یا لینک انتهایی جداگانه تنظیم کنید. متن انتهایی فقط به همان کانال افزوده می‌شود. دکمه‌ها و کتابخانهٔ ذخیره‌شدهٔ هر کانال هم مثل قبل مستقل هستند. برای تشخیص بهتر لینک، واردکردن نشانی کامل مانند https://example.com پیشنهاد می‌شود.
        </p>
        {selectedChannels.length > 0 && (
          <div style={{ display: 'grid', gap: 10, marginBottom: 14 }}>
            {selectedChannels.map((channel) => {
              const footer = footerTextByChannel[channel.id] ?? '';
              const fieldId = 'channel-footer-' + channel.id;
              return <label key={'footer-' + channel.id} htmlFor={fieldId} style={{ display: 'grid', gap: 6, padding: 10, border: '1px solid var(--border)', borderRadius: 10, minWidth: 0 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontWeight: 700, fontSize: 13 }}>
                  <PlatformBadge platform={channel.platform} />
                  <span>متن انتهایی — {channel.title}</span>
                </span>
                <textarea id={fieldId} value={footer} maxLength={MAX_CHANNEL_FOOTER} rows={2} disabled={publishing || scheduling} placeholder="مثلاً @admin یا https://example.com" onChange={(event) => setFooterTextByChannel((current) => ({ ...current, [channel.id]: event.target.value.slice(0, MAX_CHANNEL_FOOTER) }))} style={{ width: '100%', boxSizing: 'border-box', minHeight: 66, padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)', color: 'var(--text)', font: 'inherit', fontSize: 13, lineHeight: 1.8, resize: 'vertical' }} />
                <small style={{ color: 'var(--text-2)', fontSize: 11.5 }}>{faDigits(footer.length)} از {faDigits(MAX_CHANNEL_FOOTER)} نویسه؛ این متن در انتهای پیام همان کانال درج می‌شود.</small>
              </label>;
            })}
          </div>
        )}
        {selectedChannels.length === 0 ? (
          <div style={{ background: 'var(--surface-2)', color: 'var(--text-2)', borderRadius: 10, padding: '9px 12px', fontSize: 12.5 }}>
            ابتدا حداقل یک کانال مقصد را انتخاب کنید.
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {selectedChannels.map((channel) => (
              <ChannelButtonEditor
                key={channel.id}
                channel={channel}
                rows={buttonsByChannel[channel.id] ?? []}
                onRowsChange={(rows) => setButtonsByChannel((current) => ({ ...current, [channel.id]: rows }))}
                onValidationError={setRowsError}
              />
            ))}
          </div>
        )}
        {rowsError && <div className="field-error" role="alert" style={{ marginTop: 8 }}>{rowsError}</div>}
      </Card>

      {selectedChannels.length > 0 && (
        <Card pad="lg">
          <h3 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 700 }}>پیش‌نمایش پیام به تفکیک کانال</h3>
          <p style={{ margin: '0 0 12px', color: 'var(--text-2)', fontSize: 12.5, lineHeight: 1.9 }}>
            {websiteDraftItems.length > 0 ? 'این پیش‌نمایش برای هر مورد انتخاب‌شده جداگانه ساخته می‌شود؛ دکمه‌های عمومی کانال نیز به هر پست افزوده می‌شوند.' : 'این پیش‌نمایش فقط خواندنی است. عنوان اختیاری برای شناسایی پست در پنل است؛ متن ارسالی از بخش «متن پست» ساخته می‌شود. چیدمان دکمه‌ها بر اساس رفتار فعلی هر پلتفرم نمایش داده شده است.'}
          </p>
          <div style={{ display: 'grid', gap: 12 }}>
            {selectedChannels.map((channel) => {
              const previewRows = (buttonsByChannel[channel.id] ?? [])
                .filter((row) => row.label.trim() && normalizeButtonTarget(row.targetType, row.value));
              return (
                <section key={`preview-${channel.id}`} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 12, display: 'grid', gap: 8, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: 13 }}>{channel.title}</strong>
                    <span style={{ fontSize: 11.5, color: 'var(--text-2)' }}>{PLATFORM_FA[channel.platform]}</span>
                  </div>
                  <div dir="auto" style={{ borderRadius: 10, padding: 12, background: 'var(--surface-2)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 13.5, lineHeight: 2 }}>
                    {websiteDraftItems.length > 0 ? <span>{faNumber(websiteDraftItems.length)} مورد از وب‌سایت آمادهٔ انتشار است؛ عنوان و متن هر مورد در بخش انتخاب محتوا قابل ویرایش است.</span> : body.trim() ? body.trim() : <span style={{ color: 'var(--text-2)' }}>بدون متن</span>}
                    {(footerTextByChannel[channel.id] ?? '').trim() && (
                      <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px dashed var(--border)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                        {(footerTextByChannel[channel.id] ?? '').trim()}
                      </div>
                    )}
                    {mediaItems[0] && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--border)', fontSize: 12 }}>
                        {mediaItems[0].mime.startsWith('image/') && previewUrls[mediaItems[0].id]
                          ? <img src={previewUrls[mediaItems[0].id]} alt={`پیش‌نمایش رسانه برای ${channel.title}`} style={{ width: 64, height: 48, objectFit: 'cover', borderRadius: 6 }} />
                          : <span aria-hidden="true">{mediaItems[0].mime.startsWith('video/') ? 'ویدیو' : 'رسانه'}</span>}
                        <span style={{ overflowWrap: 'anywhere' }}>{mediaItems.length > 1 ? `${faNumber(mediaItems.length)} رسانه: ` : ''}{mediaItems[0].filename}</span>
                      </div>
                    )}
                    {channel.platform === 'rubika' && previewRows.length > 0 && (
                      <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--border)', display: 'grid', gap: 4 }}>
                        {previewRows.map((row, index) => (
                          <span key={`${channel.id}-rubika-preview-${index}`} style={{ color: 'var(--brand)', fontWeight: 600 }}>{row.label.trim()}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  {channel.platform !== 'rubika' && previewRows.length > 0 && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6 }}>
                      {previewRows.map((row, index) => (
                        <div key={`${channel.id}-button-preview-${index}`} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '7px 9px', minWidth: 0, textAlign: 'center', background: 'var(--surface)' }}>
                          <strong style={{ display: 'block', fontSize: 12, overflowWrap: 'anywhere' }}>{row.label.trim()}</strong>
                          <small style={{ display: 'block', marginTop: 3, color: 'var(--text-2)', fontSize: 10 }}>مقصد</small>
                          <small dir="ltr" style={{ display: 'block', marginTop: 1, color: 'var(--text-2)', fontSize: 10, overflowWrap: 'anywhere', textAlign: 'left' }}>{previewButtonDestination(channel.platform, row)}</small>
                        </div>
                      ))}
                    </div>
                  )}
                  {channel.platform === 'rubika' && previewRows.length > 0 && (
                    <div style={{ display: 'grid', gap: 6 }}>
                      <small style={{ color: 'var(--text-2)', fontSize: 11, lineHeight: 1.8 }}>
                        در روبیکا، عنوان هر پیوند در متن پیام قرار می‌گیرد؛ این پیش‌نمایش آن‌ها را به‌اشتباه به‌صورت صفحه‌کلید دکمه‌ای نشان نمی‌دهد. مقصدهای زیر فقط برای بررسی هستند و به‌صورت متن در پیام درج نمی‌شوند.
                      </small>
                      {previewRows.map((row, index) => (
                        <div key={`${channel.id}-rubika-destination-${index}`} style={{ display: 'grid', gap: 2, borderTop: '1px solid var(--border)', paddingTop: 5 }}>
                          <strong style={{ fontSize: 11, overflowWrap: 'anywhere' }}>{row.label.trim()}</strong>
                          <small dir="ltr" style={{ color: 'var(--text-2)', fontSize: 10, overflowWrap: 'anywhere', textAlign: 'left' }}>{previewButtonDestination(channel.platform, row)}</small>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        </Card>
      )}

      <Card pad="lg">
        <Field label="تاریخ و ساعت انتشار (برای زمان‌بندی)" hint="تقویم شمسی — این فیلد فقط برای «زمان‌بندی» استفاده می‌شود.">
          <JalaliDateTimePicker value={scheduledAt} onChange={setScheduledAt} restrictToFuture />
        </Field>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 6 }}>
          {!editMode && <Button onClick={() => void publishNow()} loading={publishing}>🚀 انتشار فوری</Button>}
          <Button variant="soft" onClick={() => void schedule()} loading={scheduling}>{editMode ? 'ذخیره تغییرات زمان‌بندی' : '⏰ زمان‌بندی'}</Button>
          {editMode && <Button variant="ghost" onClick={() => navigate(`/dashboard/posts/${editPostId}`)}>انصراف</Button>}
        </div>
      </Card>
    </div>
  );
}
