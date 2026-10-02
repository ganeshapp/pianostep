import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'review' | 'unusable' | 'plain';

/** Small rounded label. Purely presentational; text is the accessible content. */
export function Badge({ tone = 'neutral', className, title, children }: {
  tone?: BadgeTone;
  className?: string;
  title?: string;
  children: ReactNode;
}) {
  const classes = ['badge', tone !== 'neutral' ? `badge-${tone}` : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <span className={classes} title={title}>
      {children}
    </span>
  );
}
