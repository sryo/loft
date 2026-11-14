// SKILL.md is what an agent reads to test a native app on a loft: it stays a
// loadable skill and names only flags and errors the CLI has.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const skill = () => readFileSync(join(ROOT, "SKILL.md"), "utf8");
const cli = readFileSync(join(ROOT, "loft.mjs"), "utf8");

test("N1: SKILL.md is a skill named loft with a description", () => {
  const m = /^---\nname: loft\ndescription: (.+)\n(?:.+\n)*?---\n/.exec(skill());
  assert.ok(m, "frontmatter");
  assert.ok(m[1].length > 40 && m[1].length < 400);
});

test("N1: every loft flag and error code it names is the CLI's", () => {
  const s = skill();
  for (const f of new Set(s.match(/--[a-z]+/g))) if (/loft[^\n]*/.test(s) && !["--args"].includes(f)) assert.ok(cli.includes(`"${f}"`), `${f} is not a loft flag`);
  for (const [, c] of s.matchAll(/^\| `([a-z_]+)` \|/gm)) assert.ok(cli.includes(`"${c}"`), `${c} is not a loft error`);
});

test("N1: it keeps the steps that keep the window out of sight", () => {
  const s = skill();
  for (const must of ["open -g -j", "--owner", "set position", "set visible", "screencapture", "locked"]) assert.ok(s.includes(must), must);
});
