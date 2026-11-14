import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FundingLevel, FundingShape, OppRelation } from '@winnow/api';
import { FUNDING_LEVELS, FUNDING_SHAPES } from '@winnow/api';
import { runSkill } from '../ai/run-skill.ts';
import { readPosting } from '../ai/score.ts';
import { getSources } from '../library.ts';
import type { RunCtx, RunOutput } from '../runs/runner.ts';
import { Intake } from '../scan/intake.ts';
import { clip, nowIso, writeFileAtomic } from '../util.ts';
import { recordCoverage } from './coverage.ts';
import { isoDate, seedOpportunity } from './opportunity.ts';
import { studyBrief } from './triage.ts';

type Raw = Record<string, unknown>;
const s = (v: unknown, max = 300) => (typeof v === 'string' ? clip(v.trim(), max) : '');
const url = (v: unknown) => {
  const u = s(v, 600);
  return /^https?:\/\//.test(u) ? u : '';
};

/** Queue triage for items a run just added, so their facts get read. */
function triageNew(ctx: RunCtx, ids: string[]): string | null {
  const fresh = ids.filter((id) => ctx.space.jobs.get(id)?.list === 'inbox');
  if (!fresh.length) return null;
  try {
    return ctx.enqueue({ kind: 'triage', jobIds: fresh })[0]?.id ?? null;
  } catch (e) {
    ctx.log('stderr', `Could not queue triage: ${(e as Error).message}`);
    return null;
  }
}

/**
 * Find programmes a scholarship would pay for: at the schools it names, or in its country. Each one goes
 * through intake as a programme, linked under the scholarship, then triage reads it.
 */
export async function matchProgrammes(ctx: RunCtx): Promise<RunOutput> {
  const id = ctx.run.jobIds[0];
  if (!id) throw new Error('No scholarship to match.');
  const jobs = ctx.space.jobs;
  const sch = jobs.require(id);
  if (sch.kind !== 'scholarship') throw new Error('Find programmes works on scholarships.');
  const page = await readPosting(ctx, id);
  const brief = studyBrief(ctx);
  const known = sch.links.map((l) => `${l.title} · ${l.org}`);
  const { value } = await runSkill(ctx, {
    skill: 'programme-match',
    input: {
      scholarship: {
        title: sch.role,
        provider: sch.company,
        url: sch.url,
        facts: sch.opportunity,
      },
      page: page ? 'page.md' : null,
      candidate: brief.brief,
      known,
      max: 8,
    },
    files: { ...brief.files, ...(page ? { 'page.md': page } : {}) },
    task: `Find up to 8 programmes this scholarship would pay for that fit the candidate. Skip the ${known.length} already known.`,
    model: ctx.settings.models.scan ?? ctx.settings.models.default,
    timeoutMs: 20 * 60_000,
    validate: (v) => {
      const list = (v as { programmes?: unknown })?.programmes;
      if (!Array.isArray(list))
        throw new Error('result.json needs a "programmes" list (it may be empty).');
      return {
        programmes: (list as Raw[]).filter((p) => url(p?.url) && s(p?.title)),
        note: s((v as Raw)?.note, 300),
      };
    },
    web: true,
  });
  const intake = new Intake(ctx.space.db, jobs, getSources(ctx.space.db).rules, ctx.run.id);
  const shape = sch.opportunity?.shape;
  const relation: OppRelation =
    shape === 'built_in' ? 'built_in' : shape === 'country' ? 'eligible' : 'covers';
  let linked = 0;
  for (const p of value.programmes) {
    const country = s(p.country, 60);
    const university = s(p.university, 160);
    const got = intake.add(
      {
        url: url(p.url),
        title: s(p.title, 200),
        company: university,
        location: country,
        description: s(p.why, 600),
        kind: 'programme',
        opportunity: seedOpportunity('programme', {
          university: university || null,
          countries: country ? [country] : [],
          subject: s(p.subject, 200),
          tuition: s(p.tuition, 200) || null,
          deadlines: { scholarship: null, admission: isoDate(p.admissionDeadline) },
          level: 'Master’s',
        }),
      },
      'programme-match',
    );
    if (got) {
      jobs.link(id, got, relation, ctx.run.id);
      linked++;
    }
  }
  recordCoverage(ctx.space.db, 'scheme', sch.role, {
    found: value.programmes.length,
    added: intake.stats.added.length,
    note: value.note || `${linked} programmes linked`,
  });
  jobs.changed();
  const triageRun = triageNew(ctx, intake.stats.added);
  return {
    summary: `${linked} programme${linked === 1 ? '' : 's'} · ${intake.stats.added.length} new`,
    result: { linked, added: intake.stats.added.length, triageRun },
  };
}

