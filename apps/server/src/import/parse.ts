/**
 * Pure parsers for career-ops files. No file system access here, so each one is easy to test.
 */
import type { Rules, ScoreDimension, SearchQuery, SourceEntry } from '@winnow/api';
import { parse as parseYaml } from 'yaml';

export interface PendingLine {
  url: string;
  company: string;
  role: string;
  location: string;
  postedAt: string | null;
}

export interface ProcessedLine {
  num: string | null;
  url: string;
  company: string;
  role: string;
  score: number | null;
  /** Set for `skipped (...)` lines: the pre-screen reason. */
  skipped: string | null;
}

export interface ShortlistLine {
  url: string;
  company: string;
  role: string;
  location: string;
}

export interface PipelineFile {
  pending: PendingLine[];
  processed: ProcessedLine[];
  shortlisted: ShortlistLine[];
}

const cells = (line: string) => line.split(' | ').map((c) => c.trim());

/** `data/pipeline.md`: `## Pending`, `## Processed` and `## Shortlisted` sections. */
export function parsePipeline(text: string): PipelineFile {
  const out: PipelineFile = { pending: [], processed: [], shortlisted: [] };
  let section = '';
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const heading = /^##\s+(.+)$/.exec(line);
    if (heading) {
      section = (heading[1] ?? '').toLowerCase();
      continue;
    }
    if (!line.startsWith('- ')) continue;
    if (section.startsWith('pending')) {
      const m = /^- \[ \]\s+(.*)$/.exec(line);
      if (!m) continue;
      const parts = cells(m[1] ?? '');
      const url = parts[0] ?? '';
      if (!/^https?:\/\//.test(url)) continue;
      const posted = parts.find((p) => p.startsWith('posted:'));
      const rest = parts.slice(1).filter((p) => !p.startsWith('posted:'));
      out.pending.push({
        url,
        company: rest[0] ?? '',
        role: rest[1] ?? '',
        location: rest[2] ?? '',
        postedAt: posted ? posted.replace('posted:', '').trim() || null : null,
      });
    } else if (section.startsWith('processed')) {
      const m = /^- \[x\]\s+(.*)$/i.exec(line);
      if (!m) continue;
      const parts = cells(m[1] ?? '');
      let i = 0;
      let num: string | null = null;
      if (parts[0]?.startsWith('#')) {
        num = parts[0].slice(1).replace(/^-+$/, '') || null;
        i = 1;
      }
      const url = parts[i] ?? '';
      if (!/^https?:\/\//.test(url)) continue;
      const after = parts.slice(i + 1);
      const skippedCell = after.find((p) => /^skipped\b/i.test(p));
      if (skippedCell) {
        const reason = /\((.*)\)\s*$/.exec(skippedCell)?.[1] ?? skippedCell;
        out.processed.push({
          num,
          url,
          company: after[0] && after[0] !== skippedCell ? after[0] : '',
          role: after[1] && after[1] !== skippedCell ? after[1] : '',
          score: null,
          skipped: reason.replace(/^pre-screen mismatch:\s*/i, '').trim(),
        });
        continue;
      }
      const scoreCell = after.find((p) => /^\d(\.\d+)?\/5$/.test(p));
      out.processed.push({
        num,
        url,
        company: after[0] ?? '',
        role: after[1] ?? '',
        score: scoreCell ? Number(scoreCell.split('/')[0]) : null,
        skipped: null,
      });
    } else if (section.startsWith('shortlist')) {
      const parts = cells(line.slice(2));
      const url = parts[0] ?? '';
      if (!/^https?:\/\//.test(url)) continue;
      out.shortlisted.push({
        url,
        company: parts[1] ?? '',
        role: parts[2] ?? '',
        location: parts[3] ?? '',
      });
    }
  }
  return out;
}

export interface TrackerRow {
  num: string;
  date: string;
  company: string;
  via: string;
  role: string;
  score: number | null;
  status: string;
  reportFile: string | null;
  notes: string;
}

/** `data/applications.md`: the tracker table. Columns are found by header name. */
export function parseTracker(text: string): TrackerRow[] {
  const lines = text.split('\n').filter((l) => l.trim().startsWith('|'));
  const header = lines[0];
  if (!header) return [];
  const names = header
    .split('|')
    .slice(1, -1)
    .map((c) => c.trim().toLowerCase());
  const col = (row: string[], name: string) => {
    const i = names.indexOf(name);
    return i >= 0 ? (row[i] ?? '').trim() : '';
  };
  const out: TrackerRow[] = [];
  for (const line of lines.slice(1)) {
    const row = line.split('|').slice(1, -1);
    if (row.every((c) => /^\s*-*\s*$/.test(c))) continue;
    const num = col(row, '#');
    if (!/^\d+$/.test(num)) continue;
    const scoreText = col(row, 'score');
    const report = /\]\(([^)]+)\)/.exec(col(row, 'report'))?.[1] ?? null;
    out.push({
      num,
      date: col(row, 'date'),
      company: col(row, 'company'),
      via: col(row, 'via').replace(/^—$/, ''),
      role: col(row, 'role'),
      score: /^\d(\.\d+)?/.test(scoreText) ? Number.parseFloat(scoreText) : null,
      status: col(row, 'status').replace(/\*\*/g, ''),
      reportFile: report ? (report.split('/').pop() ?? null) : null,
      notes: col(row, 'notes'),
    });
  }
  return out;
}

