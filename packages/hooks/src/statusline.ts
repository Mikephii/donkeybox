// Claude Code statusLine command for workbench runs: reports cost to the app and prints a short line.
const run = process.env.WB_RUN_ID;
const api = process.env.WB_LOCAL_API ?? "http://127.0.0.1:8001";
const chunks: Buffer[] = [];
for await (const c of process.stdin) chunks.push(c as Buffer);
let j: any = {};
try {
  j = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
} catch {}
const cost: number | undefined = j?.cost?.total_cost_usd;
const model: string | undefined = j?.model?.id ?? j?.model?.display_name;
if (run) {
  await fetch(`${api}/runs/${run}/statusline`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cost_usd: cost, model }),
    signal: AbortSignal.timeout(400),
  }).catch(() => {});
}
process.stdout.write(`workbench run #${run ?? "?"} · ${j?.model?.display_name ?? "claude"}${cost != null ? ` · $${cost.toFixed(4)}` : ""}`);
