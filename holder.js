// The loft holder: adds a virtual display and keeps it while this osascript
// lives. Run as `osascript -l JavaScript holder.js WIDTH HEIGHT [SERIAL [OWNER]]`. It answers
// one JSON line on stdout, then serves the main run loop until killed; the
// display goes when the process does, however it ends. Given an OWNER pid, it
// exits once that process is gone, taking the display with it.
ObjC.import("AppKit");
ObjC.import("CoreGraphics");

function say(obj) {
  const data = $(JSON.stringify(obj) + "\n").dataUsingEncoding($.NSUTF8StringEncoding);
  $.NSFileHandle.fileHandleWithStandardOutput.writeData(data);
}

function spin(seconds) {
  $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(seconds));
}

function run(argv) {
  const w = Number(argv[0]), h = Number(argv[1]);
  // No Dock icon, never activates.
  $.NSApplication.sharedApplication.setActivationPolicy($.NSApplicationActivationPolicyProhibited);

  const desc = $.CGVirtualDisplayDescriptor.alloc.init;
  desc.setDispatchQueue($.NSOperationQueue.mainQueue.underlyingQueue);
  desc.name = $("loft");
  desc.maxPixelsWide = w;
  desc.maxPixelsHigh = h;
  // About 96 dpi, so macOS picks 1x and the window keeps its CSS size.
  desc.sizeInMillimeters = { width: Math.round(w * 25.4 / 96), height: Math.round(h * 25.4 / 96) };
  desc.vendorID = 0x6c66;
  desc.productID = 0x7466;
  desc.serialNum = Number(argv[2]) || 1;

  const display = $.CGVirtualDisplay.alloc.initWithDescriptor(desc);
  if (!display || display.isNil() || !display.displayID) { say({ ok: false, error: "CGVirtualDisplay returned no display" }); return; }

  const settings = $.CGVirtualDisplaySettings.alloc.init;
  settings.hiDPI = 0;
  settings.modes = $([$.CGVirtualDisplayMode.alloc.initWithWidthHeightRefreshRate(w, h, 60)]);
  if (!display.applySettings(settings)) { say({ ok: false, error: "the display refused " + w + "x" + h }); return; }

  const id = display.displayID;
  let b = null;
  for (let i = 0; i < 40; i++) {
    b = $.CGDisplayBounds(id);
    if (b.size.width > 0) break;
    b = null;
    spin(0.05);
  }
  if (!b) { say({ ok: false, error: "the display never came online" }); return; }
  say({ ok: true, displayId: id, x: b.origin.x, y: b.origin.y, w: b.size.width, h: b.size.height });

  globalThis.__loft = display;
  const owner = Number(argv[3]) || 0;
  if (!owner) for (;;) spin(60);
  ObjC.bindFunction("kill", ["int", ["int", "int"]]);
  while ($.kill(owner, 0) === 0) spin(1);
}
