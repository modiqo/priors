#!/usr/bin/env sh
# priors installer — one command, any harness.
# The enforcement core is a plain Node script; "installing" just means
# teaching your harness the ritual. This detects what you have and does the
# right thing for each; nothing here is destructive.
set -e
SRC="$(cd "$(dirname "$0")" && pwd)"
KEEPER="$SRC/skills/priors/scripts/priors.mjs"
found=0

if ! command -v node >/dev/null 2>&1; then
  echo "priors requires node >= 18, but node was not found." >&2
  exit 1
fi
NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "priors requires node >= 18; found $(node --version)." >&2
  exit 1
fi

# Claude Code (and anything else reading ~/.claude/skills)
if [ -d "$HOME/.claude" ]; then
  mkdir -p "$HOME/.claude/skills" "$HOME/.claude/commands"
  cp -R "$SRC/skills/priors" "$HOME/.claude/skills/"
  cp "$SRC/commands/with-priors.md" "$HOME/.claude/commands/"
  echo "✓ Claude Code — skill 'priors' + /with-priors command installed"
  found=1
fi

# OpenClaw (Agent Skills native)
if [ -d "$HOME/.openclaw" ]; then
  mkdir -p "$HOME/.openclaw/skills"
  cp -R "$SRC/skills/priors" "$HOME/.openclaw/skills/"
  echo "✓ OpenClaw — skill 'priors' installed"
  found=1
fi

# Codex CLI (skills + custom prompts; honors CODEX_HOME)
CODEX_DIR="${CODEX_HOME:-$HOME/.codex}"
if [ -d "$CODEX_DIR" ]; then
  mkdir -p "$CODEX_DIR/skills" "$CODEX_DIR/prompts"
  cp -R "$SRC/skills/priors" "$CODEX_DIR/skills/"
  cp "$SRC/commands/with-priors.md" "$CODEX_DIR/prompts/"
  echo "✓ Codex — skill 'priors' + /with-priors prompt installed ($CODEX_DIR)"
  found=1
fi

# Kimi Code CLI (Agent Skills native; honors KIMI_CODE_HOME)
KIMI_DIR=""
if [ -n "${KIMI_CODE_HOME:-}" ] && [ -d "$KIMI_CODE_HOME" ]; then
  KIMI_DIR="$KIMI_CODE_HOME"
elif [ -d "$HOME/.kimi-code" ]; then
  KIMI_DIR="$HOME/.kimi-code"
elif [ -d "$HOME/.kimi" ]; then
  KIMI_DIR="$HOME/.kimi"
fi
if [ -n "$KIMI_DIR" ]; then
  mkdir -p "$KIMI_DIR/skills"
  cp -R "$SRC/skills/priors" "$KIMI_DIR/skills/"
  echo "✓ Kimi CLI — skill 'priors' installed ($KIMI_DIR/skills)"
  found=1
fi

echo ""
echo "Not detected above? The protocol is identical everywhere:"
echo "  → Codex:      codex plugin marketplace add conikeec/priors"
echo "                codex plugin add priors@priors-marketplace"
echo "  → Kimi CLI:   also reads ~/.claude/skills and ~/.codex/skills natively —"
echo "                an install for either harness above covers Kimi too"
echo "  → Other       Agent-Skills harnesses: point them at $SRC/skills/priors"
echo "  → Anything    with a shell (Hermes, custom): use adapters/system-prompt.md"
echo ""
echo "Keeper path for adapters: $KEEPER"
if [ "$found" -eq 0 ]; then
  echo "No skills directory detected — that's fine: the adapters above are the install."
fi
echo "Runtime verified: $(node --version) (node >= 18 required)."
