#!/usr/bin/env bash
# Winnow one-shot setup. Designed to be run BY an AI agent (Claude Code,
# Codex, OpenCode) on the person's own Mac or Linux box, not pasted by hand.
#
#   ./scripts/init.sh                 full setup (checks, installs deps, builds web UI)
#   ./scripts/init.sh --check         only report what is missing, change nothing
#   ./scripts/init.sh --yes           auto-install missing brew packages (macOS)
#   ./scripts/init.sh --tunnel <mode> after setup, print remote-access steps:
#                                     none | tailscale | cloudflare
#
# Idempotent: safe to re-run. Every step prints what it is doing in plain
# language (the agent reads that aloud to a non-technical person) and verifies
# the result before moving on.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
mode="setup"
auto_yes=0
tunnel="none"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check) mode="check"; shift ;;
    --yes) auto_yes=1; shift ;;
    --tunnel) tunnel="${2:-none}"; shift 2 ;;
    --tunnel=*) tunnel="${1#--tunnel=}"; shift ;;
    --help|-h) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "Unknown flag: $1 (try --help)"; exit 1 ;;
  esac
done

pass=1
say()  { printf '\n== %s ==\n' "$1"; }
ok()   { printf '  ✓ %s\n' "$1"; }
miss() { printf '  ✗ %s\n' "$1"; pass=0; }
info() { printf '  · %s\n' "$1"; }

have() { command -v "$1" >/dev/null 2>&1; }

node_major() {
  have node || return 1
  node -p "process.versions.node.split('.')[0]"
}

need_browser=0

say "1/7 — Computer check (Node, package manager)"
if have node && [[ "$(node_major)" -ge 22 ]]; then
  ok "Node $(node --version) (need 22+)"
else
  miss "Node 22+ not found. Install it first: https://nodejs.org (LTS), then re-run."
fi
if have pnpm; then
  ok "pnpm $(pnpm --version 2>/dev/null || echo present)"
else
  miss "pnpm not found. Run: corepack enable && corepack prepare pnpm@12.8.1 --activate"
fi
if [[ "$mode" == "check" && "$pass" == "0" ]]; then :; fi

say "2/7 — AI helper check (at least one needed; the server does no AI by itself)"
found_cli=0
have opencode && { ok "OpenCode: $(opencode --version 2>/dev/null | head -1)"; found_cli=1; } || info "OpenCode not found (optional; https://opencode.ai)"
have claude  && { ok "Claude Code: $(claude --version 2>/dev/null | head -1)"; found_cli=1; } || info "Claude Code not found (optional; npm i -g @anthropic-ai/claude-code)"
have codex   && { ok "Codex: $(codex --version 2>/dev/null | head -1)"; found_cli=1; } || info "Codex not found (optional; npm i -g @openai/codex)"
if [[ "$found_cli" == "0" ]]; then
  miss "No AI CLI found. With only a Claude chat subscription and no terminal helper, install Claude Code first, then hand this repo to it."
else
  info "Cheap models first: Claude Haiku / Codex mini-tier for triage + setup runs; stronger model only for scoring + tailored CVs (set per person in the app: You › AI)."
fi

say "3/7 — PDF tools (only needed for tailored CVs + cover letters)"
if have tectonic; then ok "tectonic $(tectonic --version 2>/dev/null | head -1)"; else
  miss "tectonic not found (CV PDFs won't build without it)"
  [[ "$auto_yes" == "1" && "$(uname)" == "Darwin" && "$mode" != "check" ]] && brew install tectonic || info "Install: brew install tectonic  (Linux: see https://tectonic-typesetting.github.io)"
fi
if have pdftotext; then ok "poppler (pdftotext) present"; else
  miss "poppler not found (CV import from PDF won't work without it)"
  [[ "$auto_yes" == "1" && "$(uname)" == "Darwin" && "$mode" != "check" ]] && brew install poppler || info "Install: brew install poppler"
fi

say "4/7 — Reading browser (headless Chromium: the server's last resort for stubborn postings)"
case "$(uname)" in
  Darwin) browser_cache="$HOME/Library/Caches/ms-playwright" ;;
  *) browser_cache="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}" ;;
esac
if ls -d "$browser_cache"/chromium-* >/dev/null 2>&1; then
  ok "Headless Chromium present (JS-heavy postings still get read)"
  need_browser=0
