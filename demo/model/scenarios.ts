// What the demo model says, turn by turn. A scenario is chosen by the prompt that started the exchange
// (a person's message, a slash command, or a run's prompt from a rule); the turn number is how many
// replies have followed it. Each step is some text, then at most one tool call.

export interface Step {
  text?: string;
  /** A shell command, sent as Claude Code's Bash tool or OpenCode's bash tool. */
  shell?: string;
  why?: string;
  timeout?: number;
  /** Any other tool, by its exact name (MCP tools are mcp__<server>__<tool>). */
  tool?: { name: string; input: Record<string, unknown> };
  /** Milliseconds of "thinking" before the reply starts. */
  delay?: number;
}

interface Scenario {
  id: string;
  match: (prompt: string) => boolean;
  /** lastResult: the last tool result; history: every tool result since the prompt; all: the whole conversation. */
  steps: Step[] | ((lastResult: string, history: string, prompt: string, all: string) => Step[]);
}

const QA_SKILL = `---
name: qa-notes
description: After a PR merges, read what changed and attach QA notes to its Jira ticket. Use for /qa-notes REPO #N.
---

# QA notes

\`/qa-notes REPO #N "TITLE" by AUTHOR\` runs when GitHub says a pull request merged.

1. Read the merge in the repo's checkout (\`~/shop\` for acme/shop): \`git log -1 --stat\` and \`git show\`.
2. Find the ticket key (DK-123) in the branch name or the title. No key: say so and stop.
3. Write 3 to 5 QA notes a tester can follow: what to check, where, and the edge cases the diff suggests.
4. \`jira comment KEY "QA notes for REPO #N: ..."\`, then \`jira update KEY --status "In QA"\`.

Do not raise requests; this workflow runs on its own. End with one line: the ticket and what you did.
`;

const SPLIT = `| Ticket | Points | Why |
|---|---|---|
| CSV export endpoint for orders, with an admin download button | 3 | New route, CSV encoding, a button |
| Weekly orders email with the CSV attached | 2 | A Monday 8am schedule and one email |
`;

