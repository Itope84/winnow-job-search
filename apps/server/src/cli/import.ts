/**
 * Import a career-ops checkout into one person's library (read-only on the career-ops side).
 *
 *   pnpm import:career-ops <user id> <path to career-ops folder> [--profile-only]
 *
 * --profile-only brings the CV, profile, model settings and sources, but no jobs.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadConfig, loadDotEnv } from '../config.ts';
import { importCareerOps } from '../import/career-ops.ts';
import { openSpace } from '../space.ts';
import { Users } from '../users.ts';

loadDotEnv();
const config = loadConfig();
const args = process.argv.slice(2);
const profileOnly = args.includes('--profile-only');
const [userId, from] = args.filter((a) => !a.startsWith('--'));
if (!userId || !from) {
  console.error(
    'Usage: pnpm import:career-ops <user id> <path to career-ops folder> [--profile-only]',
  );
  process.exit(1);
}
const users = new Users(config.stateDir);
if (!users.get(userId)) {
  console.error(`No user ${userId}. Add one first: pnpm users add ${userId} <email>`);
  process.exit(1);
}
users.close();

const space = openSpace(config.usersDir, userId);
const started = Date.now();
const sum = importCareerOps(resolve(from), space, { jobs: !profileOnly });
console.log(
  `Imported ${resolve(from)} into ${userId} in ${((Date.now() - started) / 1000).toFixed(1)}s`,
);
console.log(
  `  Inbox ${sum.inbox} · Shortlist ${sum.shortlist} · Scored ${sum.scored} · Applied ${sum.applied} · Archive ${sum.archived}`,
);
console.log(
  `  Triage verdicts ${sum.triaged} · Job descriptions ${sum.descriptions} · Reports ${sum.reports} · Seen links ${sum.seenUrls}`,
);
console.log(
  `  Sources: ${sum.companies} companies, ${sum.boards} boards, ${sum.queries} AI queries · Profile: ${sum.profile.join(', ') || 'none'}`,
);
for (const w of sum.warnings) console.log(`  ! ${w}`);
// Boards career-ops already found dead: the Full ATS scan skips them (shared by everyone on this server).
const deadFile = join(resolve(from), 'data/cache/dead-slugs.json');
if (existsSync(deadFile)) {
  try {
    const src = JSON.parse(readFileSync(deadFile, 'utf8')) as Record<string, number>;
    const dir = join(config.stateDir, 'ats-companies');
    mkdirSync(dir, { recursive: true });
    const target = join(dir, 'dead-boards.json');
    const merged = existsSync(target)
      ? (JSON.parse(readFileSync(target, 'utf8')) as Record<string, number>)
      : {};
    for (const [key, at] of Object.entries(src)) merged[key.replace('/', ':')] = at;
    writeFileSync(target, JSON.stringify(merged));
    console.log(
      `  Known-dead job boards: ${Object.keys(src).length} (Full ATS skips them for 14 days)`,
    );
  } catch (e) {
    console.log(`  ! dead-slugs.json: ${(e as Error).message}`);
  }
}
space.db.close();
