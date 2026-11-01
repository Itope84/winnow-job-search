# Winnow

Find jobs, sort them, and score the good ones against your CV. One server on your Mac does the work (scans,
triage, scoring through OpenCode or Claude Code) and serves the app; you open it in a browser or install it as
a PWA. Several people can share one server, each with their own jobs, CV and settings.

## Run it

```bash
pnpm install
pnpm build:web                       # build the app the server serves
pnpm --filter @winnow/server start   # http://localhost:8820 (and on your LAN)
```

Tailored CVs and cover letters need Tectonic and Poppler on the server's PATH (`brew install tectonic
poppler`). Tectonic downloads LaTeX packages the first time a document uses them, so the first one takes a few
minutes.

On this Mac it runs as a login item: `scripts/install-launchd.sh` (`--uninstall` removes it). Restart with
`launchctl kickstart -k gui/$(id -u)/com.winnow.server`; logs in `library/_winnow/server.log`.

Add people (nothing is emailed: copy the link and send it yourself):

```bash
pnpm users add <username> <email> [name] [--admin]   # prints an invite link; sign in with username or email
pnpm users invite <id>                         # a new link; also resets a forgotten password
pnpm users email <id> <new email>
pnpm users list
```

A new person lands in setup after their first sign-in: CV (PDF or pasted), details, targets, five questions,
a profile AI drafts for them to check, and suggested sources ending in a first scan. They can finish later
(Jobs shows a banner) or go through it again from You › Set up again. Setup's AI runs use the person's
default model; models are set per person in You › AI, so set them for a new account before they start.

Bring over a career-ops checkout (read-only on the career-ops side; safe to run twice):

```bash
pnpm import:career-ops <id> ~/path/to/career-ops
pnpm import:career-ops <id> ~/path/to/career-ops --profile-only   # CV, profile, models, sources; no jobs
```

It imports the inbox, shortlist, tracker and reports, pre-screen discards with their reasons, triage verdicts
from the old web app, captured job descriptions, `portals.yml` (companies, boards, AI queries, rules), the CV,
`modes/_profile.md` and `config/profile.yml` (including `opencode_models`).

## Settings (`.env`, gitignored)

| Variable                                               | Default     | What it does                                                  |
| ------------------------------------------------------ | ----------- | ------------------------------------------------------------- |
| `WINNOW_PORT`                                          | `8820`      | Port for the app and the API (`/api`)                         |
| `WINNOW_ROOT`                                          | `./library` | Where everyone's data lives                                   |
| `WINNOW_MAX_SCANS` / `WINNOW_MAX_AI`                   | `2` / `5`   | Runs at once across everyone; triage goes ahead of scoring    |
| `WINNOW_SECURE_COOKIES`                                | off         | Set `1` behind HTTPS                                          |
| `WINNOW_REPLAY`                                        | off         | Folder of replay scripts instead of a real CLI (tests, demos) |
| `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, `CAREERJET_API_KEY` |             | Keys some job boards need                                     |

## Layout

```
packages/api/        shared types: lists, reasons, runs, the API shapes
apps/server/         Hono on node:sqlite. Sign-in, jobs, runs, scans, intake, AI runs, import, SSE
  vendor/career-ops/ the career-ops job-board providers, unchanged (MIT)
apps/app/            Expo Router app (web now): Jobs, Find, Activity, You
skills/              triage, score, ai-search: what the AI CLI follows
fixtures/replay/     scripted AI runs for tests
design/              brand (icon, wordmark) and the Stitch reference screens
```

## Checks

```bash
pnpm test        # server tests (replay adapter, never a real CLI)
pnpm typecheck
pnpm lint
node scripts/shot.mjs <url> <email> <password file> <out dir> phone|desktop <paths…>   # screenshots
```
