import type { ReactNode } from 'react';

/* Drawn icons instead of ⏮/⏸ characters, which some systems render as colour emoji. */

function Svg({ children, size = 20 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className="ps-icon"
    >
      {children}
    </svg>
  );
}

export function IconRestart() {
  return (
    <Svg>
      <rect x="3" y="4" width="2.2" height="12" rx="1" />
      <path d="M16.5 4.6v10.8a.8.8 0 0 1-1.25.66L7.4 10.66a.8.8 0 0 1 0-1.32l7.85-5.4a.8.8 0 0 1 1.25.66Z" />
    </Svg>
  );
}

export function IconPrev() {
  return (
    <Svg>
      <rect x="4" y="5" width="2" height="10" rx="1" />
      <path d="M15 5.7v8.6a.7.7 0 0 1-1.1.58L8 10.58a.7.7 0 0 1 0-1.16l5.9-4.3A.7.7 0 0 1 15 5.7Z" />
    </Svg>
  );
}

export function IconNext() {
  return (
    <Svg>
      <path d="M5 5.7v8.6a.7.7 0 0 0 1.1.58L12 10.58a.7.7 0 0 0 0-1.16l-5.9-4.3A.7.7 0 0 0 5 5.7Z" />
      <rect x="14" y="5" width="2" height="10" rx="1" />
    </Svg>
  );
}

export function IconPlay() {
  return (
    <Svg size={22}>
      <path d="M6 3.9v12.2a.9.9 0 0 0 1.38.76l9.5-6.1a.9.9 0 0 0 0-1.52l-9.5-6.1A.9.9 0 0 0 6 3.9Z" />
    </Svg>
  );
}

export function IconPause() {
  return (
    <Svg size={22}>
      <rect x="5" y="4" width="3.4" height="12" rx="1" />
      <rect x="11.6" y="4" width="3.4" height="12" rx="1" />
    </Svg>
  );
}

export function IconStop() {
  return (
    <Svg>
      <rect x="5" y="5" width="10" height="10" rx="1.5" />
    </Svg>
  );
}

export function IconMore() {
  return (
    <Svg>
      <circle cx="4.5" cy="10" r="1.6" />
      <circle cx="10" cy="10" r="1.6" />
      <circle cx="15.5" cy="10" r="1.6" />
    </Svg>
  );
}

export function IconPiano() {
  return (
    <Svg>
      <path
        d="M4.5 4h11A1.5 1.5 0 0 1 17 5.5v9a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14.5v-9A1.5 1.5 0 0 1 4.5 4Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="M8 11v5M12 11v5" stroke="currentColor" strokeWidth="1.2" />
      <rect x="6.6" y="4.5" width="2.8" height="6.5" rx="0.6" />
      <rect x="10.6" y="4.5" width="2.8" height="6.5" rx="0.6" />
    </Svg>
  );
}
