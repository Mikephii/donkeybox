---
name: donkeybox-ui
description: "MANDATORY for any UI work on DonkeyBox: the box's web app (packages/app/web) and the docs site (apps/docs). One design system across both: shadcn/ui as the component library, a small signature set for identity, and validated oklch tokens in one shared tokens.css. Neutral chrome with a small orange brand, an orange/teal ramp pair, a five-step surface ladder, light and dark re-stepped (not inverted), Inter for words and JetBrains Mono for data, rounded corners, colour only where it means something. Contains the mandate, the identity contract, the token and typography rules, the component map, the theme mechanics per surface, and the gotchas. Load before building or changing any screen, page, form, dialog, table or interaction."
---

# DonkeyBox UI (mandatory for UI work)

Two surfaces wear one system:

| Surface | Where | Components |
| --- | --- | --- |
| The box | `packages/app/web/src` | `components/ui/` (shadcn), `components/signature/` |
| The docs site | `apps/docs` | Fumadocs, its colours mapped onto the tokens in `app/app.css` |

The design system was taken from Amiral's colour playground (same author) and is
showcased on the box's **`/design`** page: every token in light and dark side by
side, with the measured contrast of each pair.

A styled `<div>`/`<span>`/`<button>` that mimics something the library already
provides (a badge, tab, menu, alert, select) is a bug. So is a native `<select>`,
`<input>` or `<textarea>` with a hand-written class string where `NativeSelect`,
`Input` or `Textarea` exist. Native elements are fine where the platform needs
them (a submit `<button>` in a plain POST form) or for real custom visualisation.

**Existing hand-rolled code is not a licence to copy it.** Use the component and
move the neighbour over when you touch it.

---

## 1. The identity contract

These elements make a screen read as DonkeyBox. **Identity comes from this list
and nowhere else.** Inventing a new motif, animation or accent is a review
failure even when it looks good.

| # | Element | Component | Use it for |
| --- | --- | --- | --- |
| 1 | The mark | `<Mark>` | the logo, in `currentColor`; never in the brand colour inside the product |
| 2 | Mono, tabular numbers | `<Num>` | every number, id, timestamp, duration, cost |
| 3 | Blinking square dot | `<LiveDot>`, `Badge pulse`, a working `StatusDot` | something is happening now |
| 4 | Snake-trail spinner | `<PixelSpinner>` | indeterminate busy |
| 5 | The window | the box's canvas window; `<WindowFrame>` on the site | a card with a slim title bar; how the product is shown off |
| 6 | Presence | cursors, avatars, rings and name tags in the presence colours | who else is here |

- **A signature used where a plain primitive belongs is a bug.** A `LiveDot` on
  something that is not live, or a `WindowFrame` around an ordinary card, drains
  the set.
- **Retired and never to return:** L-shaped corner brackets, square corners on
  chrome, uppercase-mono-everything, coloured primary buttons.

---

## 2. Tokens and theming

Everything is in **`tokens.css`**: oklch custom properties mapped to Tailwind
utilities in `@theme inline`. The box's copy (`packages/app/web/src/tokens.css`)
is the source. The docs import it by path.

