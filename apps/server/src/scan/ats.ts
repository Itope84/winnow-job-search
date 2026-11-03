import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SourceEntry } from '@winnow/api';
import { getSources } from '../library.ts';
import type { RunCtx, RunOutput } from '../runs/runner.ts';
import { Intake } from './intake.ts';
import { finishScan } from './portals.ts';
import { loadProviders, type Provider } from './providers.ts';

/**
 * Full ATS scan: the reverse scan from career-ops `scan-ats-full.mjs`. Walks the public company directories
 * for Greenhouse, Lever, Ashby and Workday (github.com/Feashliaa/job-board-aggregator), keeps fresh
 * postings that pass your rules. No AI. Saves its place so an interrupted scan resumes.
 */

const DATASET = 'https://raw.githubusercontent.com/Feashliaa/job-board-aggregator/main/data';
const SLUG = /^[A-Za-z0-9._-]+$/;
const CONCURRENCY = 20;
const DEFAULT_SINCE_DAYS = 3;

export type Ats = 'greenhouse' | 'lever' | 'ashby' | 'workday';
export const ATS: Ats[] = ['greenhouse', 'lever', 'ashby', 'workday'];

export function toEntry(ats: Ats, raw: string): SourceEntry | null {
  const s = String(raw);
  const host = (url: string, ok: (h: string) => boolean) => {
    try {
      return ok(new URL(url).hostname) ? url : null;
    } catch {
      return null;
    }
  };
  if (ats === 'workday') {
    const [tenant, instance, site] = s.split('|');
    if (!tenant || !instance || !site || ![tenant, instance, site].every((p) => SLUG.test(p)))
      return null;
    const url = host(`https://${tenant}.${instance}.myworkdayjobs.com/${site}`, (h) =>
      h.endsWith('.myworkdayjobs.com'),
    );
    return url ? { name: tenant, careers_url: url } : null;
  }
  if (!SLUG.test(s)) return null;
  const base = {
    greenhouse: 'https://job-boards.greenhouse.io/',
    lever: 'https://jobs.lever.co/',
    ashby: 'https://jobs.ashbyhq.com/',
  }[ats];
  return { name: s, careers_url: `${base}${s}` };
}

export async function companyList(cacheDir: string, ats: Ats): Promise<string[]> {
  mkdirSync(cacheDir, { recursive: true });
  const file = join(cacheDir, `${ats}.json`);
  const fresh = existsSync(file) && Date.now() - statSync(file).mtimeMs < 24 * 3_600_000;
  if (!fresh) {
    try {
      const res = await fetch(`${DATASET}/${ats}_companies.json`, {
        signal: AbortSignal.timeout(30_000),
      });
      if (res.ok) {
        const data = (await res.json()) as unknown;
        if (Array.isArray(data)) {
          writeFileSync(file, JSON.stringify(data));
          return data.map(String);
        }
      }
    } catch {
      // Fall back to the cached list below.
    }
  }
  try {
    return (JSON.parse(readFileSync(file, 'utf8')) as unknown[]).map(String);
  } catch {
    return [];
  }
}

/** Boards that answered 404 recently, skipped for two weeks (career-ops `dead-slugs.json`). */
const DEAD_DAYS = 14;
export function loadDead(cacheDir: string): Map<string, number> {
  try {
    const raw = JSON.parse(readFileSync(join(cacheDir, 'dead-boards.json'), 'utf8')) as Record<
      string,
      number
    >;
    const cutoff = Date.now() - DEAD_DAYS * 86_400_000;
    return new Map(Object.entries(raw).filter(([, t]) => typeof t === 'number' && t >= cutoff));
  } catch {
    return new Map();
  }
}
function saveDead(cacheDir: string, dead: Map<string, number>) {
  try {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(cacheDir, 'dead-boards.json'), JSON.stringify(Object.fromEntries(dead)));
  } catch {
    // A cache we can't write only makes the next scan slower.
  }
}
const isDead = (e: unknown) => /\b(404|410)\b|not found/i.test(String((e as Error)?.message ?? ''));

