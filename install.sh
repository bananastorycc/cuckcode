#!/bin/bash
# Install cuckcode on a Mac:
#   curl -fsSL https://raw.githubusercontent.com/bananastorycc/cuckcode/main/install.sh | bash
# Safe to rerun; it updates the checkout and reinstalls the app.
set -euo pipefail
REPO_URL=https://github.com/bananastorycc/cuckcode.git
DIR="${CUCKCODE_DIR:-$HOME/repos/cuckcode}"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

command -v git >/dev/null || { echo "Need git: run  xcode-select --install" >&2; exit 1; }
command -v node >/dev/null || { echo "Need Node: run  brew install node" >&2; exit 1; }
command -v claude >/dev/null || echo "Note: claude isn't on PATH yet. Install Claude Code before using the app." >&2

if [ -d "$DIR/.git" ]; then
  git -C "$DIR" pull --rebase --autostash
else
  mkdir -p "$(dirname "$DIR")"
  git clone "$REPO_URL" "$DIR"
fi
cd "$DIR"
npm install --no-audit --no-fund
npm run app
open /Applications/cuckcode.app
