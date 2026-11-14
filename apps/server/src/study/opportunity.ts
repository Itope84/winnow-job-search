import type { Eligibility, FundingLevel, FundingShape, OppKind, Opportunity } from '@winnow/api';
import { FUNDING_LEVELS, FUNDING_SHAPES } from '@winnow/api';
import type { JobStore } from '../jobs.ts';
import { clip, nowIso } from '../util.ts';

type Raw = Record<string, unknown>;

const str = (v: unknown, max = 300) => (typeof v === 'string' ? clip(v.trim(), max) : '');
const strs = (v: unknown, max = 20, len = 300) =>
  Array.isArray(v) ? [...new Set(v.map((x) => str(x, len)).filter(Boolean))].slice(0, max) : [];

/** A date as YYYY-MM-DD, or null when it isn't one. */
export function isoDate(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v.trim());
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : `${m[1]}-${m[2]}-${m[3]}`;
}

function eligibility(v: unknown): Eligibility | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Raw;
  const status =
    o.status === 'eligible' || o.status === 'ineligible' || o.status === 'unclear'
      ? o.status
      : 'unclear';
  return { status, who: str(o.who, 400), fails: strs(o.fails, 6), todos: strs(o.todos, 8) };
}

/**
 * Check and shape the facts a skill read off a scholarship or programme page. Unknown values become null
 * or `unknown` rather than failing the run: a page that doesn't say is common.
 */
export function cleanOpportunity(v: unknown, fallback: 'scholarship' | 'programme'): Opportunity {
  const o = (v ?? {}) as Raw;
  const kind = o.kind === 'scholarship' || o.kind === 'programme' ? o.kind : fallback;
  const d = (o.deadlines ?? {}) as Raw;
  const funding = (FUNDING_LEVELS as readonly string[]).includes(String(o.funding))
    ? (o.funding as FundingLevel)
    : 'unknown';
  const shape = (FUNDING_SHAPES as readonly string[]).includes(String(o.shape))
    ? (o.shape as FundingShape)
    : null;
  const round =
    o.round === 'open' || o.round === 'upcoming' || o.round === 'closed' ? o.round : 'unknown';
  const official = str(o.officialUrl, 500);
  return {
    kind,
    shape: kind === 'scholarship' ? (shape ?? null) : shape === 'built_in' ? 'built_in' : null,
    funding,
    covers: str(o.covers, 400),
    countries: strs(o.countries, 12, 60),
    level: str(o.level, 60),
    subject: str(o.subject, 200),
    university: str(o.university, 160) || null,
    intake: str(o.intake, 60) || null,
    deadlines: { scholarship: isoDate(d.scholarship), admission: isoDate(d.admission) },
    round,
    eligibility: eligibility(o.eligibility),
    schools: strs(o.schools, 60, 160),
    essays: strs(o.essays, 10, 600),
    documents: strs(o.documents, 20, 200),
    tuition: str(o.tuition, 200) || null,
    length: str(o.length, 100) || null,
    officialUrl: /^https?:\/\//.test(official) ? official : null,
    at: nowIso(),
  };
}

/** Facts for an item a scanner already knows something about, before AI has read it. */
export function seedOpportunity(
  kind: 'scholarship' | 'programme',
  facts: Partial<Opportunity> = {},
): Opportunity {
  return { ...cleanOpportunity({}, kind), ...facts, kind, at: nowIso() };
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(
      /\b(the|of|university|universiteit|universitat|universite|universidad|universita)\b/g,
      ' ',
    )
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Whether a school named on a scheme's page is this programme's university. */
export function sameSchool(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y || x.length < 3 || y.length < 3) return false;
  return x === y || x.includes(y) || y.includes(x);
}

const sameCountry = (a: string, b: string) => norm(a) === norm(b);

/**
 * Link a scholarship or programme to the items it pairs with, from the facts alone: a scheme that names
 * a programme's university covers it; a whole-country scheme could pay for any programme there; a
 * one-school award covers that school's programmes. Returns how many links were made.
 */
export function autoLink(jobs: JobStore, id: string, runId: string | null = null): number {
  const item = jobs.get(id);
  const opp = item?.opportunity;
  if (!item || !opp) return 0;
  const others = jobs
    .ids("kind IN ('scholarship', 'programme') AND list != 'archive' AND id != ?", id)
    .map((x) => jobs.get(x))
    .filter((x): x is NonNullable<typeof x> => !!x?.opportunity);
  let made = 0;
  const pair = (s: typeof item, p: typeof item) => {
    const so = s.opportunity as Opportunity;
    const po = p.opportunity as Opportunity;
    const uni = po.university ?? p.company;
    if (so.shape === 'one_school' && so.university && sameSchool(so.university, uni))
      return 'covers';
    if (so.schools.some((x) => sameSchool(x, uni))) return 'covers';
    if (
      so.shape === 'country' &&
      so.countries.length &&
      po.countries.some((c) => so.countries.some((k) => sameCountry(c, k)))
    )
      return 'eligible';
    return null;
  };
  for (const other of others) {
    const s = opp.kind === 'scholarship' ? item : other;
    const p = opp.kind === 'scholarship' ? other : item;
    if (s.opportunity?.kind !== 'scholarship' || p.opportunity?.kind !== 'programme') continue;
    const rel = pair(s, p);
    if (!rel) continue;
    jobs.link(s.id, p.id, rel, runId);
    made++;
  }
  return made;
}

/** The kind an item is filed as, from a scanner's guess at its title. */
export function guessKind(title: string): Extract<OppKind, 'scholarship' | 'programme'> {
  return /\b(scholarship|fellowship|bursary|grant|award|funding|stipend)s?\b/i.test(title)
    ? 'scholarship'
    : /\b(m\.?sc|m\.?a|master'?s?|mres|mphil|programme|program|degree|joint master)\b/i.test(title)
      ? 'programme'
      : 'scholarship';
}
