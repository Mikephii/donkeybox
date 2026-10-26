import { defineConfig } from "@playwright/test";

// Runs against the live local stack: `pnpm dev`, `pnpm zellij:web` and `pnpm caddy` must be up.
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  workers: 1,
  use: { baseURL: process.env.WB_URL ?? "http://localhost:8080", viewport: { width: 1440, height: 900 } },
  reporter: [["list"]],
});
