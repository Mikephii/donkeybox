// ============================================================
// SIGNATURE 4: PixelSpinner
//
// A 3x3 grid of squares with a trail running clockwise around the
// perimeter. The eight perimeter cells share one keyframe; each
// carries a negative animation-delay so the trail is on-phase from
// the moment it mounts rather than assembling itself over a cycle.
//
// The colour snap at 37.6% is deliberate: the trail steps like LCD
// pixels instead of fading.
//
// Keyframes live in tokens.css — no runtime <style> injection.
// ============================================================

import { forwardRef } from 'react';
import type { ComponentPropsWithoutRef } from 'react';
import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';
import { cn } from 'cn';

const SIZES = {
  sm: { wrap: 14, cell: 4, gap: 1 },
  md: { wrap: 20, cell: 6, gap: 1 },
  lg: { wrap: 28, cell: 8, gap: 2 },
} as const;

const CYCLE_MS = 1200;
// Grid indices 0..8, centre (4) excluded. Listed in clockwise order so the
// trail travels around the ring rather than jumping across it.
const PERIMETER = [0, 1, 2, 5, 8, 7, 6, 3];

const spinnerVariants = cva('', {
  variants: {
    tone: {
      // The default is the brand: a spinner is the app saying "me, working".
      brand: '[--spinner-bright:var(--color-brand)]',
      neutral: '[--spinner-bright:var(--color-foreground)]',
      muted: '[--spinner-bright:var(--color-muted-foreground)]',
      good: '[--spinner-bright:var(--color-status-good)]',
      warning: '[--spinner-bright:var(--color-status-warning)]',
      serious: '[--spinner-bright:var(--color-status-serious)]',
      critical: '[--spinner-bright:var(--color-status-critical)]',
    },
  },
  defaultVariants: { tone: 'brand' },
});

export type PixelSpinnerProps = ComponentPropsWithoutRef<'div'> &
  VariantProps<typeof spinnerVariants> & {
    size?: keyof typeof SIZES;
    label?: string;
  };

export const PixelSpinner = forwardRef<HTMLDivElement, PixelSpinnerProps>(
  function PixelSpinner({ size = 'md', tone, label = 'Loading', className, style, ...props }, ref) {
    const dim = SIZES[size];
    return (
      <div
        ref={ref}
        role="status"
        aria-label={label}
        className={cn('inline-grid grid-cols-3', spinnerVariants({ tone }), className)}
        style={{ width: dim.wrap, height: dim.wrap, gap: dim.gap, ...style }}
        {...props}
      >
        {Array.from({ length: 9 }, (_, i) => {
          const step = PERIMETER.indexOf(i);
          const isCentre = step === -1;
          return (
            <span
              key={i}
              className={cn(
                'rounded-[1px]',
                isCentre
                  ? 'bg-[var(--signature-pixel-off)]'
                  : 'animate-[signature-spinner-snake_var(--spinner-cycle)_linear_infinite]',
              )}
              style={
                isCentre
                  ? { width: dim.cell, height: dim.cell }
                  : {
                      width: dim.cell,
                      height: dim.cell,
                      // Negative delay: start mid-cycle so the whole ring is
                      // already in phase on the first frame.
                      animationDelay: `-${(step * CYCLE_MS) / PERIMETER.length}ms`,
                      ['--spinner-cycle' as string]: `${CYCLE_MS}ms`,
                    }
              }
            />
          );
        })}
      </div>
    );
  },
);
