import type {
  SearchQuery,
  SetupDraft,
  SetupPrefill,
  SetupQuestionKey,
  SetupSuggestions,
  SourceEntry,
} from '@winnow/api';
import { questionsFor } from '@winnow/api';
import type { RunCtx, RunOutput } from '../runs/runner.ts';
import { pageAnswers, probeEntry, resolveEntry } from '../scan/providers.ts';
import { cleanAbout, cleanRoles, cleanWorkTypes, getSetup, saveSetup } from '../setup.ts';
import { getMode } from '../study/mode.ts';
import { studySourcesSuggest } from '../study/suggest.ts';
import { clip } from '../util.ts';
import { runSkill } from './run-skill.ts';

/** Job-board providers setup may suggest: the ones that search by keyword or read a whole feed. */
export const SUGGESTABLE_BOARDS = [
  'adzuna',
  'careerjet',
  'linkedin',
  'freehire',
  'remotive',
  'remoteok',
  'himalayas',
  'weworkremotely',
  'jobicy',
  'workingnomads',
  'themuse',
  'arbeitnow',
  '4dayweek',
  'nhs-jobs',
  'jobs-ac-uk',
];

const s = (v: unknown, max = 200) => (typeof v === 'string' ? clip(v.trim(), max) : '');
const list = (v: unknown, max: number, len = 200) =>
  Array.isArray(v) ? [...new Set(v.map((x) => s(x, len)).filter(Boolean))].slice(0, max) : [];

function needCv(ctx: RunCtx) {
  const cv = ctx.space.profile.get().cv;
  if (cv.trim().length < 200) throw new Error('Add your CV first: setup reads it.');
  return cv;
}

/** Pre-fill: the forms' facts read off the CV. Runs by itself when Read CV finishes during setup. */
export async function profilePrefill(ctx: RunCtx): Promise<RunOutput> {
  const cv = needCv(ctx);
  ctx.step('Reading your CV for the forms');
  const mode = getMode(ctx.space.db);
  const statement = ctx.space.profile.get().statement;
  const { value } = await runSkill(ctx, {
    skill: 'profile-prefill',
    input: {
      mode,
      cvFile: 'cv.md',
      statementFile: mode === 'scholarships' && statement.trim() ? 'statement.md' : null,
    },
    files: {
      'cv.md': cv.slice(0, 40_000),
      ...(mode === 'scholarships' && statement.trim()
        ? { 'statement.md': statement.slice(0, 20_000) }
        : {}),
    },
    task: 'Suggest the setup form answers from the CV in input.json.',
    model: ctx.settings.models.default,
    timeoutMs: 4 * 60_000,
    validate: (v): SetupPrefill => {
      const o = (v ?? {}) as Record<string, unknown>;
      if (!o.about || !Array.isArray(o.roles))
        throw new Error('result.json needs "about" and "roles".');
      const about = cleanAbout(o.about);
      delete about.workRight;
      delete about.timezone;
      if (mode !== 'scholarships') delete about.nationality;
      return {
        about,
        roles: cleanRoles(o.roles).slice(0, 6),
        level: s(o.level, 100),
        places: list(o.places, 6, 100),
        workTypes: cleanWorkTypes(o.workTypes),
        currency: s(o.currency, 3).toUpperCase(),
      };
    },
    web: false,
  });
  saveSetup(ctx.space, { prefill: value });
  return {
    summary: `Suggested ${value.roles.length} role${value.roles.length === 1 ? '' : 's'} and your details`,
  };
}

