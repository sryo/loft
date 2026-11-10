#!/usr/bin/env node
// loft: up, status, list and down for hidden displays. Each display lives in a
// holder process (holder.js); this CLI starts it detached, records it and stops
// it. The default loft is recorded in $LOFT_HOME/holder.json; a named one
// (--id) in $LOFT_HOME/lofts/<id>.json, with a display serial of its own so
// macOS keeps them apart. A recorded pid is signalled only while its command
// line still names the holder.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const HOME = process.env.LOFT_HOME || join(homedir(), "Library", "Application Support", "loft");
const LOFTS = join(HOME, "lofts");
const HOLDER = process.env.LOFT_HOLDER ? JSON.parse(process.env.LOFT_HOLDER) : ["osascript", "-l", "JavaScript", join(ROOT, "holder.js")];
const WAIT_MS = Number(process.env.LOFT_WAIT_MS || 5000);
const USAGE = "usage: loft up [WIDTHxHEIGHT] [--id <name> | --new] [--owner <pid>] | status [<name>] | list | down [<name> | --all] (--json on up, status and list)";
// What holder.js sets on the display; AGENTS.md documents it as stable.
const IDENTITY = { vendor: 0x6c66, product: 0x7466, name: "loft" };
const DEFAULT = "default";
// The same names rooms takes; a letter first, so a size like 1280x800 is never an id.
const ID_RE = /^[a-z][a-z0-9-]{0,30}$/;

// With --json an error is {ok:false, code, error} on stdout, as rooms prints it.
const fail = (code, msg, exit = 1) => {
  if (process.argv.includes("--json")) console.log(JSON.stringify({ ok: false, code, error: msg }));
  else process.stderr.write(`loft: ${msg}\n`);
  process.exit(exit);
};
const file = (id) => (id === DEFAULT ? join(HOME, "holder.json") : join(LOFTS, `${id}.json`));
const line = (id, s) => `${id === DEFAULT ? "loft" : `loft ${id}`} is up: ${s.w}x${s.h} at ${s.x},${s.y} (display ${s.displayId})`;
const json = (id, s) => (s
  ? { up: true, id, displayId: s.displayId, ...IDENTITY, bounds: { x: s.x, y: s.y, w: s.w, h: s.h } }
  : { up: false, id, displayId: null, ...IDENTITY, bounds: null });

function checkId(id) {
  if (id === DEFAULT || !ID_RE.test(id ?? "")) fail("bad_id", `id must be 1 to 31 of a-z, 0-9 and -, starting with a letter, and not "${DEFAULT}" (got "${id ?? ""}")`, 2);
  return id;
}

function isHolder(s) {
  const r = spawnSync("ps", ["-o", "command=", "-p", String(s.pid)], { encoding: "utf8" });
  return r.status === 0 && r.stdout.includes(s.cmd);
}

// The recorded holder if it is still running; a dead or foreign pid's record is dropped.
function current(id) {
  let s;
  try { s = JSON.parse(readFileSync(file(id), "utf8")); } catch { return null; }
  if (isHolder(s)) return s;
  rmSync(file(id), { force: true });
  return null;
}

function ids() {
  let names = [];
  try { names = readdirSync(LOFTS).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).filter((n) => ID_RE.test(n) && n !== DEFAULT); } catch {}
  return [DEFAULT, ...names.sort()];
}
const live = () => ids().map((id) => [id, current(id)]).filter(([, s]) => s);

function parseSize(arg) {
  const m = /^(\d+)x(\d+)$/.exec(arg);
  const w = m && Number(m[1]), h = m && Number(m[2]);
  if (!m || w < 640 || h < 480 || w > 5120 || h > 2880) fail("bad_size", `size must be WIDTHxHEIGHT, from 640x480 to 5120x2880 (got ${arg})`, 2);
  return [w, h];
}

