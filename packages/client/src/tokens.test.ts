import assert from "node:assert/strict";
import { test } from "node:test";
import { colors, motion, nativeTheme, readerPalettes, tokensCss } from "./tokens";

test("e-ink colours are greys (a monochrome panel shows nothing else)", () => {
  for (const scheme of ["light", "dark"] as const) {
    for (const [role, hex] of Object.entries(colors.eink[scheme])) {
      const [r, g, b] = [1, 3, 5].map((i) => hex.slice(i, i + 2));
      assert.ok(r === g && g === b, `eink.${scheme}.${role} = ${hex}`);
    }
    for (const [role, rgb] of Object.entries(readerPalettes.eink[scheme])) {
      assert.equal(new Set(rgb.split(" ")).size, 1, `reader eink.${scheme}.${role} = ${rgb}`);
    }
  }
});

test("e-ink has no motion; every duration is a number of ms", () => {
  assert.ok(Object.values(motion.eink).every((ms) => ms === 0));
  assert.ok(Object.values(nativeTheme("standard", "light", { reduceMotion: true }).motion).every((ms) => ms === 0));
  assert.ok(Object.values(motion.standard).every((ms) => ms > 0));
});

test("the CSS covers both displays in both schemes", () => {
  const css = tokensCss();
  for (const sel of [
    ":root {",
    ':root:not([data-scheme="light"])',
    ':root[data-scheme="dark"]',
    ':root[data-display="eink"] {',
    ':root[data-display="eink"]:not([data-scheme="light"])',
    ':root[data-display="eink"][data-scheme="dark"]',
  ])
    assert.ok(css.includes(sel), sel);
  assert.match(css, /--section-practice: #2b6cb0;/);
  assert.match(css, /--glass-fill: 14%;/);
  assert.match(css, /--motion-fast: 0ms;/);
});
