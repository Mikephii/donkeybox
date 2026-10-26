// A tiny dev server for the Preview window demo. Serves under any path prefix so /p/3333/ works.
import { createServer } from "node:http";
const port = Number(process.env.DEMO_PORT ?? 3333);
let hits = 0;
createServer((req, res) => {
  hits++;
  res.writeHead(200, { "content-type": "text/html" });
  res.end(`<!doctype html><meta charset=utf-8><title>Demo server</title>
<style>body{font:16px system-ui;margin:2rem;color:#222;background:#fafafa}@media(prefers-color-scheme:dark){body{color:#eee;background:#111}}code{background:#8882;padding:2px 4px;border-radius:4px}</style>
<h1>Demo server on :${port}</h1><p>Request <code>${req.url}</code>, hit #${hits}, at ${new Date().toLocaleTimeString()}.</p>
<p>Any port on the box shows up in a Preview window at <code>/p/&lt;port&gt;/</code>.</p>`);
}).listen(port, "127.0.0.1", () => console.log(`demo server on 127.0.0.1:${port}`));
