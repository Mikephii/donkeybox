import { createServer } from "node:http";
import { orders } from "./orders.js";
// csv:start
import { toCsv } from "./orders-csv.js";
// csv:end

const money = (n) => `$${n.toFixed(2)}`;
const page = () => `<!doctype html><meta charset="utf-8"><title>Acme admin</title>
<style>
  body{font:15px/1.5 system-ui,sans-serif;margin:0;color:#1c1917;background:#fafaf9}
  header{display:flex;align-items:center;gap:12px;padding:14px 24px;border-bottom:1px solid #e7e5e4;background:#fff}
  header b{font-size:16px} main{padding:24px} h1{font-size:20px;margin:0 0 16px}
  table{border-collapse:collapse;width:100%;background:#fff;border:1px solid #e7e5e4;border-radius:8px}
  th,td{text-align:left;padding:10px 14px;border-bottom:1px solid #f0efed} th{font-size:12px;color:#78716c;text-transform:uppercase;letter-spacing:.04em}
  td.n{font-variant-numeric:tabular-nums} .bar{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}
  a.btn{background:#1c1917;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none;font-size:14px}
</style>
<header><b>Acme</b><span style="color:#78716c">admin</span></header>
<main><div class="bar"><h1>Orders this week</h1>
<!-- csv:start --><a class="btn" href="/orders.csv">Download CSV</a><!-- csv:end -->
</div><table><tr><th>Order</th><th>Customer</th><th>Total</th><th>Placed</th></tr>
${orders.map((o) => `<tr><td class="n">#${o.id}</td><td>${o.customer}</td><td class="n">${money(o.total)}</td><td class="n">${o.placed}</td></tr>`).join("")}
</table></main>`;

createServer((req, res) => {
  if (req.url === "/orders") return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(orders));
  // csv:start
  if (req.url === "/orders.csv")
    return res.writeHead(200, { "content-type": "text/csv", "content-disposition": "attachment; filename=orders.csv" }).end(toCsv(orders));
  // csv:end
  res.writeHead(200, { "content-type": "text/html" }).end(page());
}).listen(Number(process.env.PORT ?? 3000), () => console.log(`shop on :${process.env.PORT ?? 3000}`));
