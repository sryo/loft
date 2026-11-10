// Several lofts at once, each the size its agent asked for: `--id <name>` keeps
// its own record in $LOFT_HOME/lofts/<name>.json and its own display serial, and
// up, status and down with an id touch only that loft. The default loft
// (holder.json) is unchanged.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FAKE = join(ROOT, "test", "fakes", "fake-holder.mjs");
const ID = { vendor: 0x6c66, product: 0x7466, name: "loft" };

function setup(t, extra = {}) {
  const home = mkdtempSync(join(tmpdir(), "loft-test-"));
  const env = { ...process.env, LOFT_HOME: home, LOFT_HOLDER: JSON.stringify(["node", FAKE]), LOFT_WAIT_MS: "1500", ...extra };
  const run = (...args) => spawnSync("node", [join(ROOT, "loft.mjs"), ...args], { env, encoding: "utf8" });
  t.after(() => { run("down", "--all"); rmSync(home, { recursive: true, force: true }); });
  const rec = (id) => JSON.parse(readFileSync(join(home, "lofts", `${id}.json`), "utf8"));
  return { home, run, rec };
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

test("M1: up --id makes a loft of that size beside the default one", (t) => {
  const { run, rec, home } = setup(t);
  run("up");
  const r = run("up", "1280x800", "--id", "wide", "--json");
  assert.equal(r.status, 0, r.stderr);
  const o = JSON.parse(r.stdout);
  assert.deepEqual(o, { up: true, id: "wide", displayId: o.displayId, ...ID, bounds: { x: 1512, y: 0, w: 1280, h: 800 } });
  assert.ok(alive(rec("wide").pid));
  assert.ok(existsSync(join(home, "holder.json")), "the default loft is untouched");
});

test("M1: a loft's display serial comes from its size, so macOS never restores another size's mode; two of one size differ", (t) => {
  const { run, rec, home } = setup(t);
  run("up");
  run("up", "1280x800", "--id", "a");
  run("up", "1280x800", "--id", "b");
  run("up", "1024x768", "--id", "c");
  const def = JSON.parse(readFileSync(join(home, "holder.json"), "utf8"));
  assert.deepEqual([def.serial, rec("a").serial, rec("b").serial, rec("c").serial], [19201200, 12800800, 112800800, 10240768]);
  // The fake holder echoes the serial it was given as displayId + serial.
  assert.equal(rec("b").displayId, 77 + rec("b").serial);
});

test("M1: --new picks a free id and prints it", (t) => {
  const { run } = setup(t);
  const a = JSON.parse(run("up", "1280x800", "--new", "--json").stdout);
  const b = JSON.parse(run("up", "1280x800", "--new", "--json").stdout);
  assert.match(a.id, /^loft-\d+$/);
  assert.notEqual(a.id, b.id);
  assert.match(run("up", "1280x800", "--new").stdout, /^loft loft-\d+ is up: 1280x800 /);
});

test("M2: a loft already up at another size is refused, never reused at the wrong size", (t) => {
  const { run } = setup(t);
  run("up", "1280x800", "--id", "a");
  let r = run("up", "1280x800", "--id", "a");
  assert.equal(r.status, 0);
  assert.match(r.stdout, /already up/);
  r = run("up", "1024x768", "--id", "a");
  assert.equal(r.status, 4);
  assert.match(r.stderr, /loft a is up at 1280x800, not 1024x768; use another --id, or loft down a first/);
  // The default loft too, once a size is named.
  run("up");
  r = run("up", "2560x1440");
  assert.equal(r.status, 4);
  assert.match(r.stderr, /the loft is up at 1920x1200, not 2560x1440; use --id <name> for a loft of another size, or loft down first/);
  assert.match(run("up").stdout, /already up/, "no size named still reuses it");
});

test("M3: down <id> removes only that loft; plain down only the default", (t) => {
  const { run, rec, home } = setup(t);
  run("up");
  run("up", "1280x800", "--id", "a");
  run("up", "1280x800", "--id", "b");
  const a = rec("a").pid, b = rec("b").pid;
  assert.match(run("down", "a").stdout, /^loft a is down/);
  assert.equal(alive(a), false);
  assert.ok(alive(b));
  assert.ok(existsSync(join(home, "holder.json")));
  run("down");
  assert.equal(existsSync(join(home, "holder.json")), false);
  assert.ok(alive(b), "plain down leaves named lofts");
  run("down", "--all");
  assert.equal(alive(b), false);
});

test("M4: status <id> and list report lofts; status --json is still the default one", (t) => {
  const { run } = setup(t);
  let r = run("status", "a", "--json");
  assert.equal(r.status, 3);
  assert.deepEqual(JSON.parse(r.stdout), { up: false, id: "a", displayId: null, ...ID, bounds: null });
  run("up");
  run("up", "1280x800", "--id", "a");
  r = run("status", "a", "--json");
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(r.stdout).bounds.w, 1280);
  assert.equal(JSON.parse(run("status", "--json").stdout).bounds.w, 1920);
  assert.match(run("status", "a").stdout, /^loft a is up: 1280x800 at 1512,0/);
  const list = JSON.parse(run("list", "--json").stdout);
  assert.deepEqual(list.map((l) => [l.id, l.bounds.w]), [["default", 1920], ["a", 1280]]);
  assert.match(run("list").stdout, /default\s+1920x1200[\s\S]*a\s+1280x800/);
});

