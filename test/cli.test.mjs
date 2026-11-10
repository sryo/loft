// Pins loft's up/status/down against a fake holder: one holder at a time,
// state that never outlives its process, and a pid loft didn't start is never
// signalled.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FAKE = join(ROOT, "test", "fakes", "fake-holder.mjs");

function setup(t, extra = {}) {
  const home = mkdtempSync(join(tmpdir(), "loft-test-"));
  const env = { ...process.env, LOFT_HOME: home, LOFT_HOLDER: JSON.stringify(["node", FAKE]), LOFT_WAIT_MS: "1500", ...extra };
  const run = (...args) => spawnSync("node", [join(ROOT, "loft.mjs"), ...args], { env, encoding: "utf8" });
  t.after(() => { run("down"); rmSync(home, { recursive: true, force: true }); });
  return { home, env, run, state: () => JSON.parse(readFileSync(join(home, "holder.json"), "utf8")) };
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

test("R1: up starts one holder and reports the display", (t) => {
  const { run, state } = setup(t);
  const r = run("up");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /loft is up: 1920x1200 at 1512,0 \(display 77\)/);
  assert.ok(alive(state().pid));
});

test("R1: up takes a size", (t) => {
  const { run } = setup(t);
  assert.match(run("up", "2560x1440").stdout, /2560x1440/);
});

test("R1: a second up reuses the running holder", (t) => {
  const { run, state } = setup(t);
  run("up");
  const pid = state().pid;
  const r = run("up");
  assert.equal(r.status, 0);
  assert.match(r.stdout, /already up/);
  assert.equal(state().pid, pid);
});

test("R1: status says whether the loft is up", (t) => {
  const { run } = setup(t);
  assert.match(run("status").stdout, /loft is down/);
  run("up");
  assert.match(run("status").stdout, /loft is up: 1920x1200 at 1512,0/);
});

test("R1/R2: down stops the holder and forgets it", (t) => {
  const { run, state, home } = setup(t);
  run("up");
  const pid = state().pid;
  const r = run("down");
  assert.equal(r.status, 0);
  assert.match(r.stdout, /loft is down/);
  assert.equal(alive(pid), false);
  assert.equal(existsSync(join(home, "holder.json")), false);
});

test("R2: a holder that died leaves no state behind", (t) => {
  const { run, state, home } = setup(t);
  run("up");
  process.kill(state().pid, "SIGKILL");
  spawnSync("sleep", ["0.2"]);
  assert.match(run("status").stdout, /loft is down/);
  assert.equal(existsSync(join(home, "holder.json")), false);
  assert.match(run("up").stdout, /loft is up/);
});

test("R3: a pid loft didn't start is never signalled", (t) => {
  const { run, home } = setup(t);
  const other = spawn("sleep", ["30"]);
  t.after(() => other.kill());
  writeFileSync(join(home, "holder.json"), JSON.stringify({ pid: other.pid, cmd: FAKE, displayId: 1, x: 0, y: 0, w: 1, h: 1 }));
  assert.match(run("down").stdout, /loft is down/);
  assert.ok(alive(other.pid));
});

test("R1: a holder that fails is reported, with nothing left running", (t) => {
  const { run, home } = setup(t, { FAKE_HOLDER: "fail" });
  const r = run("up");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /loft: could not add the display: CGVirtualDisplay returned no display/);
  assert.equal(existsSync(join(home, "holder.json")), false);
});

test("R1: a holder that never answers is stopped", (t) => {
  const { run, home } = setup(t, { FAKE_HOLDER: "mute" });
  const r = run("up");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /did not answer/);
  assert.equal(existsSync(join(home, "holder.json")), false);
  const left = spawnSync("pgrep", ["-f", FAKE], { encoding: "utf8" }).stdout.trim();
  assert.equal(left, "");
});

test("R1: a bad size starts nothing", (t) => {
  const { run, home } = setup(t);
  for (const s of ["big", "100x100", "9000x9000"]) {
    const r = run("up", s);
    assert.equal(r.status, 2, s);
    assert.match(r.stderr, /size must be WIDTHxHEIGHT/);
  }
  assert.equal(existsSync(join(home, "holder.json")), false);
});

test("an unknown command lists the commands", (t) => {
  const { run } = setup(t);
  const r = run("sideways");
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage: loft up \[WIDTHxHEIGHT\] \[--id <name> \| --new\] \[--owner <pid>\] \| status \[<name>\] \| list \| down/);
});

const ID = { vendor: 0x6c66, product: 0x7466, name: "loft" };

test("L2: status --json reports the loft as recorded, exit 0 up and 3 down", (t) => {
  const { run } = setup(t);
  let r = run("status", "--json");
  assert.equal(r.status, 3, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { up: false, id: "default", displayId: null, ...ID, bounds: null });
  run("up", "2560x1440");
  r = run("status", "--json");
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { up: true, id: "default", displayId: 77, ...ID, bounds: { x: 1512, y: 0, w: 2560, h: 1440 } });
});

test("L2: up --json prints the same object, with or without a size", (t) => {
  const { run } = setup(t);
  const want = { up: true, id: "default", displayId: 77, ...ID, bounds: { x: 1512, y: 0, w: 1920, h: 1200 } };
  let r = run("up", "--json");
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), want);
  r = run("up", "--json");
  assert.deepEqual(JSON.parse(r.stdout), want);
  run("down");
  r = run("up", "2560x1440", "--json");
  assert.deepEqual(JSON.parse(r.stdout).bounds, { x: 1512, y: 0, w: 2560, h: 1440 });
});

test("L2: plain status is unchanged and always exits 0", (t) => {
  const { run } = setup(t);
  let r = run("status");
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "loft is down\n");
  run("up");
  r = run("status");
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "loft is up: 1920x1200 at 1512,0 (display 77)\n");
});

test("L2: loft.mjs reports the identity holder.js sets", () => {
  const h = readFileSync(join(ROOT, "holder.js"), "utf8");
  assert.equal(Number(/vendorID = (0x[0-9a-f]+)/.exec(h)[1]), ID.vendor);
  assert.equal(Number(/productID = (0x[0-9a-f]+)/.exec(h)[1]), ID.product);
  assert.equal(/desc\.name = \$\("([^"]+)"\)/.exec(h)[1], ID.name);
});
