// Live probe for every How we know row. Brings the loft up, puts its own
// browser windows there, measures timers (Safari: the Canary used for live
// checks runs with timer throttling off) and background trusted clicks
// (Canary, through perch), then removes the windows and the loft, and checks that the
// user's windows, frontmost app and cursor never moved and that a killed
// holder leaves no display. Run once locked and once unlocked: the lock row
// names its metrics by the session's state.
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
// The id of the window whose only tab shows url, else null.
const ownSafari = (url) => safari(`const w = s.windows().find((w) => w.tabs.length === 1 && w.tabs[0].url() === ${JSON.stringify(url)}); JSON.stringify(w ? w.id() : null)`);
const closeSafari = (id, url) => safari(`const w = s.windows.byId(${id}); if (w.tabs.length === 1 && w.tabs[0].url() === ${JSON.stringify(url)}) w.close(); "1"`);
const sjs = (sid, js) => safari(`JSON.stringify(s.doJavaScript(${JSON.stringify(js)}, { in: s.windows.byId(${sid}).currentTab }))`);
// Timer ticks and animation frames per second over 2s, and the page's visibility.
async function rates(run) {
  const read = () => [Number(run("document.body.dataset.ticks")), Number(run("document.body.dataset.frames"))];
  const [a, fa] = read();
  const t = Date.now();
  await sleep(2000);
  const [b, fb] = read();
  const s = (Date.now() - t) / 1000;
  return { rate: (b - a) / s, frames: (fb - fa) / s, vis: run("document.visibilityState") };
}
// Whether the session's screen is locked (IOConsoleUsers, as perch reads it) and the main display asleep.
const screenState = () => jxa(`ObjC.import("CoreGraphics");
ObjC.bindFunction("IORegistryGetRootEntry", ["unsigned int", ["unsigned int"]]);
ObjC.bindFunction("IORegistryEntryCreateCFProperty", ["id", ["unsigned int", "id", "void *", "unsigned int"]]);
const u = ObjC.deepUnwrap($.IORegistryEntryCreateCFProperty($.IORegistryGetRootEntry(0), $("IOConsoleUsers"), $(), 0)) || [];
JSON.stringify({ locked: u.some((x) => x && x.CGSSessionScreenIsLocked === true), asleep: Number($.CGDisplayIsAsleep($.CGMainDisplayID())) === 1 })`);
const sTicks = (sid) => rates((js) => sjs(sid, js));
// Closes the probe's browser window only while its one tab still shows the probe page.
const closeOwn = (id) => jxa(`const w = Application(${JSON.stringify(BROWSER)}).windows.byId(${id}); if (w.tabs.length === 1 && w.tabs[0].url().includes("?loft-probe")) w.close(); "1"`);
const tab = (wid, js) => jxa(`const w = Application(${JSON.stringify(BROWSER)}).windows.byId(${wid}); JSON.stringify(w.activeTab.execute({ javascript: ${JSON.stringify(js)} }))`);
const ticksPerSec = (wid) => rates((js) => tab(wid, js));
const fixture = readFileSync(join(ROOT, "bench", "fixture.html"));
const server = createServer((_, res) => { res.setHeader("content-type", "text/html"); res.end(fixture); });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/?loft-probe`;

const m = (kind, dir, samples, extra = {}) => ({ kind, dir, samples, ...extra });
const metrics = {};
let wid = null, sid = null, sUrl = null, perch = null;
const s0 = scene();
const screen0 = screenState();
console.error(`probe: screen ${JSON.stringify(screen0)}`);
let canary = null;
try {
  // Goal 1 and 3: up.
  const u = loft("up");
  if (u.status !== 0) throw new Error(`loft up failed: ${u.stderr.trim()}`);
  const st = JSON.parse(readFileSync(join(homedir(), "Library", "Application Support", "loft", "holder.json"), "utf8"));
  console.error(`probe: ${u.stdout.trim()} in ${u.ms}ms`);
  await sleep(1000);
  const s1 = scene();
  // How much of the main display's border the loft touches, in points: the
  // cursor crosses onto the loft only along it. A corner alone is 0.
  const mainB = jxa(`ObjC.import("CoreGraphics"); const b = $.CGDisplayBounds($.CGMainDisplayID()); JSON.stringify({ x: b.origin.x, y: b.origin.y, w: b.size.width, h: b.size.height })`);
  const span = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
  const sharedEdge = (st.x + st.w === mainB.x || st.x === mainB.x + mainB.w ? span(st.y, st.y + st.h, mainB.y, mainB.y + mainB.h) : 0)
    + (st.y + st.h === mainB.y || st.y === mainB.y + mainB.h ? span(st.x, st.x + st.w, mainB.x, mainB.x + mainB.w) : 0);
  console.error(`probe: the loft at ${st.x},${st.y} shares ${sharedEdge} points of the main display's border`);
  const rss = Number(execFileSync("ps", ["-o", "rss=", "-p", String(st.pid)], { encoding: "utf8" })) / 1024;

  // Goal 2: timers in a Safari window on the loft, then the same window minimized.
  // The probe's window is found by its own URL, never by position: Safari's
  // front window may be the user's.
  sUrl = `${url}-timers-${process.pid}`;
  safari(`s.make({ new: "document", withProperties: { url: ${JSON.stringify(sUrl)} } }); "1"`);
  for (let i = 0; i < 40 && !sid; i++) { await sleep(100); sid = ownSafari(sUrl); }
  if (!sid) throw new Error("could not find the probe's own Safari window");
  safari(`s.windows.byId(${sid}).bounds = { x: ${st.x + 60}, y: ${st.y + 60}, width: 1200, height: 800 }; "1"`);
  await sleep(2500);
  console.error(`probe: ${TIMERS} window ${sid} at ${JSON.stringify(safari(`JSON.stringify(s.windows.byId(${sid}).bounds())`))}`);
  const visible = await sTicks(sid);
  // A hidden app's windows are hidden on every display, the loft too: say so rather than blame the loft.
  const sHidden = jxa(`ObjC.import("AppKit"); const l = $.NSRunningApplication.runningApplicationsWithBundleIdentifier("com.apple.Safari"); JSON.stringify(l.count > 0 && l.objectAtIndex(0).hidden)`);
  if (sHidden) console.error(`probe: ${TIMERS} is hidden (Cmd-H), so its page reads hidden on the loft too; unhide it and run again`);
  safari(`s.windows.byId(${sid}).miniaturized = true; "1"`);
  await sleep(1500);
  const hidden = await sTicks(sid);
  closeSafari(sid, sUrl);
  sid = null;
  console.error(`probe: ticks/s on the loft ${visible.rate.toFixed(1)} (${visible.vis}), minimized ${hidden.rate.toFixed(1)} (${hidden.vis})`);

  // The click window, on the loft.
  wid = jxa(`const app = Application(${JSON.stringify(BROWSER)}); const w = app.Window().make(); w.bounds = { x: ${st.x + 40}, y: ${st.y + 40}, width: 1200, height: 800 }; w.activeTab.url = ${JSON.stringify(url)}; JSON.stringify(w.id())`);
  await sleep(2500);
  canary = await ticksPerSec(wid);
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
    const page = JSON.parse(tab(wid, "document.body.dataset.hits"));
    const landed = r.ok && r.hit === true && page.some((h) => h.id === `b${i}` && h.trusted);
    hits += landed;
    if (!landed) console.error(`probe: click ${i}: ${JSON.stringify(r)}`);
  }
  console.error(`probe: ${hits}/10 trusted clicks landed, ${clickFocus} foreground or cursor changes`);

  closeOwn(wid);
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
  metrics["border shared with the main display"] = m("count", "lower", [sharedEdge]);
  metrics["loft over minimized ticks"] = m("quality", "higher", [visible.rate / Math.max(hidden.rate, 0.1)], { noisy: true });
  metrics["loft page visible"] = m("quality", "higher", [visible.vis === "visible" ? 1 : 0]);
  metrics["trusted click hits"] = m("quality", "higher", [hits]);
  metrics["holder memory MB"] = m("bytes", "lower", [Math.round(rss * 10) / 10], { noisy: true });
  // The same window measurements under the session's lock state, so a run while
  // locked and one while unlocked compare: does a locked Mac still need a room?
  const screen1 = screenState();
  if (screen1.locked === screen0.locked) {
    const as = screen0.locked ? "locked" : "unlocked";
    console.error(`probe: ${as}: ticks/s ${visible.rate.toFixed(1)}, frames/s ${visible.frames.toFixed(1)} (${visible.vis}) in ${TIMERS}, ${canary.frames.toFixed(1)} (${canary.vis}) in ${BROWSER}, ${hits}/10 clicks`);
    metrics[`${as}: loft ticks per second`] = m("quality", "higher", [Math.round(visible.rate * 10) / 10], { noisy: true });
    metrics[`${as}: loft page visible`] = m("quality", "higher", [(visible.vis === "visible") + (canary.vis === "visible")]);
    metrics[`${as}: loft frames per second`] = m("quality", "higher", [Math.round(Math.min(visible.frames, canary.frames) * 10) / 10], { noisy: true });
    metrics[`${as}: trusted click hits`] = m("quality", "higher", [hits]);
  } else console.error(`probe: the lock changed during the run (${JSON.stringify(screen0)} -> ${JSON.stringify(screen1)}); no lock row`);
  metrics["up ms"] = m("time", "lower", [u.ms]);
  metrics["down ms"] = m("time", "lower", [d.ms]);
} finally {
  if (sid) try { closeSafari(sid, sUrl); } catch {}
  if (wid) try { closeOwn(wid); } catch {}
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
writeFileSync(out, JSON.stringify({ commit, dirty, screen: screen0, metrics, limits: {} }, null, 2));
console.log(out);