/** Find scholarships that could pay for a programme: the university's own, national and others. */
export async function findFunding(ctx: RunCtx): Promise<RunOutput> {
  const id = ctx.run.jobIds[0];
  if (!id) throw new Error('No programme to fund.');
  const jobs = ctx.space.jobs;
  const prog = jobs.require(id);
  if (prog.kind !== 'programme') throw new Error('Find funding works on programmes.');
  const page = await readPosting(ctx, id);
  const brief = studyBrief(ctx);
  const known = prog.links.map((l) => `${l.title} · ${l.org}`);
  const { value } = await runSkill(ctx, {
    skill: 'funding-find',
    input: {
      programme: {
        title: prog.role,
        university: prog.company,
        url: prog.url,
        facts: prog.opportunity,
      },
      page: page ? 'page.md' : null,
      candidate: brief.brief,
      known,
      max: 8,
    },
    files: { ...brief.files, ...(page ? { 'page.md': page } : {}) },
    task: `Find up to 8 scholarships the candidate could use for this programme. Skip the ${known.length} already known.`,
    model: ctx.settings.models.scan ?? ctx.settings.models.default,
    timeoutMs: 20 * 60_000,
    validate: (v) => {
      const list = (v as { scholarships?: unknown })?.scholarships;
      if (!Array.isArray(list))
        throw new Error('result.json needs a "scholarships" list (it may be empty).');
      return {
        scholarships: (list as Raw[]).filter((x) => url(x?.url) && s(x?.title)),
        tuitionFree: (v as Raw)?.tuitionFree === true,
        note: s((v as Raw)?.note, 300),
      };
    },
    web: true,
  });
  const intake = new Intake(ctx.space.db, jobs, getSources(ctx.space.db).rules, ctx.run.id);
  let linked = 0;
  for (const x of value.scholarships) {
    const shape = (FUNDING_SHAPES as readonly string[]).includes(String(x.shape))
      ? (x.shape as FundingShape)
      : null;
    const funding = (FUNDING_LEVELS as readonly string[]).includes(String(x.funding))
      ? (x.funding as FundingLevel)
      : 'unknown';
    const got = intake.add(
      {
        url: url(x.url),
        title: s(x.title, 200),
        company: s(x.provider, 160),
        location: prog.location,
        description: s(x.why, 600),
        kind: 'scholarship',
        opportunity: seedOpportunity('scholarship', {
          shape,
          funding,
          covers: s(x.covers, 400),
          countries: prog.opportunity?.countries ?? [],
          university: shape === 'one_school' ? prog.company : null,
          deadlines: { scholarship: isoDate(x.deadline), admission: null },
        }),
      },
      'funding-find',
    );
    if (got) {
      jobs.link(
        got,
        id,
        shape === 'one_school' || shape === 'built_in' ? 'covers' : 'eligible',
        ctx.run.id,
      );
      linked++;
    }
  }
  if (value.tuitionFree && prog.opportunity && prog.opportunity.funding === 'unknown')
    jobs.setOpportunity(id, { ...prog.opportunity, funding: 'tuition_free' }, ctx.run.id);
  jobs.changed();
  const triageRun = triageNew(ctx, intake.stats.added);
  return {
    summary: `${linked} way${linked === 1 ? '' : 's'} to pay · ${intake.stats.added.length} new${value.tuitionFree ? ' · tuition-free' : ''}`,
    result: { linked, added: intake.stats.added.length, triageRun },
  };
}

/** Draft the essays a scholarship or programme asks for, in the person's own voice. */
export async function draftEssays(ctx: RunCtx): Promise<RunOutput> {
  const id = ctx.run.jobIds[0];
  if (!id) throw new Error('Nothing to write for.');
  const jobs = ctx.space.jobs;
  const item = jobs.require(id);
  const page = await readPosting(ctx, id);
  const brief = studyBrief(ctx);
  const reportFile = join(jobs.reportDir, `${id}.md`);
  const { value, folder } = await runSkill(ctx, {
    skill: 'scholarship-essays',
    input: {
      item: {
        kind: item.kind,
        title: item.role,
        org: item.company,
        url: item.url,
        facts: item.opportunity,
        score: item.score
          ? { summary: item.score.summary, strengths: item.score.strengths, gaps: item.score.gaps }
          : null,
      },
      page: page ? 'page.md' : null,
      report: existsSync(reportFile) ? reportFile : null,
      candidate: brief.brief,
    },
    files: { ...brief.files, ...(page ? { 'page.md': page } : {}) },
    task: 'Draft the essays this application asks for. Write essays.md and result.json.',
    model: ctx.settings.models.score ?? ctx.settings.models.default,
    timeoutMs: 15 * 60_000,
    validate: (v) => {
      const list = (v as { essays?: unknown })?.essays;
      if (!Array.isArray(list) || !list.length)
        throw new Error('result.json needs an "essays" list.');
      return list.length;
    },
    web: false,
  });
  const file = join(folder, 'essays.md');
  if (!existsSync(file)) throw new Error('The essays were not written to essays.md.');
  const dir = join(jobs.applicationDir, id);
  mkdirSync(dir, { recursive: true });
  writeFileAtomic(join(dir, 'essays.md'), readFileSync(file, 'utf8'));
  jobs.log(id, 'essays', `Drafted ${value} essay${value === 1 ? '' : 's'}`, ctx.run.id, nowIso());
  jobs.changed([id]);
  return { summary: `${value} essay${value === 1 ? '' : 's'} drafted` };
}