/** One follow-up on a vague "get to know you" answer, or none. */
export async function setupFollowup(ctx: RunCtx): Promise<RunOutput> {
  const params = ctx.runs.params(ctx.run.id);
  const key = String(params.question ?? '') as SetupQuestionKey;
  const asked = String(params.answer ?? '');
  const mode = getMode(ctx.space.db);
  const question = questionsFor(mode).find((q) => q.key === key);
  if (!question || !asked.trim()) throw new Error('There is no answer to follow up on.');
  ctx.step('Reading your answer');
  const { value } = await runSkill(ctx, {
    skill: 'setup-followup',
    input: { mode, question: question.text, answer: asked, cvFile: 'cv.md' },
    files: { 'cv.md': needCv(ctx).slice(0, 6000) },
    task: 'Decide whether this answer needs one follow-up question.',
    model: ctx.settings.models.default,
    timeoutMs: 3 * 60_000,
    validate: (v) => {
      const f = (v as { followUp?: unknown })?.followUp;
      if (f !== null && typeof f !== 'string')
        throw new Error('result.json needs "followUp": a question or null.');
      return typeof f === 'string' && f.trim() ? clip(f.trim(), 300) : null;
    },
    web: false,
  });
  // The person may have rewritten the answer meanwhile; a follow-up on the old one is dropped.
  const state = getSetup(ctx.space);
  const answers = state.answers.map((a) =>
    a.key === key && a.answer === asked && a.followUpRun === ctx.run.id
      ? { ...a, followUp: value }
      : a,
  );
  saveSetup(ctx.space, { answers });
  return { summary: value ? `Asked: ${value}` : 'No follow-up needed' };
}

/** Draft profile: headline, story, proof and the narrative, from the CV and every answer. */
export async function profileDraft(ctx: RunCtx): Promise<RunOutput> {
  const cv = needCv(ctx);
  const state = getSetup(ctx.space);
  const roles = state.want.roles ?? [];
  const mode = getMode(ctx.space.db);
  if (!roles.length)
    throw new Error(
      mode === 'scholarships'
        ? 'Add at least one programme or subject first.'
        : 'Add at least one target role first.',
    );
  ctx.step('Writing your profile');
  const statement = ctx.space.profile.get().statement;
  const { value } = await runSkill(ctx, {
    skill: 'profile-draft',
    input: {
      mode,
      cvFile: 'cv.md',
      statementFile: statement.trim() ? 'statement.md' : null,
      about: state.about,
      want: state.want,
      answers: questionsFor(mode).map((q) => {
        const a = state.answers.find((x) => x.key === q.key);
        return {
          question: q.text,
          answer: a?.answer ?? '',
          followUp: a?.followUp ?? null,
          followUpAnswer: a?.followUpAnswer ?? '',
        };
      }),
    },
    files: {
      'cv.md': cv.slice(0, 40_000),
      ...(statement.trim() ? { 'statement.md': statement.slice(0, 20_000) } : {}),
    },
    task: 'Draft this person’s profile from input.json.',
    model: ctx.settings.models.default,
    timeoutMs: 6 * 60_000,
    validate: (v): SetupDraft => {
      const o = (v ?? {}) as Record<string, unknown>;
      const narrative = typeof o.narrative === 'string' ? o.narrative.trim() : '';
      if (narrative.length < 200) throw new Error('result.json needs the "narrative" Markdown.');
      if (!s(o.headline)) throw new Error('result.json needs a "headline".');
      const notes = (o.roleNotes ?? {}) as Record<string, unknown>;
      return {
        headline: s(o.headline, 300),
        story: s(o.story, 3000),
        superpowers: list(o.superpowers, 8, 300),
        proofPoints: Array.isArray(o.proofPoints)
          ? (o.proofPoints as Record<string, unknown>[])
              .map((p) => ({ name: s(p?.name), metric: s(p?.metric, 300) }))
              .filter((p) => p.name || p.metric)
              .slice(0, 10)
          : [],
        roleNotes: Object.fromEntries(
          roles.map((r) => [r.title, s(notes[r.title], 300)]).filter(([, n]) => n),
        ),
        narrative: narrative.slice(0, 30_000),
      };
    },
    web: false,
  });
  saveSetup(ctx.space, { draft: value });
  return { summary: 'Profile drafted' };
}

/** Run `fn` over `items`, `limit` at a time. */
async function eachLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await fn(items[next++] as T);
    }),
  );
}

