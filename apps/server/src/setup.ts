import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type {
  Rules,
  SetupAbout,
  SetupAnswer,
  SetupDraft,
  SetupFinishRequest,
  SetupRole,
  SetupState,
  SetupStatus,
  SetupStep,
  SetupWant,
  Sources,
  WorkType,
} from '@winnow/api';
import { ROLE_FIT_LABELS, SETUP_QUESTIONS, SETUP_STEPS, WORK_TYPE_LABELS } from '@winnow/api';
import { stringify } from 'yaml';
import { kvGet, kvSet } from './db.ts';
import { getSources, libraryPaths, setSources } from './library.ts';
import type { Space } from './space.ts';
import { badRequest, clip, nowIso } from './util.ts';

const KEY = 'setup';

const fresh = (status: SetupStatus): SetupState => ({
  status,
  step: 'start',
  about: {},
  want: {},
  answers: [],
  prefill: null,
  draft: null,
  suggestions: null,
  runs: { cv: null, prefill: null, draft: null, sources: null },
  redo: false,
  doneAt: null,
});

/**
 * Setup's state, kept in the person's own database so it survives restarts and follows them across
 * devices. Someone who never started setup counts as done when they already have a CV and a profile
 * (an imported account), and as needed otherwise.
 */
export function getSetup(space: Space): SetupState {
  const stored = kvGet<SetupState | null>(space.db, KEY, null);
  if (stored)
    return {
      ...fresh(stored.status),
      ...stored,
      runs: { ...fresh('needed').runs, ...stored.runs },
    };
  const ready = space.profile.ready();
  return fresh(ready.cv && ready.profile ? 'done' : 'needed');
}

export function saveSetup(space: Space, patch: Partial<SetupState>): SetupState {
  const next = { ...getSetup(space), ...patch };
  kvSet(space.db, KEY, next);
  space.events.emit('setup.changed', { status: next.status, step: next.step });
  return next;
}

export const setupActive = (space: Space) => getSetup(space).status !== 'done';

const str = (v: unknown, max = 200) => (typeof v === 'string' ? clip(v.trim(), max) : '');
const strs = (v: unknown, max = 40, len = 200) =>
  Array.isArray(v) ? [...new Set(v.map((x) => str(x, len)).filter(Boolean))].slice(0, max) : [];

const ABOUT_KEYS: (keyof SetupAbout)[] = [
  'name',
  'phone',
  'city',
  'country',
  'timezone',
  'linkedin',
  'portfolio',
  'workRight',
];

export function cleanAbout(v: unknown): Partial<SetupAbout> {
  const o = (v ?? {}) as Record<string, unknown>;
  const out: Partial<SetupAbout> = {};
  for (const k of ABOUT_KEYS) if (typeof o[k] === 'string') out[k] = str(o[k]);
  return out;
}

export function cleanRoles(v: unknown): SetupRole[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: SetupRole[] = [];
  for (const r of v as Record<string, unknown>[]) {
    const title = str(r?.title, 120);
    if (!title || seen.has(title.toLowerCase())) continue;
    seen.add(title.toLowerCase());
    out.push({ title, fit: r.fit === 'dream' || r.fit === 'stretch' ? r.fit : 'good' });
  }
  return out.slice(0, 12);
}

export function cleanWorkTypes(v: unknown): WorkType[] {
  return strs(v, 3).filter((w): w is WorkType => w in WORK_TYPE_LABELS);
}

export function cleanWant(v: unknown): Partial<SetupWant> {
  const o = (v ?? {}) as Record<string, unknown>;
  const out: Partial<SetupWant> = {};
  if ('roles' in o) out.roles = cleanRoles(o.roles);
  if ('workTypes' in o) out.workTypes = cleanWorkTypes(o.workTypes);
  if ('places' in o) out.places = strs(o.places, 20, 100);
  if ('dealBreakers' in o) out.dealBreakers = strs(o.dealBreakers, 20, 200);
  for (const k of ['level', 'currency', 'salaryTarget', 'salaryMin'] as const)
    if (typeof o[k] === 'string') out[k] = str(o[k], 100);
  return out;
}

