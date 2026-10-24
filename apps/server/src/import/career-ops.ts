import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ScoreResult, Settings, TriageResult } from '@winnow/api';
import { verdictFor } from '@winnow/api';
import { parse as parseYaml } from 'yaml';
import { type Db, tx } from '../db.ts';
import type { JobStore } from '../jobs.ts';
import { getSettings, type Profile, setSettings, setSources } from '../library.ts';
import { canonicalUrl } from '../util.ts';
import {
  mapStatus,
  parseDiscardLog,
  parseJdCache,
  parsePipeline,
  parsePortals,
  parseReport,
  parseTracker,
  sourceFromUrl,
} from './parse.ts';

export interface ImportSummary {
  inbox: number;
  shortlist: number;
  scored: number;
  applied: number;
  archived: number;
  triaged: number;
  descriptions: number;
  reports: number;
  companies: number;
  boards: number;
  queries: number;
  seenUrls: number;
  profile: string[];
  warnings: string[];
}

const readIf = (file: string) => (existsSync(file) ? readFileSync(file, 'utf8') : null);

/**
 * One-off import of a career-ops checkout into one person's Winnow library. Reads only; never writes into
 * the career-ops folder. Jobs already in Winnow (same link) are left alone, so a second run adds only
 * what is new.
 */
