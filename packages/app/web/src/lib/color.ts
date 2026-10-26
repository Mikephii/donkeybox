// Reads tokens.css and measures it: oklch to sRGB, WCAG contrast, and each theme's custom
// properties with var() chains resolved. The tokens test and the /design page both use it, so
// the numbers on the page are the numbers the test enforces. The colour maths is the colour
// playground's (Amiral's color-model.ts).

/** An oklch colour; `a` is alpha, 0 to 1. */
export interface Ok {
  l: number;
  c: number;
  h: number;
  a?: number;
}

export type ThemeName = "light" | "dark";

function toLinearRgb({ l, c, h }: Ok): [number, number, number] {
  const hr = (h * Math.PI) / 180;
  const a = c * Math.cos(hr),
    b = c * Math.sin(hr);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
}

const inGamut = (o: Ok) => toLinearRgb(o).every((v) => v >= -1e-4 && v <= 1 + 1e-4);

/** Pulls chroma in until the colour fits sRGB, keeping lightness and hue (what browsers do, roughly). */
export function fit(o: Ok): Ok {
  if (inGamut(o)) return o;
  let lo = 0,
    hi = o.c;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut({ ...o, c: mid })) lo = mid;
    else hi = mid;
  }
  return { ...o, c: lo };
}

function luminance(o: Ok): number {
  const [r, g, b] = toLinearRgb(fit(o)).map((v) => Math.min(1, Math.max(0, v)));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** A translucent colour composited over an opaque ground, close enough for a contrast reading. */
export function flatten(o: Ok, over: Ok): Ok {
  const a = o.a ?? 1;
  if (a >= 1) return o;
  return { l: o.l * a + over.l * (1 - a), c: o.c * a + over.c * (1 - a), h: a > 0.5 ? o.h : over.h };
}

/** WCAG 2 contrast ratio of a foreground (possibly translucent) on an opaque ground. */
export function contrast(fg: Ok, bg: Ok): number {
  const y1 = luminance(flatten(fg, bg)),
    y2 = luminance(bg);
  return (Math.max(y1, y2) + 0.05) / (Math.min(y1, y2) + 0.05);
}

/** sRGB hex, for consumers that cannot read CSS colours (xterm.js, canvases, presence colours). */
export function hex(o: Ok): string {
  const enc = (v: number) => {
    const x = Math.min(1, Math.max(0, v));
    const s = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
    return Math.round(s * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${toLinearRgb(fit(o)).map(enc).join("")}`;
}

export function parseOklch(v: string): Ok | null {
  const m = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+)(%?))?\s*\)$/.exec(v.trim());
  if (!m) return null;
  const a = m[4] === undefined ? undefined : Number(m[4]) / (m[5] ? 100 : 1);
  return { l: Number(m[1]), c: Number(m[2]), h: Number(m[3]), ...(a === undefined ? {} : { a }) };
}

/** Each theme's custom properties from tokens.css, var() resolved. `:root` blocks are light,
 *  `.dark` blocks layer over them, and a `:root, .dark` block applies to both. */
export function readTokens(css: string): Record<ThemeName, Record<string, string>> {
  const raw: Record<ThemeName, Record<string, string>> = { light: {}, dark: {} };
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of noComments.matchAll(/(^|\n)([^{}\n@][^{}]*?)\{([^{}]*)\}/g)) {
    const selectors = m[2]!.split(",").map((s) => s.trim());
    const decls = [...m[3]!.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)].map((d) => [d[1]!, d[2]!.trim()] as const);
    if (!decls.length) continue;
    const toLight = selectors.includes(":root"),
      toDark = selectors.includes(".dark");
    for (const [k, v] of decls) {
      if (toLight) raw.light[k] = v;
      if (toDark) raw.dark[k] = v;
    }
  }
  const dark = { ...raw.light, ...raw.dark };
  const resolve = (vars: Record<string, string>) => {
    const out: Record<string, string> = {};
    const get = (k: string, depth = 0): string => {
      const v = vars[k];
      if (v === undefined) throw new Error(`--${k} is not defined`);
      const ref = /^var\(--([\w-]+)\)$/.exec(v);
      if (!ref) return v;
      if (depth > 10) throw new Error(`--${k}: var() chain too deep`);
      return get(ref[1]!, depth + 1);
    };
    for (const k of Object.keys(vars)) out[k] = get(k);
    return out;
  };
  return { light: resolve(raw.light), dark: resolve(dark) };
}

/** A token as a colour, or an error naming it. */
export function colorOf(theme: Record<string, string>, name: string): Ok {
  const v = theme[name];
  const o = v ? parseOklch(v) : null;
  if (!o) throw new Error(`--${name} is not an oklch colour (${v})`);
  return o;
}

/** "4.8 AA": the ratio and the WCAG band it clears. */
export function ratioLabel(r: number): string {
  const band = r >= 7 ? "AAA" : r >= 4.5 ? "AA" : r >= 3 ? "AA large" : "fail";
  return `${r.toFixed(1)} ${band}`;
}

/** The pairs the system promises, per theme: text on its ground at 4.5:1, marks on the card at 3:1. */
export const TEXT_PAIRS: [fg: string, bg: string][] = [
  ["foreground", "background"],
  ["foreground", "sunken"],
  ["card-foreground", "card"],
  ["popover-foreground", "popover"],
  ["foreground", "overlay"],
  ["muted-foreground", "background"],
  ["muted-foreground", "card"],
  ["muted-foreground", "muted"],
  ["muted-foreground", "sunken"],
  ["primary-foreground", "primary"],
  ["secondary-foreground", "secondary"],
  ["accent-foreground", "accent"],
  ["sidebar-foreground", "sidebar"],
  ["sidebar-accent-foreground", "sidebar-accent"],
  ["link", "card"],
  ["link", "background"],
  ["brand-foreground", "brand"],
  ["teal-fill-fg", "teal-fill"],
  ["orange-fill-fg", "orange-fill"],
  ["teal-ink", "teal-soft"],
  ["orange-ink", "orange-soft"],
  ["destructive-foreground", "destructive"],
  ["success-foreground", "success"],
  ["warning-foreground", "warning"],
  ["serious-foreground", "serious"],
  ...(["good", "warning", "serious", "critical", "info"] as const).flatMap((s) => [
    [`status-${s}-ink`, "card"] as [string, string],
    [`status-${s}-ink`, `status-${s}-subtle`] as [string, string],
  ]),
  ...(["blue", "orange", "teal", "amber", "pink", "green", "violet", "red", "neutral"] as const).map(
    (t) => [`tag-${t}-fg`, `tag-${t}-bg`] as [string, string],
  ),
];

export const MARK_PAIRS: [mark: string, bg: string][] = [
  ["brand", "card"],
  ["ring", "background"],
  ["signature-pixel-on", "card"],
  ["series-lead", "card"],
  ["series-counter", "card"],
];

/** Presence colours: which person is which (cursors, avatars, window tags). That is the categorical
 *  job, so they are the eight chart hues, in chart order, held at one lightness (0.52) where white
 *  labels clear 5:1 and the colour still clears 3:1 as a mark on both canvases. Hex, because a
 *  presence colour travels to other people's browsers and lands in SVG attributes and box shadows. */
export const PRESENCE_HUES: [hue: number, chroma: number][] = [
  [255.5, 0.163], [48, 0.175], [185, 0.118], [75.1, 0.161], [357.4, 0.141], [142.5, 0.18], [283.6, 0.167], [24.9, 0.191],
];
export const PRESENCE_L = 0.52;
