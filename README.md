# loft

loft gives your agents a screen of their own on your Mac, so their windows stop crowding yours. It adds a monitor that only exists in software: windows put there stay on, painting and never covered, but you never see them. When you stop loft, the monitor is gone.

## Install
```bash
git clone https://github.com/sryo/loft && cd loft && npm link
```

## Use
```bash
loft up        # add the hidden monitor (loft up 2560x1440 for another size)
loft status    # whether it's up, its size and where it sits
loft down      # remove it
```

loft never moves your windows. An agent puts its own windows on the loft and takes them back.

## Works with
- [perch](https://github.com/sryo/perch): your agent drives a browser window on the loft, in your own profile, without the slowdowns and refusals a covered or minimized window gets.
- [rooms](https://github.com/sryo/rooms): when the agent needs its own signed-in browser rather than yours.

## Known gaps
- The loft shows up in System Settings > Displays while it's up, and your mouse can wander onto it, since macOS treats it as a real monitor.
- It relies on a part of macOS that Apple doesn't document, so a macOS update could break it.
