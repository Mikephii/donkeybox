// ============================================================
// LiveDot
// A 4x4 square that blinks: "this is happening now". Each dot gets
// its own period and phase, so a column of them reads as separate
// things each doing their own work rather than as a strobe.
//
// The blink is the signature-blink keyframe in tokens.css, which
// holds still under prefers-reduced-motion: the dot sits beside a
// fact stated in words, so a still dot loses nothing.
// ============================================================

import { forwardRef, useState } from 'react';
import type { ComponentPropsWithoutRef } from 'react';
import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';
import { cn } from 'cn';

const dotVariants = cva('inline-block size-1 shrink-0 rounded-[1px]', {
  variants: {
    tone: {
      default: 'bg-foreground',
      muted: 'bg-muted-foreground',
      brand: 'bg-brand',
      good: 'bg-status-good',
      warning: 'bg-status-warning',
      serious: 'bg-status-serious',
      critical: 'bg-status-critical',
      info: 'bg-status-info',
    },
  },
  defaultVariants: { tone: 'default' },
});

export type LiveDotProps = VariantProps<typeof dotVariants> &
  ComponentPropsWithoutRef<'span'> & {
    /** Set false for the settled state: the same dot, not blinking. */
    live?: boolean;
  };

export const LiveDot = forwardRef<HTMLSpanElement, LiveDotProps>(function LiveDot(
  { tone, live = true, className, style, ...props },
  ref,
) {
  // 2s plus up to 0.8s, started anywhere in the cycle. Fixed per dot for its lifetime.
  const [timing] = useState(() => ({ period: 2000 + Math.random() * 800, phase: Math.random() * 2000 }));
  return (
    <span
      ref={ref}
      aria-hidden="true"
      className={cn(dotVariants({ tone }), live && 'animate-[signature-blink_var(--blink)_steps(2,jump-none)_infinite]', className)}
      style={{ ['--blink' as string]: `${timing.period}ms`, animationDelay: `-${timing.phase}ms`, ...style }}
      {...props}
    />
  );
});
