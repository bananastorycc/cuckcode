#!/bin/sh
# Electron's own installer can unpack only part of its zip on newer Node (no Electron
# Framework, so nothing launches). Re-extract it with ditto when that happens.
cd "$(dirname "$0")/.." || exit 1
E=node_modules/electron
[ -d "$E/dist/Electron.app/Contents/Frameworks/Electron Framework.framework" ] && exit 0
V=$(node -p "require('./$E/package.json').version")
A=$(uname -m | sed 's/x86_64/x64/')
find_zip() { find "$HOME/Library/Caches/electron" -name "electron-v$V-darwin-$A.zip" 2>/dev/null | head -1; }
ZIP=$(find_zip)
[ -n "$ZIP" ] || { node "$E/install.js"; ZIP=$(find_zip); }
[ -n "$ZIP" ] || { echo "ensure-electron: no Electron $V zip found" >&2; exit 1; }
rm -rf "$E/dist" && ditto -x -k "$ZIP" "$E/dist" && printf %s Electron.app/Contents/MacOS/Electron > "$E/path.txt"
echo "ensure-electron: repaired Electron $V"
