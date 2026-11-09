// Live probe for every How we know row. Brings the loft up, puts its own
// browser windows there, measures timers (Safari: the Canary used for live
// checks runs with timer throttling off) and background trusted clicks
// (Canary, through perch), then removes the windows and the loft, and checks that the
// user's windows, frontmost app and cursor never moved and that a killed
// holder leaves no display.
//   node bench/probe.mjs [--yes] [out.json]   default: ~/.fium/runs/loft/<commit>[-dirty].json
// Creates a display and a browser window: run it while the user is away.
import { spawnSync, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PERCH = process.env.PERCH_DIR || join(homedir(), "Documents", "perch");
const BROWSER = process.env.LOFT_PROBE_BROWSER || "Google Chrome Canary";
const TIMERS = "Safari";
const args = process.argv.slice(2);
if (!args.includes("--yes")) { console.error("probe: adds a display and a browser window; pass --yes"); process.exit(2); }
const outArg = args.find((a) => a !== "--yes");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jxa = (src) => JSON.parse(execFileSync("osascript", ["-l", "JavaScript", "-e", src], { encoding: "utf8" }));
const loft = (...a) => { const t = Date.now(); const r = spawnSync("node", [join(ROOT, "loft.mjs"), ...a], { encoding: "utf8" }); return { ...r, ms: Date.now() - t }; };

// The user's on-screen windows, frontmost app and cursor.
const SCENE = `ObjC.import("AppKit"); ObjC.import("CoreGraphics");
const l = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(1 | 16, 0))) || [];
const wins = {}; for (const w of l) if (w.kCGWindowLayer === 0) wins[w.kCGWindowNumber] = [w.kCGWindowOwnerName, w.kCGWindowBounds.X, w.kCGWindowBounds.Y, w.kCGWindowBounds.Width, w.kCGWindowBounds.Height].join(" ");
const m = $.NSEvent.mouseLocation;
JSON.stringify({ wins, front: $.NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier, cursor: [Math.round(m.x), Math.round(m.y)], screens: $.NSScreen.screens.count })`;
const scene = () => jxa(SCENE);
function moved(a, b, skip = new Set()) {
  let n = 0;
  for (const k of Object.keys(a)) if (!skip.has(k) && k in b && a[k] !== b[k]) { n++; console.error(`probe: window ${k} moved: ${a[k]} -> ${b[k]}`); }
  return n;
}
const focusChanges = (a, b) => (a.front !== b.front) + (a.cursor.join() !== b.cursor.join());

const safari = (js) => jxa(`const s = Application("Safari"); ${js}`);
const sjs = (sid, js) => safari(`JSON.stringify(s.doJavaScript(${JSON.stringify(js)}, { in: s.windows.byId(${sid}).currentTab }))`);
const sTicks = async (sid) => {
  const a = Number(JSON.parse(sjs(sid, "document.body.dataset.ticks")));
  const t = Date.now();
  await sleep(2000);
  const b = Number(JSON.parse(sjs(sid, "document.body.dataset.ticks")));
  return { rate: ((b - a) * 1000) / (Date.now() - t), vis: JSON.parse(sjs(sid, "document.visibilityState")) };
};
const tab = (wid, js) => jxa(`const w = Application(${JSON.stringify(BROWSER)}).windows.byId(${wid}); JSON.stringify(w.activeTab.execute({ javascript: ${JSON.stringify(js)} }))`);
const ticksPerSec = async (wid) => {
  const a = Number(JSON.parse(tab(wid, "document.body.dataset.ticks")));
  const t = Date.now();
  await sleep(2000);
  const b = Number(JSON.parse(tab(wid, "document.body.dataset.ticks")));
  return { rate: ((b - a) * 1000) / (Date.now() - t), vis: JSON.parse(tab(wid, "document.visibilityState")) };
};

const fixture = readFileSync(join(ROOT, "bench", "fixture.html"));
const server = createServer((_, res) => { res.setHeader("content-type", "text/html"); res.end(fixture); });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/?loft-probe`;

const m = (kind, dir, samples, extra = {}) => ({ kind, dir, samples, ...extra });
const metrics = {};
let wid = null, sid = null, perch = null;
const s0 = scene();
try {
  // Goal 1 and 3: up.
  const u = loft("up");
  if (u.status !== 0) throw new Error(`loft up failed: ${u.stderr.trim()}`);
  const st = JSON.parse(readFileSync(join(homedir(), "Library", "Application Support", "loft", "holder.json"), "utf8"));
  console.error(`probe: ${u.stdout.trim()} in ${u.ms}ms`);
  await sleep(1000);
  const s1 = scene();
  const rss = Number(execFileSync("ps", ["-o", "rss=", "-p", String(st.pid)], { encoding: "utf8" })) / 1024;

  // Goal 2: timers in a Safari window on the loft, then the same window minimized.
  sid = safari(`s.make({ new: "document", withProperties: { url: ${JSON.stringify(url + "-timers")} } }); const w = s.windows[0]; w.bounds = { x: ${st.x + 60}, y: ${st.y + 60}, width: 1200, height: 800 }; JSON.stringify(w.id())`);
  await sleep(2500);
  console.error(`probe: ${TIMERS} window ${sid} at ${JSON.stringify(safari(`JSON.stringify(s.windows.byId(${sid}).bounds())`))}`);
  const visible = await sTicks(sid);
  safari(`s.windows.byId(${sid}).miniaturized = true; "1"`);
  await sleep(1500);
  const hidden = await sTicks(sid);
  safari(`s.windows.byId(${sid}).close(); "1"`);
  sid = null;
  console.error(`probe: ticks/s on the loft ${visible.rate.toFixed(1)} (${visible.vis}), minimized ${hidden.rate.toFixed(1)} (${hidden.vis})`);

  // The click window, on the loft.
  wid = jxa(`const app = Application(${JSON.stringify(BROWSER)}); const w = app.Window().make(); w.bounds = { x: ${st.x + 40}, y: ${st.y + 40}, width: 1200, height: 800 }; w.activeTab.url = ${JSON.stringify(url)}; JSON.stringify(w.id())`);
  await sleep(2500);
  console.error(`probe: ${BROWSER} window ${wid} at ${JSON.stringify(jxa(`JSON.stringify(Application(${JSON.stringify(BROWSER)}).windows.byId(${wid}).bounds())`))}`);

  // Goal 2: background trusted clicks through perch.
  const { connect, text } = await import(pathToFileURL(join(PERCH, "scripts", "mcp-client.mjs")));
  perch = await connect();
  const tabs = JSON.parse(text(await perch.call("list_tabs", { urlContains: "loft-probe" })));
  const tabId = tabs.tabs.find((t) => t.url.includes("loft-probe"))?.tabId;
  if (!tabId) throw new Error("perch did not list the probe's tab");
  let hits = 0, clickFocus = 0;
  for (let i = 0; i < 10; i++) {
    const before = scene();
    const r = JSON.parse(text(await perch.call("click", { target: { tabId }, selector: `#b${i}`, trusted: true })));
    const after = scene();
    clickFocus += focusChanges(before, after);
    const page = JSON.parse(JSON.parse(tab(wid, "document.body.dataset.hits")));
    const landed = r.ok && r.hit === true && page.some((h) => h.id === `b${i}` && h.trusted);
    hits += landed;
    if (!landed) console.error(`probe: click ${i}: ${JSON.stringify(r)}`);
  }
  console.error(`probe: ${hits}/10 trusted clicks landed, ${clickFocus} foreground or cursor changes`);

  jxa(`Application(${JSON.stringify(BROWSER)}).windows.byId(${wid}).close(); "1"`);
  wid = null;
  await sleep(500);
  const s2 = scene();
  const d = loft("down");
  await sleep(1000);
  const s3 = scene();

  // Goal 1: a killed holder takes its display with it.
  loft("up");
  const st2 = JSON.parse(readFileSync(join(homedir(), "Library", "Application Support", "loft", "holder.json"), "utf8"));
  const withLoft = scene().screens;
  process.kill(st2.pid, "SIGKILL");
  await sleep(1500);
  const s4 = scene();
  loft("status");
  const left = Math.max(0, s4.screens - s0.screens);
  console.error(`probe: screens ${s0.screens} -> ${withLoft} with the loft -> ${s4.screens} after kill -9`);

  const winsMoved = moved(s0.wins, s1.wins) + moved(s2.wins, s3.wins) + moved(s3.wins, s4.wins);
  const focusMoved = focusChanges(s0, s1) + focusChanges(s2, s3) + clickFocus;
  metrics["user windows moved"] = m("count", "lower", [winsMoved]);
  metrics["foreground or cursor changes"] = m("count", "lower", [focusMoved]);
  metrics["displays left after kill"] = m("count", "lower", [left]);
  metrics["loft over minimized ticks"] = m("quality", "higher", [visible.rate / Math.max(hidden.rate, 0.1)], { noisy: true });
  metrics["loft page visible"] = m("quality", "higher", [visible.vis === "visible" ? 1 : 0]);
  metrics["trusted click hits"] = m("quality", "higher", [hits]);
  metrics["holder memory MB"] = m("bytes", "lower", [Math.round(rss * 10) / 10], { noisy: true });
  metrics["up ms"] = m("time", "lower", [u.ms]);
  metrics["down ms"] = m("time", "lower", [d.ms]);
} finally {
  if (sid) try { safari(`s.windows.byId(${sid}).close(); "1"`); } catch {}
  if (wid) try { jxa(`Application(${JSON.stringify(BROWSER)}).windows.byId(${wid}).close(); "1"`); } catch {}
  perch?.close();
  loft("down");
  server.close();
}

const git = (...a) => { try { return execFileSync("git", a, { cwd: ROOT, encoding: "utf8" }).trim(); } catch { return null; } };
const commit = git("rev-parse", "HEAD");
const dirty = commit ? git("status", "--porcelain") !== "" : false;
const runs = join(process.env.FIUM_HOME || join(homedir(), ".fium"), "runs", "loft");
const out = outArg ?? join(runs, `${(commit ?? "unstamped").slice(0, 12)}${dirty ? "-dirty" : ""}.json`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ commit, dirty, metrics, limits: {} }, null, 2));
console.log(out);
