// The second round of footage: what "a day on the box" and the hero loops are cut from. Two takes, each
// from a fresh box (demo/acme.sh reset). A scene records one or more cameras and returns them by name;
// demo/record2.mjs keeps their frames in out/raw/<theme>/<name>/ and encodes the ones that are clips.
//
// "workflow" take: Alice asks Claude for the QA notes workflow (C4, again) while Sam's browser watches the
//   same Claude session on the Build canvas beside the workspace files; then a PR merges (C5, again).
// "day" take: a morning on the box, in order. A new Jira ticket starts an estimate run that posts a split to
//   the Inbox and ends; Alice runs the skill by hand and it just does the job; Kai answers the card and a
//   new run carries it out; the skill gains a testing estimate and the next ticket gets one. Then the
//   overnight loop, the same canvas in four browsers, and a push landing on the box.
import { Camera } from "./camera.mjs";
import { acme, api, screen, sh, ticket, until } from "./box.mjs";
import { sleep } from "./people.mjs";
import { wander } from "./wander.mjs";

const inTerm = (p, id, text, timeout = 60000) =>
  until(async () => (await screen(p, id)).includes(text), { timeout, what: `"${text}" in ${id}` });

async function spot(p, id, fx, fy) {
  const b = await p.box(p.window(id));
  return [b.x + b.width * fx, b.y + b.height * fy];
}
async function park(p, id, fx, fy, ms = 10) {
  const [x, y] = await spot(p, id, fx, fy);
  await p.glide(x, y, ms);
}
const runsNamed = async (title) => (await api("/runs")).filter((r) => r.title.includes(title));
const openRequest = async (title) => (await api("/requests?status=open")).find((r) => r.title.includes(title));
const finished = async (id) => ["done", "idle", "failed"].includes((await api(`/runs/${id}`)).run?.status);

/** Yesterday, as the morning finds it: DK-42 was split into DK-43 and DK-44 (PR #87 is DK-43). */
function yesterday() {
  sh('jira create "CSV export endpoint for orders" --type Story --estimate 3 --parent DK-42 --reporter alice >/dev/null && jira create "Weekly orders email with the CSV attached" --type Story --estimate 2 --parent DK-42 --reporter alice >/dev/null && jira update DK-42 --status Split >/dev/null');
}

/** Starts Claude Code in a terminal window, off camera. */
async function claude(p, id) {
  await p.click(p.window(id), { dx: 0.3, dy: 0.3, ms: 10 });
  await p.type("claude", { delay: 5 });
  await inTerm(p, id, "/data/workspace", 30000);
  await sleep(1200);
}

/** Opens folders in a code window's explorer (code-server, inside an iframe). */
async function explore(p, id, names) {
  const f = p.window(id).frameLocator("iframe").first();
  const item = (name) => f.getByRole("treeitem", { name, exact: true });
  await item(names[0]).waitFor({ timeout: 90000 });
  for (const n of names) {
    // Leave a folder that is already open (an earlier scene may have opened it) as it is.
    if ((await item(n).getAttribute("aria-expanded").catch(() => null)) === "true") continue;
    await p.click(item(n), { ms: 10, pause: 50 });
    await sleep(500);
  }
}

/** Takes a window by its title bar and moves it by (dx, dy). */
async function drag(p, id, dx, dy, ms = 1100) {
  const bar = p.window(id).locator("header").first();
  const b = await p.box(bar);
  await p.glide(b.x + b.width * 0.35, b.y + b.height / 2, 700);
  await p.page.mouse.down();
  await sleep(150);
  await p.glide(p.x + dx, p.y + dy, ms);
  await sleep(120);
  await p.page.mouse.up();
}

