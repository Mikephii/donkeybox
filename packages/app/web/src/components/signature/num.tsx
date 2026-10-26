// ============================================================
// SIGNATURE 1: Num
// Every number in the box goes through this. Mono, tabular, so
// columns of figures line up and a changing value does not shift
// the characters beside it.
// ============================================================

import { forwardRef } from 'react';
import type { ComponentPropsWithoutRef, ElementType, ReactNode, SVGProps } from 'react';
import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';
import { cn } from 'cn';

const numVariants = cva('font-mono [font-variant-numeric:tabular-nums]', {
  variants: {
    size: {
      xs: 'text-[0.6875rem]',
      sm: 'text-xs',
      md: 'text-sm',
      lg: 'text-base',
      // The headline register: a figure that is the point of its card.
      display: 'text-4xl font-semibold tracking-tight',
    },
    tone: {
      default: 'text-foreground',
      muted: 'text-muted-foreground',
      // For a value inside a parent that owns the colour: a table cell with a
      // per-column colour fn, a link, an option row.
      inherit: 'text-inherit',
      // Status as text is always the -ink token: the fills fail as text.
      good: 'text-status-good-ink',
      warning: 'text-status-warning-ink',
      serious: 'text-status-serious-ink',
      critical: 'text-status-critical-ink',
    },
  },
  defaultVariants: { size: 'md', tone: 'default' },
});

type NumOwnProps = {
  /**
   * Any element. `as="text"` is supported so a chart's own tick renderer can
   * put its numbers in the data voice — recharts renders SVG <text>, which is
   * not a span, so the extra props are typed loosely rather than pinned to
   * HTMLSpanElement.
   */
  as?: ElementType;
  children?: ReactNode;
  className?: string;
} & VariantProps<typeof numVariants>;

export type NumProps = NumOwnProps &
  Omit<ComponentPropsWithoutRef<'span'>, keyof NumOwnProps> &
  // x/y/dx/dy/textAnchor for the `as="text"` case. Narrowed to SVG text
  // attributes rather than a blanket index signature, which would widen every
  // destructured prop to `unknown`.
  Omit<Partial<SVGProps<SVGTextElement>>, keyof NumOwnProps | 'ref'>;

export const Num = forwardRef<HTMLSpanElement, NumProps>(function Num(
  { as: Comp = 'span', size, tone, className, children, ...props },
  ref,
) {
  const Element = Comp as ElementType;
  return (
    <Element ref={ref} className={cn(numVariants({ size, tone }), className)} {...props}>
      {children}
    </Element>
  );
});

export { numVariants };
