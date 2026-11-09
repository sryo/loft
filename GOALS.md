# loft: goals

## What loft is for
Agents that drive the user's own apps (perch driving their browser, a Mac app test loop) need a window that is on screen, painting and never covered, yet out of the user's sight. loft gives them one: a virtual display nobody looks at. It has to beat the places those windows end up today: covered or minimized windows, which browsers throttle and trusted input refuses; a second physical monitor; mirroring apps, which put the window back in front of the user; and headless browsers (rooms), which lack the user's own profile.

## Never traded
- loft never moves the user's windows, takes focus or moves the cursor.
- The display exists only while loft's holder process lives; when it stops, for any reason, the display is gone.

## Goals, in priority order
When two goals conflict, the higher one wins.

1. **Out of the way.** Bringing the loft up or down moves none of the user's windows, changes neither the frontmost app nor the cursor, and leaves no display behind.
2. **Windows there run as visible.** A browser window on the loft keeps full-rate timers and a visible page, and background trusted clicks land on it.
3. **Cheap.** The holder costs little memory and the display comes up and goes down fast.

## How we know
| Goal | Metric | Where | Run |
|---|---|---|---|
| 1 | user windows moved, foreground or cursor changes, displays left after a kill | `bench/probe.mjs` | live: `node bench/probe.mjs` |
| 2 | timer ticks per second on the loft over minimized, trusted click hits out of 10 | `bench/probe.mjs` | live: `node bench/probe.mjs` |
| 3 | holder memory, up and down time | `bench/probe.mjs` | live: `node bench/probe.mjs` |

Caps: `all=ask quality=hard time=ask+10%`

## Non-goals
- Moving windows onto the loft. Whoever owns a window parks it there (perch for its own windows); loft only provides the screen.
- Showing the loft. Mirroring it into a window puts the window back in the user's sight.
- Isolating input. A display separates pixels, not the keyboard or the cursor; background input stays the driver's job (perch's trusted input).