export function importCareerOps(
  from: string,
  deps: { db: Db; jobs: JobStore; profile: Profile },
  /** `jobs: false` brings only the profile, model settings and sources (Find), no jobs or seen links. */
  opts: { jobs?: boolean } = {},
): ImportSummary {
  const { db, jobs, profile } = deps;
  const sum: ImportSummary = {
    inbox: 0,
    shortlist: 0,
    scored: 0,
    applied: 0,
    archived: 0,
    triaged: 0,
    descriptions: 0,
    reports: 0,
    companies: 0,
    boards: 0,
    queries: 0,
    seenUrls: 0,
    profile: [],
    warnings: [],
  };
  const file = (...p: string[]) => join(from, ...p);
  if (!existsSync(file('data')) && !existsSync(file('cv.md')))
    throw new Error(`${from} doesn't look like a career-ops folder (no data/ or cv.md).`);

  // ── Profile and settings ──────────────────────────────────────────────────
  const cv = readIf(file('cv.md'));
  const narrative = readIf(file('modes', '_profile.md'));
  const profileYaml = readIf(file('config', 'profile.yml'));
  profile.set({
    ...(cv ? { cv } : {}),
    ...(narrative ? { narrative } : {}),
    ...(profileYaml ? { profileYaml } : {}),
  });
  if (cv) sum.profile.push('CV');
  if (narrative) sum.profile.push('narrative');
  if (profileYaml) {
    sum.profile.push('profile.yml');
    try {
      const doc = parseYaml(profileYaml) as Record<string, unknown>;
      const m = (doc?.opencode_models ?? {}) as Record<string, unknown>;
      const pick = (k: string) => (typeof m[k] === 'string' ? (m[k] as string) : null);
      const models: Settings['models'] = {
        default: pick('default'),
        scan: pick('scan'),
        triage: pick('triage'),
        score: pick('evaluate'),
      };
      setSettings(db, { models: { ...getSettings(db).models, ...models } });
    } catch (e) {
      sum.warnings.push(`profile.yml: ${(e as Error).message}`);
    }
  }

  // ── Sources ───────────────────────────────────────────────────────────────
  const portals = readIf(file('portals.yml'));
  if (portals) {
    try {
      const parsed = parsePortals(portals);
      setSources(db, parsed);
      sum.companies = parsed.companies.length;
      sum.boards = parsed.boards.length;
      sum.queries = parsed.queries.length;
    } catch (e) {
      sum.warnings.push(`portals.yml: ${(e as Error).message}`);
    }
  }
  if (opts.jobs === false) return sum;

  // ── Scan history: links scans have already seen, so they don't come back ───
  const firstSeen = new Map<string, string>();
  const historyFacts = new Map<string, { title: string; company: string; location: string }>();
  const history = readIf(file('data', 'scan-history.tsv'));
  if (history) {
    const insert = db.prepare(
      'INSERT OR IGNORE INTO scan_history (canon_url, first_seen, outcome) VALUES (?, ?, ?)',
    );
    tx(db, () => {
      for (const line of history.split('\n').slice(1)) {
        const [url, seen, , title, company, status, location] = line.split('\t');
        if (!url || !/^https?:/.test(url)) continue;
        insert.run(canonicalUrl(url), seen || '', status || 'added');
        if (seen) firstSeen.set(canonicalUrl(url), seen);
        historyFacts.set(canonicalUrl(url), {
          title: title ?? '',
          company: company ?? '',
          location: location ?? '',
        });
        sum.seenUrls++;
      }
    });
  }
  const seenAt = (url: string, fallback?: string | null) =>
    firstSeen.get(canonicalUrl(url)) ?? fallback ?? new Date().toISOString().slice(0, 10);

  const exists = (url: string) => jobs.byUrl(url);
  /** Fill a missing company, role or location from scan history. */
  const known = <T extends { url: string; company: string; role: string; location?: string }>(
    input: T,
  ): T => {
    const h = historyFacts.get(canonicalUrl(input.url));
    if (!h) return input;
    return {
      ...input,
      company: !input.company || input.company === '?' ? h.company || input.company : input.company,
      role: input.role || h.title,
      location: input.location || h.location,
    };
  };

  // ── Tracker rows and their reports ────────────────────────────────────────
  const reportsDir = file('reports');
  const reportFiles = existsSync(reportsDir)
    ? readdirSync(reportsDir).filter((f) => f.endsWith('.md') && !/RESERVED/i.test(f))
    : [];
  const usedReports = new Set<string>();
  const pipeline = parsePipeline(readIf(file('data', 'pipeline.md')) ?? '');
  const processedByNum = new Map(
    pipeline.processed.filter((p) => p.num).map((p) => [String(Number(p.num)), p]),
  );

  const scoreFrom = (
    r: ReturnType<typeof parseReport>,
    fallbackScore: number | null,
    at: string,
  ): ScoreResult | null => {
    const score = r.score ?? fallbackScore;
    if (score == null) return null;
    return {
      score,
      verdict: verdictFor(score, getSettings(db).bands),
      summary: r.verdictLine ?? '',
      dimensions: r.dimensions,
      hardStops: r.hardStops,
      gaps: r.gaps,
      strengths: r.strengths,
      nextStep: r.nextAction ?? '',
      legitimacy: r.legitimacy,
      archetype: r.archetype,
      comp: r.comp,
      at,
      runId: null,
    };
  };

  const addScored = (input: {
    url: string;
    company: string;
    role: string;
    location?: string;
    status: string;
    notes?: string;
    date: string;
    report: string | null;
    fallbackScore: number | null;
  }) => {
    if (exists(input.url)) return;
    const parsed = input.report ? parseReport(input.report) : null;
    const mapped = mapStatus(input.status);
    const at = `${input.date || new Date().toISOString().slice(0, 10)}T12:00:00.000Z`;
    const job = jobs.insert(
      known({
        url: input.url,
        company: input.company || parsed?.company || '?',
        role: input.role || parsed?.role || '',
        location: input.location ?? '',
        salary: parsed?.comp ?? null,
        firstSeen: seenAt(input.url, input.date),
        source: sourceFromUrl(input.url),
        list: mapped.list,
        stage: mapped.stage ?? null,
        archiveReason: mapped.reason ?? null,
        archiveDetail: mapped.reason ? input.notes || null : null,
        movedBy: 'import',
        addedBy: 'import',
        notes: input.notes ?? '',
      }),
      null,
      at,
    );
    const score = parsed ? scoreFrom(parsed, input.fallbackScore, at) : null;
    if (score || input.fallbackScore != null) {
      jobs.setScore(
        job.id,
        score ?? {
          score: input.fallbackScore as number,
          verdict: verdictFor(input.fallbackScore as number, getSettings(db).bands),
          summary: input.notes ?? '',
          dimensions: [],
          hardStops: [],
          gaps: [],
          strengths: [],
          nextStep: '',
          legitimacy: null,
          archetype: null,
          comp: null,
          at,
          runId: null,
        },
        input.report,
      );
      if (input.report) sum.reports++;
    }
    if (mapped.list === 'scored') sum.scored++;
    else if (mapped.list === 'applied') sum.applied++;
    else sum.archived++;
  };

  for (const row of parseTracker(readIf(file('data', 'applications.md')) ?? '')) {
    const reportName =
      row.reportFile && reportFiles.includes(row.reportFile) ? row.reportFile : null;
    const report = reportName ? readFileSync(join(reportsDir, reportName), 'utf8') : null;
    if (reportName) usedReports.add(reportName);
    const parsed = report ? parseReport(report) : null;
    const url = parsed?.url ?? processedByNum.get(String(Number(row.num)))?.url ?? null;
    if (!url) {
      sum.warnings.push(`Tracker #${row.num} (${row.company}, ${row.role}) has no link; skipped.`);
      continue;
    }
    addScored({
      url,
      company: row.company === '?' && row.via ? `? (via ${row.via})` : row.company,
      role: row.role,
      status: row.status,
      notes: row.notes,
      date: row.date,
      report,
      fallbackScore: row.score,
    });
  }

  // Reports with no tracker row (a run that died before the tracker merge).
  for (const name of reportFiles) {
    if (usedReports.has(name)) continue;
    const report = readFileSync(join(reportsDir, name), 'utf8');
    const parsed = parseReport(report);
    if (!parsed.url || parsed.score == null) continue;
    addScored({
      url: parsed.url,
      company: parsed.company ?? '?',
      role: parsed.role ?? '',
      status: 'Evaluated',
      date: parsed.date ?? '',
      report,
      fallbackScore: parsed.score,
    });
  }

  // Processed lines: scored ones not in the tracker, and pre-screen skips.
  for (const p of pipeline.processed) {
    if (exists(p.url)) continue;
    if (p.skipped) {
      jobs.insert(
        known({
          url: p.url,
          company: p.company || '?',
          role: p.role,
          firstSeen: seenAt(p.url),
          source: sourceFromUrl(p.url),
          list: 'archive',
          archiveReason: 'triage',
          archiveDetail: `Pre-screen: ${p.skipped}`,
          movedBy: 'triage',
          addedBy: 'import',
        }),
      );
      sum.archived++;
    } else if (p.score != null) {
      addScored({
        url: p.url,
        company: p.company,
        role: p.role,
        status: 'Evaluated',
        date: '',
        report: null,
        fallbackScore: p.score,
      });
    }
  }

  // Pre-screen discards logged on their own.
  for (const d of parseDiscardLog(readIf(file('data', 'discard.log')) ?? '')) {
    if (exists(d.url)) continue;
    jobs.insert(
      known({
        url: d.url,
        company: '?',
        role: '',
        firstSeen: seenAt(d.url, d.at.slice(0, 10)),
        source: sourceFromUrl(d.url),
        list: 'archive',
        archiveReason: 'triage',
        archiveDetail: d.reason || 'Pre-screen discard',
        movedBy: 'triage',
        addedBy: 'import',
      }),
      null,
      d.at || undefined,
    );
    sum.archived++;
  }

  for (const s of pipeline.shortlisted) {
    if (exists(s.url)) {
      continue;
    }
    jobs.insert(
      known({
        url: s.url,
        company: s.company || '?',
        role: s.role,
        location: s.location,
        firstSeen: seenAt(s.url),
        source: sourceFromUrl(s.url),
        list: 'shortlist',
        movedBy: 'import',
        addedBy: 'import',
      }),
    );
    sum.shortlist++;
  }

  for (const p of pipeline.pending) {
    if (exists(p.url)) continue;
    jobs.insert({
      url: p.url,
      company: p.company || '?',
      role: p.role,
      location: p.location,
      postedAt: p.postedAt,
      firstSeen: seenAt(p.url, p.postedAt),
      source: sourceFromUrl(p.url),
      list: 'inbox',
      movedBy: 'import',
      addedBy: 'import',
    });
    sum.inbox++;
  }

  // ── Triage verdicts the old web app kept in its run history ───────────────
  const registry = readIf(file('.career-ops-web', 'job-registry.json'));
  if (registry) {
    try {
      const runs = JSON.parse(registry) as {
        kind?: string;
        endedAt?: number;
        startedAt?: number;
        data?: { id?: string; decision?: string; reason?: string }[];
      }[];
      const triageRuns = runs
        .filter((r) => r.kind === 'triage' && Array.isArray(r.data))
        .sort((a, b) => (a.endedAt ?? a.startedAt ?? 0) - (b.endedAt ?? b.startedAt ?? 0));
      for (const run of triageRuns) {
        const at = new Date(run.endedAt ?? run.startedAt ?? Date.now()).toISOString();
        for (const d of run.data ?? []) {
          if (!d.id || (d.decision !== 'keep' && d.decision !== 'discard')) continue;
          const job = jobs.byUrl(d.id);
          // A later run's verdict replaces an earlier one; the same verdict twice is skipped.
          if (!job || (job.triage && job.triage.at >= at)) continue;
          const triage: TriageResult = {
            verdict: d.decision,
            reason: d.reason?.trim() || (d.decision === 'keep' ? 'Fits your targets' : 'Not a fit'),
            at,
            runId: null,
          };
          jobs.setTriage(job.id, triage);
          sum.triaged++;
          if (d.decision === 'discard' && job.list === 'inbox') {
            jobs.move(
              { ids: [job.id], to: 'archive', reason: 'triage', detail: triage.reason },
              'triage',
            );
            sum.inbox--;
            sum.archived++;
          }
        }
      }
    } catch (e) {
      sum.warnings.push(`Triage history: ${(e as Error).message}`);
    }
  }

  // ── Captured job descriptions ─────────────────────────────────────────────
  const jdDir = file('data', 'jd-cache');
  if (existsSync(jdDir)) {
    for (const name of readdirSync(jdDir).filter((f) => f.endsWith('.md'))) {
      const { url, body } = parseJdCache(readFileSync(join(jdDir, name), 'utf8'));
      if (!url || body.length < 80) continue;
      const job = jobs.byUrl(url);
      if (!job || job.hasJd) continue;
      jobs.writeJd(job.id, body);
      sum.descriptions++;
    }
  }

  jobs.changed();
  return sum;
}