/** Answers from the app. Follow-up questions and their runs belong to the server and are kept. */
export function mergeAnswers(old: SetupAnswer[], v: unknown): SetupAnswer[] {
  if (!Array.isArray(v)) return old;
  return SETUP_QUESTIONS.flatMap((q): SetupAnswer[] => {
    const prev = old.find((a) => a.key === q.key);
    const got = (v as Record<string, unknown>[]).find((a) => a?.key === q.key);
    if (!got) return prev ? [prev] : [];
    const answer = str(got.answer, 4000);
    // A changed answer drops the follow-up asked about the old one.
    const same = !!prev && prev.answer === answer;
    return [
      {
        key: q.key,
        answer,
        followUp: same ? prev.followUp : null,
        followUpAnswer: same ? str(got.followUpAnswer, 4000) : '',
        followUpRun: same ? prev.followUpRun : null,
      },
    ];
  });
}

export function updateSetup(space: Space, body: Record<string, unknown>): SetupState {
  const cur = getSetup(space);
  if (cur.status === 'done') throw badRequest('Setup is finished. Use You › Set up again.');
  const patch: Partial<SetupState> = { status: 'in_progress' };
  if (typeof body.step === 'string' && (SETUP_STEPS as readonly string[]).includes(body.step))
    patch.step = body.step as SetupStep;
  if (body.about) patch.about = { ...cur.about, ...cleanAbout(body.about) };
  if (body.want) patch.want = { ...cur.want, ...cleanWant(body.want) };
  if (body.answers) patch.answers = mergeAnswers(cur.answers, body.answers);
  // Edits made on Review, kept so a reload doesn't lose them.
  if (body.draft) patch.draft = cleanDraft(body.draft);
  return saveSetup(space, patch);
}

/** Start setup, or reopen it from You pre-filled with today's profile. */
export function startSetup(space: Space, redo: boolean): SetupState {
  const cur = getSetup(space);
  if (cur.status !== 'done' && !redo) return saveSetup(space, { status: 'in_progress' });
  if (!redo) return cur;
  // Already setting up again: carry on rather than start over.
  if (cur.redo && cur.status === 'in_progress') return cur;
  const now = fromProfile(space.profile.parsed());
  return saveSetup(space, {
    ...fresh('in_progress'),
    about: now.about,
    want: now.want,
    redo: true,
    step: 'start',
  });
}

/** Today's profile.yml read back into the setup forms, for Set up again. */
export function fromProfile(p: Record<string, unknown>): {
  about: Partial<SetupAbout>;
  want: Partial<SetupWant>;
} {
  const obj = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
  const cand = obj(p.candidate);
  const loc = obj(p.location);
  const comp = obj(p.compensation);
  const roles = obj(p.target_roles);
  const prefs = obj(p.work_preferences);
  const fitOf = (f: unknown) => (f === 'primary' ? 'dream' : f === 'adjacent' ? 'stretch' : 'good');
  const archetypes = Array.isArray(roles.archetypes)
    ? (roles.archetypes as Record<string, unknown>[])
    : [];
  const list: SetupRole[] = archetypes.length
    ? archetypes.map((a) => ({ title: str(a.name, 120), fit: fitOf(a.fit) }))
    : strs(roles.primary).map((title) => ({ title, fit: 'dream' as const }));
  const level = str(prefs.level) || str(archetypes[0]?.level);
  return {
    about: cleanAbout({
      name: cand.full_name,
      phone: cand.phone,
      city: loc.city,
      country: loc.country,
      timezone: loc.timezone,
      linkedin: cand.linkedin,
      portfolio: cand.portfolio_url,
      workRight: loc.visa_status,
    }),
    want: cleanWant({
      roles: list,
      level,
      workTypes: prefs.work_types ?? [],
      places: loc.target_markets ?? [],
      currency: comp.currency ?? '',
      salaryTarget: comp.target_range ?? '',
      salaryMin: comp.minimum ?? '',
      dealBreakers: p.deal_breakers ?? [],
    }),
  };
}

