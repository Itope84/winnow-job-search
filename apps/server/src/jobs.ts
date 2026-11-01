import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  Application,
  ArchiveReason,
  Job,
  JobActivity,
  JobDetail,
  JobList,
  JobPage,
  JobQuery,
  JobSource,
  ListCounts,
  MoveRequest,
  Mover,
  PostingCheck,
  ScoreResult,
  Stage,
  TimelineEntry,
  TriageResult,
} from '@winnow/api';
import { ARCHIVE_REASON_LABELS, LIST_LABELS, LISTS, STAGE_LABELS } from '@winnow/api';
import { type Db, tx } from './db.ts';
import type { EventBus } from './events.ts';
import {
  badRequest,
  canonicalUrl,
  fingerprint,
  newId,
  notFound,
  nowIso,
  parseJson,
  writeFileAtomic,
} from './util.ts';

type Row = Record<string, unknown>;

export interface NewJob {
  url: string;
  company: string;
  role: string;
  location?: string;
  workModel?: string | null;
  salary?: string | null;
  postedAt?: string | null;
  firstSeen?: string;
  source: string;
  list: JobList;
  archiveReason?: ArchiveReason | null;
  archiveDetail?: string | null;
  movedBy: Mover;
  addedBy: Job['addedBy'];
  stage?: Stage | null;
  notes?: string;
  jd?: string | null;
}

/** One person's jobs: the lists, the moves between them, and the files that belong to each job. */
export class JobStore {
  readonly jdDir: string;
  readonly reportDir: string;
  /** Tailored CVs and letters, a folder per job. */
  readonly applicationDir: string;
  /** Runs working on a job right now, kept by the runner. */
  activity = new Map<string, JobActivity>();

  constructor(
    private db: Db,
    private events: EventBus,
    library: string,
  ) {
    this.jdDir = join(library, 'jd');
    this.reportDir = join(library, 'reports');
    this.applicationDir = join(library, 'applications');
    mkdirSync(this.jdDir, { recursive: true });
    mkdirSync(this.reportDir, { recursive: true });
  }

  // ── Reading ────────────────────────────────────────────────────────────────

  get(id: string): Job | null {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Row | undefined;
    return row ? this.toJob(row) : null;
  }

  require(id: string): Job {
    const job = this.get(id);
    if (!job) throw notFound('Job');
    return job;
  }

  byUrl(url: string): Job | null {
    const row = this.db.prepare('SELECT * FROM jobs WHERE canon_url = ?').get(canonicalUrl(url)) as
      | Row
      | undefined;
    return row ? this.toJob(row) : null;
  }

  /** A job that is the same posting under another link: same company, role and place. */
  byFingerprint(company: string, role: string, location: string): Job | null {
    if (!company.trim() || company.trim() === '?' || !role.trim()) return null;
    const row = this.db
      .prepare('SELECT * FROM jobs WHERE fp = ? LIMIT 1')
      .get(fingerprint(company, role, location)) as Row | undefined;
    return row ? this.toJob(row) : null;
  }

  detail(id: string): JobDetail {
    const job = this.require(id);
    const timeline = (
      this.db
        .prepare(
          'SELECT at, kind, text, run_id FROM job_events WHERE job_id = ? ORDER BY at, rowid',
        )
        .all(id) as Row[]
    ).map(
      (r): TimelineEntry => ({
        at: r.at as string,
        kind: r.kind as string,
        text: r.text as string,
        runId: (r.run_id as string | null) ?? null,
      }),
    );
    return { ...job, timeline, jd: this.readJd(id), report: this.readReport(id) };
  }

  readJd(id: string): string | null {
    const file = join(this.jdDir, `${id}.md`);
    return existsSync(file) ? readFileSync(file, 'utf8') : null;
  }

  readReport(id: string): string | null {
    const file = join(this.reportDir, `${id}.md`);
    return existsSync(file) ? readFileSync(file, 'utf8') : null;
  }

  counts(): ListCounts {
    const out = Object.fromEntries(LISTS.map((l) => [l, 0])) as ListCounts;
    for (const r of this.db
      .prepare('SELECT list, COUNT(*) AS n FROM jobs GROUP BY list')
      .all() as Row[])
      out[r.list as JobList] = Number(r.n);
    out.kept = Number(
      (
        this.db
          .prepare(
            "SELECT COUNT(*) AS n FROM jobs WHERE list = 'inbox' AND triage_verdict = 'keep'",
          )
          .get() as Row
      ).n,
    );
    return out;
  }

  /** Inbox jobs triage kept. */
  keptInInbox(): string[] {
    return this.ids("list = 'inbox' AND triage_verdict = 'keep'");
  }