export const takes = {
  async workflow({ alice, sam, kai, jo, raw }) {
    yesterday();
    await alice.go("/c/work");
    await claude(alice, "work-claude");
    await park(alice, "work-claude", 0.5, 0.5);
    await sam.go("/c/build");
    await explore(sam, "build-code", [".claude", "skills"]);
    await park(sam, "build-runs", 0.6, 0.6);
    await kai.go("/c/work");
    await jo.go("/c/build");
    const onWork = wander([kai], ["work-requests", "work-runs", "work-claude"]);
    const onBuild = wander([jo], ["build-code", "build-runs", "build-claude"], { seed: 11 });

    const c4 = new Camera(alice.page, raw("c4-workflow"));
    const typed = new Camera(sam.page, raw("f-typed"));
    await typed.start();
    await c4.start();
    await sleep(700);
    await alice.click(alice.window("work-claude"), { dx: 0.45, dy: 0.92, ms: 500 });
    await alice.type(
      "please make a workflow for me where after PRs merge, it checks what was merged in the codebase and attaches QA notes to the ticket in Jira. it can run on its own, no need to ask",
      { delay: 28 },
    );
    c4.mark("asked");
    typed.mark("asked");
    await until(async () => JSON.stringify(await api("/workflows")).includes("qa-notes"), { what: "the qa-notes workflow" });
    typed.mark("workflow");
    await park(sam, "build-code", 0.3, 0.45, 900);
    await inTerm(alice, "work-claude", "next PR that merges", 40000);
    c4.mark("answered");
    typed.mark("answered");
    await sleep(2500);
    c4.mark("answer-read");
    await alice.click(alice.page.getByTestId("nav-workflows"), { ms: 800 });
    await sleep(1500);
    await alice.click(alice.page.getByTestId("workflow-card-qa-notes"), { ms: 700 });
    await sleep(1200);
    const rules = alice.page.getByTestId("wf-tab-rules");
    if (await rules.isVisible().catch(() => false)) await alice.click(rules, { ms: 600 });
    await sleep(2200);
    c4.mark("poster");
    await sleep(500);
    await c4.stop();
    await onWork.stop();

    // C5: GitHub says #87 merged. Alice watches the Runs page; Sam's Build canvas shows the same run.
    await alice.go("/runs");
    await alice.glide(700, 420, 10);
    const c5 = new Camera(alice.page, raw("c5-merged"));
    await c5.start();
    await sleep(1500);
    acme("hook-merged");
    c5.mark("hook");
    typed.mark("hook");
    const run = await until(async () => (await runsNamed("QA notes"))[0], { what: "the QA notes run" });
    typed.mark("run");
    await park(sam, "build-runs", 0.4, 0.35, 900);
    await sleep(1200);
    await alice.click(alice.page.getByTestId(`runs-row-${run.id}`).getByRole("link").first(), { ms: 700 });
    c5.mark("opened");
    await until(() => finished(run.id), { timeout: 90000, what: "the QA notes run to finish" });
    c5.mark("finished");
    typed.mark("finished");
    await sleep(2500);
    c5.mark("poster");
    typed.mark("poster");
    await alice.glide(900, 500, 600);
    await sleep(400);
    await c5.stop();
    await typed.stop();
    await onBuild.stop();
    return {
      clips: {
        "c4-workflow": { cam: c4, segments: [["start", "asked", 3.5], ["asked", "answered", 1.4], ["answered", "end", 1.2]], poster: "answer-read" },
        "c5-merged": { cam: c5, segments: [["start", "opened", 1], ["opened", "finished", 1.4], ["finished", "end", 1]], poster: "poster" },
      },
      raws: { "f-typed": typed },
    };
  },

  // The landing pages' first picture: three people on the Home canvas. Sam edits the estimate skill in
  // the editor and runs it in Claude Code; merged PRs start QA notes runs on their own; Alice unlocks
  // the board, makes room and adds an Inbox window, where a split from earlier is waiting.
  async canvas({ alice, sam, kai, raw }) {
    yesterday();
    sh("bash /demo/push-qa-notes.sh");
    const split = acme("ticket", "jo", "Bulk price changes from a spreadsheet", "Ops want to change prices for a few hundred products at once: upload a spreadsheet, see every change before it goes live, then apply it.").trim();
    await until(() => openRequest(`Split ${split}`), { timeout: 90000, what: "the split card" });
    const badge = sh('jira create "Low-stock badge on product cards" --type Story --reporter kai').split(/\s+/)[1];

    for (const p of [alice, sam, kai]) await p.go("/c/home");
    await claude(alice, "home-claude");
    // The skill open in Alice's editor, at its end. (Each browser has its own editor; the terminal is shared.)
    const f = alice.window("home-code").frameLocator("iframe").first();
    await explore(alice, "home-code", [".claude", "skills"]);
    // The explorer is short at this size, so open the file by name (Cmd+P), as a person would.
    await alice.click(f.getByRole("treeitem", { name: "skills", exact: true }), { ms: 10 });
    await alice.page.keyboard.press("Meta+p");
    await sleep(600);
    await alice.page.keyboard.type("ticket-estimate/SKILL.md", { delay: 20 });
    await sleep(800);
    await alice.page.keyboard.press("Enter");
    await f.locator(".monaco-editor .view-lines").first().waitFor({ timeout: 30000 });
    await sleep(1500);
    await alice.page.keyboard.press("Meta+ArrowDown");
    await park(alice, "home-code", 0.62, 0.55);
    await park(sam, "home-claude", 0.5, 0.4);
    await park(kai, "home-runs", 0.35, 0.6);
    const others = wander([sam, kai], ["home-runs", "home-claude", "home-runs", "home-code"], { seed: 5 });

    const cam = new Camera(alice.page, raw("c15-canvas"));
    await cam.start();
    await sleep(1200);
    acme("hook-merged", "121", "Order history filters", "dk-41-order-filters", "jo");
    cam.mark("pr121");
    await sleep(1400);

    // Alice adds a line to the skill and saves it...
    cam.mark("edit");
    await alice.click(f.locator(".monaco-editor").first(), { ms: 700, dx: 0.6, dy: 0.6 });
    await alice.page.keyboard.press("Meta+ArrowDown");
    await alice.page.keyboard.press("Enter");
    await alice.type("Also give every ticket a testing estimate: what to test, and its points.", { delay: 34, enter: false });
    await sleep(400);
    await alice.page.keyboard.press("Meta+s");
    cam.mark("saved");
    await sleep(800);

    // ...and runs it in Claude Code.
    await alice.click(alice.window("home-claude"), { dx: 0.45, dy: 0.9, ms: 900 });
    await alice.type(`/ticket-estimate ${badge}`, { delay: 65 });
    cam.mark("run");
    acme("hook-merged", "122", "Low-stock query", "dk-46-stock-query", "kai");
    await inTerm(alice, "home-claude", "Testing:", 40000);
    cam.mark("estimated");
    await sleep(1200);
    acme("hook-merged", "123", "Add CSV export endpoint", "dk-43-csv-export", "sam");
    cam.mark("pr123");
    await sleep(1800);

    // Alice rearranges the board: unlock, make room, add an Inbox window for what's waiting.
    cam.mark("arrange");
    await alice.click(alice.page.getByTestId("lock-toggle"), { ms: 900 });
    await sleep(700);
    const runs = await alice.box(alice.window("home-runs"));
    await alice.glide(runs.x + runs.width - 3, runs.y + runs.height - 3, 900);
    await alice.page.mouse.down();
    await alice.glide(runs.x + runs.width - 3 - 290, runs.y + runs.height - 3, 1300);
    await alice.page.mouse.up();
    cam.mark("resized");
    await sleep(600);
    await alice.click(alice.page.getByTestId("add-window"), { ms: 900 });
    await sleep(500);
    await alice.click(alice.page.getByTestId("add-requests"), { ms: 600 });
    await sleep(900);
    const added = await alice.page.locator('[data-window-type="requests"]').last().getAttribute("data-window-id");
    // Sized to match the narrower Runs window, then moved into the gap beside it.
    const runs2 = await alice.box(alice.window("home-runs"));
    const code = await alice.box(alice.window("home-code"));
    const nb = await alice.box(alice.window(added));
    const want = { w: code.x + code.width - (runs2.x + runs2.width + 25), h: runs2.height };
    await alice.glide(nb.x + nb.width - 3, nb.y + nb.height - 3, 900);
    await alice.page.mouse.down();
    await alice.glide(nb.x + want.w - 3, nb.y + want.h - 3, 1300);
    await alice.page.mouse.up();
    await sleep(400);
    const bar = await alice.box(alice.window(added).locator("header").first());
    const grabX = bar.x + bar.width * 0.35, grabY = bar.y + bar.height / 2;
    await alice.glide(grabX, grabY, 700);
    await alice.page.mouse.down();
    await alice.glide(grabX + (runs2.x + runs2.width + 25 - nb.x), grabY + (runs2.y - nb.y), 1500);
    await alice.page.mouse.up();
    await sleep(500);
    const nb2 = await alice.box(alice.window(added));
    cam.mark("added");
    await alice.glide(nb2.x + 140, nb2.y + 120, 900);
    await sleep(2500);
    cam.mark("poster");
    await sleep(600);
    await cam.stop();
    await others.stop();
    return { clips: {}, raws: { "c15-canvas": cam } };
  },

  async day({ alice, sam, kai, jo, raw }) {
    yesterday();
    const clips = {};
    const raws = {};

    // 08:52. Jo files DK-45. The estimate run finds two jobs, posts the split to the Inbox, and ends.
    await kai.go("/c/triage");
    await park(kai, "triage-activity", 0.55, 0.8);
    const TRIAGE = ["triage-requests", "triage-runs", "triage-activity"];
    for (const p of [jo, sam]) await p.go("/c/triage");
    let others = wander([jo, sam], TRIAGE, { seed: 3 });
    const card = new Camera(kai.page, raw("c12-card"));
    await card.start();
    await sleep(1200);
    const k45 = acme("ticket", "jo", "Bulk price changes from a spreadsheet", "Ops want to change prices for a few hundred products at once: upload a spreadsheet, see every change before it goes live, then apply it.").trim();
    card.mark("ticket");
    const est = await until(async () => (await runsNamed(`Estimate ${k45}`))[0], { what: `the ${k45} estimate run` });
    card.mark("run");
    await park(kai, "triage-runs", 0.5, 0.3, 1200);
    await until(() => openRequest(`Split ${k45}`), { timeout: 90000, what: "the split card" });
    card.mark("card");
    await park(kai, "triage-requests", 0.6, 0.35, 1200);
    await until(() => finished(est.id), { timeout: 60000, what: "the estimate run to end" });
    card.mark("ended");
    await sleep(2500);
    card.mark("poster");
    await sleep(400);
    await card.stop();
    await others.stop();
    clips["c12-card"] = { cam: card, segments: [["start", "card", 1.2], ["card", "end", 1]], poster: "poster" };

    // 09:05. Alice runs the skill by hand: with a person at the keyboard it just does the job.
    await alice.go("/c/desk");
    await claude(alice, "desk-claude");
    await park(alice, "desk-claude", 0.55, 0.55);
    for (const p of [kai, jo]) await p.go("/c/desk");
    others = wander([kai, jo], ["desk-claude", "canvas", "canvas"], { seed: 9 });
    const hand = new Camera(alice.page, raw("c14-by-hand"));
    await hand.start();
    await sleep(700);
    await alice.click(alice.window("desk-claude"), { dx: 0.45, dy: 0.9, ms: 500 });
    await alice.type("/ticket-estimate DK-38", { delay: 70 });
    hand.mark("asked");
    await until(async () => ticket("DK-38")?.status === "Split", { timeout: 60000, what: "DK-38 split" });
    hand.mark("split");
    await alice.page.getByTestId("doc-window").waitFor({ timeout: 60000 });
    hand.mark("doc");
    await inTerm(alice, "desk-claude", "open beside", 30000);
    await sleep(800);
    await alice.hover(alice.page.getByTestId("doc-window"), 900);
    await sleep(2600);
    hand.mark("poster");
    await sleep(400);
    await hand.stop();
    await others.stop();
    clips["c14-by-hand"] = { cam: hand, segments: [["start", "asked", 1], ["asked", "doc", 1.5], ["doc", "end", 1]], poster: "poster" };

    // 09:10. Kai reads the card and approves; a new run picks up his answer.
    const req = await openRequest(`Split ${k45}`);
    await kai.go("/c/triage");
    await park(kai, "triage-requests", 0.5, 0.8);
    for (const p of [jo, sam]) await p.go("/c/triage");
    others = wander([jo, sam], ["triage-runs", "triage-activity", "triage-activity"], { seed: 13 });
    const answer = new Camera(kai.page, raw("c13-answer"));
    await answer.start();
    await sleep(800);
    const row = kai.window("triage-requests").getByTestId(`request-${req.id}`);
    await kai.click(row.getByRole("button", { name: "Expand" }), { ms: 900 });
    await sleep(2600);
    answer.mark("read");
    await kai.click(row.getByRole("button", { name: "Approve" }), { ms: 900, pause: 400 });
    answer.mark("approved");
    const next = await until(async () => (await runsNamed(`Split ${k45}`))[0], { what: "the run that carries out the answer" });
    answer.mark("run");
    await park(kai, "triage-runs", 0.5, 0.3, 1000);
    await until(() => finished(next.id), { timeout: 90000, what: "the split run to finish" });
    await until(async () => ticket(k45)?.status === "Split", { timeout: 20000, what: `${k45} split` });
    answer.mark("done");
    await kai.click(kai.window("triage-runs").getByTestId(`run-${next.id}`), { ms: 900 });
    await sleep(3200);
    answer.mark("poster");
    await sleep(400);
    await answer.stop();
    await others.stop();
    clips["c13-answer"] = { cam: answer, segments: [["start", "approved", 1], ["approved", "done", 1.4], ["done", "end", 1]], poster: "poster" };

    // 09:40. Jo asks for a testing estimate on every ticket; Sam adds the line to the skill and commits.
    await sam.go("/c/skills");
    await jo.go("/c/skills");
    await alice.go("/c/skills");
    const f = sam.window("skills-code").frameLocator("iframe").first();
    const item = (name) => f.getByRole("treeitem", { name, exact: true });
    await item(".claude").waitFor({ timeout: 90000 });
    await park(sam, "skills-code", 0.6, 0.5);
    others = wander([jo, alice], ["skills-activity", "skills-activity", "skills-code"], { seed: 17 });
    const skill = new Camera(sam.page, raw("f-skill"));
    await skill.start();
    await sleep(600);
    for (const name of [".claude", "skills", "ticket-estimate"]) {
      await sam.click(item(name), { ms: 550, pause: 200 });
      await sleep(450);
    }
    await sam.click(item("SKILL.md"), { ms: 550, pause: 200, double: true });
    await sleep(1400);
    await sam.page.keyboard.press("Meta+ArrowDown");
    await sleep(500);
    skill.mark("typing");
    await sam.page.keyboard.press("Enter");
    await sam.type("Also give every ticket a testing estimate: what to test, and its points.", { delay: 38, enter: false });
    await sleep(500);
    await sam.page.keyboard.press("Meta+s");
    skill.mark("saved");
    await sleep(1200);
    await sam.click(f.locator('.action-item a[aria-label^="Source Control"]').first(), { ms: 700 });
    await sleep(1200);
    await sam.click(f.locator(".scm-editor .monaco-editor .view-lines").first(), { ms: 500 });
    await sam.type("ticket-estimate: estimate testing too", { delay: 40, enter: false });
    await sleep(400);
    await sam.page.keyboard.press("Meta+Enter");
    await sleep(800);
    const yes = f.getByRole("button", { name: /^(Yes|Always)$/ }).first();
    if (await yes.isVisible().catch(() => false)) await sam.click(yes, { ms: 400 });
    await until(async () => sh("git -C /data/workspace log -1 --format=%s").includes("testing"), { what: "the commit" });
    skill.mark("committed");
    await sleep(2200);
    skill.mark("poster");
    await skill.stop();
    await others.stop();
    raws["f-skill"] = skill;

    // 09:41. The next ticket's estimate has a testing estimate in it.
    await kai.go("/c/triage");
    await park(kai, "triage-activity", 0.5, 0.8);
    for (const p of [jo, sam]) await p.go("/c/triage");
    others = wander([jo, sam], ["triage-requests", "triage-activity"], { seed: 19 });
    const testing = new Camera(kai.page, raw("f-testing"));
    await testing.start();
    await sleep(1000);
    const k50 = acme("ticket", "sam", "Low-stock badge on product cards").trim();
    testing.mark("ticket");
    const t50 = await until(async () => (await runsNamed(`Estimate ${k50}`))[0], { what: `the ${k50} estimate run` });
    testing.mark("run");
    await until(() => finished(t50.id), { timeout: 90000, what: `the ${k50} run to finish` });
    testing.mark("done");
    await kai.click(kai.window("triage-runs").getByTestId(`run-${t50.id}`), { ms: 900 });
    await sleep(3500);
    testing.mark("poster");
    await sleep(400);
    await testing.stop();
    await others.stop();
    raws["f-testing"] = testing;

    // Overnight: four people leave one by one; the box carries on; in the morning Kai answers.
    for (const p of [alice, sam, kai, jo]) await p.go("/c/triage");
    await park(sam, "triage-runs", 0.3, 0.5);
    await park(kai, "triage-requests", 0.7, 0.6);
    await park(jo, "triage-activity", 0.4, 0.3);
    const evening = Object.fromEntries([jo, sam, kai].map((p, i) => [p.name, wander([p], TRIAGE, { seed: 23 + i })]));
    const lids = new Camera(alice.page, raw("f-lids"));
    await lids.start();
    await sleep(2200);
    for (const [p, m] of [[jo, "left-jo"], [sam, "left-sam"], [kai, "left-kai"]]) {
      await sleep(1100);
      await evening[p.name].stop();
      await p.page.goto("about:blank");
      lids.mark(m);
    }
    await sleep(1500);
    lids.mark("night");
    sh('wb run --group housekeeping --prompt "/housekeeping nightly" --title "Nightly housekeeping" --print >/dev/null');
    const nightly = await until(async () => (await runsNamed("Nightly housekeeping")).find((r) => !["done", "failed"].includes(r.status)) ?? null, { timeout: 30000, what: "the nightly run" }).catch(() => null);
    lids.mark("nightly");
    if (nightly) await until(() => finished(nightly.id), { timeout: 60000, what: "the nightly run to finish" });
    await sleep(1200);
    const k51 = acme("ticket", "jo", "Gift cards at checkout", "Sell gift cards in the shop, and let customers pay with one at checkout.").trim();
    lids.mark("ticket");
    await until(() => openRequest(`Split ${k51}`), { timeout: 90000, what: "the gift cards card" });
    lids.mark("card");
    await sleep(2500);
    lids.mark("morning");
    await kai.go("/c/triage");
    await park(kai, "triage-activity", 0.5, 0.9);
    lids.mark("back-kai");
    const gift = await openRequest(`Split ${k51}`);
    await kai.click(kai.window("triage-requests").getByTestId(`request-${gift.id}`).getByRole("button", { name: "Approve" }), { ms: 1400, pause: 400 });
    lids.mark("approved");
    const giftRun = await until(async () => (await runsNamed(`Split ${k51}`))[0], { what: "the gift cards split run" });
    await until(() => finished(giftRun.id), { timeout: 90000, what: "the gift cards split run to finish" });
    lids.mark("done");
    await sleep(2500);
    lids.mark("poster");
    await lids.stop();
    raws["f-lids"] = lids;

    // The same canvas in four browsers: a window moves, a line is typed, a card is answered.
    for (const p of [alice, sam, kai, jo]) await p.go("/c/together");
    sh('wb request --group tickets --title "Close DK-41? Its PR merged this morning." --body "DK-41 (Order history page) shipped in acme/shop #86. Close it as Done?" --action approve:"Close it" --action reject:"Keep it open" >/dev/null');
    await sleep(1500);
    await park(alice, "together-runs", 0.5, 0.5);
    await park(sam, "together-term", 0.6, 0.7);
    await park(kai, "together-requests", 0.3, 0.7);
    await park(jo, "together-requests", 0.8, 0.3);
    const same = {};
    for (const [n, p] of Object.entries({ alice, sam, kai, jo })) (same[n] = new Camera(p.page, raw(`f-same-${n}`)));
    const joMoves = wander([jo], ["together-requests", "together-term", "together-runs"], { seed: 29 });
    for (const cam of Object.values(same)) await cam.start();
    const mark = (m) => Object.values(same).forEach((c) => c.mark(m));
    await sleep(1200);
    await drag(alice, "together-runs", -260, 60, 1500);
    await sleep(500);
    await drag(alice, "together-runs", 260, -60, 1200);
    mark("moved");
    await sleep(600);
    await sam.click(sam.window("together-term"), { dx: 0.4, dy: 0.85, ms: 600 });
    await sam.type("jira list", { delay: 90 });
    await inTerm(sam, "together-term", "DK-4", 15000);
    mark("typed");
    await sleep(1000);
    const close = (await openRequest("Close DK-41"));
    await kai.click(kai.window("together-requests").getByTestId(`request-${close.id}`).getByRole("button", { name: "Close it" }), { ms: 1100, pause: 350 });
    mark("answered");
    await sleep(2500);
    mark("poster");
    for (const cam of Object.values(same)) await cam.stop();
    await joMoves.stop();
    Object.entries(same).forEach(([n, c]) => (raws[`f-same-${n}`] = c));

    // A push lands: the QA notes skill and its workflow arrive in the box's workspace from a laptop.
    await sam.go("/c/skills");
    await explore(sam, "skills-code", [".claude", "skills"]);
    await park(sam, "skills-code", 0.55, 0.5);
    for (const p of [kai, jo]) await p.page.goto("about:blank");
    const push = new Camera(sam.page, raw("f-push"));
    await push.start();
    await sleep(1500);
    push.mark("push");
    sh("bash /demo/push-qa-notes.sh");
    await until(async () => JSON.stringify(await api("/workflows")).includes("qa-notes"), { what: "the pushed workflow" });
    push.mark("landed");
    await sleep(1800);
    await kai.go("/c/skills");
    await park(kai, "skills-code", 0.3, 0.7, 10);
    const kaiHere = wander([kai], ["skills-code", "skills-activity"], { seed: 31 });
    push.mark("kai");
    await jo.go("/c/skills");
    await park(jo, "skills-activity", 0.5, 0.4, 10);
    const joHere = wander([jo], ["skills-activity", "skills-code"], { seed: 37 });
    push.mark("jo");
    await sleep(1200);
    await sam.click(sam.page.getByTestId("nav-workflows"), { ms: 800 });
    await sleep(1200);
    await sam.hover(sam.page.getByTestId("workflow-card-qa-notes"), 800);
    await sleep(2500);
    push.mark("poster");
    await push.stop();
    await kaiHere.stop();
    await joHere.stop();
    raws["f-push"] = push;

    return { clips, raws };
  },
};
