import type { Mode, SetupRole, StudyPrefs } from '@winnow/api';
import { EMPTY_STUDY, MODES } from '@winnow/api';
import { type Db, kvGet, kvSet } from '../db.ts';
import type { EventBus } from '../events.ts';
import { getSources, setSources } from '../library.ts';
import { badRequest, clip } from '../util.ts';

/** Whether this person looks for jobs or for scholarships. Kept in their own database. */
export function getMode(db: Db): Mode {
  const m = kvGet<string>(db, 'mode', 'jobs');
  return (MODES as readonly string[]).includes(m) ? (m as Mode) : 'jobs';
}

export function setMode(db: Db, mode: string, events?: EventBus): Mode {
  if (!(MODES as readonly string[]).includes(mode)) throw badRequest('Pick jobs or scholarships.');
  kvSet(db, 'mode', mode);
  if (mode === 'scholarships') applyStudyRules(db, getStudy(db), events);
  events?.emit('study.changed', { mode });
  return mode as Mode;
}

/** Words that mark a level a master's seeker doesn't want. Only titles that name them are dropped. */
export const STUDY_TITLE_NEGATIVES = ['PhD', 'doctoral', 'postdoc', 'undergraduate', 'bachelor'];

const str = (v: unknown, max = 200) => (typeof v === 'string' ? clip(v.trim(), max) : '');
const strs = (v: unknown, max = 40, len = 100) =>
  Array.isArray(v) ? [...new Set(v.map((x) => str(x, len)).filter(Boolean))].slice(0, max) : [];

function cleanSubjects(v: unknown): SetupRole[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: SetupRole[] = [];
  for (const r of v as Record<string, unknown>[]) {
    const title = str(typeof r === 'string' ? r : r?.title, 120);
    if (!title || seen.has(title.toLowerCase())) continue;
    seen.add(title.toLowerCase());
    const fit = typeof r === 'object' ? r?.fit : null;
    out.push({ title, fit: fit === 'dream' || fit === 'stretch' ? fit : 'good' });
  }
  return out.slice(0, 12);
}

export function cleanStudy(v: unknown, base: StudyPrefs = EMPTY_STUDY): StudyPrefs {
  const o = (v ?? {}) as Record<string, unknown>;
  const p = (o.places ?? {}) as Record<string, unknown>;
  const years = Number(o.workYears);
  return {
    nationality: 'nationality' in o ? str(o.nationality, 100) : base.nationality,
    level: 'level' in o ? str(o.level, 60) || base.level : base.level,
    subjects: 'subjects' in o ? cleanSubjects(o.subjects) : base.subjects,
    intake: 'intake' in o ? str(o.intake, 60) || 'Any' : base.intake,
    fundingNeed:
      'fundingNeed' in o ? (o.fundingNeed === 'full' ? 'full' : 'any') : base.fundingNeed,
    places:
      'places' in o
        ? {
            prefer: 'prefer' in p ? strs(p.prefer) : base.places.prefer,
            allow: 'allow' in p ? strs(p.allow) : base.places.allow,
            exclude: 'exclude' in p ? strs(p.exclude) : base.places.exclude,
          }
        : base.places,
    englishTest: 'englishTest' in o ? str(o.englishTest, 300) : base.englishTest,
    workYears:
      'workYears' in o
        ? Number.isFinite(years)
          ? Math.min(Math.max(Math.round(years * 2) / 2, 0), 40)
          : 0
        : base.workYears,
    notes: 'notes' in o ? str(o.notes, 2000) : base.notes,
  };
}

export function getStudy(db: Db): StudyPrefs {
  const s = kvGet<Partial<StudyPrefs>>(db, 'study', {});
  return {
    ...EMPTY_STUDY,
    ...s,
    places: { ...EMPTY_STUDY.places, ...(s.places ?? {}) },
    subjects: s.subjects ?? [],
  };
}

export function setStudy(db: Db, patch: unknown, events?: EventBus): StudyPrefs {
  const next = cleanStudy(patch, getStudy(db));
  kvSet(db, 'study', next);
  applyStudyRules(db, next, events);
  events?.emit('study.changed', {});
  return next;
}

/**
 * The scan rules a scholarship search runs on: excluded countries are blocked (and archived with the rule,
 * so the person can check it), and titles naming another level are dropped. Places to prefer are not a
 * filter: scoring weighs them.
 */
export function applyStudyRules(db: Db, study: StudyPrefs, events?: EventBus) {
  const sources = getSources(db);
  const negative = [...sources.rules.title.negative];
  for (const w of STUDY_TITLE_NEGATIVES)
    if (!negative.some((n) => n.toLowerCase() === w.toLowerCase())) negative.push(w);
  setSources(
    db,
    {
      ...sources,
      rules: {
        ...sources.rules,
        title: { positive: [], negative },
        location: { alwaysAllow: [], allow: [], block: study.places.exclude },
        salary: { min: 0, max: 0, currency: '' },
        maxAgeDays: null,
      },
    },
    events,
  );
}

/** The `study:` block of profile.yml, which every scholarship skill reads. */
export function studyYaml(study: StudyPrefs) {
  return {
    nationality: study.nationality,
    level: study.level,
    subjects: study.subjects.map((s) => ({ name: s.title, fit: s.fit })),
    intake: study.intake,
    funding_need: study.fundingNeed === 'full' ? 'full funding only' : 'any; say what each covers',
    places: study.places,
    english_test: study.englishTest,
    work_experience_years: study.workYears,
    notes: study.notes,
  };
}
