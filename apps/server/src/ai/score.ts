import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ScoreDimension, ScoreResult } from '@winnow/api';
import { verdictFor } from '@winnow/api';
import type { RunCtx, RunOutput } from '../runs/runner.ts';
import { captureJd } from '../scan/capture.ts';
import { clip, nowIso } from '../util.ts';
import { runSkill } from './run-skill.ts';

type Raw = Record<string, unknown>;

const strs = (v: unknown, max = 8) =>
  (Array.isArray(v) ? v : [])
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .slice(0, max)
    .map((s) => clip(s.trim(), 300));

function validate(value: unknown): Omit<ScoreResult, 'verdict' | 'at' | 'runId'> {
  const r = (value ?? {}) as Raw;
  const score = Number(r.score);
  if (!Number.isFinite(score) || score < 0 || score > 5)
    throw new Error('"score" must be a number from 1 to 5.');
  const dims: ScoreDimension[] = (Array.isArray(r.dimensions) ? r.dimensions : [])
    .filter((d): d is Raw => !!d && typeof d === 'object')
    .map((d) => ({
      key: String(d.key ?? d.label ?? '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_'),
      label: String(d.label ?? d.key ?? ''),
      score: Number.isFinite(Number(d.score)) ? Math.round(Number(d.score) * 10) / 10 : null,
      note: clip(String(d.note ?? ''), 300),
    }))
    .filter((d) => d.label);
  if (dims.length < 3) throw new Error('"dimensions" needs the five score dimensions.');
  const s = (k: string) =>
    typeof r[k] === 'string' && (r[k] as string).trim() ? clip((r[k] as string).trim(), 400) : null;
  return {
    score: Math.round(score * 10) / 10,
    summary: s('summary') ?? '',
    dimensions: dims,
    hardStops: strs(r.hardStops),
    gaps: strs(r.gaps),
    strengths: strs(r.strengths),
    nextStep: s('nextStep') ?? '',
    legitimacy: s('legitimacy'),
    archetype: s('archetype'),
    comp: s('comp'),
  };
}

/** Score one job against the CV and profile: 1–5, five dimensions, a verdict, and a full report. */
export async function score(ctx: RunCtx): Promise<RunOutput> {
  const id = ctx.run.jobIds[0];
  if (!id) throw new Error('No job to score.');
  const jobs = ctx.space.jobs;
  const job = jobs.require(id);
  ctx.progress(0, 7, 'steps');

  let jd = jobs.readJd(id);
  if (!jd) {
    ctx.step('Reading the posting');
    try {
      const got = await captureJd(job.url);
      if (got && got.text.length >= 120) {
        jobs.writeJd(id, got.text);
        jd = got.text;
      }
    } catch (e) {
      ctx.log('stderr', `Could not read the posting: ${(e as Error).message}`);
    }
  }

  const { value, folder } = await runSkill(ctx, {
    skill: 'score',
    input: {
      job: {
        id,
        url: job.url,
        company: job.company,
        role: job.role,
        location: job.location,
        salary: job.salary,
        posted: job.postedAt,
        sources: job.sources.map((s) => s.source),
        triage: job.triage,
      },
      description: jd ?? null,
      profileFiles: {
        cv: join(ctx.space.library, 'profile/cv.md'),
        narrative: join(ctx.space.library, 'profile/narrative.md'),
        profile: join(ctx.space.library, 'profile/profile.yml'),
      },
      weights: ctx.settings.weights,
      today: nowIso().slice(0, 10),
    },
    task: jd
      ? 'Score this job. The full description is in input.json.'
      : 'Score this job. No description was captured: open the posting URL to read it, and say so in the report if you cannot.',
    model: ctx.settings.models.score ?? ctx.settings.models.default,
    timeoutMs: 20 * 60_000,
    validate,
    web: true,
  });

  const reportFile = join(folder, 'report.md');
  const report = existsSync(reportFile) ? readFileSync(reportFile, 'utf8') : null;
  const at = nowIso();
  const result: ScoreResult = {
    ...value,
    verdict: verdictFor(value.score, ctx.settings.bands),
    at,
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
