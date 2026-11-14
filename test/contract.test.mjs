// The display identity and holder.json are a contract consumers rely on:
// the docs must name exactly what holder.js sets.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");

test("L1: holder.js sets the documented identity", () => {
  const h = read("holder.js");
  assert.match(h, /desc\.name = \$\("loft"\)/);
  assert.match(h, /desc\.vendorID = 0x6c66;/);
  assert.match(h, /desc\.productID = 0x7466;/);
});

test("L1: AGENTS.md and README document the identity and holder.json as stable", () => {
  for (const f of ["AGENTS.md", "README.md"]) {
    const d = read(f);
    for (const s of ["0x6c66", "0x7466", "displayId", "holder.json"]) assert.ok(d.includes(s), `${f} names ${s}`);
    assert.match(d, /"loft"[^\n]*unverified/i, `${f} marks the name unverified`);
    assert.match(d, /stable/i, `${f} declares it stable`);
  }
  assert.match(read("AGENTS.md"), /\{pid, cmd, displayId, x, y, w, h, serial, owner\?, label\?, started\}/);
  assert.match(read("AGENTS.md"), /frozen at `up`/);
});
