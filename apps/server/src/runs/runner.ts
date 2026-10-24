import type { Run, RunKind, RunLane, Settings, StartRunRequest } from '@winnow/api';
import { RUN_LABELS } from '@winnow/api';
import type { CliAdapter } from '../adapters/types.ts';
import { effectiveSettings, getSettings, getSources, type ServerAi } from '../library.ts';
import type { Space } from '../space.ts';
import { badRequest, clip, conflict, nowIso } from '../util.ts';
import type { Slots } from './slots.ts';
import { ACTIVE, FIRST_KINDS, RunStore } from './store.ts';

/** What an executor gets: the run, the person's space, and ways to report progress. */
export interface RunCtx {
  run: Run;
  space: Space;
  runs: RunStore;
  signal: AbortSignal;
  settings: Settings;
  adapter: CliAdapter;
  skillsDir: string;
  progress(done: number, total: number, unit: string): void;
  step(text: string): void;
  log(kind: 'step' | 'tool' | 'text' | 'stderr' | 'info', text: string): void;
  checkpoint<T>(): T | null;
  saveCheckpoint(value: unknown): void;
  /** Queue a follow-up run (for example triage after a scan). */
  enqueue(req: StartRunRequest): Run[];
  /** Another slot in this run's lane, ahead of ordinary waiters; null if `signal` aborts first. */
  extraSlot(signal: AbortSignal): Promise<(() => void) | null>;
  setModel(model: string | null): void;
  addCost(usd: number | null): void;
}

export interface RunOutput {
  summary: string;
  result?: Record<string, unknown>;
}

export type Executor = (ctx: RunCtx) => Promise<RunOutput>;

export class Cancelled extends Error {
  constructor() {
    super('Cancelled');
  }
}

/** One person's runner. Scans and AI work queue in two lanes; the server-wide Slots cap how many run at once. */
export class Runner {
  readonly store: RunStore;
  private controllers = new Map<string, AbortController>();
  private wakes: Record<RunLane, () => void>;
  private closed = false;

  constructor(
    private space: Space,
    private slots: Slots,
    private executors: Record<RunKind, Executor>,
    private adapterFor: (settings: Settings) => CliAdapter,
    private skillsDir: string,
    /** The server's AI choice, which wins over the person's own. */
    private serverAi: () => ServerAi | null = () => null,
  ) {
    this.store = new RunStore(space.db, space.events);
    this.wakes = { scan: () => this.pump('scan'), ai: () => this.pump('ai') };
  }

  start() {
    for (const run of this.store.interruptStale()) this.clearActivity(run);
    this.syncActivity();
    this.pump('scan');
    this.pump('ai');
  }

