/* ------------------------------------------------------------------ */
/* Standard character avatars + custom photo (Task 17-b, user item 5). */
/* ONE parametric SVG component renders all 12 characters             */
/* deterministically: palette + hair archetype + glasses/earrings are  */
/* derived from the character key index — same key, same face.         */
/* ------------------------------------------------------------------ */

import { useId } from 'react';

export type AvatarCharacterKey =
  | 'amir'
  | 'bahar'
  | 'cyrus'
  | 'darya'
  | 'esther'
  | 'farhad'
  | 'golnar'
  | 'hooman'
  | 'iraj'
  | 'jasmin'
  | 'kaveh'
  | 'laleh';

export const AVATAR_CHARACTERS: Array<{ key: AvatarCharacterKey; label: string }> = [
  { key: 'amir', label: 'امیر' },
  { key: 'bahar', label: 'بهار' },
  { key: 'cyrus', label: 'کوروش' },
  { key: 'darya', label: 'دریا' },
  { key: 'esther', label: 'استر' },
  { key: 'farhad', label: 'فرهاد' },
  { key: 'golnar', label: 'گلنار' },
  { key: 'hooman', label: 'هومن' },
  { key: 'iraj', label: 'ایرج' },
  { key: 'jasmin', label: 'یاسمین' },
  { key: 'kaveh', label: 'کاوه' },
  { key: 'laleh', label: 'لاله' },
];

const CHARACTER_INDEX: Record<string, number> = Object.fromEntries(
  AVATAR_CHARACTERS.map((c, i) => [c.key, i])
);

interface AvatarPalette {
  bg: string; // pastel circle background
  deep: string; // subtle outline on the bg circle
  skin: string;
  hair: string;
  accent: string; // glasses / earrings
  shirt: string;
}

/* 12 distinct brand-harmonious palettes — warm muted set first, only
   three cool tones, no blue/indigo dominance. */
const PALETTES: AvatarPalette[] = [
  { bg: '#FDE7EF', deep: '#F3B9CD', skin: '#F2C094', hair: '#4A3B32', accent: '#E05C7F', shirt: '#E05C7F' }, // amir — rose
  { bg: '#FFF0DA', deep: '#F2D6A8', skin: '#E8A96F', hair: '#2E2A26', accent: '#D98324', shirt: '#D98324' }, // bahar — amber
  { bg: '#DFF3EA', deep: '#B2DDC8', skin: '#E9B586', hair: '#3A3230', accent: '#1F9B6E', shirt: '#1F9B6E' }, // cyrus — emerald
  { bg: '#DFF0F4', deep: '#AEDBE3', skin: '#F2C094', hair: '#243038', accent: '#14808E', shirt: '#14808E' }, // darya — teal
  { bg: '#F3E9FB', deep: '#DBC2EE', skin: '#F5C9A2', hair: '#3C2F45', accent: '#8B5CF6', shirt: '#8B5CF6' }, // esther — violet
  { bg: '#FBE9E1', deep: '#F1C6B4', skin: '#D9975F', hair: '#211D1A', accent: '#D96A3B', shirt: '#D96A3B' }, // farhad — orange
  { bg: '#FCE7F1', deep: '#F1BFD9', skin: '#E9B586', hair: '#513A2E', accent: '#D6408F', shirt: '#D6408F' }, // golnar — pink
  { bg: '#E2EEF9', deep: '#BCD7EC', skin: '#F2C094', hair: '#2B2F33', accent: '#3E7CB1', shirt: '#3E7CB1' }, // hooman — muted sky
  { bg: '#F5F0DB', deep: '#DFD5A4', skin: '#E8A96F', hair: '#4A3B32', accent: '#A3872E', shirt: '#A3872E' }, // iraj — gold
  { bg: '#EDF6E8', deep: '#C8E4BD', skin: '#F5C9A2', hair: '#33261F', accent: '#5FA344', shirt: '#5FA344' }, // jasmin — green
  { bg: '#EAEDF4', deep: '#C6CCE0', skin: '#F2C094', hair: '#23282E', accent: '#64748B', shirt: '#64748B' }, // kaveh — slate
  { bg: '#FBE3E0', deep: '#F1BCB5', skin: '#E9B586', hair: '#2E2A26', accent: '#D64545', shirt: '#D64545' }, // laleh — tulip
];

const FACE_DARK = '#3D2F2B';

/** Bust-in-circle flat character. Hair archetypes cycled by index:
 *  0 short crop · 1 side sweep · 2 long hair · 3 topknot · 4 curly. */
