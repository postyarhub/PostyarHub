import type { ReactElement } from 'react';

/**
 * Graphical feature icons (feedback round 15, item 12).
 * Rich multi-part SVG scenes (not single stroke glyphs) rendered white on
 * per-feature gradient tiles — «هر آنچه برای انتشار حرفه‌ای نیاز دارید».
 * These are feature illustrations, NOT the brand logo (which comes only from
 * the official reference file via components/Logo.tsx).
 */

export type FeatureArtName = 'channels' | 'posts' | 'clock' | 'bots' | 'ai' | 'analytics';

const S = { fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

function ChannelsArt() {
  return (
    <svg viewBox="0 0 48 48" width="30" height="30" aria-hidden="true">
      {/* stacked channel cards */}
      <rect x="7" y="8" width="26" height="8.5" rx="3" fill="#fff" opacity="0.95" />
      <rect x="10" y="21" width="26" height="8.5" rx="3" fill="#fff" opacity="0.75" />
      <rect x="7" y="34" width="26" height="8.5" rx="3" fill="#fff" opacity="0.55" />
      {/* platform dots */}
      <circle cx="12.5" cy="12.2" r="2.4" fill="#229ED9" />
      <circle cx="15.5" cy="25.2" r="2.4" fill="#0CBC8D" />
      <circle cx="12.5" cy="38.2" r="2.4" fill="#F59E0B" />
      {/* connect spine */}
      <path d="M38 12 v24" stroke="#fff" strokeWidth="2.4" opacity="0.9" {...S} />
      <circle cx="38" cy="12" r="2.6" fill="#fff" />
      <circle cx="38" cy="36" r="2.6" fill="#fff" opacity="0.7" />
      {/* broadcast spark */}
      <path d="M42.5 8.5 l1.4 3 3 1.4 -3 1.4 -1.4 3 -1.4 -3 -3 -1.4 3 -1.4z" fill="#fff" />
    </svg>
  );
}

function PostsArt() {
  return (
    <svg viewBox="0 0 48 48" width="30" height="30" aria-hidden="true">
      {/* one-to-many broadcast */}
      <path d="M8 24 h9" stroke="#fff" strokeWidth="2.6" {...S} />
      <path d="M17 24 c8 0 8 -12 15 -12 M17 24 h15 M17 24 c8 0 8 12 15 12" stroke="#fff" strokeWidth="2.2" opacity="0.85" {...S} />
      {/* target channels */}
      <g>
        <circle cx="38.5" cy="12" r="5" fill="#fff" />
        <path d="m36.4 12 1.6 1.6 2.8-3" stroke="#6D28D9" strokeWidth="1.8" {...S} />
      </g>
      <g>
        <circle cx="38.5" cy="24" r="5" fill="#fff" opacity="0.85" />
        <path d="m36.4 24 1.6 1.6 2.8-3" stroke="#6D28D9" strokeWidth="1.8" {...S} />
      </g>
      <g>
        <circle cx="38.5" cy="36" r="5" fill="#fff" opacity="0.7" />
        <path d="m36.4 36 1.6 1.6 2.8-3" stroke="#6D28D9" strokeWidth="1.8" {...S} />
      </g>
      {/* origin post */}
      <rect x="3" y="19.5" width="9" height="9" rx="2.5" fill="#fff" opacity="0.95" />
      <path d="M5.5 22.5h4M5.5 25.5h2.6" stroke="#6D28D9" strokeWidth="1.4" {...S} />
    </svg>
  );
}

function ClockArt() {
  return (
    <svg viewBox="0 0 48 48" width="30" height="30" aria-hidden="true">
      {/* orbit ring */}
      <circle cx="24" cy="24" r="19" stroke="#fff" strokeWidth="2" opacity="0.45" fill="none" strokeDasharray="4.5 5" />
      {/* clock face */}
      <circle cx="24" cy="24" r="12.5" fill="#fff" />
      <circle cx="24" cy="24" r="12.5" stroke="#fff" strokeWidth="2" fill="none" opacity="0.4" />
      {/* hands — 10:10 feel */}
      <path d="M24 24 v-7.4" stroke="#6D28D9" strokeWidth="2.4" {...S} />
      <path d="M24 24 l5.4 3.4" stroke="#6D28D9" strokeWidth="2.4" {...S} />
      <circle cx="24" cy="24" r="1.9" fill="#6D28D9" />
      {/* auto-publish check bubble */}
      <circle cx="38.5" cy="11.5" r="5.4" fill="#fff" />
      <path d="m36.2 11.5 1.7 1.7 3-3.2" stroke="#059669" strokeWidth="2" {...S} />
      {/* progress arc */}
      <path d="M6.4 30 a18.5 18.5 0 0 0 6.2 8" stroke="#fff" strokeWidth="2.6" opacity="0.9" {...S} />
    </svg>
  );
}

function BotsArt() {
  return (
    <svg viewBox="0 0 48 48" width="30" height="30" aria-hidden="true">
      {/* antenna */}
      <path d="M24 9 v4" stroke="#fff" strokeWidth="2.2" {...S} />
      <circle cx="24" cy="7" r="2.2" fill="#fff" />
      {/* robot head */}
      <rect x="11" y="13" width="26" height="19" rx="6" fill="#fff" />
      {/* eyes */}
      <circle cx="19.5" cy="21.5" r="2.6" fill="#6D28D9" />
      <circle cx="28.5" cy="21.5" r="2.6" fill="#6D28D9" />
      {/* smile */}
      <path d="M20 26.8 c1.4 1.7 6.6 1.7 8 0" stroke="#6D28D9" strokeWidth="1.8" {...S} />
      {/* ears */}
      <path d="M8.6 20.5v5M39.4 20.5v5" stroke="#fff" strokeWidth="2.6" {...S} />
      {/* chat bubble */}
      <path d="M31 34 h9.5 a3.5 3.5 0 0 1 3.5 3.5 v4 a3.5 3.5 0 0 1 -3.5 3.5 h-6 l-3.4 2.6 v-2.6 h-.1 a3.5 3.5 0 0 1 -3.5 -3.5 v-4 a3.5 3.5 0 0 1 3.5 -3.5z" transform="scale(0.82) translate(6 4)" fill="#fff" opacity="0.9" />
      <circle cx="35" cy="40.5" r="1.2" fill="#6D28D9" />
      <circle cx="38.4" cy="40.5" r="1.2" fill="#6D28D9" />
      <circle cx="41.8" cy="40.5" r="1.2" fill="#6D28D9" />
    </svg>
  );
}

function AiArt() {
  return (
    <svg viewBox="0 0 48 48" width="30" height="30" aria-hidden="true">
      {/* neural core */}
      <circle cx="24" cy="24" r="8" fill="#fff" opacity="0.95" />
      <circle cx="24" cy="24" r="3.1" fill="#6D28D9" />
      {/* nodes + links */}
      <g stroke="#fff" strokeWidth="1.7" opacity="0.85">
        <path d="M24 16 V9.5 M24 32 v6.5 M16 24 H9.5 M32 24 h6.5 M18 18 l-4.6-4.6 M30 30 l4.6 4.6 M30 18 l4.6-4.6 M18 30 l-4.6 4.6" {...S} />
      </g>
      <circle cx="24" cy="7.5" r="2.5" fill="#fff" />
      <circle cx="24" cy="40.5" r="2.5" fill="#fff" opacity="0.8" />
      <circle cx="7.5" cy="24" r="2.5" fill="#fff" opacity="0.8" />
      <circle cx="40.5" cy="24" r="2.5" fill="#fff" />
      <circle cx="11.4" cy="11.4" r="2" fill="#fff" opacity="0.65" />
      <circle cx="36.6" cy="36.6" r="2" fill="#fff" opacity="0.65" />
      {/* spark */}
      <path d="M39 7 l1.5 3.2 3.2 1.5 -3.2 1.5 -1.5 3.2 -1.5 -3.2 -3.2 -1.5 3.2 -1.5z" fill="#fff" />
    </svg>
  );
}

function AnalyticsArt() {
  return (
    <svg viewBox="0 0 48 48" width="30" height="30" aria-hidden="true">
      {/* bars */}
      <rect x="8" y="28" width="6.5" height="12" rx="2" fill="#fff" opacity="0.6" />
      <rect x="17.5" y="21" width="6.5" height="19" rx="2" fill="#fff" opacity="0.8" />
      <rect x="27" y="14" width="6.5" height="26" rx="2" fill="#fff" />
      {/* trend arrow */}
      <path d="M9 20 L19 13 l5.5 3.4 L36 8.5" stroke="#fff" strokeWidth="2.6" {...S} />
      <path d="m31.5 7.5 5-.4 -.3 5" stroke="#fff" strokeWidth="2.6" {...S} />
      {/* magnifier over best bar */}
      <circle cx="33.5" cy="30" r="6.2" fill="#fff" opacity="0.95" />
      <circle cx="33.5" cy="30" r="3" fill="none" stroke="#6D28D9" strokeWidth="1.8" />
      <path d="m38 34.5 4 4" stroke="#fff" strokeWidth="2.8" {...S} />
    </svg>
  );
}

const ART: Record<FeatureArtName, () => ReactElement> = {
  channels: ChannelsArt,
  posts: PostsArt,
  clock: ClockArt,
  bots: BotsArt,
  ai: AiArt,
  analytics: AnalyticsArt,
};

/** Distinct premium gradients per feature (brand family + accents). */
export const FEATURE_GRADIENTS: Record<FeatureArtName, string> = {
  channels: 'linear-gradient(135deg,#6366f1,#8b5cf6)',
  posts: 'linear-gradient(135deg,#0ea56e,#34d399)',
  clock: 'linear-gradient(135deg,#f59e0b,#f97316)',
  bots: 'linear-gradient(135deg,#0ea5e9,#22d3ee)',
  ai: 'linear-gradient(135deg,#8b5cf6,#d946ef)',
  analytics: 'linear-gradient(135deg,#ef4444,#f97316)',
};

export function FeatureArt({ name }: { name: FeatureArtName }) {
  const Art = ART[name];
  return <Art />;
}
