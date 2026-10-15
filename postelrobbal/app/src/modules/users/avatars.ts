/**
 * Round 17 — user avatar model.
 *
 * users.avatar_kind = 'character' → users.avatar_value holds one of the
 * AVATAR_CHARACTERS keys below; the frontend renders it as the standard
 * character SVG (no media row involved). The 12 standard characters are:
 * amir, bahar, cyrus, darya, esther, farhad, golnar, hooman, iraj, jasmin,
 * kaveh, laleh.
 *
 * users.avatar_kind = 'photo' → users.avatar_media_id points at a processed
 * 512×512 WebP row in the media table (tenant_id = the user's own id), served
 * through GET /users/:id/avatar.
 */
export const AVATAR_CHARACTERS = [
  'amir',
  'bahar',
  'cyrus',
  'darya',
  'esther',
  'farhad',
  'golnar',
  'hooman',
  'iraj',
  'jasmin',
  'kaveh',
  'laleh',
] as const;

export type AvatarCharacter = (typeof AVATAR_CHARACTERS)[number];

export interface AvatarState {
  avatarKind: 'character' | 'photo';
  avatarValue: string;
  avatarMediaId: string | null;
}
