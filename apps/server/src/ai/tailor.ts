import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Application, DocCheck, Requirement } from '@winnow/api';
import { parse } from 'yaml';
import type { RunCtx, RunOutput } from '../runs/runner.ts';
import { clip, nowIso } from '../util.ts';
import { compileTex, type TexCheck } from './latex.ts';
import { runSkill } from './run-skill.ts';
import { readPosting } from './score.ts';

type Raw = Record<string, unknown>;
type Step = 'draft' | 'review' | 'revise';
interface Checks {
  cv: TexCheck;
  cover: TexCheck;
}
/** Where a tailor run got to, so a restart picks up after the last finished step. */
interface Checkpoint {
  done: Step | 'repair';
  draft?: Raw;
  review?: Raw | null;
  revise?: Raw;
}

const strs = (v: unknown, max = 12) =>
  (Array.isArray(v) ? v : [])
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .slice(0, max)
    .map((s) => clip(s.trim(), 400));

function requirements(v: unknown): Requirement[] {
  return (Array.isArray(v) ? v : [])
    .filter((r): r is Raw => !!r && typeof r === 'object' && typeof r.text === 'string')
    .slice(0, 30)
    .map((r) => ({
      text: clip(String(r.text), 200),
      need: r.need === 'nice' ? 'nice' : 'must',
      status: r.status === 'bridged' || r.status === 'gap' ? r.status : 'shown',
      where: clip(String(r.where ?? ''), 200),
    }));
}

/** A step's `result.json` must name its step; the files it wrote are checked by compiling them. */
const validateStep = (step: Step, folder: string) => (value: unknown) => {
  const r = (value ?? {}) as Raw;
  if (r.step !== step) throw new Error(`"step" must be "${step}".`);
  if (step !== 'review')
    for (const f of ['cv.tex', 'cover.tex'])
      if (!existsSync(join(folder, f))) throw new Error(`${f} is missing from the run folder.`);
  return r;
};

const docCheck = (c: TexCheck): DocCheck => ({
  ok: c.ok,
  error: c.error,
  pages: c.pages,
  problems: c.problems,
});

/** The candidate's email, which must survive into the CV's text layer. */
function candidateEmail(library: string): string | null {
  try {
    const y = parse(readFileSync(join(library, 'profile/profile.yml'), 'utf8')) as Raw;
    const email = (y?.candidate as Raw | undefined)?.email;
    return typeof email === 'string' && email.includes('@') ? email : null;
  } catch {
    return null;
  }
}

/**
 * Write a CV and cover letter for one job: draft, a cold review, a revision, each compiled with Tectonic
 * and checked. A revision that still doesn't compile gets one repair. The result lands in
 * `applications/<job id>/`.
 */
