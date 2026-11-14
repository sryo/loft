# loft

How loft is built and how to work on it. Goals and how they are measured are in GOALS.md; fium rules in ~/Documents/fium/RULES.md.

## Layout
```
loft.mjs          # the CLI: up, status, list, down; starts and stops holders
holder.js         # JXA: adds the virtual display and keeps it while it lives
install.sh        # curl | bash installer: clone or pull into ~/.loft, npm link
test/             # node:test against a fake holder (test/fakes), no display needed
bench/probe.mjs   # live probe for every How we know row
bench/fixture.html# the page the probe drives
```

## How it works
- `holder.js` runs under `osascript -l JavaScript`, builds a `CGVirtualDisplayDescriptor` (private CoreGraphics), creates the `CGVirtualDisplay`, applies one mode, answers one JSON line on stdout and then serves the main run loop. The display lives exactly as long as that process (which ends itself only for an owned loft, below), so a crash or `kill -9` removes it; there is no cleanup path to get wrong. That holds only while the main display is awake: asleep (a locked, idle Mac), macOS keeps the display of a holder that ended until the display wakes, and takes 12s to bring a new one up (0.6 to 1.6s awake, locked or not). So `up` and `down` wake it first (`caffeinate -u -t 5`, or the command in `LOFT_WAKE` in tests), the holder waits up to 4s for the wake before it adds its display, and a holder that ends by itself (owner gone, windows gone) wakes it on the way out. A holder killed from outside while the display sleeps still leaves its display until the next wake.
- `loft.mjs` spawns the holder detached, waits `LOFT_WAIT_MS` (5s) for its answer, and records `{pid, cmd, displayId, x, y, w, h, serial, owner?, label?, started}` in `$LOFT_HOME/holder.json` (default `~/Library/Application Support/loft`) for the default loft, or `$LOFT_HOME/lofts/<id>.json` for one made with `--id <id>` or `--new` (which picks `loft-<n>`).
- Several lofts can be up at once, each its own holder and size. `up` runs one at a time (`$LOFT_HOME/up.lock`, a directory; taken over when older than `LOFT_WAIT_MS` + 5s, `busy` after 12s waiting), so ups at once never pick the same `loft-<n>` or serial. A loft's display serial is `w*10000+h` (plus 100000000 per live loft already that size), because macOS remembers a mode per serial and brings a new display up in it whenever it fits (one serial for every loft made 1440x900 and 1920x1200 come up 1280x800). `up` also refuses a display macOS gave another size (`display_size`). `up` with a size naming a loft already up at another size fails with exit 4 rather than reuse it; `down` touches only the loft named (`--all`: every one). `--owner <pid>` (checked running, else `bad_owner`) is recorded as `owner` and passed to the holder, which polls it every second and exits when it is gone, so the display goes with its owner. An owned loft also goes once its windows are gone: the holder counts the ordinary windows (layer 0, hidden and minimized ones too) centered on the display every 2s and exits 30s after the last one left, or 2 minutes after it came up if none ever arrived; a loft with no owner stays until `down`. `--label <text>` (`^[A-Za-z0-9._-]{1,40}$`, else `bad_label`) is recorded as `label` and shown by `list` and `status`, so a loft left up names who made it; the display itself is always named `"loft"`. Ids are rooms' pattern, `^[a-z][a-z0-9-]{0,30}$`, so a `WxH` size is never an id. With `--json`, errors print `{ok:false, code, error}` on stdout (`bad_size`, `bad_id`, `bad_owner`, `bad_label`, `busy`, `size_mismatch`, `display_failed`, `holder_timeout`, `usage`); without it, `loft: <message>` on stderr. A recorded pid is signalled only while `ps` shows its command line still naming the holder; otherwise the record is dropped.
- Contract (stable; consumers may rely on it, changing it is a breaking change):
  - Display identity, set in holder.js: vendor `0x6c66`, product `0x7466`, name `"loft"` (the name macOS reports is unverified live). The `displayId` is the CGDirectDisplayID of this run; it changes with every `up`.
  - Record shape (holder.json and lofts/<id>.json): `{pid, cmd, displayId, x, y, w, h, serial, owner?, label?, started}`, `started` an ISO time. `x, y, w, h` are the bounds as recorded, frozen at `up`; if the user rearranges displays they go stale, so read live bounds with `CGDisplayBounds(displayId)`.
  - `loft status --json` and `loft up --json` print `{up, id, displayId, vendor, product, name, bounds: {x, y, w, h}, label?}` from that record (`id` is `"default"` for holder.json); with a name, `status <id>` reports that loft, and `list --json` prints an array of every live one. `status --json` exits 3 when down (`displayId` and `bounds` null); plain `status` always exits 0, and with no name also lists the other lofts up and their owners.
- The holder sets the prohibited activation policy, so it has no Dock icon and never activates. It waits by taking the app's events (`spin`), not by running the run loop alone: otherwise `CGDisplayBounds` keeps answering with the display's old place after macOS moves it (another loft going shifts this one), and the fence and the window count read the wrong rect.
- `sizeInMillimeters` is set for about 96 dpi so macOS treats the display as 1x.
- The holder moves the display to the main display's bottom-left corner (`CGConfigureDisplayOrigin`, for the login session), where the two share no edge. The move takes macOS about 0.7s, so the holder asks only when the display came up elsewhere: macOS remembers the place until logout, and later lofts come up there. Left where macOS put it, the loft shares most of an edge and the cursor wanders onto it. If macOS refuses the origin, the display stays where it came up.
- The corner still lets a diagonal fling through, so the holder checks the cursor (`fence`: every 30ms within 300 points of the loft, every 250ms farther away) and warps one found inside the loft's live bounds to the nearest point of the main display. A driver that moves the real cursor onto a loft window loses it the same way; drivers post to the window instead (perch's background trusted input).
- loft never moves windows. Callers park their own windows by setting their bounds inside the display's rect.

## Rules
- Single file CLI plus the JXA holder, Node built-ins only, no build step.
- Never touch the user's windows, focus or cursor; the probe checks all three around up, down and each click. The one exception is the fence: a cursor on the loft is put back on the main display.

## Test
```bash
npm test
```
A change is done when `fium done` says so: it measures every How we know row in GOALS.md where the change started and now.

## Live checks
`node bench/probe.mjs --yes` adds the display, opens its own Safari and Canary windows on it, and removes everything after. It stops unless the user is away (`fium away`: locked, or 5 quiet minutes with nothing of theirs keeping the display awake); `--now` runs it with them there. It needs JavaScript from Apple Events in both browsers, Accessibility for perch's trusted clicks, and perch at `$PERCH_DIR` (default `~/Documents/perch`). The live-check Canary runs with timer throttling off, which is why the timer row uses Safari. The lock row names its metrics `locked:` or `unlocked:` by the session's state at the start (IOConsoleUsers' `CGSSessionScreenIsLocked`, as perch reads it) and is dropped if the lock changes mid-run; run the probe once each way. Never lock or unlock the Mac for it: wait for the user to lock it and leave.