/** Suggest sources: employers, board searches, web queries and title words for this person. */
export async function sourcesSuggest(ctx: RunCtx): Promise<RunOutput> {
  if (getMode(ctx.space.db) === 'scholarships') return studySourcesSuggest(ctx);
  const cv = needCv(ctx);
  const state = getSetup(ctx.space);
  const w = state.want;
  if (!(w.roles ?? []).length) throw new Error('Add at least one target role first.');
  ctx.progress(0, 5, 'steps');
  const { value } = await runSkill(ctx, {
    skill: 'sources-suggest',
    input: {
      roles: w.roles,
      level: w.level ?? '',
      workTypes: w.workTypes ?? [],
      places: w.places ?? [],
      currency: w.currency ?? '',
      dealBreakers: w.dealBreakers ?? [],
      cvFile: 'cv.md',
      boardsAvailable: SUGGESTABLE_BOARDS,
    },
    files: { 'cv.md': cv.slice(0, 6000) },
    task: 'Suggest starting sources for this person.',
    model: ctx.settings.models.scan ?? ctx.settings.models.default,
    timeoutMs: 15 * 60_000,
    validate: (v) => {
      const o = (v ?? {}) as Record<string, unknown>;
      if (!Array.isArray(o.companies) || !Array.isArray(o.boards) || !Array.isArray(o.queries))
        throw new Error('result.json needs "companies", "boards" and "queries" lists.');
      return o;
    },
    web: true,
  });

  const seen = new Set<string>();
  const unique = <T extends { name: string }>(x: T) => {
    const k = x.name.toLowerCase();
    if (!x.name || seen.has(k)) return false;
    seen.add(k);
    return true;
  };
  const raw = (value.companies as Record<string, unknown>[])
    .map((c) => ({
      name: s(c?.name, 120),
      // Greenhouse's old host only resolves with an API link; the new one resolves on its own.
      careers_url: s(c?.careers_url, 500).replace(
        '://boards.greenhouse.io/',
        '://job-boards.greenhouse.io/',
      ),
      notes: s(c?.notes, 300),
    }))
    .filter((c) => /^https?:\/\//.test(c.careers_url))
    .filter(unique)
    .slice(0, 30);
  // Employers a scanner reads must have jobs that load (a wrong slug is dropped). The rest are kept for
  // AI search if their careers page answers. Replay (tests, demo) stays offline and checks patterns only.
  ctx.progress(4, 5, 'steps');
  ctx.step(`Checking ${raw.length} careers pages`);
  const offline = ctx.adapter.id === 'replay';
  const companies: SourceEntry[] = [];
  const careerSites: SourceEntry[] = [];
  const dropped: string[] = [];
  await eachLimit(raw, 5, async (c) => {
    const scanned = !('error' in (await resolveEntry(c)));
    const alive = offline
      ? true
      : scanned
        ? !(await probeEntry(c).catch((e: Error) => e.message))
        : await pageAnswers(c.careers_url);
    if (!alive) dropped.push(c.name);
    else (scanned ? companies : careerSites).push({ ...c, enabled: true });
  });
  const order = (a: SourceEntry, b: SourceEntry) =>
    raw.findIndex((r) => r.name === a.name) - raw.findIndex((r) => r.name === b.name);
  companies.sort(order);
  careerSites.sort(order);

  const boards: SourceEntry[] = (value.boards as Record<string, unknown>[])
    .filter((b) => b && typeof b === 'object' && SUGGESTABLE_BOARDS.includes(String(b.provider)))
    .map((b) => {
      const entry: SourceEntry = {
        ...(b as SourceEntry),
        name: s(b.name, 120) || String(b.provider),
        enabled: true,
      };
      delete entry.api;
      delete entry.careers_url;
      return entry;
    })
    .filter(unique)
    .slice(0, 8);
  const queries: SearchQuery[] = (value.queries as Record<string, unknown>[])
    .map((q) => ({ name: s(q?.name, 120), query: s(q?.query, 400), enabled: true }))
    .filter((q) => q.query)
    .map((q) => ({ ...q, name: q.name || q.query }))
    .filter(unique)
    .slice(0, 10);
  const t = (value.titles ?? {}) as Record<string, unknown>;
  const suggestions: SetupSuggestions = {
    companies,
    careerSites,
    boards,
    queries,
    titles: { positive: list(t.positive, 40, 80), negative: list(t.negative, 30, 80) },
    dropped,
  };
  saveSetup(ctx.space, { suggestions });
  ctx.progress(5, 5, 'steps');
  return {
    summary: `${companies.length + careerSites.length} employers, ${boards.length} board searches, ${queries.length} queries${dropped.length ? ` · ${dropped.length} dead links dropped` : ''}`,
  };
}
