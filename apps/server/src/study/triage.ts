import type { Opportunity, TriageResult, TriageVerdict } from '@winnow/api';
import { runSkill } from '../ai/run-skill.ts';
import { candidateBrief } from '../ai/triage.ts';
import type { RunCtx, RunOutput } from '../runs/runner.ts';
import { clip, nowIso, today } from '../util.ts';
import { getStudy, studyYaml } from './mode.ts';
import { autoLink, cleanOpportunity } from './opportunity.ts';

const CHUNK = 8;
const PAGE_CHARS = 6000;

/** What every scholarship skill knows about the person: the job brief plus study wants and own words. */
export function studyBrief(ctx: RunCtx) {
  const base = candidateBrief(ctx);
  const statement = ctx.space.profile.get().statement;
  return {
    brief: {
      ...base.brief,
      statement: statement.trim() ? 'statement.md' : null,
      study: studyYaml(getStudy(ctx.space.db)),
      today: today(),
    },
    files: {
      ...base.files,
      ...(statement.trim() ? { 'statement.md': clip(statement, 8000) } : {}),
    },
  };
}

interface StudyVerdict {
  id: string;
  verdict: TriageVerdict;
  reason: string;
  facts: Opportunity;
  title: string;
  org: string;
}

function validate(ids: Map<string, 'scholarship' | 'programme'>) {
  return (value: unknown): StudyVerdict[] => {
    const results = (value as { results?: unknown })?.results;
    if (!Array.isArray(results)) throw new Error('result.json needs a "results" list.');
    const out: StudyVerdict[] = [];
    for (const r of results as Record<string, unknown>[]) {
      const id = String(r?.id ?? '');
      const kind = ids.get(id);
      const verdict = String(r?.verdict ?? '').toLowerCase();
      if (!kind || !['keep', 'discard', 'unsure'].includes(verdict)) continue;
      out.push({
        id,
        verdict: verdict as TriageVerdict,
        reason: clip(String(r?.reason ?? '').trim(), 300),
        facts: cleanOpportunity(r?.facts, kind),
        title: clip(String(r?.title ?? '').trim(), 200),
        org: clip(String(r?.org ?? '').trim(), 160),
      });
    }
    if (!out.length) throw new Error('result.json had no verdicts for these items.');
    return out;
  };
}

/**
 * The verdict the server stands behind. The page saying the person can't apply is a discard, with what
 * rules them out as the reason; a passed deadline with no new round known is a discard too. Things they
 * can still fix (a language test) never are.
 */
export function studyHold(
  v: StudyVerdict,
  now = today(),
): { verdict: TriageVerdict; reason: string } {
  const e = v.facts.eligibility;
  if (e?.status === 'ineligible' && e.fails.length)
    return { verdict: 'discard', reason: `Not eligible: ${e.fails[0]}` };
  const d = v.facts.deadlines;
  const last = [d.scholarship, d.admission]
    .filter((x): x is string => !!x)
    .sort()
    .at(-1);
  if (last && last < now && v.facts.round !== 'upcoming' && v.verdict === 'keep')
    return {
      verdict: 'unsure',
      reason: `Deadline ${last} has passed; check for the next round. ${v.reason}`,
    };
  return { verdict: v.verdict, reason: v.reason };
}

/**
 * Triage for scholarships and programmes: Keep, Discard or Unsure, and the facts off each page (funding,
 * deadlines, eligibility, schools it names). Facts are saved even on a discard, so the reason can be
 * checked. Items that turn out to pair up are linked.
 */
export async function studyTriage(ctx: RunCtx): Promise<RunOutput> {
  const jobs = ctx.space.jobs;
  const done = new Set(ctx.checkpoint<string[]>() ?? []);
  const todo = ctx.run.jobIds.filter((id) => !done.has(id) && jobs.get(id));
  const counts = { keep: 0, discard: 0, unsure: 0 };
  let linked = 0;
  const brief = studyBrief(ctx);
  const total = ctx.run.jobIds.length;
  ctx.progress(done.size, total, 'items');
  for (let i = 0; i < todo.length; i += CHUNK) {
    if (ctx.signal.aborted) throw new Error('Cancelled');
    const chunk = todo.slice(i, i + CHUNK);
    const kinds = new Map<string, 'scholarship' | 'programme'>();
    const items = chunk.map((id) => {
      const job = jobs.require(id);
      kinds.set(id, job.kind === 'programme' ? 'programme' : 'scholarship');
      const page = jobs.readJd(id);
      return {
        id,
        kind: job.kind,
        title: job.role,
        org: job.company,
        location: job.location,
        url: job.url,
        source: job.sources[0]?.source ?? null,
        known: job.opportunity,
        page: page ? clip(page, PAGE_CHARS) : null,
      };
    });
    ctx.step(`Reading ${i + 1}–${i + chunk.length} of ${total}`);
    const { value } = await runSkill(ctx, {
      skill: 'scholarship-triage',
      folder: `${ctx.run.id}/batch-${i / CHUNK + 1}`,
      input: { candidate: brief.brief, items },
      files: brief.files,
      task: `Judge all ${items.length} items in input.json and read their facts.`,
      model: ctx.settings.models.triage ?? ctx.settings.models.default,
      timeoutMs: 10 * 60_000,
      validate: validate(kinds),
      web: false,
    });
    const at = nowIso();
    const byId = new Map(value.map((v) => [v.id, v]));
    for (const id of chunk) {
      const job = jobs.get(id);
      if (!job) continue;
      const v = byId.get(id);
      if (v) {
        jobs.setOpportunity(id, v.facts, ctx.run.id);
        // The page names the item better than a feed's headline or a page title did.
        if (v.title) jobs.rename(id, v.title, v.org || v.facts.university || job.company);
      }
      const held = v
        ? studyHold(v)
        : { verdict: 'unsure' as const, reason: 'Triage gave no answer for this item.' };
      const result: TriageResult = { ...held, at, runId: ctx.run.id };
      jobs.setTriage(id, result);
      counts[result.verdict]++;
      if (result.verdict === 'discard' && job.list === 'inbox')
        jobs.move(
          { ids: [id], to: 'archive', reason: 'triage', detail: result.reason || 'Not a fit' },
          'triage',
          ctx.run.id,
        );
      else if (v) linked += autoLink(jobs, id, ctx.run.id);
      done.add(id);
    }
    ctx.saveCheckpoint([...done]);
    jobs.changed(chunk);
    ctx.progress(done.size, total, 'items');
  }
  const parts = [`${counts.keep} kept`, `${counts.discard} archived`];
  if (counts.unsure) parts.push(`${counts.unsure} unsure`);
  if (linked) parts.push(`${linked} linked`);
  return { summary: parts.join(' · '), result: { ...counts, total, linked } };
}
