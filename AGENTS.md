# Winnow

A job-search PWA plus its own server. Read `README.md` for running it, `docs/plan.md` for what's built, and
the product brief (Claude Docs, "Yinkops rebuild: product brief") for product rules.

## The decisions that matter

- **The server owns the data and the work.** The app only shows state and sends decisions. Every job lives in
  the person's `winnow.db` (`library/users/<id>/`), with captured descriptions in `jd/`, reports in `reports/`,
  tailored CVs and letters in `applications/<job id>/`, AI run folders in `runs/`, and the CV and profile in
  `profile/`.
- **Every move has a reason.** A job is in exactly one list (inbox, shortlist, scored, applied, archive). Moving
  it records who moved it; archiving needs a reason. Keep it that way in any new code path.
- **All work is a run.** Runs are stored (`runs` table), queued in a scan lane and an AI lane, report progress,
  and survive restarts: on start-up, running work becomes `interrupted` and resumes from its checkpoint.
- **AI runs write a result file.** A skill in `skills/` writes `result.json` (and `report.md` for scoring) in its
  run folder; the server validates it and saves it in one step. The server stops the CLI as soon as a valid
  result exists. Never parse answers from stdout.
- **OpenCode runs with `--dir <library>`.** Without it, OpenCode resolves paths against the server's folder.
  Its edit rules only match `**/<folder>/*`-style globs; see `adapters/opencode.ts`.
- **Intake is the one door for new postings**: dedupe by canonical URL and company/role/place, rules (title
  misses are counted, location/pay/age misses are archived with the rule), then inbox.
- **Sign-in:** email and password, invite-only, session cookie, `x-winnow: 1` header on writes. The server
  serves the app and `/api` from one origin.

## Working rules

- Test skills through OpenCode with a cheap model on a scratch library (`WINNOW_ROOT=…`), never on `library/`.
- Tests use the replay adapter (`fixtures/replay`), never a real CLI.
- Contract changes go in `packages/api/src/index.ts` first, then the server, then the app.
- Expo SDK 57: read `apps/app/AGENTS.md`; install with `npx expo install`.
- Playwright stays on 1.63 (matches the installed browsers).
- Check visual changes with `scripts/shot.mjs` screenshots.