export interface ParsedReport {
  url: string | null;
  date: string | null;
  company: string | null;
  role: string | null;
  score: number | null;
  verdictLine: string | null;
  legitimacy: string | null;
  archetype: string | null;
  comp: string | null;
  hardStops: string[];
  gaps: string[];
  strengths: string[];
  nextAction: string | null;
  finalDecision: string | null;
  dimensions: ScoreDimension[];
}

const DIMENSION_KEYS: [RegExp, string, string][] = [
  [/match|cv/i, 'cv', 'CV match'],
  [/north star|archetype|alignment/i, 'north_star', 'North Star fit'],
  [/comp|salary|pay/i, 'comp', 'Comp'],
  [/cultur/i, 'culture', 'Culture'],
  [/red flag|risk/i, 'red_flags', 'Red flags'],
];

/** A career-ops evaluation report: header fields, the Machine Summary YAML and the score table. */
export function parseReport(text: string): ParsedReport {
  const field = (name: string) =>
    new RegExp(`^\\*\\*${name}:\\*\\*\\s*(.+)$`, 'mi').exec(text)?.[1]?.trim() ?? null;
  let summary: Record<string, unknown> = {};
  const yamlBlock = /## Machine Summary[\s\S]*?```ya?ml\n([\s\S]*?)```/.exec(text)?.[1];
  if (yamlBlock) {
    try {
      summary = (parseYaml(yamlBlock) as Record<string, unknown>) ?? {};
    } catch {
      summary = {};
    }
  }
  const list = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

  const dimensions: ScoreDimension[] = [];
  const table = /\*\*Score breakdown\*\*\s*\n+([\s\S]*?)(?:\n\s*\n|$)/i.exec(text)?.[1] ?? '';
  for (const line of table.split('\n')) {
    const parts = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    if (parts.length < 2 || /^-+$/.test(parts[0] ?? '') || /^dimension$/i.test(parts[0] ?? ''))
      continue;
    const label = parts[0] ?? '';
    const score = Number.parseFloat(parts[1] ?? '');
    if (/global|overall|total/i.test(label)) continue;
    const known = DIMENSION_KEYS.find(([re]) => re.test(label));
    dimensions.push({
      key: known?.[1] ?? label.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
      label: known?.[2] ?? label,
      score: Number.isFinite(score) ? score : null,
      note: parts[2] ?? '',
    });
  }

  const scoreText = field('Score');
  const headerScore = scoreText ? Number.parseFloat(scoreText) : Number.NaN;
  const yamlScore = typeof summary.score === 'number' ? summary.score : Number.NaN;
  const score = Number.isFinite(yamlScore)
    ? yamlScore
    : Number.isFinite(headerScore)
      ? headerScore
      : null;
  const title = /^# Evaluation:\s*(.+?)\s+—\s+(.+)$/m.exec(text);

  return {
    url: field('URL'),
    date: field('Date'),
    company: str(summary.company) ?? title?.[1]?.trim() ?? null,
    role: str(summary.role) ?? title?.[2]?.trim() ?? null,
    score,
    verdictLine: field('Verdict')?.replace(/^\d(\.\d+)?\/5\s*—\s*/, '') ?? null,
    legitimacy: str(summary.legitimacy_tier) ?? field('Legitimacy'),
    archetype: str(summary.archetype) ?? field('Archetype'),
    comp: str(summary.advertised_comp),
    hardStops: list(summary.hard_stops),
    gaps: list(summary.soft_gaps),
    strengths: list(summary.top_strengths),
    nextAction: str(summary.next_action),
    finalDecision: str(summary.final_decision),
    dimensions,
  };
}

/** One `data/jd-cache/*.md` file: front matter plus text. */
export function parseJdCache(text: string): { url: string | null; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!m) return { url: null, body: text };
  let url: string | null = null;
  try {
    const fm = parseYaml(m[1] ?? '') as Record<string, unknown>;
    url = typeof fm?.url === 'string' ? fm.url : null;
  } catch {
    url = /^url:\s*(\S+)/m.exec(m[1] ?? '')?.[1] ?? null;
  }
  return { url, body: (m[2] ?? '').trim() };
}

