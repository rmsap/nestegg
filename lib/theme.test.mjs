import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultPrimaryColor, parseColorMode, parsePrimaryColor, primaryColor, themeVariables } from "./theme.ts";

test("theme input normalizes full hex colors and accepts the three supported modes", () => {
  assert.equal(parsePrimaryColor("#FAa010"), "#faa010");
  for (const input of [null, "#fff", "245e49", "#gggggg", "#245e49ff"]) {
    assert.equal(parsePrimaryColor(input), null);
    assert.equal(primaryColor(input), defaultPrimaryColor);
  }
  for (const mode of ["light", "dark", "system"]) assert.equal(parseColorMode(mode), mode);
  for (const mode of ["Dark", "auto", null, ["system"]]) assert.equal(parseColorMode(mode), null);
});

test("extreme primary colors get legible text and derived colors for both modes", () => {
  const light = themeVariables("#ffffff");
  const dark = themeVariables("#000000");
  assert.equal(light["--theme-on-primary"], "#000000");
  assert.equal(dark["--theme-on-primary"], "#ffffff");
  assert.equal(light["--theme-primary-border"], light["--theme-accent-strong"]);
  assert.equal(dark["--theme-primary-border-dark"], dark["--theme-accent-strong-dark"]);
  assert.ok(parseInt(light["--theme-accent-strong"].slice(1), 16) < 0x666666);
  assert.ok(parseInt(dark["--theme-accent-strong-dark"].slice(1), 16) > 0xb2b2b2);
  assert.deepEqual(themeVariables("invalid"), themeVariables(defaultPrimaryColor));
});
