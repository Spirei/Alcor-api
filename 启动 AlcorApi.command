#!/bin/zsh
set -eu
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
cd -- "${0:A:h}"
if [[ ! -d node_modules ]]; then
  npm ci
fi
npm run build
exec uv run python tools/local-runtime.py
