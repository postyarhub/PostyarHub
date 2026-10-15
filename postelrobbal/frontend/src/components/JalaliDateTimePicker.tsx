import DatePicker from 'react-multi-date-picker';
import DateObject from 'react-date-object';
import persian from 'react-date-object/calendars/persian';
import gregorian from 'react-date-object/calendars/gregorian';
import persian_fa from 'react-date-object/locales/persian_fa';
import { useEffect, useMemo, useState, type WheelEvent } from 'react';
import { faDigits, toLatinDigits, zonedPersianParts, zonedWallClockToDate } from '../lib/format';

/**
 * Jalali date picker with direct-editable, mouse-wheel hour/minute controls.
 * All conversions use the authenticated user's active timezone.
 */
export function JalaliDateTimePicker({
  value,
  onChange,
  placeholder = 'انتخاب تاریخ (شمسی)',
  disabled = false,
  restrictToFuture = false,
}: {
  value: Date | null;
  onChange: (d: Date | null) => void;
  placeholder?: string;
  disabled?: boolean;
  /** For scheduling: disable past dates. Off for search/filter usage. */
  restrictToFuture?: boolean;
}) {
  const parts = useMemo(() => value ? zonedPersianParts(value) : null, [value]);
  const pickerValue = useMemo(() => {
    return parts
      ? new DateObject({ ...parts, calendar: persian, locale: persian_fa }).setDigits(['۰','۱','۲','۳','۴','۵','۶','۷','۸','۹'])
      : null;
  }, [parts]);
  const minimumDate = useMemo(() => {
    if (!restrictToFuture) return undefined;
    const today = zonedPersianParts(new Date());
    return today
      ? new DateObject({ year: today.year, month: today.month, day: today.day, hour: 0, minute: 0, second: 0, calendar: persian, locale: persian_fa })
      : undefined;
  }, [restrictToFuture]);

  const [hourText, setHourText] = useState(parts ? String(parts.hour).padStart(2, '0') : '');
  const [minuteText, setMinuteText] = useState(parts ? String(parts.minute).padStart(2, '0') : '');
  const [hourEditing, setHourEditing] = useState(false);
  const [minuteEditing, setMinuteEditing] = useState(false);

  useEffect(() => {
    if (!hourEditing) setHourText(parts ? String(parts.hour).padStart(2, '0') : '');
  }, [parts?.hour, hourEditing]);
  useEffect(() => {
    if (!minuteEditing) setMinuteText(parts ? String(parts.minute).padStart(2, '0') : '');
  }, [parts?.minute, minuteEditing]);

  const emitClock = (hour: number, minute: number, dayShift = 0) => {
    if (!pickerValue) return;
    const gregorianDate = new DateObject(pickerValue).convert(gregorian);
    const shifted = new Date(Date.UTC(
      Number(gregorianDate.year),
      Number(gregorianDate.month.number) - 1,
      Number(gregorianDate.day) + dayShift,
    ));
    onChange(zonedWallClockToDate({
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
      hour,
      minute,
      second: 0,
    }));
  };

  const changeClockByWheel = (field: 'hour' | 'minute', step: number) => {
    if (!parts || !pickerValue || disabled) return;
    let hour = parts.hour;
    let minute = parts.minute;
    let dayShift = 0;
    if (field === 'hour') {
      if (step > 0 && hour === 23) dayShift = 1;
      else if (step < 0 && hour === 0) dayShift = -1;
      hour = (hour + step + 24) % 24;
    } else {
      let total = hour * 60 + minute + step;
      if (total < 0) { total += 1440; dayShift = -1; }
      else if (total >= 1440) { total -= 1440; dayShift = 1; }
      hour = Math.floor(total / 60);
      minute = total % 60;
    }
    setHourText(faDigits(String(hour).padStart(2, '0')));
    setMinuteText(faDigits(String(minute).padStart(2, '0')));
    emitClock(hour, minute, dayShift);
  };

  const handleWheel = (field: 'hour' | 'minute', event: WheelEvent<HTMLInputElement>) => {
    if (disabled || !value) return;
    event.preventDefault();
    event.stopPropagation();
    changeClockByWheel(field, event.deltaY < 0 ? 1 : -1);
  };

  const handleManualChange = (field: 'hour' | 'minute', raw: string) => {
    const normalized = faDigits(toLatinDigits(raw).replace(/[^0-9]/g, '').slice(0, 2));
    if (field === 'hour') setHourText(normalized);
    else setMinuteText(normalized);
    if (!parts || !pickerValue || normalized === '') return;
    const parsed = Number(toLatinDigits(normalized));
    const max = field === 'hour' ? 23 : 59;
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > max) return;
    emitClock(field === 'hour' ? parsed : parts.hour, field === 'minute' ? parsed : parts.minute);
  };

  const handleDateChange = (selected: DateObject | null) => {
    if (!selected || !selected.isValid) {
      onChange(null);
      return;
    }
    const selectedGregorian = new DateObject(selected).convert(gregorian);
    const nowParts = zonedPersianParts(new Date());
    onChange(zonedWallClockToDate({
      year: Number(selectedGregorian.year),
      month: Number(selectedGregorian.month.number),
      day: Number(selectedGregorian.day),
      // Preserve the chosen time, or seed a new date with the current hour/minute.
      hour: parts?.hour ?? nowParts?.hour ?? 0,
      minute: parts?.minute ?? nowParts?.minute ?? 0,
      second: 0,
    }));
  };

  const timeFieldStyle = {
    width: 68,
    minWidth: 68,
    textAlign: 'center' as const,
    direction: 'ltr' as const,
    fontVariantNumeric: 'tabular-nums' as const,
    paddingInline: 8,
  };
  const clockHint = 'برای تغییر با چرخ ماوس روی ساعت یا دقیقه اسکرول کنید؛ برای ورود دستی، عدد را تایپ کنید.';

  return (
    <div style={{ display: 'grid', gap: 6, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'stretch', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 220px', minWidth: 190 }}>
          <DatePicker
            value={pickerValue}
            onChange={(d) => handleDateChange((Array.isArray(d) ? d[0] : d) as DateObject | null)}
            calendar={persian}
            locale={persian_fa}
            format="YYYY/MM/DD"
            inputClass="input"
            placeholder={placeholder}
            editable={false}
            disabled={disabled}
            calendarPosition="bottom-right"
            digits={['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹']}
            minDate={minimumDate}
          />
        </div>
        <div role="group" aria-label="تنظیم ساعت و دقیقه" style={{ display: 'flex', alignItems: 'center', gap: 5, flex: '0 0 auto' }} title={clockHint}>
          <label style={{ display: 'grid', justifyItems: 'center', gap: 3, color: 'var(--text-2)', fontSize: 11 }}>
            <span>ساعت</span>
            <input
              className="input"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              maxLength={2}
              aria-label="ساعت"
              title={clockHint}
              disabled={disabled || !value}
              value={hourEditing ? hourText : (parts ? faDigits(String(parts.hour).padStart(2, '0')) : '')}
              onFocus={(event) => { setHourEditing(true); setHourText(parts ? faDigits(String(parts.hour).padStart(2, '0')) : ''); event.currentTarget.select(); }}
              onChange={(event) => handleManualChange('hour', event.target.value)}
              onBlur={() => {
                setHourEditing(false);
                setHourText(parts ? String(parts.hour).padStart(2, '0') : '');
              }}
              onWheel={(event) => handleWheel('hour', event)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                  event.preventDefault(); changeClockByWheel('hour', event.key === 'ArrowUp' ? 1 : -1);
                }
              }}
              style={timeFieldStyle}
              placeholder="۰۰"
            />
          </label>
          <span aria-hidden="true" style={{ fontSize: 20, lineHeight: 1, paddingTop: 18, color: 'var(--text-2)' }}>:</span>
          <label style={{ display: 'grid', justifyItems: 'center', gap: 3, color: 'var(--text-2)', fontSize: 11 }}>
            <span>دقیقه</span>
            <input
              className="input"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              maxLength={2}
              aria-label="دقیقه"
              title={clockHint}
              disabled={disabled || !value}
              value={minuteEditing ? minuteText : (parts ? faDigits(String(parts.minute).padStart(2, '0')) : '')}
              onFocus={(event) => { setMinuteEditing(true); setMinuteText(parts ? faDigits(String(parts.minute).padStart(2, '0')) : ''); event.currentTarget.select(); }}
              onChange={(event) => handleManualChange('minute', event.target.value)}
              onBlur={() => {
                setMinuteEditing(false);
                setMinuteText(parts ? String(parts.minute).padStart(2, '0') : '');
              }}
              onWheel={(event) => handleWheel('minute', event)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                  event.preventDefault(); changeClockByWheel('minute', event.key === 'ArrowUp' ? 1 : -1);
                }
              }}
              style={timeFieldStyle}
              placeholder="۰۰"
            />
          </label>
        </div>
      </div>
      <p style={{ margin: 0, color: 'var(--text-2)', fontSize: 12, lineHeight: 1.7 }}>{clockHint}{!value ? ' ابتدا تاریخ را انتخاب کنید.' : ''}</p>
    </div>
  );
}