const FIT_TO_CAREER_OPS = { dream: 'primary', good: 'secondary', stretch: 'adjacent' } as const;

/** profile.yml in career-ops' shape, built from the forms and the confirmed draft. */
export function composeProfileYaml(state: SetupState, d: SetupDraft, email: string) {
  const a = state.about;
  const w = state.want;
  const roles = w.roles ?? [];
  const where = [a.city, a.country].filter(Boolean).join(', ');
  const work = (w.workTypes ?? []).map((t) => WORK_TYPE_LABELS[t]).join(', ');
  const doc = {
    candidate: {
      full_name: a.name ?? '',
      email,
      phone: a.phone ?? '',
      location: where,
      linkedin: a.linkedin ?? '',
      portfolio_url: a.portfolio ?? '',
    },
    target_roles: {
      primary: roles.filter((r) => r.fit !== 'stretch').map((r) => r.title),
      archetypes: roles.map((r) => ({
        name: r.title,
        level: w.level ?? '',
        fit: FIT_TO_CAREER_OPS[r.fit],
        note: d.roleNotes[r.title] ?? `${ROLE_FIT_LABELS[r.fit]} role`,
      })),
    },
    narrative: {
      headline: d.headline,
      exit_story: d.story,
      superpowers: d.superpowers,
      proof_points: d.proofPoints.map((p) => ({ name: p.name, hero_metric: p.metric })),
    },
    compensation: {
      target_range: w.salaryTarget ?? '',
      currency: w.currency ?? '',
      minimum: w.salaryMin ?? '',
      location_flexibility: [work, (w.places ?? []).join(', ')].filter(Boolean).join(' · '),
    },
    location: {
      country: a.country ?? '',
      city: a.city ?? '',
      timezone: a.timezone ?? '',
      visa_status: a.workRight ?? '',
      target_markets: w.places ?? [],
    },
    work_preferences: { level: w.level ?? '', work_types: w.workTypes ?? [] },
    deal_breakers: w.dealBreakers ?? [],
    language: { output: 'en' },
  };
  return `# Winnow profile, written by setup on ${nowIso().slice(0, 10)}. Edit it in You › Profile and targets.\n\n${stringify(doc, { lineWidth: 100 })}`;
}

const union = (a: string[], b: string[]) => {
  const seen = new Set(a.map((x) => x.toLowerCase()));
  return [...a, ...b.filter((x) => x && !seen.has(x.toLowerCase()) && seen.add(x.toLowerCase()))];
};

