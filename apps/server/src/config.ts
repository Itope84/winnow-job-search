import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const VERSION = '0.1.0';

export interface ServerConfig {
  /** The folder that holds `users/` and the server-wide `_winnow/`. */
  root: string;
  stateDir: string;
  usersDir: string;
  port: number;
  host: string;
  skillsDir: string;
  webDir: string;
  /** Replace real CLIs with the replay adapter (tests, demos). */
  replayDir: string | null;
  /** Server-wide caps on concurrent runs per lane. */
  maxRuns: { scan: number; ai: number };
  /** Cookies only over HTTPS when the server sits behind a TLS proxy. */
  secureCookies: boolean;
}

export class ConfigError extends Error {}

/** Settings kept in `<repo>/.env` (gitignored). */
export function loadDotEnv(file = join(REPO_ROOT, '.env')) {
  if (!existsSync(file)) return;
  try {
    process.loadEnvFile(file);
  } catch (e) {
    console.warn(`Could not read ${file}: ${(e as Error).message}`);
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const root = resolve(env.WINNOW_ROOT ?? join(REPO_ROOT, 'library'));
  const stateDir = join(root, '_winnow');
  const usersDir = join(root, 'users');
  for (const dir of [root, usersDir, stateDir]) mkdirSync(dir, { recursive: true });
  const count = (v: string | undefined, fallback: number) => {
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : fallback;
  };
  return {
    root,
    stateDir,
    usersDir,
    port: count(env.WINNOW_PORT, 8820),
    host: env.WINNOW_HOST ?? '0.0.0.0',
    skillsDir: resolve(env.WINNOW_SKILLS ?? join(REPO_ROOT, 'skills')),
    webDir: resolve(env.WINNOW_WEB_DIR ?? join(REPO_ROOT, 'apps/app/dist')),
    replayDir: env.WINNOW_REPLAY ? resolve(env.WINNOW_REPLAY) : null,
    maxRuns: { scan: count(env.WINNOW_MAX_SCANS, 2), ai: count(env.WINNOW_MAX_AI, 5) },
    secureCookies: env.WINNOW_SECURE_COOKIES === '1',
  };
}
