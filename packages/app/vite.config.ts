import { defineConfig, type Plugin } from "vite";

const DOOR = Number(process.env.WB_APP_DOOR_PORT ?? 8080);
const PORT = Number(process.env.WB_VITE_PORT ?? 5173);

/** Everything goes through the app door (Caddy, :8080 by default). Opening Vite's own port directly would break /api, so redirect. */
const redirectToCaddy = (): Plugin => ({
  name: "redirect-to-caddy",
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.headers.host?.endsWith(`:${PORT}`) && req.headers.accept?.includes("text/html")) {
        res.writeHead(302, { location: `http://localhost:${DOOR}${req.url ?? "/"}` });
        return res.end();
      }
      next();
    });
  },
});
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: "web",
  plugins: [redirectToCaddy(), react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./web/src", import.meta.url)) } },
  server: { host: "127.0.0.1", port: PORT, strictPort: true, hmr: { clientPort: DOOR }, allowedHosts: true },
  build: { outDir: "../dist", emptyOutDir: true },
});
