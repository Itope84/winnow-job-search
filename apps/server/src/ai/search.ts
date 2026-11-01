import { getSources } from '../library.ts';
import type { RunCtx, RunOutput } from '../runs/runner.ts';
import { Intake, type Offer } from '../scan/intake.ts';
import { finishScan } from '../scan/portals.ts';
import { resolveEntry } from '../scan/providers.ts';
import { clip } from '../util.ts';
import { runSkill } from './run-skill.ts';
import { candidateBrief } from './triage.ts';

function validate(value: unknown): Offer[] {
  const jobs = (value as { jobs?: unknown })?.jobs;
  if (!Array.isArray(jobs)) throw new Error('result.json needs a "jobs" list (it may be empty).');
  return (jobs as Record<string, unknown>[])
    .filter(
      (j) =>
        typeof j?.url === 'string' &&
        /^https?:\/\//.test(j.url as string) &&
        typeof j.title === 'string',
    )
    .map((j) => {
      const posted = typeof j.posted === 'string' ? Date.parse(j.posted) : Number.NaN;
      return {
        url: j.url as string,
        title: clip((j.title as string).trim(), 200),
        company: typeof j.company === 'string' ? j.company.trim() : '',
        location: typeof j.location === 'string' ? j.location.trim() : '',
        description: typeof j.description === 'string' ? j.description : undefined,
        postedAt: Number.isFinite(posted) ? posted : undefined,
      };
    });
}

/** AI search: the person's search queries and the career sites no scanner covers. Uses tokens. */
export async function aiSearch(ctx: RunCtx): Promise<RunOutput> {
  const sources = getSources(ctx.space.db);
  const queries = sources.queries.filter((q) => q.enabled);
  // Companies no scanner can read: the AI browses their careers pages instead.
  const unsupported = [];
  for (const c of sources.companies) {
    if (c.enabled === false || !c.careers_url) continue;
    if ('error' in (await resolveEntry(c))) unsupported.push(c);
  }
  const intake = new Intake(ctx.space.db, ctx.space.jobs, sources.rules, ctx.run.id);
  ctx.progress(0, queries.length, 'queries');
  const candidate = candidateBrief(ctx);
  const { value } = await runSkill(ctx, {
    skill: 'ai-search',
    files: candidate.files,
    input: {
      candidate: candidate.brief,
      queries,
      careerSites: unsupported.slice(0, 20).map((c) => ({ name: c.name, url: c.careers_url })),
      knownCount: ctx.space.jobs.counts(),
      maxJobs: 60,
      sinceDays: sources.rules.maxAgeDays ?? 21,
    },
    task: `Run the ${queries.length} search queries and list the open postings you find.`,
    model: ctx.settings.models.scan ?? ctx.settings.models.default,
    timeoutMs: 25 * 60_000,
    validate,
    web: true,
  });
  for (const offer of value) intake.add(offer, 'ai-search');
  return finishScan(ctx, intake, { reported: value.length });
}
