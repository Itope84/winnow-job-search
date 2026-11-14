import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ScoreResult } from '@winnow/api';
import { verdictFor } from '@winnow/api';
import { runSkill } from '../ai/run-skill.ts';
import { readPosting, validate as validateScore } from '../ai/score.ts';
import type { RunCtx, RunOutput } from '../runs/runner.ts';
import { nowIso } from '../util.ts';
import { countryFacts } from './data.ts';
import { autoLink, cleanOpportunity } from './opportunity.ts';
import { studyBrief } from './triage.ts';

/**
 * Score one scholarship or programme: whether the person can apply, then how good it is for them. Six
 * dimensions, a report, and the page's facts read again in full (triage only saw the start of the page).
 */
export async function studyScore(ctx: RunCtx): Promise<RunOutput> {
  const id = ctx.run.jobIds[0];
  if (!id) throw new Error('Nothing to score.');
  const jobs = ctx.space.jobs;
  const job = jobs.require(id);
  ctx.progress(0, 7, 'steps');
  const page = await readPosting(ctx, id);
  const brief = studyBrief(ctx);
  const runFolder = join(ctx.space.library, 'runs', ctx.run.id);
  const kind = job.kind === 'programme' ? 'programme' : 'scholarship';
  const facts = (job.opportunity?.countries ?? [])
    .map((c) => countryFacts(c))
    .filter((c) => c !== null);
  const { value, folder } = await runSkill(ctx, {
    skill: 'scholarship-score',
    input: {
      item: {
        id,
        kind,
        title: job.role,
        org: job.company,
        location: job.location,
        url: job.url,
        known: job.opportunity,
        triage: job.triage,
        links: job.links.map((l) => ({ kind: l.kind, title: l.title, org: l.org, score: l.score })),
      },
      page: page ? join(runFolder, 'page.md') : null,
      candidate: brief.brief,
      countries: facts,
      weights: ctx.settings.weights,
    },
    files: { ...brief.files, ...(page ? { 'page.md': page } : {}) },
    task: page
      ? 'Score this item. The page text is in page.md in the run folder.'
      : 'Score this item. No page text was captured: open its URL to read it, and say so in the report if you cannot.',
    model: ctx.settings.models.score ?? ctx.settings.models.default,
    timeoutMs: 20 * 60_000,
    validate: (v) => ({
      score: validateScore(v),
      facts: (v as { facts?: unknown })?.facts
        ? cleanOpportunity((v as { facts?: unknown }).facts, kind)
        : null,
    }),
    web: true,
  });
  if (value.facts) {
    jobs.setOpportunity(id, value.facts, ctx.run.id);
    autoLink(jobs, id, ctx.run.id);
  }
  const reportFile = join(folder, 'report.md');
  const report = existsSync(reportFile) ? readFileSync(reportFile, 'utf8') : null;
  const result: ScoreResult = {
    ...value.score,
    verdict: verdictFor(value.score.score, ctx.settings.bands),
    at: nowIso(),
    runId: ctx.run.id,
  };
  jobs.setScore(id, result, report);
  const fresh = jobs.require(id);
  if (fresh.list === 'inbox' || fresh.list === 'shortlist')
    jobs.move({ ids: [id], to: 'scored' }, 'score', ctx.run.id);
  else jobs.changed([id]);
  return {
    summary: `${result.score.toFixed(1)} · ${result.summary || 'Scored'}`.slice(0, 160),
    result: { score: result.score, verdict: result.verdict },
  };
}
