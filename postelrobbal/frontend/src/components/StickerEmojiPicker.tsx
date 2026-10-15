import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiRequestError } from '../lib/api';
import { EMOJI_GROUPS } from '../emoji-library';

type StickerSet = { id: string; telegramName: string; title: string; stickerType: string };
type Sticker = { id: string; emoji?: string | null; stickerType: string; positionIndex: number };

type Props = {
  onSelectEmoji: (emoji: string) => void;
  onSelectSticker?: (sticker: Sticker & { setId: string; setTitle: string }) => void;
  label?: string;
};

const TAB_EMOJI = 'emoji';
const TAB_STICKER = 'sticker';

function pickerErrorText(error: unknown, fallback: string): string {
  if (!(error instanceof ApiRequestError)) return fallback;
  return `${error.message}${error.requestId ? ` (شناسهٔ پیگیری: ${error.requestId})` : ''}`;
}

export function StickerEmojiPicker({ onSelectEmoji, onSelectSticker, label = 'ایموجی و استیکر' }: Props) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<string>(TAB_EMOJI);
  const [emojiGroup, setEmojiGroup] = useState(Object.keys(EMOJI_GROUPS)[0] ?? '');
  const [sets, setSets] = useState<StickerSet[]>([]);
  const [activeSet, setActiveSet] = useState<{ set: StickerSet; stickers: Sticker[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingSets, setLoadingSets] = useState(false);
  const [setsLoaded, setSetsLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const loadSets = useCallback(async (force = false) => {
    if (setsLoaded && !force) return;
    setLoadingSets(true);
    setLoadError(null);
    try {
      const data = await api.get<{ sets?: StickerSet[] }>('/api/v1/stickers/telegram/sets');
      const nextSets = data.sets ?? [];
      setSets(nextSets);
      if (nextSets[0] && (!activeSet || !nextSets.some((set) => set.id === activeSet.set.id))) {
        const detail = await api.get<{ set: StickerSet; stickers: Sticker[] }>(`/api/v1/stickers/telegram/sets/${nextSets[0].id}`);
        setActiveSet(detail);
      } else if (!nextSets.length) {
        setActiveSet(null);
      }
      setSetsLoaded(true);
    } catch (err) {
      setLoadError(pickerErrorText(err, 'بارگذاری کتابخانه استیکرها انجام نشد. دوباره تلاش کنید.'));
    } finally {
      setLoadingSets(false);
    }
  }, [activeSet, setsLoaded]);

  useEffect(() => { if (open && tab === TAB_STICKER) void loadSets(); }, [open, tab, loadSets]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const emojis = useMemo(() => EMOJI_GROUPS[emojiGroup as keyof typeof EMOJI_GROUPS] ?? [], [emojiGroup]);

  const openSet = async (set: StickerSet) => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await api.get<{ set: StickerSet; stickers: Sticker[] }>(`/api/v1/stickers/telegram/sets/${set.id}`);
      setActiveSet(data);
    } catch (err) {
      setLoadError(pickerErrorText(err, 'دریافت این مجموعه استیکر ناموفق بود.'));
    } finally { setLoading(false); }
  };

  return (
    <div ref={rootRef} className="content-tools" style={{ position: 'relative', display: 'inline-block' }}>
      <button type="button" className="content-tools-trigger" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(v => !v)} title={label}><span aria-hidden="true">😊</span><span>{label}</span></button>
      {open && (
        <div className="content-tools-popover" role="dialog" aria-label={label}>
          <div className="content-tools-head">
            <div className="content-tools-tabs">
              <button className={tab === TAB_EMOJI ? 'active' : ''} onClick={() => setTab(TAB_EMOJI)} type="button">ایموجی</button>
              <button className={tab === TAB_STICKER ? 'active' : ''} onClick={() => setTab(TAB_STICKER)} type="button">استیکر</button>
            </div>
            <button type="button" className="content-tools-close" onClick={() => setOpen(false)} aria-label="بستن">✕</button>
          </div>

          {tab === TAB_EMOJI ? (
            <div className="emoji-picker-body">
              <div className="emoji-categories">{Object.keys(EMOJI_GROUPS).map(group => (
                <button key={group} type="button" className={group === emojiGroup ? 'active' : ''} onClick={() => setEmojiGroup(group)} title={group}>{group.slice(0, 2)}</button>
              ))}</div>
              <div className="emoji-grid">{emojis.map((emoji, i) => <button key={`${emoji}-${i}`} type="button" onClick={() => onSelectEmoji(emoji)} aria-label={emoji}>{emoji}</button>)}</div>
            </div>
          ) : (
            <div className="sticker-picker-body">
              {loadingSets ? <div className="sticker-picker-loading" role="status">در حال بارگذاری مجموعه‌های استیکر…</div> : loadError ? <div className="sticker-picker-error" role="alert"><p>{loadError}</p><button type="button" onClick={() => void loadSets(true)}>تلاش دوباره</button></div> : (
                <>
                  <div className="sticker-pack-tabs">
                    {sets.length === 0 ? <div className="sticker-picker-empty">هنوز مجموعه‌ای در کتابخانه شما نیست. از بخش «کتابخانه استیکرها» یک مجموعه اضافه کنید.</div> : sets.map(set => <button key={set.id} type="button" className={activeSet?.set.id === set.id ? 'active' : ''} onClick={() => void openSet(set)}>{set.title}</button>)}
                  </div>
                  {loading ? <div className="sticker-picker-loading" role="status">در حال دریافت استیکرها…</div> : activeSet ? <div className="sticker-picker-grid">{activeSet.stickers.map(sticker => <button key={sticker.id} type="button" className="sticker-picker-item" onClick={() => { onSelectSticker?.({ ...sticker, setId: activeSet.set.id, setTitle: activeSet.set.title }); setOpen(false); }}><img src={`/api/v1/stickers/telegram/${sticker.id}/file`} alt={sticker.emoji ?? 'استیکر'} loading="lazy" />{sticker.emoji && <span>{sticker.emoji}</span>}</button>)}</div> : null}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