function CharacterArt({ index }: { index: number }) {
  const p = PALETTES[index % PALETTES.length];
  const hair = index % 5;
  const glasses = index % 3 === 1;
  const earrings = index % 4 === 2;
  // Unique clip id (bust is clipped to the bg circle so shoulders never poke out).
  const clipId = `pyav${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <svg viewBox="0 0 64 64" width="100%" height="100%" aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={clipId}>
          <circle cx="32" cy="32" r="30.6" />
        </clipPath>
      </defs>
      <circle cx="32" cy="32" r="30.6" fill={p.bg} stroke={p.deep} strokeWidth="1.5" />
      <g clipPath={`url(#${clipId})`}>
        {/* long hair back panels (before head, so they peek at the sides) */}
        {hair === 2 && (
          <>
            <rect x="17.5" y="21" width="7.5" height="24" rx="3.75" fill={p.hair} />
            <rect x="39" y="21" width="7.5" height="24" rx="3.75" fill={p.hair} />
          </>
        )}
        {/* shoulders */}
        <path d="M13.5 64c0-11.2 8.1-17.6 18.5-17.6S50.5 52.8 50.5 64Z" fill={p.shirt} />
        {/* neck */}
        <rect x="28.6" y="34.5" width="6.8" height="9" rx="3.2" fill={p.skin} />
        {/* head */}
        <circle cx="32" cy="26" r="12.5" fill={p.skin} />
        {/* hair front */}
        {hair === 0 && <path d="M19.5 26a12.5 12.5 0 0 1 25 0Z" fill={p.hair} />}
        {hair === 1 && (
          <>
            <path d="M19.5 26a12.5 12.5 0 0 1 25 0Z" fill={p.hair} />
            <rect x="34.8" y="20.5" width="9.2" height="6" rx="3" fill={p.hair} />
          </>
        )}
        {hair === 2 && <path d="M19.5 26a12.5 12.5 0 0 1 25 0Z" fill={p.hair} />}
        {hair === 3 && (
          <>
            <path d="M19.5 26a12.5 12.5 0 0 1 25 0Z" fill={p.hair} />
            <circle cx="32" cy="11.5" r="4.6" fill={p.hair} />
          </>
        )}
        {hair === 4 && (
          <>
            <circle cx="23.4" cy="19.4" r="5.6" fill={p.hair} />
            <circle cx="32" cy="16.8" r="6.2" fill={p.hair} />
            <circle cx="40.6" cy="19.4" r="5.6" fill={p.hair} />
          </>
        )}
        {/* face */}
        <circle cx="27.2" cy="29" r="1.35" fill={FACE_DARK} />
        <circle cx="36.8" cy="29" r="1.35" fill={FACE_DARK} />
        <path d="M28.6 33.6q3.4 2.5 6.8 0" fill="none" stroke={FACE_DARK} strokeWidth="1.5" strokeLinecap="round" />
        {glasses && (
          <g fill="none" stroke={p.accent} strokeWidth="1.4">
            <circle cx="27.2" cy="29" r="3.3" />
            <circle cx="36.8" cy="29" r="3.3" />
            <path d="M30.5 29h3" />
          </g>
        )}
        {earrings && (
          <g fill={p.accent}>
            <circle cx="19.8" cy="31.5" r="1.15" />
            <circle cx="44.2" cy="31.5" r="1.15" />
          </g>
        )}
      </g>
    </svg>
  );
}

export function Avatar({
  kind,
  value,
  photoUrl,
  name,
  size = 40,
  className = '',
}: {
  kind?: string | null;
  value?: string | null;
  photoUrl?: string | null;
  name?: string | null;
  size?: number;
  className?: string;
}) {
  const cls = className ? ` ${className}` : '';
  if (kind === 'photo' && photoUrl) {
    return (
      <img
        className={`pavatar pavatar__img${cls}`}
        src={photoUrl}
        width={size}
        height={size}
        alt={name ? `آواتار ${name}` : 'تصویر پروفایل'}
        loading="lazy"
      />
    );
  }
  const idx = typeof value === 'string' ? CHARACTER_INDEX[value] : undefined;
  if (idx !== undefined) {
    return (
      <span className={`pavatar${cls}`} style={{ width: size, height: size }} aria-hidden="true">
        <CharacterArt index={idx} />
      </span>
    );
  }
  // No character chosen yet (fresh account): derive a deterministic standard
  // character from the name so nobody ever sees an empty box/letter avatar.
  const nameSeed = (name ?? '').trim() || value || 'postyar';
  let hash = 0;
  for (let i = 0; i < nameSeed.length; i++) hash = (hash * 31 + nameSeed.charCodeAt(i)) >>> 0;
  return (
    <span className={`pavatar${cls}`} style={{ width: size, height: size }} aria-hidden="true">
      <CharacterArt index={hash % PALETTES.length} />
    </span>
  );
}
