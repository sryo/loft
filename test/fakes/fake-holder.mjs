// Stands in for holder.js: answers like the JXA holder, per FAKE_HOLDER
// ("ok", "fail" or "mute"), then stays alive until killed.
const [w, h] = process.argv.slice(2).map(Number);
const mode = process.env.FAKE_HOLDER || "ok";
if (mode === "fail") { console.log(JSON.stringify({ ok: false, error: "CGVirtualDisplay returned no display" })); process.exit(1); }
if (mode === "ok") console.log(JSON.stringify({ ok: true, displayId: 77, x: 1512, y: 0, w, h }));
setInterval(() => {}, 1 << 30);
