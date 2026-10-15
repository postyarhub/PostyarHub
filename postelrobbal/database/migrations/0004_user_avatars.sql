-- ============================================================================
-- Postyar migration 0004 — round 17: user profile avatars.
-- A user's avatar is either a standard character (frontend-rendered SVG keyed
-- by avatar_value) or a processed 512×512 WebP photo stored in the media table
-- (avatar_media_id, tenant = the user's own id).
-- ============================================================================
SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- Round 17: user profile avatars (standard character or processed WebP photo)
ALTER TABLE users
  ADD COLUMN avatar_kind ENUM('character','photo') NOT NULL DEFAULT 'character' AFTER timezone,
  ADD COLUMN avatar_value VARCHAR(32) NOT NULL DEFAULT '' AFTER avatar_kind,
  ADD COLUMN avatar_media_id CHAR(26) NULL AFTER avatar_value;
