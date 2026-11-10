// Stands in for holder.js: answers like the JXA holder, per FAKE_HOLDER
// ("ok", "fail", "mute", or "smaller": a 1280x800 display whatever was asked), then stays alive until killed. Its displayId is 77
// for the first loft of a size (serial w*10000+h) and 77 + serial for later ones,
// so tests can see the serial it got.
const [w, h, serial, owner] = process.argv.slice(2).map(Number);
const mode = process.env.FAKE_HOLDER || "ok";
if (mode === "fail") { console.log(JSON.stringify({ ok: false, error: "CGVirtualDisplay returned no display" })); process.exit(1); }
if (mode === "ok" || mode === "smaller") console.log(JSON.stringify({ ok: true, displayId: serial === w * 10000 + h ? 77 : 77 + serial, x: 1512, y: 0, w: mode === "smaller" ? 1280 : w, h: mode === "smaller" ? 800 : h }));
// Given an owner pid, it exits once that process is gone, as holder.js does.
setInterval(() => { if (owner) try { process.kill(owner, 0); } catch { process.exit(0); } }, owner ? 100 : 1 << 30);