else
  miss "No Playwright Chromium found. Most postings still read fine; JS-heavy ones may come back empty."
  info "Install: pnpm exec playwright install chromium  (~170MB, one time; --yes does it during setup)"
  need_browser=1
fi

if [[ "$mode" == "check" && "$tunnel" == "none" ]]; then
  say "Check only — changed nothing."
  [[ "$pass" == "1" ]] && ok "Everything needed is present." || miss "Something above is missing; fix it, then run ./scripts/init.sh"
  exit $((1 - pass))
fi
if [[ "$mode" == "check" ]]; then
  say "Check only — changed nothing, skipping install/build/account steps."
fi

if [[ "$mode" != "check" ]]; then
say "5/7 — Settings file (.env)"
if [[ ! -f "$root/.env" ]]; then
  cp "$root/.env.example" "$root/.env"
  ok "Created .env from .env.example (edit keys later; Adzuna/CareerJet optional)"
else
  ok ".env already exists, left alone"
fi

say "6/7 — Install + build the app the server serves"
info "Running: pnpm install"
pnpm --dir "$root" install --prefer-offline
ok "Dependencies installed"
if [[ "$need_browser" == "1" ]]; then
  if [[ "$auto_yes" == "1" ]]; then
    info "Downloading headless Chromium (~170MB, one time)…"
    if pnpm --dir "$root" exec playwright install chromium; then ok "Headless Chromium installed"; fi
  else
    info "Skipping Chromium (no --yes). Add it later: pnpm exec playwright install chromium"
  fi
fi
info "Running: pnpm build:web (takes a minute the first time)"
pnpm --dir "$root" build:web
if [[ -d "$root/apps/app/dist" ]]; then ok "Web UI built (apps/app/dist)"; else miss "build:web produced no apps/app/dist"; exit 1; fi

say "7/7 — First run + your account"
info "Starting the server briefly to verify it boots…"
if have timeout; then
  (cd "$root" && timeout 12 pnpm --filter @winnow/server start 2>&1 | head -8) || true
  ok "Server boots (full run: pnpm --filter @winnow/server start → http://localhost:8820)"
else
  info "Skipping the boot check (no 'timeout' on this machine; Mac: brew install coreutils for it)"
  info "Verify by hand: pnpm --filter @winnow/server start → http://localhost:8820"
fi
info "Next: pnpm users add <username> <email> [name] --admin   (first account becomes admin automatically; prints an invite link — copy it, nothing is emailed)"
info "Then open http://localhost:8820/welcome?invite=… and follow setup (CV → details → targets → 5 questions → profile check → sources + first scan)."
info "Keep it running at login (Mac): scripts/install-launchd.sh   (logs: library/_winnow/server.log)"
fi

if [[ "$tunnel" != "none" ]]; then
  say "Remote access: $tunnel"
  port="${WINNOW_PORT:-8820}"
  case "$tunnel" in
    tailscale)
      info "Recommended for family: private, no public URL. Install Tailscale on this server + each phone/laptop (https://tailscale.net), join the same tailnet, then open the server address from the other device."
      have tailscale && { ok "tailscale present ($(tailscale version 2>/dev/null | head -1))"; info "Bonus, and worth doing: tailscale serve http://localhost:$port gives a proper https address — fixes PWA install + offline on phones and encrypts passwords on your Wi-Fi."; } || info "Install: brew install tailscale  (Linux: curl -fsSL https://tailscale.com/install.sh | sh)"
      info "Set WINNOW_PUBLIC_URL=<the address other devices open> in .env so invite links work on them."
      ;;
    cloudflare)
      info "One session at a time (e.g. helping family remotely), then stop it. It creates a PUBLIC link — anyone with it reaches your server, and sign-in here is password-only (no second factor, no rate limit). Links leak via screenshots and forwards."
      have cloudflared && ok "cloudflared present" || info "Install: brew install cloudflared"
      info "Run: cloudflared tunnel --url http://localhost:$port   (prints a https://….trycloudflare.com URL)"
      info "Then set in .env: WINNOW_PUBLIC_URL=<that https URL> (cookies go Secure automatically), restart the server. Want Cloudflare permanently? Use a named tunnel + Cloudflare Access (email code) in front, not a bare quick tunnel."
      ;;
  esac
else
  info "Outside the home? Re-run with --tunnel tailscale (private, family — recommended) or --tunnel cloudflare (public link for remote help). Details in README."
fi

say "Done."
ok "Open http://localhost:8820 — everyone you invite gets their own jobs, CV and settings on this one server."
