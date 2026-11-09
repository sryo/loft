#!/usr/bin/env node
// loft: up, status and down for the hidden display. The display lives in the
// holder process (holder.js); this CLI starts it detached, records it in
// $LOFT_HOME/holder.json and stops it. A recorded pid is signalled only while
// its command line still names the holder.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const HOME = process.env.LOFT_HOME || join(homedir(), "Library", "Application Support", "loft");
const STATE = join(HOME, "holder.json");
const HOLDER = process.env.LOFT_HOLDER ? JSON.parse(process.env.LOFT_HOLDER) : ["osascript", "-l", "JavaScript", join(ROOT, "holder.js")];
const WAIT_MS = Number(process.env.LOFT_WAIT_MS || 5000);
const USAGE = "usage: loft up [WIDTHxHEIGHT] | status | down (--json on up and status)";
// What holder.js sets on the display; AGENTS.md documents it as stable.
const IDENTITY = { vendor: 0x6c66, product: 0x7466, name: "loft" };

const fail = (msg, code = 1) => { process.stderr.write(`loft: ${msg}\n`); process.exit(code); };
const line = (s) => `loft is up: ${s.w}x${s.h} at ${s.x},${s.y} (display ${s.displayId})`;
const json = (s) => JSON.stringify(s
  ? { up: true, displayId: s.displayId, ...IDENTITY, bounds: { x: s.x, y: s.y, w: s.w, h: s.h } }
  : { up: false, displayId: null, ...IDENTITY, bounds: null });

function isHolder(s) {
  const r = spawnSync("ps", ["-o", "command=", "-p", String(s.pid)], { encoding: "utf8" });
  return r.status === 0 && r.stdout.includes(s.cmd);
}

// The recorded holder if it is still running; a dead or foreign pid's record is dropped.
function current() {
  let s;
  try { s = JSON.parse(readFileSync(STATE, "utf8")); } catch { return null; }
  if (isHolder(s)) return s;
  rmSync(STATE, { force: true });
  return null;
}

function parseSize(arg = "1920x1200") {
  const m = /^(\d+)x(\d+)$/.exec(arg);
  const w = m && Number(m[1]), h = m && Number(m[2]);
  if (!m || w < 640 || h < 480 || w > 5120 || h > 2880) fail(`size must be WIDTHxHEIGHT, from 640x480 to 5120x2880 (got ${arg})`, 2);
  return [w, h];
}

async function up(sizeArg, asJson) {
  const [w, h] = parseSize(sizeArg);
  const s = current();
  if (s) return console.log(asJson ? json(s) : `${line(s)}, already up`);
  const child = spawn(HOLDER[0], [...HOLDER.slice(1), String(w), String(h)], { detached: true, stdio: ["ignore", "pipe", "ignore"] });
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
    fail(answer ? `could not add the display: ${answer.error}` : `the holder did not answer within ${WAIT_MS}ms; stopped it`);
  }
  child.stdout.destroy();
  child.unref();
  const state = { pid: child.pid, cmd: HOLDER[HOLDER.length - 1], displayId: answer.displayId, x: answer.x, y: answer.y, w: answer.w, h: answer.h, started: new Date().toISOString() };
  mkdirSync(HOME, { recursive: true });
  writeFileSync(STATE, JSON.stringify(state));
  console.log(asJson ? json(state) : line(state));
}

async function down() {
  const s = current();
  if (s) {
    try { process.kill(s.pid, "SIGTERM"); } catch {}
    for (let i = 0; i < 60 && isHolder(s); i++) await new Promise((r) => setTimeout(r, 50));
    if (isHolder(s)) try { process.kill(s.pid, "SIGKILL"); } catch {}
    rmSync(STATE, { force: true });
  }
  console.log("loft is down");
}

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const [cmd, arg] = args.filter((a) => a !== "--json");
if (cmd === "up") await up(arg, asJson);
else if (cmd === "down") await down();
else if (cmd === "status" && asJson) { const s = current(); console.log(json(s)); if (!s) process.exitCode = 3; }
else if (cmd === "status") { const s = current(); console.log(s ? line(s) : "loft is down"); }
else fail(USAGE, 2);
