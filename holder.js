// The loft holder: adds a virtual display and keeps it while this osascript
// lives, at the main display's bottom-left corner. Run as `osascript -l JavaScript holder.js WIDTH HEIGHT [SERIAL [OWNER]]`. It answers
// one JSON line on stdout, then serves the main run loop until killed; the
// display goes when the process does, however it ends. Given an OWNER pid, it
// exits once that process is gone, taking the display with it. While it lives it
// puts a cursor that strays onto the display back on the main one.
ObjC.import("AppKit");
ObjC.import("CoreGraphics");

function say(obj) {
  const data = $(JSON.stringify(obj) + "\n").dataUsingEncoding($.NSUTF8StringEncoding);
  $.NSFileHandle.fileHandleWithStandardOutput.writeData(data);
}

// Waits by taking the app's events, not by running the run loop alone: only then
// does this process learn that macOS moved its display (another loft going
// shifts this one), and CGDisplayBounds stops answering with the old place.
function spin(seconds) {
  const until = $.NSDate.dateWithTimeIntervalSinceNow(seconds);
  for (;;) {
    // Every event type (NSEventMaskAny).
    const e = $.NSApp.nextEventMatchingMaskUntilDateInModeDequeue(0xffffffffffffffff, until, $.NSDefaultRunLoopMode, true);
    if (!e || e.isNil()) return;
    $.NSApp.sendEvent(e);
  }
}

// The cursor can still reach the loft through the corner the displays share.
// One found there is put back on the nearest point of the main display, so it
// is never lost on a screen nobody sees.
function fence(id) {
  // The displays' bounds are read once a second; the cursor on every check.
  const now = Date.now();
  if (!fence.at || now - fence.at >= 1000) { fence.at = now; fence.main = $.CGDisplayBounds($.CGMainDisplayID()); fence.b = $.CGDisplayBounds(id); }
  const main = fence.main, b = fence.b, p = $.NSEvent.mouseLocation;
  // AppKit counts y up from the main display's bottom edge; CoreGraphics down from its top.
  const x = p.x, y = main.size.height - p.y;
  const dx = Math.max(b.origin.x - x, 0, x - (b.origin.x + b.size.width - 1));
  const dy = Math.max(b.origin.y - y, 0, y - (b.origin.y + b.size.height - 1));
  // Far from the loft the next check can wait; near it, it can't.
  if (dx || dy) return Math.max(dx, dy) > 300 ? 0.25 : 0.03;
  $.CGWarpMouseCursorPosition({
    x: Math.min(Math.max(x, main.origin.x), main.origin.x + main.size.width - 1),
    y: Math.min(Math.max(y, main.origin.y), main.origin.y + main.size.height - 1),
  });
  // A warp holds mouse movement back for a quarter second unless told not to.
  $.CGAssociateMouseAndMouseCursorPosition(1);
  return 0.03;
}

function run(argv) {
  const w = Number(argv[0]), h = Number(argv[1]);
  // No Dock icon, never activates.
  $.NSApplication.sharedApplication.setActivationPolicy($.NSApplicationActivationPolicyProhibited);

  // Read before the display exists: while macOS takes a new display in, this read waits on it.
  const main = $.CGDisplayBounds($.CGMainDisplayID());

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
  // macOS puts a new display beside the main one, sharing a long edge the cursor
  // crosses. Displays must touch, so the loft goes where they touch least: the
  // main display's bottom-left corner, below and to its left, away from the menu
  // bar's corners and the Dock's edge. If macOS refuses, it stays where it came up.
  try {
    const x = main.origin.x - b.size.width, y = main.origin.y + main.size.height;
    // Moving a display takes macOS most of a second, so it is asked once: it
    // remembers the place until logout, and the display comes up there after that.
    if (b.origin.x !== x || b.origin.y !== y) {
      const config = Ref();
      if ($.CGBeginDisplayConfiguration(config) === 0) {
        $.CGConfigureDisplayOrigin(config[0], id, x, y);
        // 1: kCGConfigureForSession.
        $.CGCompleteDisplayConfiguration(config[0], 1);
        for (let i = 0; i < 20; i++) {
          b = $.CGDisplayBounds(id);
          if (b.origin.x === x && b.origin.y === y) break;
          spin(0.05);
        }
      }
    }
  } catch (e) {}
  say({ ok: true, displayId: id, x: b.origin.x, y: b.origin.y, w: b.size.width, h: b.size.height });

  globalThis.__loft = display;
  const owner = Number(argv[3]) || 0;
  if (owner) ObjC.bindFunction("kill", ["int", ["int", "int"]]);
  // An owned loft is its owner's for the windows it parks there, so it also goes
  // once they are gone: EMPTY_MS after its last window left, or FIRST_MS after it
  // came up if none ever arrived. A loft with no owner stays until taken down.
  const EMPTY_MS = 30000, FIRST_MS = 120000;
  let wait = 0.03, checked = Date.now(), looked = Date.now(), emptySince = Date.now(), seen = false;
  for (;;) {
    spin(wait);
    try { wait = fence(id); } catch (e) { wait = 0.25; }
    if (!owner) continue;
    const now = Date.now();
    if (now - checked >= 1000) { checked = now; if ($.kill(owner, 0) !== 0) return; }
    if (now - looked >= 2000) {
      looked = now;
      let n = 1;
      try { n = windowsOn(id); } catch (e) {}
      if (n > 0) { seen = true; emptySince = 0; }
      else if (!emptySince) emptySince = now;
      else if (now - emptySince >= (seen ? EMPTY_MS : FIRST_MS)) return;
    }
  }
}

// How many ordinary windows (layer 0, any app's, hidden and minimized ones too)
// have their center on the display. Off-screen windows count, so a loft never
// goes from under a window that would then land on the user's display.
function windowsOn(id) {
  const b = $.CGDisplayBounds(id);
  // 16: kCGWindowListExcludeDesktopElements, over every window (0).
  const list = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(16, 0))) || [];
  let n = 0;
  for (const w of list) {
    const r = w.kCGWindowBounds;
    if (w.kCGWindowLayer !== 0 || !r || r.Width < 50 || r.Height < 50) continue;
    const cx = r.X + r.Width / 2, cy = r.Y + r.Height / 2;
    if (cx >= b.origin.x && cx < b.origin.x + b.size.width && cy >= b.origin.y && cy < b.origin.y + b.size.height) n++;
  }
  return n;
}
