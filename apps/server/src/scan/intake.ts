import type { Rules } from '@winnow/api';
import type { Db } from '../db.ts';
import type { JobStore } from '../jobs.ts';
import { canonicalUrl, nowIso, today } from '../util.ts';
import { cleanPosting } from './capture.ts';
import { compileRules, type SalaryInfo } from './rules.ts';

/** A posting as a provider returns it (career-ops `Job` shape). */
export interface Offer {
  title: string;
  url: string;
  company?: string;
  location?: string;
  description?: string;
  postedAt?: number;
  salary?: SalaryInfo & { text?: string };
}

export interface IntakeStats {
  found: number;
  added: string[];
  duplicates: number;
  seenBefore: number;
  filteredTitle: number;
  filteredRules: number;
  ruleCounts: Record<string, number>;
}

export const emptyStats = (): IntakeStats => ({
  found: 0,
  added: [],
  duplicates: 0,
  seenBefore: 0,
  filteredTitle: 0,
  filteredRules: 0,
  ruleCounts: {},
});

function salaryText(s: Offer['salary']): string | null {
  if (!s) return null;
  if (s.text) return s.text;
  const sym =
    s.currency === 'GBP' ? '£' : s.currency === 'USD' ? '$' : s.currency === 'EUR' ? '€' : '';
  const k = (n: number) => `${sym}${Math.round(n / 1000)}k`;
  if (s.min && s.max) return `${k(s.min)}–${k(s.max)}`;
  if (s.min) return `From ${k(s.min)}`;
  if (s.max) return `Up to ${k(s.max)}`;
  return null;
}

function workModel(location: string, description = ''): string | null {
  const t = `${location} ${description.slice(0, 600)}`.toLowerCase();
  if (/\bremote\b/.test(t) && !/\bhybrid\b/.test(location.toLowerCase())) return 'Remote';
  if (/\bhybrid\b/.test(t)) return 'Hybrid';
  if (/\bon-?site\b|\bin office\b/.test(t)) return 'On-site';
  return null;
}

/**
 * Where every scan's postings go: drop what was seen before, merge duplicates, apply the rules, and add
 * the rest to the inbox. Postings that match a role but break a location, pay or age rule are archived
 * with the rule as the reason, so a rule can be checked. Title misses are only counted.
 */
export class Intake {
  private rules;
  private seen: Set<string>;
  readonly stats = emptyStats();

  constructor(
    private db: Db,
    private jobs: JobStore,
    rules: Rules,
    private runId: string,
    /** Archive rule misses so a rule can be checked (Portals); a wide scan only counts them. */
    private archiveRuleMisses = true,
  ) {
    this.rules = compileRules(rules);
    this.seen = new Set(
      (db.prepare('SELECT canon_url FROM scan_history').all() as { canon_url: string }[]).map(
        (r) => r.canon_url,
      ),
    );
  }

  private remember(url: string, outcome: string) {
    const canon = canonicalUrl(url);
    this.seen.add(canon);
    this.db
      .prepare(
        'INSERT OR IGNORE INTO scan_history (canon_url, first_seen, outcome) VALUES (?, ?, ?)',
      )
      .run(canon, today(), outcome);
  }

  /** `skipRules`: the posting was already matched to the person (Jill roles), so none of the rules apply. */
  add(
    offer: Offer,
    source: string,
    fallbackCompany = '',
    opts: { skipRules?: boolean } = {},
  ): void {
    this.stats.found++;
    if (!offer?.url || !offer.title?.trim()) return;
    const canon = canonicalUrl(offer.url);
    const company = (offer.company || fallbackCompany || '').trim();
    const location = (offer.location || '').trim();

    const existing = this.jobs.byUrl(offer.url);
    if (existing) {
      this.jobs.addSource(existing.id, source, offer.url);
      this.stats.duplicates++;
      return;
    }
    if (this.seen.has(canon)) {
      this.stats.seenBefore++;
      return;
    }
    const titleMiss = opts.skipRules ? null : this.rules.title(offer.title);
    if (titleMiss) {
      this.stats.filteredTitle++;
      this.remember(offer.url, 'title');
      return;
    }
    const twin = this.jobs.byFingerprint(company, offer.title, location);
    if (twin) {
      this.jobs.addSource(twin.id, source, offer.url);
      this.remember(offer.url, 'duplicate');
      this.stats.duplicates++;
      return;
    }
    const broken = opts.skipRules
      ? null
      : (this.rules.location(location) ??
        this.rules.salary(offer.salary) ??
        this.rules.age(offer.postedAt));
    if (broken && !this.archiveRuleMisses) {
      this.stats.filteredRules++;
      const kind = broken.split(' ')[0] ?? 'Rule';
      this.stats.ruleCounts[kind] = (this.stats.ruleCounts[kind] ?? 0) + 1;
      this.remember(offer.url, 'rules');
      return;
    }
    const postedAt =
      typeof offer.postedAt === 'number' && Number.isFinite(offer.postedAt)
        ? new Date(offer.postedAt).toISOString().slice(0, 10)
        : null;
    // The posting check runs here too: some sources carry the whole posting.
    const checked = offer.description?.trim() ? cleanPosting(offer.description.trim()) : null;
    const description = checked?.text ?? '';
    const job = this.jobs.insert(
      {
        url: offer.url,
        company: company || '?',
        role: offer.title.trim(),
        location,
        workModel: workModel(location, description),
        salary: salaryText(offer.salary),
        postedAt,
        firstSeen: nowIso(),
        source,
        list: broken ? 'archive' : 'inbox',
        archiveReason: broken ? 'rules' : null,
        archiveDetail: broken,
        movedBy: broken ? 'rules' : 'scan',
        addedBy: 'scan',
        jd: description.length > 300 ? description : null,
      },
      this.runId,
    );
    if (checked?.warnings.length && description.length > 300)
      this.jobs.setPosting(job.id, { warnings: checked.warnings });
    this.remember(offer.url, broken ? 'rules' : 'added');
    if (broken) {
      this.stats.filteredRules++;
      const kind = broken.split(' ')[0] ?? 'Rule';
      this.stats.ruleCounts[kind] = (this.stats.ruleCounts[kind] ?? 0) + 1;
    } else this.stats.added.push(job.id);
  }

  summary(): string {
    const s = this.stats;
    const parts = [`Found ${s.found}`, `${s.added.length} new`];
    if (s.duplicates) parts.push(`${s.duplicates} duplicates`);
    if (s.filteredTitle + s.filteredRules)
      parts.push(`${s.filteredTitle + s.filteredRules} filtered`);
    return parts.join(' · ');
  }
}