  query(q: JobQuery): JobPage {
    if (!LISTS.includes(q.list)) throw badRequest('Unknown list.');
    const where: string[] = ['list = ?'];
    const args: (string | number | null)[] = [q.list];
    if (q.q?.trim()) {
      where.push('(company LIKE ? OR role LIKE ? OR location LIKE ?)');
      const like = `%${q.q.trim()}%`;
      args.push(like, like, like);
    }
    if (q.triage === 'none') where.push('triage_verdict IS NULL');
    else if (q.triage) {
      where.push('triage_verdict = ?');
      args.push(q.triage);
    }
    if (q.source) {
      where.push('sources LIKE ?');
      args.push(`%"source":"${q.source}"%`);
    }
    if (q.withinDays) {
      where.push('COALESCE(posted_at, first_seen) >= ?');
      args.push(new Date(Date.now() - q.withinDays * 86_400_000).toISOString().slice(0, 10));
    }
    if (q.minScore != null) {
      where.push('score >= ?');
      args.push(q.minScore);
    }
    if (q.reason) {
      where.push('archive_reason = ?');
      args.push(q.reason);
    }
    if (q.stage) {
      where.push('stage = ?');
      args.push(q.stage);
    }
    const whereSql = where.join(' AND ');
    const total = Number(
      (this.db.prepare(`SELECT COUNT(*) AS n FROM jobs WHERE ${whereSql}`).get(...args) as Row).n,
    );

    // Keyset pagination on (sort key, id) so pages stay stable while jobs arrive.
    const sort = q.sort ?? (q.list === 'scored' ? 'score' : 'newest');
    const key =
      sort === 'score'
        ? "printf('%08.3f', COALESCE(score, -1))"
        : sort === 'scoredAt'
          ? "COALESCE(json_extract(score_json, '$.at'), '')"
          : sort === 'company'
            ? 'lower(company)'
            : q.list === 'inbox' || q.list === 'shortlist'
              ? 'COALESCE(posted_at, first_seen)'
              : 'moved_at';
    const dir = sort === 'company' ? 'ASC' : 'DESC';
    const pageArgs = [...args];
    let cursorSql = '';
    if (q.cursor) {
      const [k, id] = JSON.parse(Buffer.from(q.cursor, 'base64url').toString()) as [string, string];
      cursorSql =
        dir === 'DESC'
          ? ` AND (${key} < ? OR (${key} = ? AND id < ?))`
          : ` AND (${key} > ? OR (${key} = ? AND id > ?))`;
      pageArgs.push(k, k, id);
    }
    const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
    const rows = this.db
      .prepare(
        `SELECT *, ${key} AS sort_key FROM jobs WHERE ${whereSql}${cursorSql} ORDER BY sort_key ${dir}, id ${dir} LIMIT ?`,
      )
      .all(...pageArgs, limit + 1) as Row[];
    const more = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map((r) => this.toJob(r)),
      total,
      nextCursor:
        more && last
          ? Buffer.from(JSON.stringify([String(last.sort_key), last.id])).toString('base64url')
          : null,
    };
  }

  ids(where: string, ...args: (string | number)[]): string[] {
    return (this.db.prepare(`SELECT id FROM jobs WHERE ${where}`).all(...args) as Row[]).map(
      (r) => r.id as string,
    );
  }

  // ── Writing ────────────────────────────────────────────────────────────────

  /** Insert a new job. The caller has already checked for duplicates. */
  insert(input: NewJob, runId: string | null = null, at = nowIso()): Job {
    const id = newId('job');
    const sources: JobSource[] = [{ source: input.source, url: input.url, seenAt: at }];
    const firstSeen = input.firstSeen ?? at;
    this.db
      .prepare(
        `INSERT INTO jobs (id, url, canon_url, fp, company, role, location, work_model, salary, posted_at,
          first_seen, sources, list, stage, archive_reason, archive_detail, moved_by, moved_at, added_by,
          notes, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.url,
        canonicalUrl(input.url),
        fingerprint(input.company, input.role, input.location ?? ''),
        input.company.trim(),
        input.role.trim(),
        (input.location ?? '').trim(),
        input.workModel ?? null,
        input.salary ?? null,
        input.postedAt ?? null,
        firstSeen,
        JSON.stringify(sources),
        input.list,
        input.stage ?? null,
        input.archiveReason ?? null,
        input.archiveDetail ?? null,
        input.movedBy,
        at,
        input.addedBy,
        input.notes ?? '',
        at,
      );
    if (input.jd) this.writeJd(id, input.jd);
    const how =
      input.addedBy === 'you'
        ? 'Added by you'
        : input.addedBy === 'import'
          ? `Imported from career-ops (${input.source})`
          : `Found by ${input.source}`;
    this.log(id, 'found', how, runId, firstSeen);
    if (input.list === 'archive' && input.archiveReason)
      this.log(
        id,
        'move',
        `Archived: ${input.archiveDetail ?? ARCHIVE_REASON_LABELS[input.archiveReason]}`,
        runId,
        at,
      );
    return this.require(id);
  }

  /** Record that a known job was seen again on another source. */
  addSource(id: string, source: string, url: string) {
    const job = this.require(id);
    if (job.sources.some((s) => s.source === source && canonicalUrl(s.url) === canonicalUrl(url)))
      return;
    const sources = [...job.sources, { source, url, seenAt: nowIso() }];
    this.db
      .prepare('UPDATE jobs SET sources = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(sources), nowIso(), id);
  }

  /** Fill fields a later source knows and the first one didn't. */
  patchFacts(
    id: string,
    facts: Partial<
      Pick<Job, 'company' | 'role' | 'location' | 'salary' | 'workModel' | 'postedAt'>
    >,
  ) {
    const job = this.require(id);
    const pick = (cur: string | null, next: string | null | undefined) =>
      (!cur || cur === '?') && next ? next : cur;
    const company = pick(job.company, facts.company) ?? '';
    const role = pick(job.role, facts.role) ?? '';
    const location = pick(job.location, facts.location) ?? '';
    this.db
      .prepare(
        'UPDATE jobs SET company = ?, role = ?, location = ?, salary = ?, work_model = ?, posted_at = ?, fp = ?, updated_at = ? WHERE id = ?',
      )
      .run(
        company,
        role,
        location,
        pick(job.salary, facts.salary),
        pick(job.workModel, facts.workModel),
        pick(job.postedAt, facts.postedAt),
        fingerprint(company, role, location),
        nowIso(),
        id,
      );
  }

  move(req: MoveRequest, by: Mover, runId: string | null = null): Job[] {
    if (!LISTS.includes(req.to)) throw badRequest('Unknown list.');
    if (req.to === 'archive' && !req.reason) throw badRequest('Archiving needs a reason.');
    const moved = tx(this.db, () =>
      req.ids.map((id) => {
        const job = this.require(id);
        const at = nowIso();
        const stage = req.to === 'applied' ? (req.stage ?? job.stage ?? 'applied') : job.stage;
        this.db
          .prepare(
            `UPDATE jobs SET list = ?, prev_list = ?, stage = ?, archive_reason = ?, archive_detail = ?,
              moved_by = ?, moved_at = ?, updated_at = ? WHERE id = ?`,
          )
          .run(
            req.to,
            job.list === req.to ? job.prevList : job.list,
            stage,
            req.to === 'archive' ? (req.reason ?? null) : null,
            req.to === 'archive' ? (req.detail ?? null) : null,
            by,
            at,
            at,
            id,
          );
        const who =
          by === 'you' ? 'You' : by === 'triage' ? 'Triage' : by === 'score' ? 'Score' : 'Winnow';
        const text =
          req.to === 'archive'
            ? `${who} archived it: ${req.detail ?? ARCHIVE_REASON_LABELS[req.reason as ArchiveReason]}`
            : req.to === 'applied' && job.list === 'applied'
              ? `Stage: ${STAGE_LABELS[stage as Stage]}`
              : `${who} moved it to ${LIST_LABELS[req.to]}`;
        this.log(id, 'move', text, runId, at);
        return this.require(id);
      }),
    );
    this.changed(req.ids);
    return moved;
  }

  /** Send archived jobs back to the list they came from. */
  restore(ids: string[]): Job[] {
    const out = tx(this.db, () =>
      ids.map((id) => {
        const job = this.require(id);
        const to: JobList =
          job.prevList && job.prevList !== 'archive'
            ? job.prevList
            : job.score
              ? 'scored'
              : 'inbox';
        const at = nowIso();
        this.db
          .prepare(
            `UPDATE jobs SET list = ?, prev_list = 'archive', archive_reason = NULL, archive_detail = NULL,
              moved_by = 'you', moved_at = ?, updated_at = ? WHERE id = ?`,
          )
          .run(to, at, at, id);
        this.log(id, 'move', `You restored it to ${LIST_LABELS[to]}`, null, at);
        return this.require(id);
      }),
    );
    this.changed(ids);
    return out;
  }

  setNotes(id: string, notes: string) {
    this.require(id);
    this.db
      .prepare('UPDATE jobs SET notes = ?, updated_at = ? WHERE id = ?')
      .run(notes, nowIso(), id);
    this.changed([id]);
  }

  setStage(id: string, stage: Stage) {
    const job = this.require(id);
    if (job.list !== 'applied') throw badRequest('Only applied jobs have a stage.');
    this.db
      .prepare('UPDATE jobs SET stage = ?, updated_at = ? WHERE id = ?')
      .run(stage, nowIso(), id);
    this.log(id, 'stage', `Stage: ${STAGE_LABELS[stage]}`, null);
    this.changed([id]);
  }

  setTriage(id: string, triage: TriageResult) {
    this.db
      .prepare('UPDATE jobs SET triage = ?, triage_verdict = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(triage), triage.verdict, nowIso(), id);
    const label =
      triage.verdict === 'keep' ? 'Kept' : triage.verdict === 'discard' ? 'Discard' : 'Unsure';
    this.log(
      id,
      'triage',
      `Triage: ${label}${triage.reason ? ` — ${triage.reason}` : ''}`,
      triage.runId,
      triage.at,
    );
  }

  setScore(id: string, score: ScoreResult, report: string | null) {
    if (report) writeFileAtomic(join(this.reportDir, `${id}.md`), report);
    this.db
      .prepare(
        'UPDATE jobs SET score = ?, score_json = ?, has_report = ?, updated_at = ? WHERE id = ?',
      )
      .run(
        score.score,
        JSON.stringify(score),
        report ? 1 : this.hasReport(id) ? 1 : 0,
        nowIso(),
        id,
      );
    this.log(
      id,
      'score',
      `Scored ${score.score.toFixed(1)}${score.summary ? ` — ${score.summary}` : ''}`,
      score.runId,
      score.at,
    );
  }

  /** Record what reading the posting found. Fields left out keep their value. */
  setPosting(id: string, patch: Partial<Omit<PostingCheck, 'checkedAt'>>) {
    const cur = this.require(id).posting;
    const next: PostingCheck = {
      warnings: patch.warnings ?? cur?.warnings ?? [],
      deadline: patch.deadline !== undefined ? patch.deadline : (cur?.deadline ?? null),
      unreachable: patch.unreachable !== undefined ? patch.unreachable : (cur?.unreachable ?? null),
      checkedAt: nowIso(),
    };
    this.db
      .prepare('UPDATE jobs SET posting = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(next), nowIso(), id);
    if (patch.warnings?.length && !cur?.warnings.length)
      this.log(id, 'posting', `Posting check: ${patch.warnings[0]}`);
  }

  setApplication(id: string, application: Application) {
    this.db
      .prepare('UPDATE jobs SET application = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(application), nowIso(), id);
    this.log(id, 'application', 'CV and cover letter written', application.runId);
    this.changed([id]);
  }

  writeJd(id: string, text: string) {
    writeFileAtomic(join(this.jdDir, `${id}.md`), text);
    this.db.prepare('UPDATE jobs SET has_jd = 1 WHERE id = ?').run(id);
  }

  remove(id: string) {
    this.db.prepare('DELETE FROM jobs WHERE id = ?').run(id);
  }

  log(id: string, kind: string, text: string, runId: string | null = null, at = nowIso()) {
    this.db
      .prepare('INSERT INTO job_events (job_id, at, kind, text, run_id) VALUES (?, ?, ?, ?, ?)')
      .run(id, at, kind, text, runId);
  }

  changed(ids?: string[]) {
    this.events.emit('jobs.changed', { ids: ids && ids.length <= 200 ? ids : undefined });
  }

  private hasReport(id: string) {
    return existsSync(join(this.reportDir, `${id}.md`));
  }

  private toJob(r: Row): Job {
    const id = r.id as string;
    return {
      id,
      url: r.url as string,
      company: r.company as string,
      role: r.role as string,
      location: r.location as string,
      workModel: (r.work_model as string | null) ?? null,
      salary: (r.salary as string | null) ?? null,
      postedAt: (r.posted_at as string | null) ?? null,
      firstSeen: r.first_seen as string,
      sources: parseJson<JobSource[]>(r.sources as string, []),
      list: r.list as JobList,
      stage: (r.stage as Stage | null) ?? null,
      archiveReason: (r.archive_reason as ArchiveReason | null) ?? null,
      archiveDetail: (r.archive_detail as string | null) ?? null,
      movedBy: r.moved_by as Mover,
      movedAt: r.moved_at as string,
      prevList: (r.prev_list as JobList | null) ?? null,
      triage: parseJson<TriageResult | null>(r.triage as string | null, null),
      score: parseJson<ScoreResult | null>(r.score_json as string | null, null),
      addedBy: r.added_by as Job['addedBy'],
      hasJd: Boolean(r.has_jd),
      hasReport: Boolean(r.has_report),
      notes: r.notes as string,
      activity: this.activity.get(id) ?? null,
      posting: parseJson<PostingCheck | null>(r.posting as string | null, null),
      application: parseJson<Application | null>(r.application as string | null, null),
    };
  }
}