/** `data/discard.log`: `timestamp<TAB>url<TAB>reason`. */
export function parseDiscardLog(text: string): { at: string; url: string; reason: string }[] {
  return text
    .split('\n')
    .map((l) => l.split('\t'))
    .filter((p) => p.length >= 2 && /^https?:\/\//.test(p[1] ?? ''))
    .map((p) => ({ at: p[0] ?? '', url: p[1] ?? '', reason: (p[2] ?? '').trim() }));
}

const strings = (v: unknown): string[] =>
  v == null ? [] : (Array.isArray(v) ? v : [v]).filter((x): x is string => typeof x === 'string');

/** `portals.yml` → companies, boards, queries and rules. */
export function parsePortals(text: string): {
  companies: SourceEntry[];
  boards: SourceEntry[];
  queries: SearchQuery[];
  rules: Rules;
} {
  const doc = (parseYaml(text) as Record<string, unknown>) ?? {};
  const entries = (v: unknown) =>
    (Array.isArray(v) ? v : []).filter(
      (e): e is SourceEntry =>
        !!e && typeof e === 'object' && typeof (e as SourceEntry).name === 'string',
    );
  const tf = (doc.title_filter ?? {}) as Record<string, unknown>;
  const lf = (doc.location_filter ?? {}) as Record<string, unknown>;
  const sf = (doc.salary_filter ?? {}) as Record<string, unknown>;
  const age = Number(doc.max_posting_age_days);
  return {
    companies: entries(doc.tracked_companies),
    boards: entries(doc.job_boards),
    queries: (Array.isArray(doc.search_queries) ? doc.search_queries : [])
      .filter((q): q is Record<string, unknown> => !!q && typeof q === 'object')
      .filter((q) => typeof q.query === 'string')
      .map((q) => ({
        name: typeof q.name === 'string' ? q.name : String(q.query).slice(0, 40),
        query: q.query as string,
        enabled: q.enabled !== false,
      })),
    rules: {
      title: { positive: strings(tf.positive), negative: strings(tf.negative) },
      location: {
        alwaysAllow: strings(lf.always_allow),
        allow: strings(lf.allow),
        block: strings(lf.block),
      },
      salary: {
        min: Number(sf.min) || 0,
        max: Number(sf.max) || 0,
        currency: typeof sf.currency === 'string' ? sf.currency : '',
      },
      maxAgeDays: Number.isInteger(age) && age > 0 ? age : null,
    },
  };
}

/** Map a career-ops tracker status to a Winnow list. */
export function mapStatus(status: string): {
  list: 'scored' | 'applied' | 'archive';
  stage?: 'applied' | 'responded' | 'interview' | 'offer' | 'hired';
  reason?: 'rejected' | 'not_for_me' | 'low_score' | 'closed';
} {
  const s = status.trim().toLowerCase();
  if (/^(applied|aplicado|enviada|aplicada|sent)$/.test(s))
    return { list: 'applied', stage: 'applied' };
  if (/^(responded|respondido)$/.test(s)) return { list: 'applied', stage: 'responded' };
  if (/^(interview|entrevista)$/.test(s)) return { list: 'applied', stage: 'interview' };
  if (/^(offer|oferta)$/.test(s)) return { list: 'applied', stage: 'offer' };
  if (/^(hired|contratad[oa]|accepted|accept)$/.test(s)) return { list: 'applied', stage: 'hired' };
  if (/^(rejected|rechazad[oa])$/.test(s)) return { list: 'archive', reason: 'rejected' };
  if (/^(discarded|descartad[oa]|cerrada|cancelada)$/.test(s))
    return { list: 'archive', reason: 'not_for_me' };
  if (/^(skip|no_aplicar|no aplicar|monitor)$/.test(s))
    return { list: 'archive', reason: 'low_score' };
  return { list: 'scored' };
}

/** The provider a posting URL most likely came from, for the source label. */
export function sourceFromUrl(url: string): string {
  const u = url.toLowerCase();
  const known: [RegExp, string][] = [
    [/greenhouse\.io|gh_jid=/, 'greenhouse'],
    [/lever\.co/, 'lever'],
    [/ashbyhq\.com/, 'ashby'],
    [/myworkdayjobs\.com|workday/, 'workday'],
    [/linkedin\.com/, 'linkedin'],
    [/adzuna\./, 'adzuna'],
    [/smartrecruiters\.com/, 'smartrecruiters'],
    [/workable\.com/, 'workable'],
    [/teamtailor\.com/, 'teamtailor'],
    [/recruitee\.com/, 'recruitee'],
    [/personio\./, 'personio'],
    [/bamboohr\.com/, 'bamboohr'],
    [/successfactors|sapsf/, 'successfactors'],
  ];
  return known.find(([re]) => re.test(u))?.[1] ?? 'web';
}
