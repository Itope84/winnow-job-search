import type { SourceEntry } from '@winnow/api';
import { getSources } from '../library.ts';
import type { RunCtx, RunOutput } from '../runs/runner.ts';
import { clip } from '../util.ts';
import { captureMany } from './capture.ts';
import { Intake } from './intake.ts';
import { loadProviders, resolveEntry } from './providers.ts';

const CONCURRENCY = 8;

/** Portals scan: every enabled company and job board, through the career-ops providers. No AI. */
export async function scanPortals(ctx: RunCtx): Promise<RunOutput> {
  const sources = getSources(ctx.space.db);
  const entries: { entry: SourceEntry; board: boolean }[] = [
    ...sources.companies
      .filter((e) => e.enabled !== false)
      .map((entry) => ({ entry, board: false })),
    ...sources.boards.filter((e) => e.enabled !== false).map((entry) => ({ entry, board: true })),
  ];
  if (!entries.length)
    throw new Error('No companies or job boards to scan. Add some in Find › Sources.');
  const { makeHttpCtx } = await loadProviders();
  const intake = new Intake(ctx.space.db, ctx.space.jobs, sources.rules, ctx.run.id);
  const errors: { name: string; error: string }[] = [];
  const unsupported: string[] = [];
  const notes: string[] = [];
  let done = 0;
  ctx.progress(0, entries.length, entries.length === 1 ? 'source' : 'sources');

  const queue = [...entries];
  const worker = async () => {
    for (;;) {
      if (ctx.signal.aborted) return;
      const next = queue.shift();
      if (!next) return;
      const { entry } = next;
      const resolved = await resolveEntry(entry);
      if ('error' in resolved) {
        unsupported.push(entry.name);
      } else {
        ctx.step(`Checking ${resolved.provider.id} · ${entry.name}`);
        try {
          const offers = await resolved.provider.fetch(entry, makeHttpCtx());
          for (const offer of Array.isArray(offers) ? offers : [])
            intake.add(offer, resolved.provider.id, next.board ? '' : entry.name);
          if (offers?.note) {
            notes.push(`${entry.name}: ${offers.note}`);
            ctx.log('info', `${entry.name}: ${offers.note}`);
          }
        } catch (e) {
          errors.push({ name: entry.name, error: clip((e as Error).message, 200) });
          ctx.log('stderr', `${entry.name}: ${(e as Error).message}`);
        }
      }
      ctx.progress(++done, entries.length, 'sources');
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, entries.length) }, worker));
  if (ctx.signal.aborted) throw new Error('Cancelled');

  const out = await finishScan(ctx, intake, { errors, unsupported, notes });
  return notes.length ? { ...out, summary: `${out.summary} · ${clip(notes[0] ?? '', 90)}` } : out;
}

/** Shared tail of every scan: read the new postings, then queue triage for them. */
export async function finishScan(
  ctx: RunCtx,
  intake: Intake,
  extra: Record<string, unknown> = {},
): Promise<RunOutput> {
  const added = intake.stats.added;
  ctx.space.jobs.changed();
  if (added.length) {
    ctx.step(`Reading ${added.length} new job description${added.length === 1 ? '' : 's'}`);
    await captureMany(
      ctx,
      added.filter((id) => !ctx.space.jobs.get(id)?.hasJd),
    );
  }
  const params = ctx.runs.params(ctx.run.id);
  let triageRun: string | null = null;
  if (added.length && params.autoTriage !== false) {
    try {
      triageRun = ctx.enqueue({ kind: 'triage', jobIds: added })[0]?.id ?? null;
    } catch (e) {
      ctx.log('stderr', `Could not queue triage: ${(e as Error).message}`);
    }
  }
  const errors = (extra.errors as unknown[] | undefined)?.length ?? 0;
  return {
    summary: intake.summary() + (errors ? ` · ${errors} failed` : ''),
    result: { ...intake.stats, added: added.length, addedIds: added, triageRun, ...extra },
  };
}