export async function tailor(ctx: RunCtx): Promise<RunOutput> {
  const id = ctx.run.jobIds[0];
  if (!id) throw new Error('No job to write for.');
  const jobs = ctx.space.jobs;
  const library = ctx.space.library;
  const job = jobs.require(id);
  const skillDir = join(library, '_skills/tailor');
  const runFolder = `tailor-${ctx.run.id}`;
  const folder = join(library, 'runs', runFolder);
  const email = candidateEmail(library);

  const description = await readPosting(ctx, id);
  if (!description)
    throw new Error('Winnow couldn’t read the posting. Paste its text, then try again.');
  const reportFile = join(jobs.reportDir, `${id}.md`);
  const base = {
    job: {
      company: job.company,
      role: job.role,
      location: job.location,
      url: job.url,
      deadline: job.posting?.deadline ?? null,
      warnings: job.posting?.warnings ?? [],
    },
    // In its own file: OpenCode's read tool cuts long lines, and a JSON string is one line.
    description: join(folder, 'posting.md'),
    profileFiles: {
      cv: join(library, 'profile/cv.md'),
      narrative: join(library, 'profile/narrative.md'),
      profile: join(library, 'profile/profile.yml'),
    },
    score: job.score
      ? { summary: job.score.summary, strengths: job.score.strengths, gaps: job.score.gaps }
      : null,
    report: existsSync(reportFile) ? reportFile : null,
    references: {
      cv: join(skillDir, 'cv-reference.tex'),
      cover: join(skillDir, 'cover-reference.tex'),
    },
    today: nowIso().slice(0, 10),
  };
  const model = ctx.settings.models.score ?? ctx.settings.models.default;

  const step = async (name: Step, extra: object, task: string) => {
    ctx.step(name === 'draft' ? 'Drafting' : name === 'review' ? 'Reviewing' : 'Revising');
    const { value } = await runSkill(ctx, {
      skill: 'tailor',
      folder: runFolder,
      input: { step: name, ...base, ...extra },
      files: { 'posting.md': description },
      task,
      model,
      timeoutMs: 20 * 60_000,
      validate: validateStep(name, folder),
      web: name === 'review',
    });
    writeFileSync(join(folder, `${name}.json`), JSON.stringify(value, null, 2));
    return value;
  };

  const check = async (): Promise<Checks> => {
    ctx.step('Compiling and checking');
    // The letter's class and fonts sit next to it, as the reference expects.
    cpSync(join(skillDir, 'cover.cls'), join(folder, 'cover.cls'));
    cpSync(join(skillDir, 'OpenFonts'), join(folder, 'OpenFonts'), { recursive: true });
    const out = {
      cv: await compileTex(folder, 'cv.tex', {
        mustContain: email ? [email] : [],
        signal: ctx.signal,
      }),
      cover: await compileTex(folder, 'cover.tex', { signal: ctx.signal }),
    };
    for (const c of [out.cv, out.cover])
      ctx.log(
        c.ok ? 'info' : 'stderr',
        `${c.file}: ${c.ok ? `${c.pages} page${c.pages === 1 ? '' : 's'}` : `failed: ${c.error}`}${c.problems.length ? ` · ${c.problems.join(' ')}` : ''}`,
      );
    return out;
  };

  mkdirSync(folder, { recursive: true });
  let cp = ctx.checkpoint<Checkpoint>();
  const save = (next: Checkpoint) => {
    cp = next;
    ctx.saveCheckpoint(next);
  };

  if (!cp)
    save({
      done: 'draft',
      draft: await step('draft', {}, 'Draft the CV and cover letter for this job.'),
    });
  let checks = await check();
  if (cp?.done === 'draft') {
    const review = await step('review', { check: checks }, 'Review this application.');
    save({ ...cp, done: 'review', review });
    checks = await check();
  }
  if (cp?.done === 'review') {
    const revise = await step(
      'revise',
      { check: checks, review: cp.review },
      'Revise the application using the review and the compile check.',
    );
    save({ ...cp, done: 'revise', revise });
    checks = await check();
  }
  const needsRepair = (c: Checks) =>
    !c.cv.ok || !c.cover.ok || c.cv.problems.length > 0 || c.cover.problems.length > 0;
  if (cp?.done === 'revise' && needsRepair(checks)) {
    // A repair that breaks the build gives way to the version before it.
    for (const f of ['cv.tex', 'cover.tex']) cpSync(join(folder, f), join(folder, `${f}.before`));
    const revise = await step(
      'revise',
      { check: checks, review: null },
      'Fix the compile errors and problems in `check`, and change nothing else.',
    );
    save({ ...cp, done: 'repair', revise });
    const repaired = await check();
    if (repaired.cv.ok && repaired.cover.ok) checks = repaired;
    else {
      for (const f of ['cv.tex', 'cover.tex']) cpSync(join(folder, `${f}.before`), join(folder, f));
      checks = await check();
    }
  }
  if (!checks.cv.ok) throw new Error(`The CV still doesn’t compile: ${checks.cv.error}`);
  if (!checks.cover.ok)
    throw new Error(`The cover letter still doesn’t compile: ${checks.cover.error}`);

  const final = cp?.revise ?? cp?.draft ?? {};
  const target = join(jobs.applicationDir, id);
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  for (const f of ['cv.tex', 'cv.pdf', 'cover.tex', 'cover.pdf'])
    cpSync(join(folder, f), join(target, f));
  const application: Application = {
    summary: clip(String(final.summary ?? cp?.draft?.notes ?? ''), 600),
    requirements: requirements(final.requirements ?? cp?.draft?.requirements),
    stretches: strs(final.stretches ?? cp?.draft?.stretches),
    verdict:
      typeof cp?.review?.verdict === 'string' ? clip(cp.review.verdict as string, 600) : null,
    cv: docCheck(checks.cv),
    cover: docCheck(checks.cover),
    at: nowIso(),
    runId: ctx.run.id,
  };
  jobs.setApplication(id, application);
  return {
    summary: `CV ${checks.cv.pages} page${checks.cv.pages === 1 ? '' : 's'}, letter ${checks.cover.pages} page${checks.cover.pages === 1 ? '' : 's'}`,
  };
}