interface Checkpoint {
  /** Companies finished, as `ats:name`. Kept as a count per ATS to stay small. */
  doneByAts: Partial<Record<Ats, number>>;
  stats?: unknown;
}

export function atsScanner(cacheDir: string) {
  return async function scanAts(ctx: RunCtx): Promise<RunOutput> {
    const sources = getSources(ctx.space.db);
    const sinceDays = sources.rules.maxAgeDays ?? DEFAULT_SINCE_DAYS;
    const cutoff = Date.now() - sinceDays * 86_400_000;
    const { providers, makeHttpCtx } = await loadProviders();
    const intake = new Intake(ctx.space.db, ctx.space.jobs, sources.rules, ctx.run.id, false);
    const checkpoint = ctx.checkpoint<Checkpoint>() ?? { doneByAts: {} };
    const dead = loadDead(cacheDir);
    let skippedDead = 0;

    ctx.step('Downloading company directories');
    const lists: { ats: Ats; entries: SourceEntry[]; provider: Provider }[] = [];
    for (const ats of ATS) {
      const provider = providers.get(ats);
      if (!provider) continue;
      const raw = await companyList(cacheDir, ats);
      const entries = raw.map((r) => toEntry(ats, r)).filter((e): e is SourceEntry => !!e);
      lists.push({ ats, entries, provider });
    }
    const total = lists.reduce((n, l) => n + l.entries.length, 0);
    if (!total)
      throw new Error(
        'Could not download the company directories. Check the connection and retry.',
      );
    let done = lists.reduce(
      (n, l) => n + Math.min(checkpoint.doneByAts[l.ats] ?? 0, l.entries.length),
      0,
    );
    let undated = 0;
    let stale = 0;
    let failed = 0;
    ctx.progress(done, total, 'companies');

    for (const { ats, entries, provider } of lists) {
      let index = checkpoint.doneByAts[ats] ?? 0;
      if (index >= entries.length) continue;
      ctx.step(`Scanning ${ats} · ${entries.length.toLocaleString()} companies`);
      let next = index;
      let finished = index;
      const worker = async () => {
        for (;;) {
          if (ctx.signal.aborted) return;
          const i = next++;
          const entry = entries[i];
          if (!entry) return;
          const key = `${ats}:${entry.name}`;
          if (dead.has(key)) {
            skippedDead++;
            finished++;
            done++;
            continue;
          }
          try {
            const offers = await provider.fetch(entry, makeHttpCtx());
            for (const offer of Array.isArray(offers) ? offers : []) {
              if (!offer.postedAt) {
                undated++;
                continue;
              }
              if (offer.postedAt < cutoff) {
                stale++;
                continue;
              }
              intake.add(offer, `${ats}-full`, entry.name);
            }
          } catch (e) {
            failed++;
            if (isDead(e)) dead.set(key, Date.now());
          }
          finished++;
          done++;
          if (done % 25 === 0) ctx.progress(done, total, 'companies');
          if (finished - index >= 200) {
            index = finished;
            checkpoint.doneByAts[ats] = finished;
            ctx.saveCheckpoint(checkpoint);
            saveDead(cacheDir, dead);
          }
        }
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      if (ctx.signal.aborted) {
        checkpoint.doneByAts[ats] = Math.min(finished, entries.length);
        ctx.saveCheckpoint(checkpoint);
        throw new Error('Cancelled');
      }
      checkpoint.doneByAts[ats] = entries.length;
      ctx.saveCheckpoint(checkpoint);
      saveDead(cacheDir, dead);
      ctx.progress(done, total, 'companies');
    }
    ctx.log(
      'info',
      `Skipped ${undated} undated and ${stale} older than ${sinceDays} days; ${failed} boards failed; ${skippedDead} known-dead boards skipped.`,
    );
    return finishScan(ctx, intake, {
      undated,
      stale,
      failedBoards: failed,
      skippedDead,
      sinceDays,
    });
  };
}
