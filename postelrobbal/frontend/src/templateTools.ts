import { onRouteChange } from './lib/routeEvents';

/*
 * Postyar — content composer tools.
 *
 * Scope is intentionally limited to the content composer on:
 *   /dashboard/posts/new
 *   /dashboard/gold
 *
 * Ready-made message templates live in the WooCommerce center. This module
 * only owns composer media helpers (emoji/sticker).
 */

const STYLE_ID = 'postyar-content-tools-v4-style';
const TOOLBAR_CLASS = 'postyar-content-tools-row';
const POPUP_CLASS = 'postyar-content-tools-popup';
const FIELD_MARKER = 'data-postyar-content-tools';
const CONTENT_PATHS = new Set(['/dashboard/posts/new', '/dashboard/gold']);

let activePopup: HTMLElement | null = null;
let activeField: HTMLTextAreaElement | null = null;
let activeCleanup: (() => void) | null = null;
let lastPath = '';
let emojiGroupsCache: Record<string, string[]> | null = null;
let stickerSetsCache: Array<Record<string, unknown>> | null = null;
const stickerDetailsCache = new Map<string, { stickers: Array<Record<string, unknown>>; set: Record<string, unknown> }>();


function insertText(field: HTMLTextAreaElement, text: string): void {
  if (!field.isConnected) return;
  field.focus();
  const start = field.selectionStart ?? field.value.length;
  const end = field.selectionEnd ?? field.value.length;
  field.setRangeText(text, start, end, 'end');
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

function injectStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.postyar-content-tools-row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;width:100%;margin-top:10px;direction:rtl;clear:both}
.postyar-content-tools-row--gold{grid-template-columns:minmax(0,1fr)}
.postyar-content-tools-card{min-width:0}
.postyar-content-tools-button{width:100%;min-height:46px;padding:9px 12px;border:1px solid var(--border,#e5e7eb);border-radius:14px;background:var(--surface,#fff);color:var(--text,#222);box-shadow:0 3px 14px rgba(26,18,35,.06);display:flex;align-items:center;justify-content:center;gap:8px;font:inherit;font-size:13px;font-weight:800;line-height:1.4;cursor:pointer;box-sizing:border-box}
.postyar-content-tools-button:hover{transform:translateY(-1px);box-shadow:0 7px 20px rgba(26,18,35,.1)}
.postyar-content-tools-button:focus-visible{outline:3px solid rgba(124,58,237,.18);outline-offset:2px}
.postyar-content-tools-button__icon{width:27px;height:27px;flex:0 0 27px;display:grid;place-items:center;border-radius:9px;font-size:16px;line-height:1;background:var(--surface-2,#f3f4f6)}
.postyar-content-tools-button__text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.postyar-content-tools-popup{position:fixed;left:10px;top:10px;width:min(860px,calc(100vw - 24px));max-height:min(860px,90vh);display:flex;flex-direction:column;background:#fff;border:1px solid rgba(80,60,120,.14);border-radius:20px;box-shadow:0 28px 100px rgba(18,12,30,.24);z-index:2147483100;overflow:hidden;direction:rtl;box-sizing:border-box}
.postyar-content-tools-popup__head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 14px;border-bottom:1px solid #eee;background:#fff}
.postyar-content-tools-popup__head strong{font-size:14px}
.postyar-content-tools-popup__close{width:34px;height:34px;border:0;background:transparent;color:#4b4650;font-size:21px;cursor:pointer;border-radius:10px}
.postyar-content-tools-popup__close:hover{background:#f4f1f7}
.postyar-content-tools-popup__body{overflow:auto;padding:12px;overscroll-behavior:contain}
.postyar-content-tools-popup__note{background:#faf8ff;border:1px solid #eee7fb;color:#6b5b7c;border-radius:12px;padding:10px 12px;font-size:11.5px;line-height:1.9;margin-bottom:10px}
.postyar-content-tools-popup__tabs{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:10px}
.postyar-content-tools-popup__tabs button,.postyar-content-tools-popup__cats button,.postyar-content-tools-popup__packs button{font:inherit;cursor:pointer}
.postyar-content-tools-popup__tabs button{border:1px solid #ece8f0;background:#fff;color:#625b69;border-radius:11px;padding:9px 10px;font-weight:800}
.postyar-content-tools-popup__tabs button.active{background:#f4efff;border-color:#ded1f8;color:#6d28d9}
.postyar-content-tools-popup__cats,.postyar-content-tools-popup__packs{display:flex;gap:6px;overflow:auto;margin-bottom:10px;scrollbar-width:thin}
.postyar-content-tools-popup__cats button,.postyar-content-tools-popup__packs button{flex:0 0 auto;border:1px solid #ece8f0;background:#fff;color:#625b69;border-radius:10px;padding:8px 11px;white-space:nowrap}
.postyar-content-tools-popup__cats button.active,.postyar-content-tools-popup__packs button.active{background:#f0e8ff;border-color:#ded1f8;color:#6d28d9;font-weight:800}
.postyar-content-tools-emoji-grid{display:grid;grid-template-columns:repeat(9,minmax(0,1fr));gap:5px}
.postyar-content-tools-emoji-grid button{aspect-ratio:1;min-width:0;border:1px solid #f0edf3;background:#fff;border-radius:10px;font-size:23px;line-height:1;cursor:pointer}
.postyar-content-tools-emoji-grid button:hover{background:#f8f5fb}
.postyar-content-tools-sticker-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}
.postyar-content-tools-sticker-grid button{min-width:0;min-height:88px;border:1px solid #ece8f0;background:#fff;border-radius:12px;padding:7px;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px}
.postyar-content-tools-sticker-grid button:hover{background:#faf8ff;border-color:#d8c9ef}
.postyar-content-tools-sticker-grid img{display:block;width:58px;height:58px;object-fit:contain}
.postyar-content-tools-sticker-grid span{font-size:11px;line-height:1}
.postyar-content-tools-empty,.wp-tools-loading-shell{padding:18px;border:1px solid #e8e1ef;border-radius:16px;background:linear-gradient(180deg,#fff,#faf8fd);display:grid;gap:10px;text-align:right}.wp-tools-loading-shell__title{font-weight:850;font-size:15px}.wp-tools-loading-shell__bars{display:grid;gap:7px}.wp-tools-loading-shell__bars span{height:10px;border-radius:999px;background:linear-gradient(90deg,#eee8f4,#f8f5fb,#eee8f4);background-size:200% 100%;animation:py-tools-shimmer 1.5s linear infinite}.wp-tools-loading-shell__bars span:nth-child(2){width:78%}.wp-tools-loading-shell__bars span:nth-child(3){width:58%}.wp-tools-loading-shell__meta{font-size:11.5px;color:var(--text-2)}@keyframes py-tools-shimmer{to{background-position:-200% 0}}
.postyar-content-tools-loading{padding:18px 12px;border:1px dashed #ded8e5;border-radius:12px;text-align:center;color:#786f80;font-size:12px;line-height:1.9}
`;
  document.head.appendChild(style);
}

function isContentPath(): boolean {
  return CONTENT_PATHS.has(window.location.pathname);
}

function isGoldPath(): boolean {
  return window.location.pathname === '/dashboard/gold';
}

function fieldsForCurrentPage(): HTMLTextAreaElement[] {
  if (!isContentPath()) return [];
  if (window.location.pathname === '/dashboard/posts/new') {
    return Array.from(document.querySelectorAll<HTMLTextAreaElement>('textarea[aria-label="متن پست"]'));
  }
  return Array.from(document.querySelectorAll<HTMLTextAreaElement>('textarea'))
    .filter((field) => {
      const label = field.getAttribute('aria-label') ?? '';
      const placeholder = field.getAttribute('placeholder') ?? '';
      const wrapperText = field.parentElement?.textContent ?? '';
      const hint = `${label} ${placeholder} ${wrapperText}`;
      return hint.includes('متن قالب') || hint.includes('{دلار}') || hint.includes('{سکه امامی}') || hint.includes('{طلای ۱۸}');
    });
}

function popupPosition(popup: HTMLElement, anchor: HTMLElement): void {
  const rect = anchor.getBoundingClientRect();
  const narrow = window.innerWidth <= 420;
  if (narrow) {
    popup.style.left = '7px';
    popup.style.right = '7px';
    popup.style.top = 'auto';
    popup.style.bottom = '7px';
    return;
  }
  const width = Math.min(560, Math.max(280, window.innerWidth - 20));
  const height = Math.min(720, Math.max(260, window.innerHeight * 0.82));
  const left = Math.max(10, Math.min(window.innerWidth - width - 10, rect.right - width));
  let top = rect.bottom + 10;
  if (top + height > window.innerHeight - 10) top = rect.top - height - 10;
  popup.style.width = `${width}px`;
  popup.style.maxHeight = `${height}px`;
  popup.style.left = `${left}px`;
  popup.style.right = 'auto';
  popup.style.top = `${Math.max(10, top)}px`;
  popup.style.bottom = 'auto';
}

function closePopup(): void {
  activeCleanup?.();
  activeCleanup = null;
  activePopup?.remove();
  activePopup = null;
  activeField = null;
}

function openPopup(field: HTMLTextAreaElement, anchor: HTMLButtonElement, renderer: (body: HTMLElement) => void): void {
  if (activePopup && activeField === field) {
    closePopup();
    return;
  }
  closePopup();

  const popup = document.createElement('div');
  popup.className = POPUP_CLASS;
  popup.setAttribute('role', 'dialog');
  popup.setAttribute('aria-modal', 'false');
  const head = document.createElement('div');
  head.className = 'postyar-content-tools-popup__head';
  const title = document.createElement('strong');
  title.textContent = 'ایموجی و استیکر';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'postyar-content-tools-popup__close';
  close.setAttribute('aria-label', 'بستن');
  close.textContent = '×';
  head.append(title, close);
  const body = document.createElement('div');
  body.className = 'postyar-content-tools-popup__body';
  popup.append(head, body);
  document.body.appendChild(popup);

  activePopup = popup;
  activeField = field;

  const reposition = () => {
    if (activePopup === popup && anchor.isConnected && field.isConnected) popupPosition(popup, anchor);
  };
  const outside = (event: Event) => {
    const target = event.target as Node | null;
    if (activePopup !== popup || !target) return;
    if (!popup.contains(target) && target !== anchor && !anchor.contains(target)) closePopup();
  };
  const cleanup = () => {
    window.removeEventListener('resize', reposition);
    window.removeEventListener('scroll', reposition, true);
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', keydown, true);
  };
  const keydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && activePopup === popup) closePopup();
  };

  activeCleanup = cleanup;
  close.onclick = closePopup;
  popup.addEventListener('pointerdown', (event) => event.stopPropagation());
  window.addEventListener('resize', reposition, { passive: true });
  window.addEventListener('scroll', reposition, { passive: true, capture: true });
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('keydown', keydown, true);
  popupPosition(popup, anchor);
  renderer(body);
}

function parseEmojiGroups(source: string): Record<string, string[]> | null {
  const match = source.match(/export const EMOJI_GROUPS(?:\s*:\s*Record<string, string\[\]>)?\s*=\s*(\{[\s\S]*\});?\s*$/);
  if (!match) return null;
  try { return JSON.parse(match[1]) as Record<string, string[]>; } catch { return null; }
}

async function loadEmojiGroups(): Promise<Record<string, string[]>> {
  if (emojiGroupsCache) return emojiGroupsCache;
  try {
    const response = await fetch('/assets/gen/emoji-library.js', { credentials: 'same-origin', cache: 'force-cache' });
    if (response.ok) {
      const parsed = parseEmojiGroups(await response.text());
      if (parsed && Object.keys(parsed).length) {
        emojiGroupsCache = parsed;
        return parsed;
      }
    }
  } catch { /* fallback below */ }
  emojiGroupsCache = {
    '😀 چهره و احساس': ['😀','😃','😄','😁','😆','😅','😂','🤣','😊','😍','🥰','😘','😎','🤔','😴','😢','😭','😡','🤬','🥳','😱','🤩'],
    '👍 واکنش و نشانه': ['👍','👎','👏','🙌','🙏','💪','🤝','👌','✌️','🤞','👉','👈','☝️','❤️','💔','🔥','✨','✅','❌','⭐','💯'],
  };
  return emojiGroupsCache;
}

async function fetchData(url: string): Promise<any> {
  const response = await fetch(url, { credentials: 'include', headers: { accept: 'application/json' } });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(String(payload?.error?.message ?? 'REQUEST_FAILED'));
  return payload?.data !== undefined ? payload.data : payload;
}

async function loadStickerSets(): Promise<Array<Record<string, unknown>>> {
  if (stickerSetsCache) return stickerSetsCache;
  const data = await fetchData('/api/v1/stickers/telegram/sets');
  stickerSetsCache = Array.isArray(data?.sets) ? data.sets as Array<Record<string, unknown>> : [];
  return stickerSetsCache;
}

async function loadStickerSet(id: string): Promise<{ stickers: Array<Record<string, unknown>>; set: Record<string, unknown> }> {
  const cached = stickerDetailsCache.get(id);
  if (cached) return cached;
  const data = await fetchData(`/api/v1/stickers/telegram/sets/${encodeURIComponent(id)}`);
  const result = {
    set: (data?.set ?? { id, title: 'مجموعه استیکر' }) as Record<string, unknown>,
    stickers: Array.isArray(data?.stickers) ? data.stickers as Array<Record<string, unknown>> : [],
  };
  stickerDetailsCache.set(id, result);
  return result;
}

function renderMediaPicker(body: HTMLElement, field: HTMLTextAreaElement): void {
  body.innerHTML = '';
  const note = document.createElement('div');
  note.className = 'postyar-content-tools-popup__note';
  note.textContent = 'ایموجی و استیکر در این کادر مستقل هستند و از قالب‌های آماده جدا نگه داشته شده‌اند.';
  body.appendChild(note);

  const tabs = document.createElement('div');
  tabs.className = 'postyar-content-tools-popup__tabs';
  const emojiTab = document.createElement('button');
  const stickerTab = document.createElement('button');
  emojiTab.type = stickerTab.type = 'button';
  emojiTab.textContent = '😀 ایموجی';
  stickerTab.textContent = '🎨 استیکر';
  emojiTab.className = 'active';
  tabs.append(emojiTab, stickerTab);
  body.appendChild(tabs);

  const panel = document.createElement('div');
  body.appendChild(panel);

  const renderEmoji = async () => {
    panel.innerHTML = '<div class="postyar-content-tools-loading">در حال آماده‌سازی ایموجی‌ها…</div>';
    const groups = await loadEmojiGroups();
    const names = Object.keys(groups);
    panel.innerHTML = '';
    if (!names.length) {
      panel.innerHTML = '<div class="postyar-content-tools-empty">کتابخانه ایموجی در دسترس نیست.</div>';
      return;
    }
    let activeGroup = names[0];
    const cats = document.createElement('div');
    cats.className = 'postyar-content-tools-popup__cats';
    const grid = document.createElement('div');
    grid.className = 'postyar-content-tools-emoji-grid';

    const draw = () => {
      cats.innerHTML = '';
      names.forEach((name) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = name.slice(0, 2);
        b.title = name;
        b.className = name === activeGroup ? 'active' : '';
        b.onclick = () => { activeGroup = name; draw(); drawGrid(); };
        cats.appendChild(b);
      });
    };
    const drawGrid = () => {
      grid.innerHTML = '';
      (groups[activeGroup] ?? []).forEach((emoji) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = emoji;
        b.setAttribute('aria-label', `افزودن ${emoji}`);
        b.onclick = () => insertText(field, emoji);
        grid.appendChild(b);
      });
    };
    panel.append(cats, grid);
    draw();
    drawGrid();
  };

  const renderStickers = async () => {
    panel.innerHTML = '<div class="postyar-content-tools-loading">در حال دریافت مجموعه‌های استیکر…</div>';
    try {
      const sets = await loadStickerSets();
      panel.innerHTML = '';
      if (!sets.length) {
        panel.innerHTML = '<div class="postyar-content-tools-empty">هنوز مجموعه‌ای در کتابخانه استیکر ندارید. از بخش «کتابخانه استیکر» یک مجموعه اضافه کنید.</div>';
        return;
      }
      let activeSetId = String(sets[0].id ?? '');
      const packs = document.createElement('div');
      packs.className = 'postyar-content-tools-popup__packs';
      const grid = document.createElement('div');
      grid.className = 'postyar-content-tools-sticker-grid';
      panel.append(packs, grid);

      const drawPacks = () => {
        packs.innerHTML = '';
        sets.forEach((set) => {
          const id = String(set.id ?? '');
          if (!id) return;
          const b = document.createElement('button');
          b.type = 'button';
          b.textContent = String(set.title ?? set.telegramName ?? 'مجموعه');
          b.className = id === activeSetId ? 'active' : '';
          b.onclick = async () => { activeSetId = id; drawPacks(); await drawStickers(); };
          packs.appendChild(b);
        });
      };
      const drawStickers = async () => {
        grid.innerHTML = '<div class="postyar-content-tools-loading">در حال دریافت استیکرها…</div>';
        try {
          const detail = await loadStickerSet(activeSetId);
          grid.innerHTML = '';
          if (!detail.stickers.length) {
            grid.innerHTML = '<div class="postyar-content-tools-empty">این مجموعه استیکری ندارد.</div>';
            return;
          }
          detail.stickers.forEach((sticker) => {
            const id = String(sticker.id ?? '');
            if (!id) return;
            const b = document.createElement('button');
            b.type = 'button';
            b.title = sticker.emoji ? `استیکر ${String(sticker.emoji)}` : 'استیکر';
            const img = document.createElement('img');
            img.src = `/api/v1/stickers/telegram/${encodeURIComponent(id)}/file`;
            img.alt = sticker.emoji ? String(sticker.emoji) : 'استیکر';
            img.loading = 'lazy';
            b.appendChild(img);
            if (sticker.emoji) {
              const span = document.createElement('span');
              span.textContent = String(sticker.emoji);
              b.appendChild(span);
            }
            b.onclick = () => {
              // Current post/gold payloads are text-oriented. Preserve that
              // server contract by inserting the sticker's associated emoji.
              if (sticker.emoji) insertText(field, String(sticker.emoji));
            };
            grid.appendChild(b);
          });
        } catch {
          grid.innerHTML = '<div class="postyar-content-tools-empty">دریافت استیکرها ناموفق بود.</div>';
        }
      };

      drawPacks();
      await drawStickers();
    } catch {
      panel.innerHTML = '<div class="postyar-content-tools-empty">دریافت کتابخانه استیکرها ناموفق بود.</div>';
    }
  };

  emojiTab.onclick = () => { emojiTab.className = 'active'; stickerTab.className = ''; void renderEmoji(); };
  stickerTab.onclick = () => { emojiTab.className = ''; stickerTab.className = 'active'; void renderStickers(); };
  void renderEmoji();
}

function makeButton(field: HTMLTextAreaElement): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'postyar-content-tools-button';
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-label', 'باز کردن ایموجی و استیکر');
  button.setAttribute('aria-expanded', 'false');
  const icon = document.createElement('span');
  icon.className = 'postyar-content-tools-button__icon';
  icon.textContent = '😀';
  const label = document.createElement('span');
  label.className = 'postyar-content-tools-button__text';
  label.textContent = 'ایموجی و استیکر';
  button.append(icon, label);
  button.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    openPopup(field, button, (body) => {
      renderMediaPicker(body, field);
    });
    button.setAttribute('aria-expanded', activePopup ? 'true' : 'false');
  };
  return button;
}


function sync(): void {
  if (!document.body) return;
  const path = window.location.pathname;
  if (path !== lastPath) {
    closePopup();
    lastPath = path;
  }
  injectStyle();

  const fields = fieldsForCurrentPage();
  const fieldSet = new Set(fields);

  document.querySelectorAll<HTMLElement>(`.${TOOLBAR_CLASS}[data-owner="postyar"]`).forEach((row) => {
    const ownerId = row.getAttribute('data-field-marker');
    const owner = ownerId ? document.querySelector<HTMLTextAreaElement>(`textarea[${FIELD_MARKER}="${ownerId}"]`) : null;
    if (!isContentPath() || !owner || !fieldSet.has(owner)) row.remove();
  });

  fields.forEach((field, index) => {
    if (!field.isConnected || field.getAttribute(FIELD_MARKER)) return;
    const marker = `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`;
    field.setAttribute(FIELD_MARKER, marker);
    const row = document.createElement('div');
    row.className = `${TOOLBAR_CLASS}${isGoldPath() ? ' postyar-content-tools-row--gold' : ''}`;
    row.setAttribute('data-owner', 'postyar');
    row.setAttribute('data-field-marker', marker);
    const mediaCard = document.createElement('div');
    mediaCard.className = 'postyar-content-tools-card';
    mediaCard.appendChild(makeButton(field));
    row.appendChild(mediaCard);
    field.insertAdjacentElement('afterend', row);
  });
}

function start(): void {
  const w = window as Window & { __POSTYAR_CONTENT_TOOLS_V4?: boolean };
  if (w.__POSTYAR_CONTENT_TOOLS_V4) return;
  w.__POSTYAR_CONTENT_TOOLS_V4 = true;
  lastPath = window.location.pathname;
  injectStyle();
  sync();
  const refresh = () => window.requestAnimationFrame(sync);
  onRouteChange(refresh);
  window.addEventListener('pagehide', closePopup, { passive: true });
}

if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', start, { once: true });
else start();

export {};
