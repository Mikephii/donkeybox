// The design tokens are measured, not chosen: every promised text pair clears WCAG AA (4.5:1)
// and every mark clears 3:1, in both themes. A token edit that breaks one fails here.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { colorOf, contrast, fit, hex, MARK_PAIRS, parseOklch, PRESENCE_HUES, PRESENCE_L, readTokens, TEXT_PAIRS } from "../web/src/lib/color.ts";

const css = readFileSync(new URL("../web/src/tokens.css", import.meta.url), "utf8");
const themes = readTokens(css);

describe("design tokens", () => {
  it("reads both themes and resolves every var() chain", () => {
    expect(themes.light.brand).toBe("oklch(0.57 0.143 48)");
    expect(themes.dark.brand).toBe("oklch(0.74 0.143 48)");
    expect(themes.dark.background).toBe("oklch(0.196 0.004 100)");
    // Status fills are shared by both themes.
    expect(themes.dark["status-warning"]).toBe(themes.light["status-warning"]);
  });

  for (const theme of ["light", "dark"] as const) {
    const t = themes[theme];
    it(`${theme}: every text pair clears 4.5:1`, () => {
      const failing = TEXT_PAIRS.map(([fg, bg]) => ({ fg, bg, r: contrast(colorOf(t, fg), colorOf(t, bg)) }))
        .filter((p) => p.r < 4.5)
        .map((p) => `${p.fg} on ${p.bg}: ${p.r.toFixed(2)}`);
      expect(failing).toEqual([]);
    });

    it(`${theme}: every mark clears 3:1`, () => {
      const failing = MARK_PAIRS.map(([m, bg]) => ({ m, bg, r: contrast(colorOf(t, m), colorOf(t, bg)) }))
        .filter((p) => p.r < 3)
        .map((p) => `${p.m} on ${p.bg}: ${p.r.toFixed(2)}`);
      expect(failing).toEqual([]);
    });

    it(`${theme}: the elevation ladder climbs`, () => {
      const rungs = ["sunken", "background", "card", "popover", "overlay"].map((k) => colorOf(t, k).l);
      for (let i = 1; i < rungs.length; i++) expect(rungs[i]!).toBeGreaterThanOrEqual(rungs[i - 1]!);
      if (theme === "dark") expect(new Set(rungs).size).toBe(rungs.length); // dark separates rungs by lightness alone
    });
  }

  it("presence colours carry white labels and read as marks on both canvases", () => {
    for (const [h, c] of PRESENCE_HUES) {
      const o = fit({ l: PRESENCE_L, c, h });
      expect(contrast({ l: 1, c: 0, h: 0 }, o)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(o, colorOf(themes.light, "sunken"))).toBeGreaterThanOrEqual(3);
      expect(contrast(o, colorOf(themes.dark, "sunken"))).toBeGreaterThanOrEqual(3);
    }
  });

  it("converts to hex for consumers that cannot read CSS colours", () => {
    expect(hex(parseOklch("oklch(1 0 0)")!)).toBe("#ffffff");
    expect(hex(parseOklch("oklch(0 0 0)")!)).toBe("#000000");
  });
});
