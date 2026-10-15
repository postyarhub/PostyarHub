import type { ReactElement } from 'react';

/**
 * Hand-drawn stroke icon set for navigation (Task 14-a).
 * Single component, currentColor, 24×24 grid — no icon fonts, no CDNs.
 */

export type NavIconName =
  | 'home'
  | 'channels'
  | 'posts'
  | 'bots'
  | 'workflows'
  | 'ai'
  | 'woocommerce'
  | 'gold'
  | 'analytics'
  | 'clock'
  | 'subscription'
  | 'wallet'
  | 'referrals'
  | 'notifications'
  | 'support'
  | 'help'
  | 'settings'
  | 'admin'
  | 'more';

const PATHS: Record<NavIconName, ReactElement> = {
  home: (
    <>
      <path d="M3.5 10.5 12 3.5l8.5 7" />
      <path d="M5.5 9.6V20h13V9.6" />
      <path d="M9.5 20v-6h5v6" />
    </>
  ),
  channels: (
    <>
      <path d="M18 5 7.5 9.5H5a2 2 0 0 0-2 2v1.5a2 2 0 0 0 2 2h2.5L18 19V5Z" />
      <path d="M8 15.3v3.2a1.5 1.5 0 0 0 3 0v-1.8" />
    </>
  ),
  posts: (
    <>
      <path d="m21 3-9.5 9.5" />
      <path d="M21 3l-6.5 18-3-8.5L3 9.5 21 3Z" />
    </>
  ),
  bots: (
    <>
      <rect x="4.5" y="8.5" width="15" height="11" rx="3" />
      <path d="M12 5.2v3.3" />
      <circle cx="12" cy="3.9" r="1.3" />
      <path d="M9.3 13v2" />
      <path d="M14.7 13v2" />
    </>
  ),
  workflows: (
    <>
      <circle cx="6.5" cy="5.5" r="2.2" />
      <circle cx="6.5" cy="18.5" r="2.2" />
      <circle cx="17.5" cy="9" r="2.2" />
      <path d="M6.5 7.7v8.6" />
      <path d="M17.5 11.2c0 3.4-4.6 3.7-8.7 5" />
    </>
  ),
  ai: (
    <>
      <path d="M12 4.5 13.6 9l4.4 1.6-4.4 1.6L12 16.6l-1.6-4.4L6 10.6 10.4 9 12 4.5Z" />
      <path d="m18.5 15.5.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z" />
    </>
  ),
  woocommerce: (
    <>
      <path d="M6 8h12l1.2 12.2a1 1 0 0 1-1 1.1H5.8a1 1 0 0 1-1-1.1L6 8Z" />
      <path d="M9 10.5V6.8a3 3 0 0 1 6 0v3.7" />
    </>
  ),
  gold: (
    <>
      <circle cx="12" cy="12" r="8.2" />
      <circle cx="12" cy="12" r="4.4" />
      <path d="M12 1.8v2" />
      <path d="M12 20.2v2" />
    </>
  ),
  analytics: (
    <>
      <path d="M4 20h16" />
      <path d="M6.5 20v-6" />
      <path d="M12 20V6" />
      <path d="M17.5 20v-9" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 7.4V12l3.2 2" />
    </>
  ),
  subscription: (
    <>
      <path d="M7 4h10l4 5.5L12 20.5 3 9.5 7 4Z" />
      <path d="M3 9.5h18" />
      <path d="m12 20.5-4-11 4-5.5 4 5.5-4 11" />
    </>
  ),
  wallet: (
    <>
      <rect x="3" y="6.5" width="18" height="12.5" rx="2.5" />
      <path d="M16 11h5v4h-5a2 2 0 0 1 0-4Z" />
      <path d="M3 9.5h11" />
    </>
  ),
  referrals: (
    <>
      <circle cx="12" cy="12" r="8.2" />
      <circle cx="12" cy="12" r="4.4" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  notifications: (
    <>
      <path d="M18 9a6 6 0 1 0-12 0c0 6-2.5 7.5-2.5 7.5h17S18 15 18 9Z" />
      <path d="M10.3 20.5a2 2 0 0 0 3.4 0" />
    </>
  ),
  support: (
    <>
      <circle cx="12" cy="12" r="8.2" />
      <circle cx="12" cy="12" r="3.6" />
      <path d="m6.1 6.1 3.5 3.5" />
      <path d="m17.9 6.1-3.5 3.5" />
      <path d="m17.9 17.9-3.5-3.5" />
      <path d="m6.1 17.9 3.5-3.5" />
    </>
  ),
  help: (
    <>
      <path d="M12 4.2 2.9 8.8 12 13.4l9.1-4.6L12 4.2Z" />
      <path d="M6.3 10.6v4.9c0 1.7 2.55 3.2 5.7 3.2s5.7-1.5 5.7-3.2v-4.9" />
      <path d="M21.1 9.2v5.6" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3.1" />
      <circle cx="12" cy="12" r="7.6" />
      <path d="M12 2.3v1.9M12 19.8v1.9M21.7 12h-1.9M4.2 12H2.3M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4M18.8 18.8l-1.4-1.4M6.6 6.6 5.2 5.2" />
    </>
  ),
  admin: (
    <>
      <path d="M12 3l8 3v5.5c0 4.6-3.4 7.7-8 9.1-4.6-1.4-8-4.5-8-9.1V6l8-3Z" />
      <path d="m9 11.6 2.2 2.2 3.8-4.2" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="5" r="1.35" fill="currentColor" stroke="none" />
      <circle cx="12" cy="5" r="1.35" fill="currentColor" stroke="none" />
      <circle cx="19" cy="5" r="1.35" fill="currentColor" stroke="none" />
      <circle cx="5" cy="12" r="1.35" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.35" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.35" fill="currentColor" stroke="none" />
      <circle cx="5" cy="19" r="1.35" fill="currentColor" stroke="none" />
      <circle cx="12" cy="19" r="1.35" fill="currentColor" stroke="none" />
      <circle cx="19" cy="19" r="1.35" fill="currentColor" stroke="none" />
    </>
  ),
};

export function NavIcon({ name, size = 22 }: { name: NavIconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
