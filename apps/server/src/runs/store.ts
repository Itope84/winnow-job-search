import type { Run, RunKind, RunLane, RunLogLine, RunProgress, RunStatus } from '@winnow/api';
import type { Db } from '../db.ts';
import type { EventBus } from '../events.ts';
import { newId, notFound, nowIso, parseJson } from '../util.ts';

type Row = Record<string, unknown>;

export const LANE_FOR: Record<RunKind, RunLane> = {
  scan_portals: 'scan',
  scan_ats: 'scan',
  scan_ai: 'ai',
  triage: 'ai',
  score: 'ai',
  capture: 'scan',
  cv_import: 'ai',
  profile_prefill: 'ai',
  setup_followup: 'ai',
  profile_draft: 'ai',
  sources_suggest: 'ai',
  scan_jack: 'scan',
  jack_update: 'ai',
};

/** Runs that jump the queue: triage, and setup's runs, which someone is waiting on screen for. */
export const FIRST_KINDS: RunKind[] = [
  'triage',
  'cv_import',
  'profile_prefill',
  'setup_followup',
  'profile_draft',
  'sources_suggest',
  'jack_update',
];

export const ACTIVE: RunStatus[] = ['queued', 'running', 'needs_input'];

/** Runs live in the database, so their state survives the app closing and the server restarting. */
export class RunStore {
  private lastEmit = new Map<string, number>();

  constructor(
    private db: Db,
    private events: EventBus,
  ) {}

