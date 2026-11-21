<img src="logo.svg" alt="loft" width="128">

# loft

loft gives your agents a screen of their own on your Mac, so their windows stop crowding yours. It adds a monitor that only exists in software: windows put there stay on, painting and never covered, but you never see them. When you stop loft, the monitor is gone.

## Install
```bash
curl -fsSL https://raw.githubusercontent.com/sryo/loft/main/install.sh | bash
```

## Why not just…
- **Minimize it or let other windows cover it.** Browsers slow a hidden page down and refuse clicks sent to it. On the loft a page's timers ran about 60 times faster than in the same window minimized, at 60 frames a second, and 10 of 10 background clicks landed.
- **Plug in a second monitor.** Then the windows are in your sight again, and you need the monitor.
- **Mirror the window into an app.** That puts it back in front of you.
- **Use a browser with no window.** It doesn't have your own profile and sign-ins.

## Use
```bash
loft up        # add the hidden monitor (loft up 2560x1440 for another size)
loft status    # whether it's up and where it sits, and any other loft that's up (--json for scripts)
loft down      # remove it
```

An agent that needs a screen of a given size makes its own loft and removes it when done, leaving yours and other agents' alone:
```bash
loft up 1280x800 --new --json   # a new loft that size; prints its id
loft status <id>                # that loft (--json for scripts)
loft list                       # every loft that's up
loft down <id>                  # remove only that one (loft down --all: every one)
```
A loft already up at another size is refused (exit 4) rather than reused at the wrong size.

`--owner <pid>` ties a loft to a process: when that process ends, however it ends, the loft goes too. perch uses it for the lofts it makes itself (`new_tab {url, loft:"1280x800"}`), so an agent never has to clean up. An owned loft also goes by itself 30 seconds after its last window closes. `--label <text>` notes who made it, and `loft list` shows it.

For scripts and agents, `--json` prints `{up, id, displayId, vendor, product, name, bounds}`, and `status` exits 3 when the loft is down. The loft's identity is stable: vendor `0x6c66`, product `0x7466`, and the `displayId` it reports while up. Its name is `"loft"`, though what macOS shows for it is unverified. Its record is `holder.json` in `~/Library/Application Support/loft` (`lofts/<id>.json` for a named one), and its bounds are the ones from `up`, which don't follow you rearranging displays. As in [rooms](https://github.com/sryo/rooms), names are a letter then up to 30 of a-z, 0-9 and -, sizes are `WIDTHxHEIGHT`, and with `--json` an error is `{ok:false, code, error}` on stdout.

loft never moves your windows. An agent puts its own windows on the loft and takes them back.

## Works with
- [perch](https://github.com/sryo/perch): your agent drives a browser window on the loft, in your own profile, without the slowdowns and refusals a covered or minimized window gets.
- [rooms](https://github.com/sryo/rooms): when the agent needs its own signed-in browser rather than yours.

## Known gaps
- The loft shows up in System Settings > Displays while it's up, and macOS treats it as a real monitor. It sits below and to the left of your main display, touching only its bottom-left corner, and a mouse that slips through that corner is put straight back on your screen.
- It relies on a part of macOS that Apple doesn't document, so a macOS update could break it.
