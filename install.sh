#!/usr/bin/env bash
# loft installer — clones loft and links its `loft` command onto your PATH.
# Re-runnable: pulls if already cloned, and npm link replaces its own link.
#
# Overrides:
#   LOFT_REPO=...   git URL to clone from
#   LOFT_DIR=...    install location (default: ~/.loft)

set -euo pipefail

LOFT_REPO="${LOFT_REPO:-https://github.com/sryo/loft.git}"
LOFT_DIR="${LOFT_DIR:-$HOME/.loft}"

[[ "$(uname -s)" == "Darwin" ]] || { echo "loft only works on macOS." >&2; exit 1; }

command -v git >/dev/null || { echo "git not found. Run: xcode-select --install" >&2; exit 1; }
command -v node >/dev/null || { echo "node not found. Install Node 22.16+ from https://nodejs.org" >&2; exit 1; }
command -v npm >/dev/null || { echo "npm not found. Reinstall Node from https://nodejs.org" >&2; exit 1; }

if [[ -f "$LOFT_DIR/loft.mjs" ]]; then
  if [[ -d "$LOFT_DIR/.git" ]]; then
    echo "loft already at $LOFT_DIR — pulling latest..."
    git -C "$LOFT_DIR" pull --ff-only
  else
    echo "loft already at $LOFT_DIR (local, no git repo — skipping pull)..."
  fi
else
  echo "Cloning loft to $LOFT_DIR..."
  git clone "$LOFT_REPO" "$LOFT_DIR"
fi

# The required version is package.json's engines.node (">=X.Y"), read from the
# checkout so this script never drifts from it.
LOFT_DIR="$LOFT_DIR" node -e '
  const want = (require(process.env.LOFT_DIR + "/package.json").engines?.node || "").replace(/^>=\s*/, "");
  if (!want) process.exit(0);
  const [a, b] = [process.versions.node, want].map((v) => v.split(".").map(Number));
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) > (b[i] || 0)) process.exit(0);
    if ((a[i] || 0) < (b[i] || 0)) {
      console.error(`node ${process.versions.node} < ${want}. Upgrade Node: https://nodejs.org`);
      process.exit(1);
    }
  }
'

echo "Linking the loft command..."
(cd "$LOFT_DIR" && npm link --silent)

cat <<EOF

loft installed at $LOFT_DIR

No build step and no permission to grant: try it with

  loft up       # add the hidden monitor
  loft status   # where it sits
  loft down     # remove it

If \`loft\` isn't found, add npm's global bin dir (\`npm prefix -g\`/bin) to your PATH.
EOF