  enqueue(req: StartRunRequest): Run[] {
    const jobs = this.space.jobs;
    const created: Run[] = [];
    if (req.kind === 'triage' || req.kind === 'score') {
      const ready = this.space.profile.ready();
      if (!ready.cv || !ready.profile)
        throw badRequest(
          `${RUN_LABELS[req.kind]} needs your CV and profile to judge jobs against. Finish setting up first.`,
        );
    }
    switch (req.kind) {
      case 'score': {
        const ids = req.jobIds ?? [];
        if (!ids.length) throw badRequest('Pick at least one job to score.');
        for (const id of ids) {
          const job = jobs.require(id);
          if (this.activeFor(id, 'score')) continue;
          created.push(
            this.store.create({
              kind: 'score',
              title: `Score · ${job.company && job.company !== '?' ? job.company : 'Job'}`,
              subtitle: clip(job.role, 80),
              jobIds: [id],
            }),
          );
        }
        break;
      }
      case 'triage': {
        let ids = req.jobIds ?? [];
        if (!ids.length && req.scope === 'untriaged')
          ids = jobs.ids("list = 'inbox' AND triage_verdict IS NULL");
        ids = ids.filter((id) => !this.activeFor(id, 'triage'));
        if (!ids.length)
          throw badRequest('Nothing to triage: every inbox job already has a verdict.');
        created.push(
          this.store.create({
            kind: 'triage',
            title: `Triage · ${ids.length} job${ids.length === 1 ? '' : 's'}`,
            jobIds: ids,
          }),
        );
        break;
      }
      case 'cv_import': {
        if (!req.upload || !/^[\w.-]+\.(pdf|txt)$/.test(req.upload))
          throw badRequest('Upload a PDF of your CV first.');
        created.push(
          this.store.create({
            kind: 'cv_import',
            title: RUN_LABELS.cv_import,
            subtitle: req.upload.endsWith('.txt') ? 'Pasted CV' : req.upload.replace(/^\d+-/, ''),
            params: { upload: req.upload },
          }),
        );
        break;
      }
      case 'setup_followup': {
        const answer = (req.answer ?? '').trim();
        if (!req.question || !answer) throw badRequest('There is no answer to follow up on.');
        created.push(
          this.store.create({
            kind: 'setup_followup',
            title: RUN_LABELS.setup_followup,
            params: { question: req.question, answer: req.answer },
          }),
        );
        break;
      }
      case 'capture': {
        for (const id of req.jobIds ?? []) {
          const job = jobs.require(id);
          created.push(
            this.store.create({
              kind: 'capture',
              title: `Read posting · ${job.company}`,
              subtitle: job.role,
              jobIds: [id],
            }),
          );
        }
        break;
      }
      default: {
        const busy = this.store.list({ active: true }).find((r) => r.kind === req.kind);
        if (busy)
          throw conflict(
            `${RUN_LABELS[req.kind]} is already ${busy.status === 'queued' ? 'waiting' : 'running'}.`,
          );
        if (req.kind === 'scan_ai' && !getSources(this.space.db).queries.some((q) => q.enabled))
          throw badRequest('Add an AI search query first (Find › AI search queries).');
        created.push(
          this.store.create({
            kind: req.kind,
            title: RUN_LABELS[req.kind],
            params: {
              autoTriage: req.options?.autoTriage ?? getSettings(this.space.db).autoTriage,
            },
          }),
        );
      }
    }
    for (const run of created) this.markActivity(run);
    if (created.length) this.space.jobs.changed(created.flatMap((r) => r.jobIds));
    this.pump('scan');
    this.pump('ai');
    return created;
  }

  cancel(id: string): Run {
    const run = this.store.require(id);
    if (run.status === 'queued' || run.status === 'interrupted') {
      const out = this.store.update(id, { status: 'cancelled', finishedAt: nowIso() });
      this.clearActivity(out);
      return out;
    }
    const controller = this.controllers.get(id);
    if (controller) controller.abort();
    else if (ACTIVE.includes(run.status)) {
      const out = this.store.update(id, { status: 'cancelled', finishedAt: nowIso() });
      this.clearActivity(out);
      return out;
    }
    return this.store.require(id);
  }

  /** Start the same work again as a new run. */
  retry(id: string): Run[] {
    const run = this.store.require(id);
    if (ACTIVE.includes(run.status)) throw conflict('That run is still going.');
    const params = this.store.params(id);
    if (run.kind === 'score' || run.kind === 'triage' || run.kind === 'capture')
      return this.enqueue({ kind: run.kind, jobIds: run.jobIds });
    if (run.kind === 'cv_import')
      return this.enqueue({ kind: run.kind, upload: String(params.upload ?? '') });
    if (run.kind === 'setup_followup')
      return this.enqueue({
        kind: run.kind,
        question: String(params.question ?? ''),
        answer: String(params.answer ?? ''),
      });
    return this.enqueue({ kind: run.kind, options: { autoTriage: params.autoTriage !== false } });
  }

  /** Put an interrupted run back in the queue; it picks up from its checkpoint. */
  resume(id: string): Run {
    const run = this.store.require(id);
    if (run.status !== 'interrupted' && run.status !== 'failed')
      throw conflict('Only interrupted or failed runs can resume.');
    const out = this.store.update(id, { status: 'queued', error: null, finishedAt: null });
    this.markActivity(out);
    this.pump(out.lane);
    return out;
  }

  dismiss(id: string): Run {
    return this.store.update(id, { reviewed: true });
  }

