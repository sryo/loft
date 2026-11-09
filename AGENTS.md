# loft

How loft is built and how to work on it. Goals and how they are measured are in GOALS.md; fium rules in ~/Documents/fium/RULES.md.

## Layout
```
loft.mjs          # the CLI: up, status, down; starts and stops the holder
holder.js         # JXA: adds the virtual display and keeps it while it lives
test/             # node:test against a fake holder (test/fakes), no display needed
bench/probe.mjs   # live probe for every How we know row
bench/fixture.html# the page the probe drives
```

## How it works
- `holder.js` runs under `osascript -l JavaScript`, builds a `CGVirtualDisplayDescriptor` (private CoreGraphics), creates the `CGVirtualDisplay`, applies one mode, answers one JSON line on stdout and then serves the main run loop. The display lives exactly as long as that process, so a crash or `kill -9` removes it; there is no cleanup path to get wrong.
- `loft.mjs` spawns the holder detached, waits `LOFT_WAIT_MS` (5s) for its answer, and records `{pid, cmd, displayId, x, y, w, h, started}` in `$LOFT_HOME/holder.json` (default `~/Library/Application Support/loft`). A recorded pid is signalled only while `ps` shows its command line still naming the holder; otherwise the record is dropped.
- Contract (stable; consumers may rely on it, changing it is a breaking change):
  - Display identity, set in holder.js: vendor `0x6c66`, product `0x7466`, name `"loft"` (the name macOS reports is unverified live). The `displayId` is the CGDirectDisplayID of this run; it changes with every `up`.
  - holder.json shape: `{pid, cmd, displayId, x, y, w, h, started}`, `started` an ISO time. `x, y, w, h` are the bounds as recorded, frozen at `up`; if the user rearranges displays they go stale, so read live bounds with `CGDisplayBounds(displayId)`.
  - `loft status --json` and `loft up --json` print `{up, displayId, vendor, product, name, bounds: {x, y, w, h}}` from that record. `status --json` exits 3 when down (`displayId` and `bounds` null); plain `status` always exits 0.
- The holder sets the prohibited activation policy, so it has no Dock icon and never activates.
- `sizeInMillimeters` is set for about 96 dpi so macOS treats the display as 1x.
- loft never moves windows. Callers park their own windows by setting their bounds inside the display's rect.

## Rules
- Single file CLI plus the JXA holder, Node built-ins only, no build step.
- Never touch the user's windows, focus or cursor; the probe checks all three around up, down and each click.

## Test
```bash
npm test
```
A change is done when `fium done` says so: it measures every How we know row in GOALS.md where the change started and now.

## Live checks
`node bench/probe.mjs --yes` adds the display, opens its own Safari and Canary windows on it, and removes everything after. Run it only while the user is away (HID idle at least 5 minutes). It needs JavaScript from Apple Events in both browsers, Accessibility for perch's trusted clicks, and perch at `$PERCH_DIR` (default `~/Documents/perch`). The live-check Canary runs with timer throttling off, which is why the timer row uses Safari.
