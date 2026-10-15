import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';

/** Public handle so parents can force a fresh challenge (e.g. after a failed attempt). */
export interface CaptchaHandle {
  refresh: () => void;
}

/** Controlled value emitted to the parent on every change. */
export interface CaptchaValue {
  captchaId: string;
  captchaText: string;
}

interface CaptchaFieldProps {
  /** Emits the current value, or null while no challenge is loaded. */
  onChange: (value: CaptchaValue | null) => void;
  /** Server error message about the captcha — highlights the tile and shows the message inline. */
  invalidToken?: string;
  disabled?: boolean;
}

type Status = 'loading' | 'ready' | 'error';

/**
 * Graphical anti-bot captcha widget (item 15).
 * Self-contained styling (scoped <style> + inline) — never touches shared CSS.
 * Pulls a fresh SVG challenge from GET /api/v1/auth/captcha and reports
 * { captchaId, captchaText } up to the form. Codes are one-shot server-side.
 */
export const CaptchaField = forwardRef<CaptchaHandle, CaptchaFieldProps>(function CaptchaField(
  { onChange, invalidToken, disabled = false },
  ref
) {
  const [status, setStatus] = useState<Status>('loading');
  const [captchaId, setCaptchaId] = useState<string | null>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const [text, setText] = useState('');
  const [spinning, setSpinning] = useState(false);

  const loadingRef = useRef(false);
  const spinTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Unique, CSS-safe class for fully scoped styling.
  const cls = `pycap-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  const load = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setCaptchaId(null); // old code is dead the moment we re-roll
    setSvg(null);
    setText('');
    setStatus('loading');
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const timer = window.setTimeout(() => controller.abort(), 12000);
    try {
      const res = await fetch('/api/v1/auth/captcha', {
        credentials: 'include',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: controller.signal,
      });
      const json = (await res.json()) as {
        success?: boolean;
        data?: { captchaId?: string; svg?: string };
      };
      if (!res.ok || !json.success || !json.data?.captchaId || !json.data?.svg) {
        throw new Error('captcha unavailable');
      }
      setCaptchaId(json.data.captchaId);
      setSvg(json.data.svg);
      setText('');
      setStatus('ready');
    } catch {
      if (!controller.signal.aborted) setStatus('error');
      else setStatus('error');
    } finally {
      window.clearTimeout(timer);
      if (requestRef.current === controller) requestRef.current = null;
      loadingRef.current = false;
    }
  }, []);

  const refresh = useCallback(() => {
    setSpinning(true);
    if (spinTimer.current) clearTimeout(spinTimer.current);
    spinTimer.current = setTimeout(() => setSpinning(false), 550);
    void load();
  }, [load]);

  useEffect(() => {
    void load();
    return () => {
      requestRef.current?.abort();
      if (spinTimer.current) clearTimeout(spinTimer.current);
    };
  }, [load]);

  useImperativeHandle(ref, () => ({ refresh }), [refresh]);

  // Report every change up to the form (null while no live challenge exists).
  useEffect(() => {
    onChangeRef.current(captchaId ? { captchaId, captchaText: text } : null);
  }, [captchaId, text]);

  const invalid = Boolean(invalidToken);
  const shake = invalid && text === ''; // re-shakes on every fresh failed attempt

  const css = `
.${cls} { max-width: 320px; margin: 2px 0 14px; }
.${cls} .pycap-head { display: flex; align-items: center; gap: 7px; margin-bottom: 8px; }
.${cls} .pycap-chip {
  width: 22px; height: 22px; border-radius: 7px; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--brand-soft); color: var(--brand-strong);
}
.${cls} .pycap-label { font-size: 13px; font-weight: 600; color: var(--text-2); }
.${cls} .pycap-row { display: flex; align-items: center; gap: 8px; }
.${cls} .pycap-tile {
  position: relative; flex: 1; height: 60px; border-radius: 12px; overflow: hidden;
  border: 1px solid var(--border);
  background:
    linear-gradient(rgba(99,102,241,0.055) 1px, transparent 1px),
    linear-gradient(90deg, rgba(99,102,241,0.055) 1px, transparent 1px),
    linear-gradient(135deg, rgba(99,102,241,0.06) 0%, rgba(139,92,246,0.10) 100%);
  background-size: 12px 12px, 12px 12px, 100% 100%;
  box-shadow: inset 0 1px 3px rgba(26,29,41,0.05);
  transition: border-color 0.25s ease;
}
.${cls} .pycap-tile.is-invalid { border-color: rgba(220,38,38,0.55); }
.${cls} .pycap-tile.is-shake { animation: ${cls}-shake 0.45s cubic-bezier(0.36,0.07,0.19,0.97); }
.${cls} .pycap-svg { position: absolute; inset: 0; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
.${cls} .pycap-svg svg { width: 100%; height: 100%; display: block; }
.${cls} .pycap-skeleton {
  position: absolute; inset: 0;
  background: linear-gradient(90deg, var(--surface-2) 25%, #e8eaf2 50%, var(--surface-2) 75%);
  background-size: 200% 100%;
  animation: ${cls}-shimmer 1.4s infinite;
}
.${cls} .pycap-fail {
  position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 3px;
  background: var(--danger-soft); padding: 4px;
}
.${cls} .pycap-fail-msg { font-size: 11.5px; color: var(--danger); font-weight: 600; }
.${cls} .pycap-retry {
  background: none; border: none; padding: 2px 8px; border-radius: 8px;
  font-size: 12px; font-weight: 700; color: var(--brand); font-family: inherit;
}
.${cls} .pycap-retry:hover { background: var(--brand-soft); }
.${cls} .pycap-refresh {
  width: 46px; height: 46px; border-radius: 12px; flex-shrink: 0;
  border: 1px solid var(--border); background: var(--surface); color: var(--text-2);
  display: inline-flex; align-items: center; justify-content: center;
  transition: color 0.2s ease, border-color 0.2s ease, background 0.2s ease, transform 0.1s ease;
}
.${cls} .pycap-refresh:hover { color: var(--brand-strong); border-color: var(--brand); background: var(--brand-soft); }
.${cls} .pycap-refresh:active { transform: scale(0.94); }
.${cls} .pycap-refresh > span { display: inline-flex; }
.${cls} .pycap-refresh.is-spinning > span { animation: ${cls}-spin 0.55s cubic-bezier(0.4, 0, 0.2, 1); }
.${cls} .pycap-input {
  margin-top: 10px; text-align: left; direction: ltr;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  letter-spacing: 3px; font-size: 15px;
}
.${cls} .pycap-input::placeholder { letter-spacing: 1px; font-family: inherit; }
@keyframes ${cls}-spin { to { transform: rotate(360deg); } }
@keyframes ${cls}-shake {
  10%, 90% { transform: translateX(-1px); }
  20%, 80% { transform: translateX(2px); }
  30%, 50%, 70% { transform: translateX(-3px); }
  40%, 60% { transform: translateX(3px); }
}
@keyframes ${cls}-shimmer { to { background-position: -200% 0; } }
@media (prefers-reduced-motion: reduce) {
  .${cls} .pycap-refresh.is-spinning > span,
  .${cls} .pycap-tile.is-shake,
  .${cls} .pycap-skeleton { animation: none; }
}
`;

  return (
    <div className={cls}>
      <style>{css}</style>

      {/* label row — mirrors .field-label + required marker of the design system */}
      <div className="pycap-head">
        <span className="pycap-chip" aria-hidden="true">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-3.6 8-10V5.5L12 2 4 5.5V12c0 6.4 8 10 8 10z" />
            <path d="m9 11.5 2.2 2.2 4.3-4.2" />
          </svg>
        </span>
        <span className="pycap-label" id={`${cls}-label`}>
          کد امنیتی<span aria-hidden="true"> *</span>
        </span>
      </div>

      <div className="pycap-row">
        <div
          className={`pycap-tile${invalid ? ' is-invalid' : ''}${shake ? ' is-shake' : ''}`}
          role="img"
          aria-label="تصویر کد امنیتی"
        >
          {status === 'ready' && svg && (
            <div
              className="pycap-svg"
              aria-label="کد امنیتی تصویری"
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          )}
          {status === 'loading' && <div className="pycap-skeleton" />}
          {status === 'error' && (
            <div className="pycap-fail">
              <span className="pycap-fail-msg">دریافت کد امنیتی ناموفق بود.</span>
              <button type="button" className="pycap-retry" onClick={() => void load()}>
                تلاش دوباره
              </button>
            </div>
          )}
        </div>
        <button
          type="button"
          className={`pycap-refresh${spinning ? ' is-spinning' : ''}`}
          onClick={refresh}
          disabled={disabled}
          aria-label="تازه‌سازی کد"
          title="تازه‌سازی کد"
        >
          <span aria-hidden="true">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 0 1 15.3-6.4L21 8" />
              <path d="M21 3v5h-5" />
              <path d="M21 12a9 9 0 0 1-15.3 6.4L3 16" />
              <path d="M3 21v-5h5" />
            </svg>
          </span>
        </button>
      </div>

      <input
        className="input pycap-input"
        dir="ltr"
        inputMode="text"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        maxLength={10}
        placeholder="مثال: A7x2B"
        aria-labelledby={`${cls}-label`}
        value={text}
        disabled={disabled || status !== 'ready'}
        onChange={(e) => setText(e.target.value.replace(/\s/g, ''))}
      />

      <p className="field-hint" style={{ marginTop: 5 }}>
        تصویر را وارد کنید تا مطمئن شویم ربات نیستید.
      </p>
      {invalidToken && (
        <p className="field-error" role="alert" style={{ marginTop: 2 }}>
          {invalidToken}
        </p>
      )}
    </div>
  );
});
