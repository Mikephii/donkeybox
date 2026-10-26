// Claude Code hook for workbench runs. Usage (from the generated settings.json):
//   node hook.ts <EventName>     with the hook payload on stdin and WB_RUN_ID in the environment.
// Posts the payload to the local API and prints whatever decision the app returns.
const event = process.argv[2] ?? "unknown";
const run = process.env.WB_RUN_ID;
const api = process.env.WB_LOCAL_API ?? "http://127.0.0.1:8001";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function post(path: string, body: unknown): Promise<any> {
  const r = await fetch(`${api}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

async function withRetry<T>(fn: () => Promise<T>, totalMs: number): Promise<T> {
  const until = Date.now() + totalMs;
  for (;;) {
    try {
      return await fn();
    } catch (e) {
      if (Date.now() > until) throw e;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

const deny = (reason: string) =>
  JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } });

async function main() {
  const raw = await readStdin();
  if (!run) return;
  let payload: unknown = {};
  try {
    payload = JSON.parse(raw || "{}");
  } catch {}
  let out: any;
  try {
    // Guards must fail closed: if the workbench is unreachable, tool calls are denied rather than waved through.
    out = await withRetry(() => post(`/hooks/claude/${event}?run=${run}`, payload), event === "PreToolUse" ? 60_000 : 5_000);
  } catch (e) {
    if (event === "PreToolUse") process.stdout.write(deny(`workbench unreachable, tool call denied: ${(e as Error).message}`));
    return;
  }
  if (out && typeof out.pending === "number") {
    for (;;) {
      try {
        const r = await fetch(`${api}/requests/${out.pending}/answer?wait=1&timeout=25`);
        const body = await r.json();
        if (body.decision) {
          process.stdout.write(JSON.stringify(body.decision));
          return;
        }
        if (body.status === "closed") {
          process.stdout.write(deny("request was closed without an answer"));
          return;
        }
      } catch {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }
  if (out && Object.keys(out).length) process.stdout.write(JSON.stringify(out));
}

await main();
