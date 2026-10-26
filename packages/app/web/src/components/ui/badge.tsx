import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

import { LiveDot } from "../signature/live-dot"

const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        secondary:
          "bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
        // Status badges sit on the status's subtle ground in its ink — the
        // fill tokens are for bars and dots, and fail as text (the donkeybox-ui skill).
        destructive:
          "bg-status-critical-subtle text-status-critical-ink focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 [a]:hover:bg-destructive/20",
        outline:
          "border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground",
        ghost:
          "hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
        link: "text-primary underline-offset-4 hover:underline",
        success: "bg-status-good-subtle text-status-good-ink",
        warning: "bg-status-warning-subtle text-status-warning-ink",
        info: "bg-status-info-subtle text-status-info-ink",
      },
      // Tone is orthogonal to variant: variant carries semantic weight
      // (default/destructive/success/...), tone carries an arbitrary
      // categorical hue from the tag palette. The hue comes from the data
      // (toneForKey), never hardcoded per domain concept. Declared after `variant` so its colours win under
      // tailwind-merge when both are set.
      tone: {
        none: "",
        neutral: "bg-[var(--tag-neutral-bg)] text-[var(--tag-neutral-fg)]",
        blue: "bg-[var(--tag-blue-bg)] text-[var(--tag-blue-fg)]",
        orange: "bg-[var(--tag-orange-bg)] text-[var(--tag-orange-fg)]",
        teal: "bg-[var(--tag-teal-bg)] text-[var(--tag-teal-fg)]",
        amber: "bg-[var(--tag-amber-bg)] text-[var(--tag-amber-fg)]",
        pink: "bg-[var(--tag-pink-bg)] text-[var(--tag-pink-fg)]",
        green: "bg-[var(--tag-green-bg)] text-[var(--tag-green-fg)]",
        violet: "bg-[var(--tag-violet-bg)] text-[var(--tag-violet-fg)]",
        red: "bg-[var(--tag-red-bg)] text-[var(--tag-red-fg)]",
      },
      // A leading blinking dot: this badge describes something happening now.
      // Signature 2. Implemented as a variant rather than asking every caller
      // to compose <Badge><LiveDot/>…</Badge>, which three screens had already
      // started doing slightly differently.
      pulse: { true: "", false: "" },
      // Badge text is in the data voice when it labels a value (a method, a
      // status code, an id) and in the interface voice when it reads as a
      // word. See the typography split in the donkeybox-ui skill.
      mono: {
        true: "font-mono text-[0.6875rem] tracking-wider uppercase rounded-md",
        false: "",
      },
    },
    defaultVariants: {
      variant: "default",
      tone: "none",
      pulse: false,
      mono: false,
    },
  }
)

/** The categorical tag hues, in the same fixed order as the chart slots. */
export const BADGE_TONES = [
  "blue",
  "orange",
  "teal",
  "amber",
  "pink",
  "green",
  "violet",
  "red",
] as const

export type BadgeTone = (typeof BADGE_TONES)[number]

/**
 * Pick a stable tone for an arbitrary key, so the same value always gets the
 * same colour without anyone hardcoding a mapping. Assignment is by hash, not
 * by rank, so adding or filtering values never repaints the survivors.
 */
/**
 * The background/foreground classes for a tone, for the cases that are not a
 * Badge — an avatar tile, a legend swatch, a row accent. Written out rather
 * than interpolated because Tailwind cannot build a class name at runtime.
 */
export const TONE_CLASS: Record<BadgeTone | "neutral", string> = {
  neutral: "bg-[var(--tag-neutral-bg)] text-[var(--tag-neutral-fg)]",
  blue: "bg-[var(--tag-blue-bg)] text-[var(--tag-blue-fg)]",
  orange: "bg-[var(--tag-orange-bg)] text-[var(--tag-orange-fg)]",
  teal: "bg-[var(--tag-teal-bg)] text-[var(--tag-teal-fg)]",
  amber: "bg-[var(--tag-amber-bg)] text-[var(--tag-amber-fg)]",
  pink: "bg-[var(--tag-pink-bg)] text-[var(--tag-pink-fg)]",
  green: "bg-[var(--tag-green-bg)] text-[var(--tag-green-fg)]",
  violet: "bg-[var(--tag-violet-bg)] text-[var(--tag-violet-fg)]",
  red: "bg-[var(--tag-red-bg)] text-[var(--tag-red-fg)]",
}

/** The tone classes for an arbitrary key, in one call. */
export function toneClassForKey(key: string): string {
  return TONE_CLASS[toneForKey(key)]
}

export function toneForKey(key: string): BadgeTone {
  let h = 0
  for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) | 0
  // The modulo is always in range; the fallback satisfies
  // noUncheckedIndexedAccess without a non-null assertion.
  return BADGE_TONES[Math.abs(h) % BADGE_TONES.length] ?? "blue"
}

function Badge({
  className,
  variant = "default",
  tone = "none",
  pulse = false,
  mono = false,
  asChild = false,
  children,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      data-tone={tone}
      className={cn(badgeVariants({ variant, tone, pulse, mono }), className)}
      {...props}
    >
      {/* asChild hands a single child to Slot, so the dot can only be added on
          the plain path. A pulsing badge that is also a trigger composes
          <LiveDot/> itself. */}
      {asChild ? (
        children
      ) : (
        <>
          {pulse ? <LiveDot className="bg-current" /> : null}
          {children}
        </>
      )}
    </Comp>
  )
}

export { Badge, badgeVariants }