  create(input: {
    kind: RunKind;
    title: string;
    subtitle?: string | null;
    jobIds?: string[];
    params?: Record<string, unknown>;
  }): Run {
    const id = newId('run');
    this.db
      .prepare(
        `INSERT INTO runs (id, kind, lane, status, title, subtitle, job_ids, params, created)
         VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.kind,
        LANE_FOR[input.kind],
        input.title,
        input.subtitle ?? null,
        JSON.stringify(input.jobIds ?? []),
        JSON.stringify(input.params ?? {}),
        nowIso(),
      );
    const run = this.require(id);
    this.emit(run, true);
    return run;
  }

  get(id: string): Run | null {
    const row = this.db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as Row | undefined;
    return row ? toRun(row) : null;
  }

  require(id: string): Run {
    const run = this.get(id);
    if (!run) throw notFound('Run');
    return run;
  }

  params(id: string): Record<string, unknown> {
    const row = this.db.prepare('SELECT params FROM runs WHERE id = ?').get(id) as Row | undefined;
    return parseJson(row?.params as string, {});
  }

  checkpoint<T>(id: string): T | null {
    const row = this.db.prepare('SELECT checkpoint FROM runs WHERE id = ?').get(id) as
      | Row
      | undefined;
    return parseJson<T | null>(row?.checkpoint as string | null, null);
  }

  saveCheckpoint(id: string, value: unknown) {
    this.db.prepare('UPDATE runs SET checkpoint = ? WHERE id = ?').run(JSON.stringify(value), id);
  }

  list(opts: { active?: boolean; limit?: number } = {}): Run[] {
    const rows = opts.active
      ? (this.db
          .prepare(
            `SELECT * FROM runs WHERE status IN ('queued','running','needs_input') ORDER BY created`,
          )
          .all() as Row[])
      : (this.db
          .prepare('SELECT * FROM runs ORDER BY created DESC LIMIT ?')
          .all(opts.limit ?? 100) as Row[]);
    return rows.map(toRun);
  }

  /** The next queued run in a lane: triage first, then the oldest. */
  nextQueued(lane: RunLane): Run | null {
    const row = this.db
      .prepare(
        `SELECT * FROM runs WHERE status = 'queued' AND lane = ? ORDER BY kind IN (${FIRST_KINDS.map((k) => `'${k}'`).join(', ')}) DESC, created LIMIT 1`,
      )
      .get(lane) as Row | undefined;
    return row ? toRun(row) : null;
  }

  update(
    id: string,
    patch: Partial<{
      status: RunStatus;
      step: string | null;
      progress: RunProgress | null;
      startedAt: string | null;
      finishedAt: string | null;
      error: string | null;
      summary: string | null;
      result: Record<string, unknown> | null;
      costUsd: number | null;
      model: string | null;
      cli: string | null;
      sessionId: string | null;
      reviewed: boolean;
      jobIds: string[];
    }>,
  ): Run {
    const cols: Record<string, unknown> = {
      status: patch.status,
      step: patch.step,
      progress:
        patch.progress === undefined
          ? undefined
          : patch.progress
            ? JSON.stringify(patch.progress)
            : null,
      started: patch.startedAt,
      finished: patch.finishedAt,
      error: patch.error,
      summary: patch.summary,
      result:
        patch.result === undefined ? undefined : patch.result ? JSON.stringify(patch.result) : null,
      cost_usd: patch.costUsd,
      model: patch.model,
      cli: patch.cli,
      session_id: patch.sessionId,
      reviewed: patch.reviewed === undefined ? undefined : patch.reviewed ? 1 : 0,
      job_ids: patch.jobIds === undefined ? undefined : JSON.stringify(patch.jobIds),
    };
    const set = Object.entries(cols).filter(([, v]) => v !== undefined);
    if (set.length) {
      this.db
        .prepare(`UPDATE runs SET ${set.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`)
        .run(...(set.map(([, v]) => v) as (string | number | null)[]), id);
    }
    const run = this.require(id);
    // Progress ticks are throttled; status changes always go out.
    this.emit(
      run,
      patch.status !== undefined || patch.summary !== undefined || patch.error !== undefined,
    );
    return run;
  }

  log(id: string, kind: RunLogLine['kind'], text: string) {
    const row = this.db
      .prepare('SELECT MAX(seq) AS s FROM run_log WHERE run_id = ?')
      .get(id) as Row;
    this.db
      .prepare('INSERT INTO run_log (run_id, seq, at, kind, text) VALUES (?, ?, ?, ?, ?)')
      .run(id, Number(row.s ?? 0) + 1, nowIso(), kind, text.slice(0, 4000));
  }

  logLines(id: string, after = 0): RunLogLine[] {
    return (
      this.db
        .prepare(
          'SELECT seq, at, kind, text FROM run_log WHERE run_id = ? AND seq > ? ORDER BY seq LIMIT 2000',
        )
        .all(id, after) as Row[]
    ).map((r) => ({
      seq: Number(r.seq),
      at: r.at as string,
      kind: r.kind as RunLogLine['kind'],
      text: r.text as string,
    }));
  }

  /** Runs that were going when the server stopped: mark them interrupted so the person can resume. */
  interruptStale(): Run[] {
    const stale = this.db
      .prepare(`SELECT id FROM runs WHERE status IN ('running','needs_input')`)
      .all() as Row[];
    return stale.map((r) =>
      this.update(r.id as string, {
        status: 'interrupted',
        error: 'The server restarted while this was running. Progress so far is kept.',
        finishedAt: nowIso(),
      }),
    );
  }

  private emit(run: Run, force: boolean) {
    const now = Date.now();
    if (!force && now - (this.lastEmit.get(run.id) ?? 0) < 800) return;
    this.lastEmit.set(run.id, now);
    this.events.emit('run.changed', { run });
  }
}

function toRun(r: Row): Run {
  return {
    id: r.id as string,
    kind: r.kind as RunKind,
    lane: r.lane as RunLane,
    status: r.status as RunStatus,
    title: r.title as string,
    subtitle: (r.subtitle as string | null) ?? null,
    jobIds: parseJson<string[]>(r.job_ids as string, []),
    progress: parseJson<RunProgress | null>(r.progress as string | null, null),
    step: (r.step as string | null) ?? null,
    createdAt: r.created as string,
    startedAt: (r.started as string | null) ?? null,
    finishedAt: (r.finished as string | null) ?? null,
    error: (r.error as string | null) ?? null,
    summary: (r.summary as string | null) ?? null,
    result: parseJson<Record<string, unknown> | null>(r.result as string | null, null),
    costUsd: (r.cost_usd as number | null) ?? null,
    model: (r.model as string | null) ?? null,
    cli: (r.cli as string | null) ?? null,
    reviewed: Boolean(r.reviewed),
  };
}
