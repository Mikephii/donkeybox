// /design: the design system on one page, light and dark side by side. Every colour comes from
// tokens.css and every ratio printed here is the one test/tokens.test.ts enforces, read from the
// same file. Not in the sidebar; linked from Settings and the donkeybox-ui skill.
import { AlertTriangle, CheckCircle2, Info, Terminal, XCircle } from "lucide-react";
import tokensCss from "../tokens.css?raw";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LiveDot, Mark, microLabelClass, Num, PixelSpinner } from "@/components/signature";
import { StatusDot } from "@/app/StatusDot";
import { colorOf, contrast, ratioLabel, readTokens, type ThemeName } from "@/lib/color";
import { presencePalette } from "@/lib/yjs";
import { cn } from "@/lib/utils";

const TOKENS = readTokens(tokensCss);
const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const STATUSES = ["good", "warning", "serious", "critical", "info"] as const;
const TAGS = ["blue", "orange", "teal", "amber", "pink", "green", "violet", "red", "neutral"] as const;

export function DesignPage() {
  return (
    <div className="h-full overflow-auto bg-background" data-testid="design-page">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-4 p-4 md:p-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Design system</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              DonkeyBox's tokens and components in both themes. The box and the docs site share one tokens.css; every ratio
              below is measured from it and enforced by a test.
            </p>
          </div>
          <Mark className="size-10 text-foreground" title="DonkeyBox" />
        </header>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <ThemePanel theme="light" />
          <ThemePanel theme="dark" />
        </div>
      </div>
    </div>
  );
}