**Never use a raw palette class** (`bg-amber-500`, `text-sky-600`, `bg-white`):
only theme tokens (`bg-primary`, `text-muted-foreground`,
`bg-status-critical-subtle`). The one family that looks like a palette class but
is not: `orange-*` and `teal-*` are OUR ramps (the tokens replace Tailwind's), so
`text-orange-ink` is a token.

### The invariants

1. **Chrome is neutral.** `--primary` is near-black in light, near-white in
   dark. Buttons, tabs, toggles, the active nav row and the current plan carry no
   hue; selection is neutral contrast (`--accent`, `--sidebar-accent`, a
   `ring-foreground`).
2. **Brand is orange, and small.** `--brand` is the orange fill. It appears in
   exactly these places: the focus ring (`--ring`), text selection
   (`--selection`), inline links (`--link`), the lit cell of a meter
   (`--signature-pixel-on`), the sequential scale and, **on marketing pages
   only**, eyebrows, list marks and feature-icon tiles (`text-orange-ink`).
   Adding orange to a new piece of product chrome is a review
   failure.
3. **Two ramps, lead and counterpoint.** Orange and teal are eleven-step ramps
   (50–950). **Orange leads** (the brand, the single series, the current
   thing); **teal answers** (the counterpoint, the comparison, and the info
   status). They are the pair for data (`--series-lead` / `--series-counter`).
   Never swap the roles and never bring in a third ramp.
4. **Roles, not steps.** UI takes a ramp ROLE (`ground`, `soft`, `border`,
   `fill`, `fill-hover`, `ink`, `fill-fg`) and each theme maps it to its own step
   (light 50/100/200/600/700/800, dark 950/900/800/400/300/200). A raw step
   (`bg-orange-500`) is only for a visualisation that walks the ramp on purpose.
5. **Elevation is a ladder; take the rung you sit on.** `--sunken` (0: wells,
   code, tracks, the canvas, the site's backdrop) < `--background` (1: the plane)
   < `--card` (2: cards and canvas windows) < `--popover` (3: menus, pickers) <
   `--overlay` (4: dialogs, sheets), with `--scrim` behind 4. Light separates
   rungs with borders and shadow; dark by lightness alone (0.17 → 0.196 → 0.217
   → 0.243 → 0.262), so a component on the wrong rung disappears in dark mode.
6. **Status has three tones, and text only ever takes the ink.**
   `--status-{good,warning,serious,critical,info}` is the FILL (dot, bar, chip
   ground); `-ink` is text (≥4.5:1 on the card in both themes); `-subtle` is a
   pale ground for a notice, banner or row. `text-destructive` or
   `text-status-warning` as a sentence is a bug: the fills fail as text
   (warning ~1.9:1). Status fills are the same in both themes and never carry
   meaning alone: every status ships an icon or a word.
7. **Colour follows the job, not the look** (below).
8. **Values are measured, not chosen.** `packages/app/test/tokens.test.ts`
   resolves both themes and fails if any promised text pair drops under 4.5:1 or
   any mark under 3:1. Editing a colour means running it. The `/design` page
   prints the same ratios from the same code (`lib/color.ts`).

**Radius.** `--radius: 0.625rem`. Pixel-grid signatures stay square inside
rounded chrome; that contrast is deliberate.

### Colour, by the job it does

- **Categorical** (which thing) → `--chart-1` … `--chart-8` (blue orange teal
  amber pink green violet red), in fixed order, never cycled. A ninth folds into
  "Other". Colour follows the entity, never its rank.
- **Pair / single** → `--series-lead` (orange) and `--series-counter` (teal). A
  single series is the lead, not `--chart-1`.
- **Sequential** (magnitude) → `--chart-seq-1` … `--chart-seq-7`, the orange
  ramp 200→800. Never for categories.
- **Status** → invariant 6.
- **Tag** (an arbitrary key needing a stable colour) → `<Badge tone>` with
  `toneForKey(key)`, which hashes, so filtering never repaints. Pastel by design.
- **Presence** (which person) → the eight chart hues held at one lightness
  (`PRESENCE_HUES`, `PRESENCE_L` in `lib/color.ts`), where a white name tag
  clears 5:1 and the colour clears 3:1 on both canvases. They are hex because
  they travel to other people's browsers and into SVG attributes.

A hue is assigned from the data, never hardcoded per domain concept: no
`--tag-deploy`, no `tone={kind === "deploy" ? "green" : "red"}`.

**Do not make a screen more colourful to make it look designed.**

### Dark mode, per surface

Dark is the `dark` class; light is the default or the `light` class. Either can
be forced on a subtree (`/design` does), and `dark:` utilities stop at a `.light`
subtree. Dark is re-stepped, not inverted: every role names its dark value.

| Surface | Stored in | First paint |
| --- | --- | --- |
| The box | `wb-theme` cookie: `light`, `dark`, `system` | the server sets the class from the cookie; `index.html`'s script covers dev and `system` |
| Docs | Fumadocs' own toggle | Fumadocs |

Never `localStorage` for the theme (the server cannot read it).

---

## 3. Typography: two voices

```
--font-sans: Inter            the interface and reading voice
--font-mono: JetBrains Mono   the DATA voice
```

Both are self-hosted (`@fontsource-variable/*`), never a font CDN: a box may have
no internet.

The decision is one question: **is this scanned as a value, or read as a word?**

| Register | Face | Used for |
| --- | --- | --- |
| Heading | Inter 600 (marketing 700, tight tracking) | page, section, card titles |
| Body | Inter 400 | prose, descriptions, help text |
| UI | Inter 500 | buttons, nav, tabs, form labels |
| Micro-label | Inter 500, uppercase, tracked, 10px: `microLabelClass` | section eyebrows, column captions |
| **Data** | **Mono, tabular: `<Num>`** | numbers, ids, timestamps, durations, costs, paths |
| **Code** | **Mono, no ligatures** | commands, code, `kbd` |
| **Token** | **Mono, uppercase, tracked, 11px: `Badge mono`** | method and state labels (`POST`, `READY`) |

- **Every number goes through `<Num>`** (or `font-mono tabular-nums` where a
  component owns the markup). Use `tone="inherit"` when the parent colours it.
- **The micro-label is Inter, not mono.** Uppercase-tracked mono and
  uppercase-tracked Inter look alike in a screenshot and nothing alike on a page.
  One definition: `microLabelClass`. Never re-declare it.
- **Code never shows ligatures.** `tokens.css` turns them off for `code`, `pre`,
  `kbd`, `samp` and `.font-mono`, so `-<` and `->` show the characters to type.

---

## 4. Choosing a component

Name the interaction first, then map it.

| You need | Use | Not |
| --- | --- | --- |
| Trigger an action | `Button` (`size="icon"` for icon-only) | a styled `<div>` or `<a>` |
| A router link that looks like a button | `Button asChild` + `Link` | a link with button classes |
| Pick one of a few options | `Select`, or `NativeSelect` for plain lists | bare `<select>` |
| Switch between views of one page | `Tabs` | styled links |
| Horizontal primary nav between pages | a plain `<nav>` of links, `aria-current`, an underline in `foreground` | `Tabs` |
| Free text | `Input` / `Textarea` | native input + class string |
| Menu of actions | `DropdownMenu` | a popup of divs |
| Status or category label | `Badge`: `variant` for status (`success`, `warning`, `destructive`, `info`, `secondary`), `tone` for a categorical hue, `mono` for value labels, `pulse` when live | a rounded span |
| A notice on a page | `Alert` (`info`, `success`, `warning`, `destructive`) with the status icon | a bordered div |
| A banner across the box | `border-status-*/40 bg-status-*-subtle text-status-*-ink` plus an icon | `bg-amber-500/10` |
| Card | `Card` + `CardHeader`/`CardTitle`/`CardAction`/`CardContent` | a bordered div |
| Tabular data | `Table` | a grid of divs |
| Indeterminate busy | `PixelSpinner` | `animate-pulse`, a spinning icon |
| A status mark in a list | `StatusDot` (box) | a coloured circle |
| Confirm a destructive action | `Dialog` with a destructive button | an inline "sure?" swap |
| Toast | `toast()` from Sonner (box) | a fixed div |
| Show the product (site) | `WindowFrame` around a real screenshot | a device mockup, a browser chrome |

## 5. Rulings

Cases the map did not originally cover, each from a real migration.

- **Destructive as text takes the critical ink.** `text-status-critical-ink`,
  never `text-destructive`: the critical fill measures under 4.5:1 as text in dark.
- **Status badges sit on the subtle ground in the ink.** `Badge variant="warning"`
  etc. do this; never `bg-amber-500 text-white`.
- **A live state blinks; a settled one does not.** Working and starting runs,
  provisioning and updating boxes, a running rollout: `pulse` or a blinking
  `StatusDot`. Done, failed and stopped hold still.
- **The current thing is neutral.** The selected plan is `ring-2 ring-foreground`;
  the active tab is a `foreground` underline; never an orange border.
- **Dropdown menus size to their content.** The ported `DropdownMenuContent` does
  not take its trigger's width: the box's menus hang off small icon buttons.
- **Exceptions that keep a raw colour**, each with a comment saying why:
  a preview iframe's `bg-white` (a web page assumes a white canvas); white text on
  a presence colour (measured); the xterm palette and presence colours as hex
  (consumers that cannot read CSS variables). There are no others.
- **Marketing pages may use the brand ink** for eyebrows (`microLabelClass` +
  `text-orange-ink`), list marks and feature-icon tiles; the big ghosted mark
  takes `text-mark-ghost`; the backdrop is the `site-grid` lattice on `--sunken`
  inside a bordered column. None of this enters the product.
- **The product shot is real.** It is captured from a running box with seeded
  demo data, light and dark, and teammates' cursors on the site are drawn exactly
  as the box draws them (same arrow, same tag, presence colours), animated in CSS
  and held still under reduced motion. Never a mock-up of the UI.

## 6. Gotchas

- **Tailwind 4 needs `@source`** for components that live in another package.
- **An app that imports an icon needs `lucide-react` itself.**
- **`data-active={isActive || undefined}`**, never a bare boolean, on any shadcn
  part with a `data-active:` variant: Tailwind compiles it to attribute presence.
- **xterm and SVG presentation attributes cannot read `var()`.** Use hex from
  `lib/color.ts` (`hex()`), with a comment naming the token.
- **Radix conventions:** `open`/`onOpenChange`, `checked`/`onCheckedChange`,
  `value`/`onValueChange`, `asChild`.
- **A Radix tooltip needs a focusable trigger**: give a bare span `tabIndex={0}`.
- **Reduced motion is not optional** for the signature set: `LiveDot`, the
  spinner and the site's cursors all hold still under `prefers-reduced-motion`.
- **A terminal on the canvas can take focus and close an open menu.** Tests that
  open a menu next to a loading terminal retry the open.
- **Favicons come from `brand/mark.svg`.** Run
  `node packages/app/scripts/favicons.ts apps/docs/public` after changing the
  mark.

## 7. Before you finish

- `pnpm --filter @wb/app test` (the tokens test) if you touched `tokens.css` or
  `lib/color.ts`.
- Look at the screen in **both themes**. `/design` shows every token; a new
  component that looks right in light and vanishes in dark is on the wrong rung.
- Grep what you added for raw palette classes:
  `grep -nE "(bg|text|border)-(red|amber|sky|emerald|green|blue|white|black|neutral|gray|zinc)-?[0-9]*" <files>`.