/** Lowest number in a pay figure like "£35K" or "35,000", in whole units. */
export function payFloor(s: string | undefined): number {
  const m = /(\d[\d,.]*)\s*(k)?/i.exec(s ?? '');
  if (!m) return 0;
  const n = Number((m[1] ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(m[2] ? n * 1000 : n) : 0;
}

/** The ticked suggestions and the answers become Find's sources and rules, added to what is there. */
export function mergeSources(cur: Sources, state: SetupState, req: SetupFinishRequest): Sources {
  const s = state.suggestions;
  const pick = <T extends { name: string }>(all: T[] | undefined, names: string[], have: T[]) => {
    const keep = new Set(names);
    const had = new Set(have.map((x) => x.name.toLowerCase()));
    return (all ?? []).filter((x) => keep.has(x.name) && !had.has(x.name.toLowerCase()));
  };
  const places = state.want.places ?? [];
  const remote = state.want.workTypes?.includes('remote') ? ['Remote'] : [];
  const rules: Rules = {
    ...cur.rules,
    title: {
      positive: union(
        cur.rules.title.positive,
        union(
          (state.want.roles ?? []).map((r) => r.title),
          s?.titles.positive ?? [],
        ),
      ),
      negative: union(cur.rules.title.negative, s?.titles.negative ?? []),
    },
    location: {
      ...cur.rules.location,
      allow: union(cur.rules.location.allow, [...places, ...remote]),
    },
    salary: cur.rules.salary.min
      ? cur.rules.salary
      : {
          ...cur.rules.salary,
          min: payFloor(state.want.salaryMin),
          currency: state.want.currency || cur.rules.salary.currency,
        },
  };
  return {
    companies: [
      ...cur.companies,
      ...pick([...(s?.companies ?? []), ...(s?.careerSites ?? [])], req.companies, cur.companies),
    ],
    boards: [...cur.boards, ...pick(s?.boards, req.boards, cur.boards)],
    queries: [...cur.queries, ...pick(s?.queries, req.queries, cur.queries)],
    rules,
  };
}

export function cleanDraft(v: unknown): SetupDraft {
  const o = (v ?? {}) as Record<string, unknown>;
  const notes = (o.roleNotes ?? {}) as Record<string, unknown>;
  const narrative = typeof o.narrative === 'string' ? o.narrative.trim().slice(0, 30_000) : '';
  if (!narrative) throw badRequest('The profile needs its narrative.');
  return {
    headline: str(o.headline, 300),
    story: str(o.story, 3000),
    superpowers: strs(o.superpowers, 8, 300),
    proofPoints: Array.isArray(o.proofPoints)
      ? (o.proofPoints as Record<string, unknown>[])
          .map((p) => ({ name: str(p?.name, 200), metric: str(p?.metric, 300) }))
          .filter((p) => p.name || p.metric)
          .slice(0, 10)
      : [],
    roleNotes: Object.fromEntries(
      Object.entries(notes)
        .filter(([, n]) => typeof n === 'string')
        .map(([k, n]) => [clip(k, 120), str(n, 300)]),
    ),
    narrative,
  };
}

/**
 * Confirm Review: write profile.yml and the narrative, keeping the old ones as backups. From here triage
 * and scoring work, even if the person puts off the last step.
 */
export function confirmProfile(space: Space, body: unknown, email: string): SetupState {
  const state = getSetup(space);
  if (state.status === 'done') throw badRequest('Setup is already finished.');
  const draft = cleanDraft((body as { draft?: unknown } | null)?.draft);
  if (!space.profile.ready().cv) throw badRequest('Add your CV first.');
  if (!(state.want.roles ?? []).length) throw badRequest('Add at least one target role.');
  const p = libraryPaths(space.library);
  const backups = join(p.profileDir, 'uploads');
  mkdirSync(backups, { recursive: true });
  const stamp = nowIso().replace(/[:.]/g, '-');
  for (const [file, name] of [
    [p.profileYaml, 'profile'],
    [p.narrative, 'narrative'],
  ] as const)
    if (existsSync(file))
      copyFileSync(
        file,
        join(backups, `${name}-before-${stamp}${file.slice(file.lastIndexOf('.'))}`),
      );
  space.profile.set({
    profileYaml: composeProfileYaml(state, draft, email),
    narrative: `${draft.narrative}\n`,
  });
  return saveSetup(space, { draft, step: 'sources', status: 'in_progress' });
}

/** The last step: add the ticked sources and the rules, and mark setup done. */
export function finishSetup(space: Space, body: unknown): SetupState {
  const state = getSetup(space);
  if (state.status === 'done') throw badRequest('Setup is already finished.');
  if (!space.profile.ready().profile) throw badRequest('Confirm your profile on Review first.');
  const b = (body ?? {}) as Record<string, unknown>;
  const names = (v: unknown) => strs(v, 200, 300);
  const req: SetupFinishRequest = {
    companies: names(b.companies),
    boards: names(b.boards),
    queries: names(b.queries),
    scan: b.scan === true,
  };
  setSources(space.db, mergeSources(getSources(space.db), state, req), space.events);
  return saveSetup(space, { status: 'done', doneAt: nowIso(), redo: false });
}