function ThemePanel({ theme }: { theme: ThemeName }) {
  const t = TOKENS[theme];
  const ratio = (fg: string, bg: string) => ratioLabel(contrast(colorOf(t, fg), colorOf(t, bg)));
  return (
    <section className={cn(theme, "flex flex-col gap-5 rounded-xl border bg-background p-4 text-foreground")} data-testid={`design-${theme}`}>
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-semibold capitalize">{theme}</span>
        <Num size="xs" tone="muted">tokens.css</Num>
      </div>

      <Section title="Surfaces · sunken < background < card < popover < overlay">
        <div className="relative grid h-40 grid-cols-[1fr_1.4fr] gap-3 overflow-hidden rounded-lg border bg-background p-3">
          <div className="flex flex-col gap-2">
            <span className="text-[11px] text-muted-foreground">background</span>
            <div className="flex-1 rounded-md bg-sunken p-2 shadow-[inset_0_1px_2px_rgb(0_0_0/0.06)]">
              <span className="text-[11px] text-muted-foreground">sunken</span>
            </div>
          </div>
          <div className="relative rounded-lg border bg-card p-2 shadow-sm">
            <span className="text-[11px] text-muted-foreground">card</span>
            <div className="absolute left-6 top-7 w-28 rounded-md border bg-popover p-2 shadow-md">
              <span className="text-[11px] text-muted-foreground">popover</span>
            </div>
          </div>
          <div className="absolute inset-y-0 right-0 flex w-[34%] items-center justify-center bg-scrim">
            <div className="w-[80%] rounded-lg border bg-overlay p-2 shadow-lg">
              <span className="text-[11px] text-muted-foreground">overlay</span>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Interface roles · contrast on their ground">
        <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2 [&>*]:border-b">
          <Role name="foreground" note="ink on background" r={ratio("foreground", "background")} />
          <Role name="muted-foreground" note="secondary ink on card" r={ratio("muted-foreground", "card")} />
          <Role name="primary" note="the dark button" r={ratio("primary-foreground", "primary")} />
          <Role name="accent" note="hover, pressed, menu cursor" r={ratio("accent-foreground", "accent")} />
          <Role name="brand" note="the orange mark, 3:1 on card" r={ratio("brand", "card")} />
          <Role name="link" note="inline links" r={ratio("link", "card")} />
          <Role name="ring" note="focus" />
          <Role name="selection" note="text selection" />
          <Role name="border" note="hairlines, card edges" />
          <Role name="input" note="field edges" />
        </div>
      </Section>

      <Section title="Ramps · orange leads (brand), teal answers">
        {(["orange", "teal"] as const).map((ramp) => (
          <div key={ramp} className="grid grid-cols-11 gap-1">
            {STEPS.map((s) => (
              <div key={s} className="flex flex-col gap-1">
                <span className="h-8 rounded" style={{ background: `var(--${ramp}-${s})` }} />
                <Num size="xs" tone="muted">{s}</Num>
              </div>
            ))}
          </div>
        ))}
        <div className="flex flex-wrap gap-1.5">
          {(["ground", "soft", "border", "fill", "ink"] as const).map((role) => (
            <span key={role} className="rounded-md border px-2 py-1 text-xs" style={{ background: `var(--orange-${role === "ink" ? "soft" : role})`, color: role === "ink" ? "var(--orange-ink)" : role === "fill" ? "var(--orange-fill-fg)" : undefined }}>
              orange-{role}
            </span>
          ))}
        </div>
      </Section>

      <Section title="Status · fill, ink, subtle">
        <div className="flex flex-col gap-1.5">
          {STATUSES.map((s) => (
            <div key={s} className="grid grid-cols-[64px_repeat(3,22px)_minmax(0,1fr)_auto] items-center gap-2">
              <span className="text-xs font-medium capitalize">{s}</span>
              <span className="size-[22px] rounded" style={{ background: `var(--status-${s})` }} />
              <span className="size-[22px] rounded" style={{ background: `var(--status-${s}-ink)` }} />
              <span className="size-[22px] rounded ring-1 ring-inset ring-border" style={{ background: `var(--status-${s}-subtle)` }} />
              <span className="truncate text-[11px]" style={{ color: `var(--status-${s}-ink)` }}>Status as text takes the ink</span>
              <Num size="xs" tone="muted">{ratio(`status-${s}-ink`, "card")}</Num>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          {["working", "done", "blocked", "interrupted", "failed", "idle"].map((s) => (
            <span key={s} className="flex items-center gap-1.5"><StatusDot status={s} /> {s}</span>
          ))}
        </div>
      </Section>

      <Section title="Tags · Badge tone, hashed from the data">
        <div className="flex flex-wrap gap-1.5">
          {TAGS.map((tag) => (
            <Badge key={tag} tone={tag}>{tag} <Num size="xs" tone="inherit">{ratio(`tag-${tag}-fg`, `tag-${tag}-bg`).split(" ")[0]}</Num></Badge>
          ))}
        </div>
      </Section>

      <Section title="Data · categorical 1–8, sequential 1–7, presence">
        <div className="grid grid-cols-8 gap-1">
          {Array.from({ length: 8 }, (_, i) => (
            <span key={i} className="h-6 rounded" style={{ background: `var(--chart-${i + 1})` }} />
          ))}
        </div>
        <div className="grid grid-cols-7 overflow-hidden rounded-md">
          {Array.from({ length: 7 }, (_, i) => (
            <span key={i} className="h-5" style={{ background: `var(--chart-seq-${i + 1})` }} />
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {presencePalette.map((c, i) => (
            <span key={c} className="rounded px-1.5 py-0.5 text-[11px] font-medium text-white" style={{ background: c }}>person {i + 1}</span>
          ))}
        </div>
      </Section>

      <Section title="Type · Inter for words, JetBrains Mono for data">
        <div className="flex flex-col gap-2">
          <span className="text-lg font-semibold tracking-tight">Heading, Inter 600</span>
          <span className="text-sm">Body, Inter 400. Prose and descriptions read in this voice.</span>
          <span className={microLabelClass}>Micro-label, Inter, not mono</span>
          <span className="flex flex-wrap items-baseline gap-3">
            <Num size="display">1,284</Num>
            <Num>run #4182</Num>
            <Num tone="muted">2026-10-17 19:42</Num>
            <Num tone="muted">3m 12s</Num>
            <Badge variant="outline" mono>POST</Badge>
          </span>
        </div>
      </Section>

      <Section title="Components">
        <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
          <Card size="sm">
            <CardHeader>
              <CardTitle>Buttons and controls</CardTitle>
              <CardDescription>Chrome is neutral: no button carries a hue.</CardDescription>
              <CardAction><Badge variant="success">Healthy</Badge></CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm">Primary</Button>
                <Button size="sm" variant="secondary">Secondary</Button>
                <Button size="sm" variant="outline">Outline</Button>
                <Button size="sm" variant="ghost">Ghost</Button>
                <Button size="sm" variant="destructive">Delete</Button>
              </div>
              <Input placeholder="Resting field" />
              <Input defaultValue="Focused field" className="border-ring ring-3 ring-ring/50" />
              <Input defaultValue="Invalid field" aria-invalid />
              <div className="flex items-center gap-4 text-sm">
                <label className="flex items-center gap-2"><Checkbox defaultChecked /> Checked</label>
                <Tabs defaultValue="open"><TabsList><TabsTrigger value="open">Open</TabsTrigger><TabsTrigger value="all">All</TabsTrigger></TabsList></Tabs>
                <Kbd>⌘K</Kbd>
              </div>
              <p className="text-xs text-muted-foreground">
                Muted copy with an <a href="#design" className="text-link underline underline-offset-2">inline link</a> and <span className="bg-selection">selected text</span>.
              </p>
            </CardContent>
          </Card>
          <div className="flex flex-col gap-2">
            <Alert><Info className="text-status-info-ink" /><AlertTitle>Info</AlertTitle><AlertDescription>A neutral notice.</AlertDescription></Alert>
            <Alert><CheckCircle2 className="text-status-good-ink" /><AlertTitle>Saved</AlertTitle><AlertDescription>Success says so and gets out of the way.</AlertDescription></Alert>
            <Alert variant="warning"><AlertTriangle /><AlertTitle>Warning</AlertTitle><AlertDescription>Warning ink, because the warning fill fails as text.</AlertDescription></Alert>
            <Alert variant="destructive"><XCircle /><AlertTitle>Error</AlertTitle><AlertDescription>Critical ink on the card.</AlertDescription></Alert>
            <div className="flex flex-wrap items-center gap-2">
              <Badge>Default</Badge>
              <Badge variant="success">Success</Badge>
              <Badge variant="warning">Warning</Badge>
              <Badge variant="destructive">Error</Badge>
              <Badge variant="outline" pulse>Live</Badge>
              <LiveDot tone="good" />
              <PixelSpinner size="sm" />
            </div>
          </div>
        </div>
      </Section>

      <Section title="A canvas window">
        <div className="wb-canvas-bg rounded-lg border p-4">
          <section className="flex h-36 flex-col overflow-hidden rounded-lg border bg-card text-card-foreground shadow-md">
            <header className="flex h-8 shrink-0 items-center gap-2 border-b bg-muted/60 px-2">
              <Terminal className="size-3.5 text-muted-foreground" />
              <span className="text-xs font-medium">Terminal · shell</span>
            </header>
            <pre className="flex-1 bg-card p-3 font-mono text-xs text-foreground">
              <span className="text-brand">$</span> claude{"\n"}<span className="text-muted-foreground">Welcome back. 3 tasks in the queue.</span>
            </pre>
          </section>
        </div>
      </Section>
    </section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className={microLabelClass}>{title}</span>
      {children}
    </div>
  );
}

function Role({ name, note, r }: { name: string; note: string; r?: string }) {
  return (
    <div className="grid grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2 py-1">
      <span className="size-[18px] rounded ring-1 ring-inset ring-border" style={{ background: `var(--${name})` }} />
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-xs font-medium">{name}</span>
        <span className="truncate text-[11px] text-muted-foreground">{note}</span>
      </div>
      {r ? <Num size="xs" tone="muted">{r}</Num> : null}
    </div>
  );
}
