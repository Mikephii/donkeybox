// Keys are macOS ones: the recorder's Chromium runs on a Mac, so code-server binds Cmd, not Ctrl.
// The clips, in recording order: each picks up where the last left the box. A clip takes the cast
// and returns the camera's recording plus how to cut it: segments [from, to, speed] between marks,
// and the mark that makes the poster.
import { Camera } from "./camera.mjs";
import { acme, api, screen, sh, ticket, until } from "./box.mjs";
import { sleep } from "./people.mjs";

const inTerm = (p, id, text, timeout = 60000) =>
  until(async () => (await screen(p, id)).includes(text), { timeout, what: `"${text}" in ${id}` });

/** A point inside a window, as fractions of its size. */
async function spot(p, id, fx, fy) {
  const b = await p.box(p.window(id));
  return [b.x + b.width * fx, b.y + b.height * fy];
}

async function park(p, id, fx, fy, ms = 10) {
  const [x, y] = await spot(p, id, fx, fy);
  await p.glide(x, y, ms);
}

const openRequests = async () => (await api("/requests?status=open")).length;
const runsNamed = async (title) => (await api("/runs")).filter((r) => r.title.includes(title));

export const clips = {
  // Alice runs the estimate skill by hand in the box's Claude Code; it asks the team before splitting.
  async "c1-estimate"({ alice, kai, sam, raw }) {
    for (const p of [alice, kai, sam]) await p.go("/c/work");
    await park(kai, "work-runs", 0.4, 0.6);
    await park(sam, "work-runs", 0.75, 0.85);
    await park(alice, "work-claude", 0.55, 0.45);
    const cam = new Camera(alice.page, raw);
    await cam.start();
    await sleep(700);
    await alice.click(alice.window("work-claude"), { dx: 0.3, dy: 0.3, ms: 500 });
    await alice.type("claude");
    await inTerm(alice, "work-claude", "/data/workspace", 30000);
    await sleep(1000);
    cam.mark("claude");
    await alice.type("/ticket-estimate DK-42", { delay: 70 });
    cam.mark("asked");
    await park(kai, "work-requests", 0.5, 0.75, 1500);
    await until(async () => (await openRequests()) > 0, { what: "the split request" });
    cam.mark("request");
    await park(sam, "work-requests", 0.8, 0.85, 1200);
    await sleep(3000);
    cam.mark("poster");
    await sleep(800);
    await cam.stop();
    return { cam, segments: [["start", "claude", 1], ["claude", "asked", 1], ["asked", "request", 1.5], ["request", "end", 1]], poster: "poster" };
  },

  // Kai approves the split from his own browser; Alice's Claude carries on and creates the tickets.
  async "c2-approve"({ alice, kai, raw }) {
    const cam = new Camera(alice.page, raw);
    await cam.start();
    await sleep(800);
    await kai.click(kai.window("work-requests").getByRole("button", { name: "Approve" }), { ms: 1200, pause: 450 });
    cam.mark("approved");
    await until(async () => ticket("DK-42")?.status === "Split", { what: "DK-42 split" });
    await inTerm(alice, "work-claude", "marked Split", 30000);
    cam.mark("done");
    await sleep(2600);
    cam.mark("poster");
    await sleep(500);
    await cam.stop();
    return { cam, segments: [["start", "approved", 1], ["approved", "done", 1.3], ["done", "end", 1]], poster: "poster" };
  },

  // Sam changes the skill in the browser editor (code-server on the box) and commits it.
  async "c3-skill"({ sam, alice, raw }) {
    await sam.go("/c/skills");
    await alice.go("/c/skills");
    await park(alice, "skills-activity", 0.5, 0.75);
    const f = sam.window("skills-code").frameLocator("iframe").first();
    const item = (name) => f.getByRole("treeitem", { name, exact: true });
    await item(".claude").waitFor({ timeout: 60000 });
    await park(sam, "skills-code", 0.6, 0.5);
    const cam = new Camera(sam.page, raw);
    await cam.start();
    await sleep(600);
    for (const name of [".claude", "skills", "ticket-estimate"]) {
      await sam.click(item(name), { ms: 550, pause: 200 });
      await sleep(450);
    }
    // A double-click opens the file for editing with the cursor in it (one click only previews it).
    await sam.click(item("SKILL.md"), { ms: 550, pause: 200, double: true });
    await sleep(1400);
    await sam.page.keyboard.press("Meta+ArrowDown");
    await sleep(500);
    cam.mark("typing");
    await sam.page.keyboard.press("Enter");
    await sam.type("Also give every ticket a testing estimate: what to test, and its points.", { delay: 38, enter: false });
    await sleep(500);
    await sam.page.keyboard.press("Meta+s");
    cam.mark("saved");
    await sleep(1200);
    await sam.click(f.locator('.action-item a[aria-label^="Source Control"]').first(), { ms: 700 });
    await sleep(1200);
    const message = f.locator(".scm-editor .monaco-editor .view-lines").first();
    await sam.click(message, { ms: 500 });
    await sam.type("ticket-estimate: estimate testing too", { delay: 40, enter: false });
    await sleep(400);
    await sam.page.keyboard.press("Meta+Enter");
    await sleep(800);
    // VS Code asks once whether to stage everything; yes.
    const yes = f.getByRole("button", { name: /^(Yes|Always)$/ }).first();
    if (await yes.isVisible().catch(() => false)) await sam.click(yes, { ms: 400 });
    await until(async () => sh("git -C /data/workspace log -1 --format=%s").includes("testing"), { what: "the commit" });
    cam.mark("committed");
    await sleep(2200);
    cam.mark("poster");
    await sleep(500);
    await cam.stop();
    return { cam, segments: [["start", "typing", 1], ["typing", "saved", 1.2], ["saved", "end", 1]], poster: "saved" };
  },

  // Alice asks Claude Code for a workflow; it writes the skill, the workflow and the rule.
  async "c4-workflow"({ alice, raw }) {
    await alice.go("/c/work");
    await park(alice, "work-claude", 0.5, 0.5);
    const cam = new Camera(alice.page, raw);
    await cam.start();
    await sleep(700);
    await alice.click(alice.window("work-claude"), { dx: 0.45, dy: 0.92, ms: 500 });
    await alice.type(
      "please make a workflow for me where after PRs merge, it checks what was merged in the codebase and attaches QA notes to the ticket in Jira. it can run on its own, no need to ask",
      { delay: 28 },
    );
    cam.mark("asked");
    await until(async () => (await api("/workflows")).some?.((w) => w.id === "qa-notes") || JSON.stringify(await api("/workflows")).includes("qa-notes"), { what: "the qa-notes workflow" });
    await inTerm(alice, "work-claude", "next PR that merges", 40000);
    cam.mark("answered");
    await sleep(2500);
    cam.mark("answer-read");
    await alice.click(alice.page.getByTestId("nav-workflows"), { ms: 800 });
    await sleep(1500);
    await alice.click(alice.page.getByTestId("workflow-card-qa-notes"), { ms: 700 });
    await sleep(1200);
    const rules = alice.page.getByTestId("wf-tab-rules");
    if (await rules.isVisible().catch(() => false)) await alice.click(rules, { ms: 600 });
    await sleep(2200);
    cam.mark("poster");
    await sleep(500);
    await cam.stop();
    return { cam, segments: [["start", "asked", 3.5], ["asked", "answered", 1.4], ["answered", "end", 1.2]], poster: "answer-read" };
  },

  // GitHub says PR #87 merged. Nobody is at a keyboard; the QA notes workflow runs on its own.
  async "c5-merged"({ alice, raw }) {
    await alice.go("/runs");
    await alice.glide(700, 420, 10);
    const cam = new Camera(alice.page, raw);
    await cam.start();
    await sleep(1500);
    acme("hook-merged");
    cam.mark("hook");
    const run = await until(async () => (await runsNamed("QA notes"))[0], { what: "the QA notes run" });
    await sleep(1200);
    await alice.click(alice.page.getByTestId(`runs-row-${run.id}`).getByRole("link").first(), { ms: 700 });
    cam.mark("opened");
    await until(async () => ["done", "idle"].includes((await api(`/runs/${run.id}`)).run?.status), { timeout: 90000, what: "the QA notes run to finish" });
    cam.mark("finished");
    await sleep(2500);
    cam.mark("poster");
    await alice.glide(900, 500, 600);
    await sleep(400);
    await cam.stop();
    return { cam, segments: [["start", "opened", 1], ["opened", "finished", 1.4], ["finished", "end", 1]], poster: "poster" };
  },

  // Sam and Alice in one terminal session: same box, same checkout, no laptop setup.
  async "c6-terminal"({ alice, sam, raw }) {
    await alice.go("/c/shop");
    await sam.go("/c/shop");
    await park(alice, "shop-preview", 0.5, 0.6);
    await park(sam, "shop-tests", 0.5, 0.5);
    const cam = new Camera(alice.page, raw);
    await cam.start();
    await sleep(700);
    await sam.click(sam.window("shop-tests"), { dx: 0.4, dy: 0.3, ms: 500 });
    await sam.type("git log --oneline -4", { delay: 60 });
    await sleep(900);
    await sam.type("npm test", { delay: 70 });
    await inTerm(sam, "shop-tests", "pass 2", 30000);
    cam.mark("tested");
    await sleep(1200);
    await alice.click(alice.window("shop-tests"), { dx: 0.5, dy: 0.7, ms: 700 });
    await alice.type("curl -s localhost:3000/orders.csv | head -4", { delay: 45 });
    await sleep(2400);
    cam.mark("poster");
    await sleep(500);
    await cam.stop();
    return { cam, segments: [["start", "tested", 1.2], ["tested", "end", 1]], poster: "poster" };
  },

  // Log in to an MCP server once, on the box; every person's session and every workflow can use it.
  async "c7-mcp"({ alice, raw }) {
    await alice.go("/c/work");
    await park(alice, "work-claude", 0.5, 0.5);
    const cam = new Camera(alice.page, raw);
    await cam.start();
    await sleep(600);
    await alice.click(alice.window("work-claude"), { dx: 0.45, dy: 0.92, ms: 500 });
    await alice.type("/exit", { delay: 60 });
    await sleep(1500);
    await alice.type("clear", { delay: 40 });
    await alice.type("claude mcp add --scope user --transport http atlassian https://mcp.atlassian.com/v1/mcp", { delay: 22 });
    await inTerm(alice, "work-claude", "to user config", 20000);
    await sleep(700);
    await alice.type("claude mcp list", { delay: 50 });
    await inTerm(alice, "work-claude", "atlassian: https://mcp.atlassian.com/v1/mcp (HTTP) - ✔ Connected", 40000);
    cam.mark("connected");
    await sleep(1800);
    await alice.click(alice.page.getByTestId("nav-workflows"), { ms: 800 });
    await sleep(1200);
    await alice.click(alice.page.getByTestId("workflow-card-tickets"), { ms: 700 });
    await sleep(900);
    await alice.click(alice.page.getByTestId("wf-tab-mcp"), { ms: 600 });
    await sleep(700);
    await alice.click(alice.page.getByTestId("mcp-import"), { ms: 600 });
    await sleep(900);
    await alice.click(alice.page.getByTestId("mcp-found-atlassian").locator("button,[role=checkbox]").first(), { ms: 600 });
    await sleep(500);
    await alice.click(alice.page.getByTestId("mcp-import-run"), { ms: 600 });
    await sleep(1500);
    const save = alice.page.getByRole("button", { name: /^Save/ }).first();
    if (await save.isEnabled().catch(() => false)) await alice.click(save, { ms: 600 });
    await sleep(2200);
    cam.mark("poster");
    await sleep(400);
    await cam.stop();
    return { cam, segments: [["start", "connected", 2.2], ["connected", "end", 1.4]], poster: "poster" };
  },

  // A run wants to delete a ticket; the guard stops it until a person decides. Jo says no.
  async "c8-guard"({ alice, jo, raw }) {
    await alice.go("/c/triage");
    await jo.go("/c/triage");
    await park(alice, "triage-activity", 0.5, 0.7);
    await park(jo, "triage-activity", 0.3, 0.4);
    const cam = new Camera(alice.page, raw);
    await cam.start();
    await sleep(1200);
    sh('wb run --group tickets --prompt "/jira-tickets clean up duplicates" --title "Clean up duplicate tickets"');
    cam.mark("run");
    await until(async () => (await openRequests()) > 0, { timeout: 60000, what: "the guard request" });
    cam.mark("asked");
    await sleep(1800);
    await jo.click(jo.window("triage-requests").getByRole("button", { name: "Deny" }), { ms: 1300, pause: 400 });
    await sleep(500);
    const reason = jo.window("triage-requests").locator("input,textarea").first();
    if (await reason.isVisible().catch(() => false)) {
      await jo.click(reason, { ms: 300 });
      await jo.type("Keep it: it has the customer's screenshots. I'll merge them.", { delay: 30, enter: false });
      await sleep(300);
      await jo.click(jo.window("triage-requests").getByRole("button", { name: "Deny" }).last(), { ms: 500 });
    }
    cam.mark("denied");
    const run = (await runsNamed("Clean up duplicate tickets"))[0];
    await until(async () => ["done", "idle", "failed"].includes((await api(`/runs/${run.id}`)).run?.status), { timeout: 60000, what: "the clean-up run to stop" });
    await sleep(1500);
    cam.mark("poster");
    await sleep(500);
    await cam.stop();
    return { cam, segments: [["start", "asked", 1.3], ["asked", "end", 1]], poster: "denied" };
  },

  // Last night's scheduled run, and the shop's own web server running in the box.
  async "c9-nightly"({ alice, raw }) {
    await alice.go("/runs");
    await alice.glide(640, 300, 10);
    const cam = new Camera(alice.page, raw);
    await cam.start();
    await sleep(900);
    const nightly = (await runsNamed("Nightly housekeeping"))[0];
    await alice.hover(alice.page.getByTestId(`runs-row-${nightly.id}`), 700);
    await sleep(700);
    await alice.click(alice.page.getByTestId(`runs-row-${nightly.id}`).getByRole("link").first(), { ms: 500 });
    await sleep(3200);
    cam.mark("run");
    await alice.click(alice.page.getByTestId("nav-canvases"), { ms: 800 });
    await sleep(900);
    await alice.click(alice.page.getByTestId("canvas-tabs").getByRole("button", { name: "Shop", exact: true }), { ms: 700 });
    await sleep(1500);
    await alice.hover(alice.window("shop-preview").frameLocator("iframe").first().getByText("Download CSV"), 900);
    await sleep(2000);
    cam.mark("poster");
    await sleep(400);
    await cam.stop();
    return { cam, segments: [["start", "end", 1]], poster: "run" };
  },

  // OpenCode, logged in once by Sam on the box; Kai opens it in his own terminal and it is ready.
  async "c10-opencode"({ alice, sam, kai, raw }) {
    for (const p of [alice, sam, kai]) await p.go("/c/agents");
    await park(alice, "agents-sam", 0.5, 0.85);
    await park(sam, "agents-sam", 0.5, 0.5);
    await park(kai, "agents-kai", 0.5, 0.5);
    const cam = new Camera(alice.page, raw);
    await cam.start();
    await sleep(700);
    await sam.click(sam.window("agents-sam"), { dx: 0.4, dy: 0.3, ms: 500 });
    await sam.type("opencode auth login", { delay: 55 });
    await inTerm(sam, "agents-sam", "Select provider", 30000);
    await sleep(900);
    await sam.type("anthropic", { delay: 80, enter: false });
    await sleep(700);
    await sam.page.keyboard.press("Enter");
    await inTerm(sam, "agents-sam", "API key", 15000);
    await sleep(600);
    await sam.type("sk-ant-api03-acme-team-key-000000000000000000000000", { delay: 6 });
    await inTerm(sam, "agents-sam", "Done", 15000);
    cam.mark("logged-in");
    await sleep(1000);
    await kai.click(kai.window("agents-kai"), { dx: 0.4, dy: 0.3, ms: 700 });
    await kai.type("opencode", { delay: 70 });
    await inTerm(kai, "agents-kai", "Build", 30000);
    await sleep(1500);
    cam.mark("open");
    await kai.type("what does GET /orders.csv return?", { delay: 45 });
    await inTerm(kai, "agents-kai", "DK-44", 40000);
    cam.mark("answered");
    await sleep(3000);
    cam.mark("poster");
    await sleep(400);
    await cam.stop();
    return { cam, segments: [["start", "logged-in", 1.8], ["logged-in", "open", 2], ["open", "answered", 1.3], ["answered", "end", 1]], poster: "poster" };
  },
};

/** The hero: the first five clips' best moments, one after another. */
export const hero = [
  ["c1-estimate", "claude", "poster"],
  ["c2-approve", "start", "poster"],
  ["c3-skill", "typing", "committed"],
  ["c4-workflow", "asked", "answer-read"],
  ["c5-merged", "start", "poster"],
];