test("M5: a dead named loft's record is dropped", (t) => {
  const { run, rec, home } = setup(t);
  run("up", "1280x800", "--id", "a");
  process.kill(rec("a").pid, "SIGKILL");
  spawnSync("sleep", ["0.2"]);
  assert.equal(run("status", "a", "--json").status, 3);
  assert.equal(existsSync(join(home, "lofts", "a.json")), false);
});

test("M6: a bad id starts nothing", (t) => {
  const { run } = setup(t);
  for (const id of ["default", "../x", "A B", "", "9a"]) {
    const r = run("up", "1280x800", "--id", id);
    assert.equal(r.status, 2, id);
    assert.match(r.stderr, /id must be/);
  }
});

// One dialect with rooms: the same id pattern (a letter first, so "1280x800" is
// never an id), exit 3 when not up, and --json errors as JSON on stdout.
test("A1: ids follow rooms' pattern", (t) => {
  const { run } = setup(t);
  for (const id of ["1280x800", "9a", "a".repeat(32)]) assert.equal(run("up", "1280x800", "--id", id).status, 2, id);
  assert.equal(run("up", "1280x800", "--id", "a".repeat(31)).status, 0);
});

test("A2: with --json an error is {ok:false, code, error} on stdout", (t) => {
  const { run } = setup(t);
  let r = run("up", "big", "--json");
  assert.equal(r.status, 2);
  assert.deepEqual(JSON.parse(r.stdout), { ok: false, code: "bad_size", error: "size must be WIDTHxHEIGHT, from 640x480 to 5120x2880 (got big)" });
  run("up", "1280x800", "--id", "a");
  r = run("up", "1024x768", "--id", "a", "--json");
  assert.equal(r.status, 4);
  assert.equal(JSON.parse(r.stdout).code, "size_mismatch");
  assert.equal(JSON.parse(run("up", "1280x800", "--id", "Bad", "--json").stdout).code, "bad_id");
  assert.match(run("up", "big").stderr, /^loft: size must be/, "without --json, plain text on stderr as before");
});

// --owner <pid>: the loft lasts only while that process does, so a loft an agent's
// tool made (perch) goes with it however it ends.
test("O1: a loft with an owner goes when the owner does", async (t) => {
  const { run, rec } = setup(t);
  const owner = spawn("sleep", ["30"]);
  t.after(() => owner.kill());
  const r = run("up", "1280x800", "--new", "--owner", String(owner.pid), "--json");
  assert.equal(r.status, 0, r.stderr);
  const id = JSON.parse(r.stdout).id;
  assert.equal(rec(id).owner, owner.pid);
  const pid = rec(id).pid;
  owner.kill("SIGKILL");
  for (let i = 0; i < 40 && alive(pid); i++) await new Promise((res) => setTimeout(res, 100));
  assert.equal(alive(pid), false, "the holder exited with its owner");
  assert.equal(run("status", id, "--json").status, 3);
});

test("O1: an owner that isn't running starts nothing", (t) => {
  const { run } = setup(t);
  for (const o of ["99999999", "x", "0"]) {
    const r = run("up", "1280x800", "--new", "--owner", o, "--json");
    assert.equal(r.status, 2, o);
    assert.equal(JSON.parse(r.stdout).code, "bad_owner");
  }
  assert.equal(run("list", "--json").stdout.trim(), "[]");
});

// macOS can give a virtual display another of its modes than the one applied
// (live: 1440x900 came up 1280x800). A loft is the size asked for or nothing.
test("Z1: a display that came up at another size is refused, with nothing left running", (t) => {
  const { run, home } = setup(t, { FAKE_HOLDER: "smaller" });
  const r = run("up", "1440x900", "--new", "--json");
  assert.equal(r.status, 1, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { ok: false, code: "display_size", error: "macOS gave the display 1280x800, not 1440x900" });
  assert.equal(run("list", "--json").stdout.trim(), "[]");
  assert.equal(spawnSync("pgrep", ["-f", FAKE], { encoding: "utf8" }).stdout.trim(), "");
  void home;
});
