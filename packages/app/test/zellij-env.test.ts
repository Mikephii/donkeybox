import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { expect, it } from "vitest";
import { env } from "../src/env.ts";

it("gives Zellij a config folder that exists, so session layouts are applied on a fresh box", () => {
  expect(process.env.ZELLIJ_CONFIG_FILE).toBe(env.zellijConfig);
  expect(process.env.ZELLIJ_CONFIG_DIR).toBe(dirname(env.zellijConfig));
  expect(existsSync(process.env.ZELLIJ_CONFIG_DIR!)).toBe(true);
});

it("gives the shells in terminals a TERM, which a container does not have", () => {
  expect(process.env.TERM).toBeTruthy();
});