// Tickets the estimate skill meets in the "day on the box" footage, by words in their summary (their
// keys depend on what was created before them). A split is two [summary, points, why] rows.
const SPLITS: [RegExp, [string, number, string][]][] = [
  [/Stock levels/i, [["Show how many are left on the product page", 2, "One query and a label"], ["Email ops when stock drops below 5", 3, "A nightly check and an email"]]],
  [/Bulk price/i, [["Upload a price spreadsheet and preview every change", 3, "Parse it, match SKUs, a preview table"], ["Apply the changes in one batch, with undo", 2, "One transaction and a revert"]]],
  [/Gift cards/i, [["Sell gift cards and email the code", 3, "A product type and an email"], ["Redeem a gift card at checkout", 3, "A code field and a balance"]]],
];
const ONE: [RegExp, { points: number; why: string; test: [number, string] }][] = [
  [/Low-stock badge/i, { points: 2, why: "A badge on the product card, from the stock count the page already has.", test: [1, "the badge at 5, 1 and 0 left, and that it goes away when restocked"] }],
];
const keyOf = (p: string) => (p.match(/ARGUMENTS:\s*(DK-\d+)/) ?? p.match(/ticket-estimate\s+(DK-\d+)/))?.[1] ?? "DK-?";
const summaryIn = (h: string) => h.match(/DK-\d+ {2}([^\\"]+)/)?.[1] ?? "";
const createdIn = (h: string) => [...h.matchAll(/created (DK-\d+)/g)].map((m) => m[1]!);
const splitFor = (h: string) => SPLITS.find(([re]) => re.test(summaryIn(h)))?.[1] ?? SPLITS[1]![1];
const table = (rows: [string, number, string][], keys?: string[]) =>
  (keys ? "| Ticket | Summary | Points |\n|---|---|---|\n" : "| Summary | Points | Why |\n|---|---|---|\n") +
  rows.map(([s, n, why], i) => (keys ? `| ${keys[i]} | ${s} | ${n} |` : `| ${s} | ${n} | ${why} |`)).join("\n") + "\n";
const creates = (rows: [string, number, string][], parent: string) => rows.map(([s, n]) => `jira create "${s}" --type Story --estimate ${n} --parent ${parent}`).join(" && ");
const nameOf = (email: string) => email.replace(/@.*/, "").replace(/^./, (c) => c.toUpperCase());

const scenarios: Scenario[] = [
  {
    // Run by a person: they are at the keyboard, so it splits the ticket itself and opens what it did.
    id: "estimate-by-hand",
    match: (p) => /# Ticket estimate/.test(p) && keyOf(p) === "DK-38",
    steps: (_last, h) => {
      const rows = splitFor(h);
      const [a, b] = createdIn(h);
      const doc = `# DK-38: split into two\n\n_Stock levels on the product page, and an email when stock runs low_\n\n${table(rows, [a ?? "DK-?", b ?? "DK-?"])}\n**Why two:** the label ships with the product page; the email needs a nightly check and its own template.\n\nDK-38 links to both and is marked Split.\n`;
      return [
        { text: "Reading the ticket.", shell: "jira show DK-38", why: "Read DK-38", delay: 1100 },
        { text: "Two jobs: the label on the product page, and the low-stock email. You're here, so I'll split it now.", shell: creates(rows, "DK-38"), why: "Create the two tickets" },
        { shell: `jira comment DK-38 "Split into ${a} (${rows[0]![1]} pts) and ${b} (${rows[1]![1]} pts)." && jira update DK-38 --status Split`, why: "Note the split on DK-38" },
        { tool: { name: "Write", input: { file_path: "/tmp/DK-38-estimate.md", content: doc } } },
        { shell: "wb open /tmp/DK-38-estimate.md", why: "Show the estimate beside the terminal" },
        { text: `DK-38 is split into **${a}** (${rows[0]![1]} pts) and **${b}** (${rows[1]![1]} pts). The estimate is open beside this terminal.` },
      ];
    },
  },
  {
    // Run by a workflow (a new ticket): nobody is watching, so a split goes to the Inbox and the run ends.
    id: "estimate-run",
    match: (p) => /# Ticket estimate/.test(p) && !/DK-4[2]\b/.test(keyOf(p)) && keyOf(p) !== "DK-38",
    steps: (_last, h, prompt) => {
      const KEY = keyOf(prompt);
      const one = ONE.find(([re]) => re.test(summaryIn(h)))?.[1];
      const show = { text: "Reading the ticket.", shell: `jira show ${KEY}`, why: `Read ${KEY}`, delay: 900 };
      if (one) {
        const testing = /testing estimate/i.test(prompt);
        const note = `${one.points} points: ${one.why}` + (testing ? ` Testing: ${one.test[0]} point. Check ${one.test[1]}.` : "");
        return [
          show,
          { text: testing ? `One piece of work: ${one.points} points. The skill asks for a testing estimate too.` : `One piece of work: ${one.points} points.`, shell: `jira estimate ${KEY} ${one.points} && jira comment ${KEY} "${note}"`, why: `Estimate ${KEY}` },
          { text: `**${KEY}: ${one.points} points.** ${one.why}` + (testing ? `\n\n**Testing: ${one.test[0]} point.** Check ${one.test[1]}.` : "") },
        ];
      }
      const rows = splitFor(h);
      return [
        show,
        { text: `${KEY} is two pieces of work. Nobody is watching this run, so the split goes to the team.`, tool: { name: "Write", input: { file_path: `/tmp/${KEY}-split.md`, content: table(rows) } } },
        { shell: `wb request --group estimates --title "Split ${KEY} into two tickets?" --body-file /tmp/${KEY}-split.md`, why: "Post the split to the Inbox" },
        { text: `Posted the split to the Inbox. This run ends here; whoever answers starts the next one.` },
      ];
    },
  },
  {
    // The answer to a split card, in a new run that picks up where the first one stopped.
    id: "estimate-answer",
    match: (p) => /^Approved by \S+: Split DK-\d+/m.test(p),
    steps: (_last, h, prompt, all) => {
      const key = prompt.match(/Split (DK-\d+)/)![1]!;
      const who = nameOf(prompt.match(/^Approved by (\S+):/m)![1]!);
      // The first run read the ticket; this one resumes its conversation.
      const rows = splitFor(all.slice(all.indexOf(`${key}  `)));
      const [a, b] = createdIn(h);
      return [
        { text: `${who} approved. Creating the two tickets.`, shell: creates(rows, key), why: "Create the split tickets", delay: 900 },
        { shell: `jira comment ${key} "Split into ${a} (${rows[0]![1]} pts) and ${b} (${rows[1]![1]} pts), approved by ${who}." && jira update ${key} --status Split`, why: `Note the split on ${key}` },
        { text: `${key} is split, approved by ${who}:\n\n${table(rows, [a ?? "DK-?", b ?? "DK-?"])}` },
      ];
    },
  },
  {
    id: "workflow",
    match: (p) => /make (me )?a workflow|workflow for me/i.test(p),
    steps: [
      { text: "I'll write a skill for it, give it a workflow of its own, and start it on every merged PR.", tool: { name: "mcp__workbench__write_skill", input: { name: "qa-notes", content: QA_SKILL } }, delay: 1400 },
      {
        tool: {
          name: "mcp__workbench__upsert_workflow",
          input: {
            id: "qa-notes",
            group: {
              title: "QA notes",
              description: "After a PR merges, attach QA notes to its ticket.",
              skill: "qa-notes",
              autonomy: "autonomous",
              model: "haiku",
              workdir: "/data/home/shop",
              allowedTools: ["Bash(git:*)", "Bash(jira:*)"],
            },
          },
        },
      },
      {
        tool: {
          name: "mcp__workbench__upsert_rule",
          input: {
            rule: {
              id: "qa-notes-on-merge",
              on: "github.pull_request.merged",
              group: "qa-notes",
              title: "QA notes: {{payload.repo}} #{{payload.number}}",
              prompt: '/qa-notes {{payload.repo}} #{{payload.number}} "{{payload.title}}" by {{payload.author}}',
            },
          },
        },
      },
      {
        text:
          "Done. **QA notes** is set up:\n\n" +
          "- **Skill** `qa-notes`: reads the merge, finds the ticket key, writes 3–5 QA notes and comments on the ticket.\n" +
          "- **Workflow** QA notes, autonomous, as you asked: it comments without asking anyone. You can make it ask first on its page.\n" +
          "- **Rule** on `github.pull_request.merged` from the GitHub source, which already posts to this box at `/hooks/github`.\n\n" +
          "The next PR that merges in acme/shop will get QA notes on its ticket.",
      },
    ],
  },
  {
    id: "estimate",
    match: (p) => /ticket-estimate|# Ticket estimate/i.test(p) && /DK-42/.test(p),
    steps: (last) => [
      { text: "Reading the ticket.", shell: "jira show DK-42", why: "Read DK-42", delay: 1200 },
      {
        text: "DK-42 is two pieces of work: an export endpoint with a download button, and a weekly email. I'll propose a split and ask the team first.",
        tool: { name: "Write", input: { file_path: "/tmp/DK-42-split.md", content: SPLIT } },
      },
      {
        shell: 'wb request --group estimates --title "Split DK-42 into two tickets?" --body-file /tmp/DK-42-split.md --action approve:Approve --action changes:"Needs changes" --action reject:Reject --wait',
        why: "Ask the team and wait for an answer",
        timeout: 600000,
      },
      /reject/i.test(last)
        ? { text: "Rejected, so I'll estimate it as one ticket.", shell: "jira estimate DK-42 5", why: "Estimate DK-42" }
        : { text: "Kai approved. Creating the two tickets.", shell: 'jira create "CSV export endpoint for orders" --type Story --estimate 3 --parent DK-42 && jira create "Weekly orders email with the CSV attached" --type Story --estimate 2 --parent DK-42', why: "Create the split tickets" },
      { shell: 'jira comment DK-42 "Split into DK-43 (3 pts) and DK-44 (2 pts), approved by Kai." && jira update DK-42 --status Split', why: "Note the split on DK-42" },
      { text: "DK-42 is split:\n\n| Ticket | Summary | Points |\n|---|---|---|\n| DK-43 | CSV export endpoint for orders | 3 |\n| DK-44 | Weekly orders email with the CSV attached | 2 |\n\nDK-42 links to both and is marked Split." },
    ],
  },
  {
    id: "qa-notes",
    match: (p) => /\/qa-notes|^# QA notes/m.test(p),
    steps: [
      { text: "Reading what merged in acme/shop #87.", shell: "git log -1 --stat --format='%h %s%n%n%b'", why: "Read the merge", delay: 1000 },
      { shell: "git show HEAD^2 --stat --format='%h %an: %s'", why: "Read the change" },
      {
        text: "The branch is dk-43-csv-export, so this is DK-43. Attaching QA notes.",
        shell:
          'jira comment DK-43 "QA notes for acme/shop #87 (Add CSV export endpoint): 1) Admin > Orders: Download CSV saves orders.csv with a header row and one row per order. 2) Totals keep their decimals (142.25, not 142.3). 3) A customer name with a comma or quote stays in one cell (try Sam \\"O\\" Neil, Jr). 4) GET /orders.csv sends text/csv as an attachment. 5) The weekly email (DK-44) is not in this PR." && jira update DK-43 --status "In QA"',
        why: "Comment on DK-43 and move it to In QA",
      },
      { text: "DK-43 has 5 QA notes and is In QA." },
    ],
  },
  {
    id: "cleanup",
    match: (p) => /clean up duplicates/i.test(p),
    steps: [
      { text: "Listing the tickets.", shell: "jira list", why: "List tickets", delay: 1000 },
      { text: "DK-39 duplicates DK-40 (same summary, reported later). Deleting DK-39.", shell: "jira delete DK-39", why: "Delete the duplicate" },
      { text: "Jo denied deleting DK-39 (\"Keep it: it has the customer's screenshots. I'll merge them.\"), so it stays. Nothing else looks duplicated; stopping here." },
    ],
  },
  {
    id: "nightly",
    match: (p) => /housekeeping nightly|ARGUMENTS: nightly/.test(p),
    steps: [
      { shell: "jira list", why: "List tickets", delay: 600 },
      { text: "Nightly: the backlog is in order. Nothing merged since yesterday, so no changelog line." },
    ],
  },
  {
    id: "opencode",
    match: (p) => /orders\.csv/i.test(p),
    steps: [
      { shell: "grep -n -A3 'orders.csv' server.js && cat orders-csv.js", why: "Find the CSV route", delay: 900 },
      {
        text:
          "`GET /orders.csv` returns this week's orders as CSV, sent as a download (`orders.csv`, `text/csv`).\n\n" +
          "- Columns: `id, customer, total, placed`, with a header row.\n" +
          "- Cells with commas or quotes are quoted, so names like `Sam \"O\" Neil, Jr` stay in one cell.\n" +
          "- It's built by `toCsv` in `orders-csv.js`, which the weekly email (DK-44) can reuse.",
      },
    ],
  },
];

export function pick(prompt: string, turn: number, lastResult: string, history = "", all = ""): Step {
  const s = scenarios.find((x) => x.match(prompt));
  if (!s) return turn === 0 ? { text: "Sure. What would you like me to do?" } : { text: "Done." };
  const steps = typeof s.steps === "function" ? s.steps(lastResult, history, prompt, all) : s.steps;
  return steps[turn] ?? { text: "Done." };
}