  close() {
    this.closed = true;
    for (const c of this.controllers.values()) c.abort();
  }

  private activeFor(jobId: string, kind: RunKind) {
    const a = this.space.jobs.activity.get(jobId);
    return a && a.kind === kind && (a.status === 'queued' || a.status === 'running');
  }

  private syncActivity() {
    for (const run of this.store.list({ active: true })) this.markActivity(run);
  }

  private markActivity(run: Run) {
    if (run.kind !== 'score' && run.kind !== 'triage' && run.kind !== 'capture') return;
    for (const id of run.jobIds)
      this.space.jobs.activity.set(id, { runId: run.id, kind: run.kind, status: run.status });
  }

  private clearActivity(run: Run) {
    for (const id of run.jobIds) {
      if (this.space.jobs.activity.get(id)?.runId === run.id) this.space.jobs.activity.delete(id);
    }
    if (run.jobIds.length) this.space.jobs.changed(run.jobIds);
  }

  private pump(lane: RunLane) {
    if (this.closed) return;
    for (;;) {
      const next = this.store.nextQueued(lane);
      if (!next) {
        this.slots.decline(lane, this.wakes[lane]);
        return;
      }
      const first = FIRST_KINDS.includes(next.kind);
      const release = this.slots.take(lane, this.wakes[lane], first);
      if (!release) {
        this.slots.wait(lane, this.wakes[lane], first);
        return;
      }
      void this.execute(next, release);
    }
  }

  private async execute(queued: Run, release: () => void) {
    const controller = new AbortController();
    this.controllers.set(queued.id, controller);
    const settings = effectiveSettings(this.space.db, this.serverAi());
    let run = this.store.update(queued.id, {
      status: 'running',
      startedAt: queued.startedAt ?? nowIso(),
      finishedAt: null,
      error: null,
      cli: settings.cli,
    });
    this.markActivity(run);
    if (run.jobIds.length) this.space.jobs.changed(run.jobIds);
    let cost: number | null = null;
    const ctx: RunCtx = {
      run,
      space: this.space,
      runs: this.store,
      signal: controller.signal,
      settings,
      adapter: this.adapterFor(settings),
      skillsDir: this.skillsDir,
      progress: (done, total, unit) => {
        this.store.update(run.id, { progress: { done, total, unit } });
      },
      step: (text) => {
        this.store.update(run.id, { step: clip(text, 160) });
        this.store.log(run.id, 'step', text);
      },
      log: (kind, text) => this.store.log(run.id, kind, text),
      checkpoint: <T>() => this.store.checkpoint<T>(run.id),
      saveCheckpoint: (value) => this.store.saveCheckpoint(run.id, value),
      enqueue: (req) => this.enqueue(req),
      extraSlot: (signal) => this.slots.extra(run.lane, signal),
      setModel: (model) => {
        this.store.update(run.id, { model });
      },
      addCost: (usd) => {
        if (usd == null) return;
        cost = (cost ?? 0) + usd;
        this.store.update(run.id, { costUsd: cost });
      },
    };
    try {
      const out = await this.executors[run.kind](ctx);
      if (controller.signal.aborted) throw new Cancelled();
      run = this.store.update(run.id, {
        status: 'succeeded',
        summary: out.summary,
        result: out.result ?? null,
        finishedAt: nowIso(),
        step: null,
      });
      this.store.log(run.id, 'info', `Done: ${out.summary}`);
    } catch (e) {
      const cancelled = controller.signal.aborted || e instanceof Cancelled;
      const message = cancelled ? 'Cancelled' : (e as Error).message || String(e);
      run = this.store.update(run.id, {
        status: cancelled ? 'cancelled' : 'failed',
        error: cancelled ? null : clip(message, 500),
        finishedAt: nowIso(),
        step: null,
      });
      this.store.log(run.id, cancelled ? 'info' : 'stderr', message);
      if (!cancelled)
        console.error(`[${this.space.userId}] ${run.kind} ${run.id} failed: ${message}`);
    } finally {
      this.controllers.delete(run.id);
      this.clearActivity(run);
      release();
      this.pump(run.lane);
    }
  }
}
