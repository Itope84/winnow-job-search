import type { TriageResult, TriageVerdict } from '@winnow/api';
import { getSources } from '../library.ts';
import type { RunCtx, RunOutput } from '../runs/runner.ts';
import { clip, nowIso } from '../util.ts';
import { runSkill } from './run-skill.ts';

const CHUNK = 20;
const JD_CHARS = 1800;

interface Verdict {
  id: string;
  verdict: TriageVerdict;
  reason: string;
  agency: boolean;
}

/**
 * What triage and AI search know about the person: profile.yml, the narrative, the start of the CV and
 * "Not on your CV". The texts go in files of their own: OpenCode's read tool cuts long lines, and a JSON
 * string is one line.
 */
export function candidateBrief(ctx: RunCtx) {
  const doc = ctx.space.profile.get();
  const sources = getSources(ctx.space.db);
  return {
    brief: {
      profileYaml: 'profile.yml',
      narrative: 'narrative.md',
      cv: 'cv.md',
      extras: doc.extras.trim() ? 'extras.md' : null,
      excludedTitles: sources.rules.title.negative,
      locations: sources.rules.location,
      salaryFloor: sources.rules.salary,
    },
    files: {
      'profile.yml': clip(doc.profileYaml, 8000),
      'narrative.md': clip(doc.narrative, 6000),
      'cv.md': clip(doc.cv, 7000),
      ...(doc.extras.trim() ? { 'extras.md': clip(doc.extras, 4000) } : {}),
    },
  };
}

function validate(ids: Set<string>) {
  return (value: unknown): Verdict[] => {
    const results = (value as { results?: unknown })?.results;
    if (!Array.isArray(results)) throw new Error('result.json needs a "results" list.');
    const out: Verdict[] = [];
    for (const r of results as Record<string, unknown>[]) {
      const id = String(r?.id ?? '');
      const verdict = String(r?.verdict ?? '').toLowerCase();
      if (!ids.has(id)) continue;
      if (verdict !== 'keep' && verdict !== 'discard' && verdict !== 'unsure') continue;
      out.push({
        id,
        verdict,
        reason: clip(String(r?.reason ?? '').trim(), 300),
        agency: r?.agency === true,
      });
    }
    if (!out.length) throw new Error('result.json had no verdicts for these jobs.');
    return out;
  };
}

/**
 * Quick Triage: Keep, Discard or Unsure for each job, with a reason. Every verdict is saved on the job as
 * soon as its batch finishes; discards go straight to Archive with the reason. Batches run two at a time
 * when a second slot is free.
 */
export async function triage(ctx: RunCtx): Promise<RunOutput> {
  const jobs = ctx.space.jobs;
  const done = new Set(ctx.checkpoint<string[]>() ?? []);
  const todo = ctx.run.jobIds.filter((id) => !done.has(id) && jobs.get(id));
  const counts = { keep: 0, discard: 0, unsure: 0 };
  for (const id of done) {
    const v = jobs.get(id)?.triage?.verdict;
    if (v) counts[v]++;
  }
  const candidate = candidateBrief(ctx);
  const total = ctx.run.jobIds.length;
  ctx.progress(done.size, total, 'jobs');

  const batches: string[][] = [];
  for (let i = 0; i < todo.length; i += CHUNK) batches.push(todo.slice(i, i + CHUNK));
  let nextBatch = 0;
  let failure: unknown = null;

  const judge = async (b: number) => {
    const chunk = batches[b] as string[];
    const items = chunk.map((id) => {
      const job = jobs.require(id);
      const jd = jobs.readJd(id);
      return {
        id,
        company: job.company,
        role: job.role,
        location: job.location,
        salary: job.salary,
        posted: job.postedAt,
        deadline: job.posting?.deadline ?? null,
        warnings: job.posting?.warnings.length ? job.posting.warnings : undefined,
        description: jd ? clip(jd, JD_CHARS) : null,
      };
    });
    ctx.step(`Judging batch ${b + 1} of ${batches.length} (${total} jobs)`);
    const { value } = await runSkill(ctx, {
      skill: 'triage',
      folder: `${ctx.run.id}/batch-${b + 1}`,
      input: { candidate: candidate.brief, jobs: items },
      files: candidate.files,
      task: `Judge all ${items.length} jobs in input.json.`,
      model: ctx.settings.models.triage ?? ctx.settings.models.default,
      timeoutMs: 6 * 60_000,
      validate: validate(new Set(chunk)),
      web: false,
    });
    const at = nowIso();
    const byId = new Map(value.map((v) => [v.id, v]));
    for (const id of chunk) {
      const job = jobs.get(id);
      if (!job) continue;
      // A job the model skipped gets Unsure, never a silent Keep.
      const v = byId.get(id) ?? {
        id,
        verdict: 'unsure' as const,
        reason: 'Triage gave no answer for this job.',
        agency: false,
      };
      const noJd = !job.hasJd && v.verdict === 'keep';
      const result: TriageResult = {
        verdict: noJd ? 'unsure' : v.verdict,
        reason: noJd ? `No description to check. ${v.reason}`.trim() : v.reason,
        ...(v.agency ? { agency: true } : {}),
        at,
        runId: ctx.run.id,
      };
      jobs.setTriage(id, result);
      counts[result.verdict]++;
      if (result.verdict === 'discard' && job.list === 'inbox')
        jobs.move(
          { ids: [id], to: 'archive', reason: 'triage', detail: result.reason || 'Not a fit' },
          'triage',
          ctx.run.id,
        );
      done.add(id);
    }
    ctx.saveCheckpoint([...done]);
    jobs.changed(chunk);
    ctx.progress(done.size, total, 'jobs');
  };

  /** Takes batches until none are left or one fails. */
  const worker = async () => {
    while (nextBatch < batches.length && !failure) {
      if (ctx.signal.aborted) throw new Error('Cancelled');
      const b = nextBatch++;
      try {
        await judge(b);
      } catch (e) {
        failure ??= e;
      }
    }
  };

  // The run's own slot does the first worker's batches; a second slot (ahead of scoring) runs another
  // batch alongside when one frees up. It goes back as soon as there is nothing left to start.
  const finished = new AbortController();
  const onAbort = () => finished.abort();
  ctx.signal.addEventListener('abort', onAbort, { once: true });
  const helper =
    batches.length > 1
      ? ctx.extraSlot(finished.signal).then(async (release) => {
          if (!release) return;
          try {
            await worker();
          } finally {
            release();
          }
        })
      : Promise.resolve();
  try {
    await worker();
  } finally {
    finished.abort();
    ctx.signal.removeEventListener('abort', onAbort);
    await helper.catch((e) => {
      failure ??= e;
    });
  }
  if (failure) throw failure;

  const parts = [`${counts.keep} kept`, `${counts.discard} archived`];
  if (counts.unsure) parts.push(`${counts.unsure} unsure`);
  return { summary: parts.join(' · '), result: { ...counts, total } };
}