async function up(id, sizeArg, asJson, owner) {
  const [w, h] = parseSize(sizeArg ?? "1920x1200");
  const s = current(id);
  if (s) {
    if (sizeArg != null && (s.w !== w || s.h !== h)) {
      fail("size_mismatch", id === DEFAULT
        ? `the loft is up at ${s.w}x${s.h}, not ${w}x${h}; use --id <name> for a loft of another size, or loft down first`
        : `loft ${id} is up at ${s.w}x${s.h}, not ${w}x${h}; use another --id, or loft down ${id} first`, 4);
    }
    return console.log(asJson ? JSON.stringify(json(id, s)) : `${line(id, s)}, already up`);
  }
  // The default loft keeps serial 1; a named one takes the lowest serial no live loft has.
  const taken = new Set(live().map(([, l]) => l.serial ?? 1));
  let serial = 1;
  if (id !== DEFAULT) { serial = 2; while (taken.has(serial)) serial++; }
  const child = spawn(HOLDER[0], [...HOLDER.slice(1), String(w), String(h), String(serial), ...(owner ? [String(owner)] : [])], { detached: true, stdio: ["ignore", "pipe", "ignore"] });
  const answer = await new Promise((resolve) => {
    let buf = "";
    const t = setTimeout(() => resolve(null), WAIT_MS);
    child.stdout.on("data", (d) => {
      buf += d;
      const nl = buf.indexOf("\n");
      if (nl >= 0) { clearTimeout(t); try { resolve(JSON.parse(buf.slice(0, nl))); } catch { resolve({ ok: false, error: buf.slice(0, nl) }); } }
    });
    child.on("exit", () => { clearTimeout(t); resolve(buf ? undefined : { ok: false, error: "the holder exited without answering" }); });
  });
  if (!answer?.ok) {
    try { process.kill(child.pid, "SIGKILL"); } catch {}
    fail(answer ? "display_failed" : "holder_timeout", answer ? `could not add the display: ${answer.error}` : `the holder did not answer within ${WAIT_MS}ms; stopped it`);
  }
  child.stdout.destroy();
  child.unref();
  const state = { pid: child.pid, cmd: HOLDER[HOLDER.length - 1], displayId: answer.displayId, x: answer.x, y: answer.y, w: answer.w, h: answer.h, serial, ...(owner ? { owner } : {}), started: new Date().toISOString() };
  mkdirSync(dirname(file(id)), { recursive: true });
  writeFileSync(file(id), JSON.stringify(state));
  console.log(asJson ? JSON.stringify(json(id, state)) : line(id, state));
}

async function down(id) {
  const s = current(id);
  if (s) {
    try { process.kill(s.pid, "SIGTERM"); } catch {}
    for (let i = 0; i < 60 && isHolder(s); i++) await new Promise((r) => setTimeout(r, 50));
    if (isHolder(s)) try { process.kill(s.pid, "SIGKILL"); } catch {}
    rmSync(file(id), { force: true });
  }
  console.log(`${id === DEFAULT ? "loft" : `loft ${id}`} is down`);
}

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const all = args.includes("--all");
const fresh = args.includes("--new");
let named = null, owner = null;
const rest = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--id") { named = args[++i] ?? ""; continue; }
  if (args[i] === "--owner") { owner = args[++i] ?? ""; continue; }
  if (["--json", "--all", "--new"].includes(args[i])) continue;
  rest.push(args[i]);
}
const [cmd, arg] = rest;

if (cmd === "up") {
  let id = DEFAULT;
  if (named != null) id = checkId(named);
  else if (fresh) { const have = new Set(ids()); let n = 1; while (have.has(`loft-${n}`)) n++; id = `loft-${n}`; }
  if (owner != null) {
    const pid = /^[1-9]\d*$/.test(owner) ? Number(owner) : 0;
    let ok = pid > 0;
    if (ok) try { process.kill(pid, 0); } catch (e) { ok = e.code === "EPERM"; }
    if (!ok) fail("bad_owner", `--owner takes the pid of a running process (got ${owner})`, 2);
    owner = pid;
  }
  await up(id, arg, asJson, owner);
} else if (cmd === "down") {
  if (all) for (const id of ids()) await down(id);
  else await down(arg == null ? DEFAULT : arg === DEFAULT ? DEFAULT : checkId(arg));
} else if (cmd === "status") {
  const id = arg == null || arg === DEFAULT ? DEFAULT : checkId(arg);
  const s = current(id);
  if (asJson) { console.log(JSON.stringify(json(id, s))); if (!s) process.exitCode = 3; }
  else console.log(s ? line(id, s) : `${id === DEFAULT ? "loft" : `loft ${id}`} is down`);
} else if (cmd === "list") {
  const l = live();
  if (asJson) console.log(JSON.stringify(l.map(([id, s]) => json(id, s))));
  else console.log(l.length ? l.map(([id, s]) => `${id.padEnd(12)} ${s.w}x${s.h} at ${s.x},${s.y} (display ${s.displayId})`).join("\n") : "no loft is up");
} else fail("usage", USAGE, 2);
