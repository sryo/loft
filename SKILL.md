---
name: loft
description: Test a native Mac app's window out of the user's sight, on a hidden display (a loft). Launch it hidden, park its window there, capture it and press its controls without taking focus or the cursor. Use when a check needs a real app window on screen. For a browser page use perch's new_tab {loft} instead.
allowed-tools: Bash(loft:*) Bash(open:*) Bash(osascript:*) Bash(screencapture:*) Bash(pgrep:*)
---

# loft: a native app window nobody sees

A loft is a virtual display to the side of the user's screen. A window on it is on screen and painting, so it captures and answers like any other, but the user never sees it. loft only provides the screen: you put your app's window there. Browser pages go through perch (`new_tab {url, loft:"1280x800"}`), which does all of this itself.

Every step ran live on this Mac, unlocked: 4s to a parked, shown window, with no change to the frontmost app, the cursor or any other window.

## Steps

`APP` is the app's bundle path, `NAME` its process name.

1. **Launch hidden, in the background.** No window shows and focus stays where it is.
   ```bash
   open -g -j -n "$APP"; sleep 2; PID=$(pgrep -n -x "$NAME")
   ```
2. **Make a loft that goes when the app does.** The size is the screen you want, at least the window's.
   ```bash
   loft up 1280x800 --new --owner $PID --label "$NAME" --json
   ```
   It prints `{"id":"loft-1", "bounds":{"x":-1280,"y":1664,"w":1280,"h":800}, ...}`. Keep `id` and `bounds`.
3. **Park the window while it is still hidden.** Positions are global points from the main display's top-left, the same numbers as `bounds`. Put it a little inside the loft.
   ```bash
   osascript -e 'tell application "System Events" to tell process "NAME" to set position of window 1 to {-1240, 1704}'
   ```
4. **Show it there.** It appears on the loft, not in front of the user.
   ```bash
   osascript -e 'tell application "System Events" to set visible of process "NAME" to true'
   ```
5. **Check where it is** before trusting anything else: `get {position, size} of window 1` answers the numbers you set. A window the app opens later (a sheet, a second window) may open on the user's display: read its position and park it the same way.
6. **Capture it** by window id, which works on any display and takes no focus:
   ```bash
   WID=$(osascript -l JavaScript -e 'ObjC.import("CoreGraphics"); (ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(16, 0))) || []).filter(w => w.kCGWindowOwnerName === "NAME" && w.kCGWindowLayer === 0 && w.kCGWindowBounds.Height > 60)[0].kCGWindowNumber')
   screencapture -x -o -l $WID shot.png
   ```
   The height test skips the app's menu bar strip, which is a window too.
7. **Drive it through accessibility**, never the mouse: `click button "Save" of window 1`, `set value of text field 1 of window 1 to "..."`, `get value of static text 1 of window 1`. These press and read the control itself and work in the background.
8. **Quit the app when done.** The loft goes with it (`--owner`), so there is nothing else to clean up. `loft list` shows what is still up and who made it.

## Never
- Never move the real cursor onto the loft or send it a mouse click: loft puts a cursor found there back on the main display, and the user loses theirs meanwhile.
- Never `activate` the app or use a call that brings it to the front.
- Never take the loft down while the window is on it: the window jumps to the user's display. Quit the app first.
- Never use or take down a loft you didn't make.

## When it can't work
- **The screen is locked.** macOS hides every app's windows from accessibility then, so steps 3 to 7 answer that the app has no window. Only an app that places its own window can go on a loft; otherwise the check waits for the unlock and reads as not measured.
- **No Accessibility permission.** `System Events` answers "not allowed assistive access". The user grants it in System Settings > Privacy & Security > Accessibility; say so and stop.
- **The app was already running.** `open -n` starts a second copy, which some apps refuse. Never hide, move or quit the user's own copy.

## Errors from loft
| Code | What happened | Do |
|---|---|---|
| `size_mismatch` | A loft with that id is up at another size | Use `--new`, or another id |
| `busy` | Another `loft up` is still running | Retry in a few seconds |
| `holder_timeout` | macOS didn't bring the display up in 5s | Retry once; if it repeats, run `loft list` and tell the user |
| `display_failed` | macOS refused the display | A loft that size may be stuck: tell the user, don't retry in a loop |
| `bad_owner` | The pid given to `--owner` isn't running | The app quit; launch it again |
