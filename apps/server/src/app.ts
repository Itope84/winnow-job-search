import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  AddJobRequest,
  ArchiveReason,
  JackApplyRequest,
  JackEditRequest,
  JobList,
  JobQuery,
  JobSort,
  MoveRequest,
  ProfileDoc,
  Settings,
  Sources,
  Stage,
  StartRunRequest,
  TriageVerdict,
} from '@winnow/api';
import {
  APPLICATION_FILES,
  type ApplicationFile,
  ARCHIVE_REASONS,
  JOB_SORTS,
  LISTS,
  RUN_KINDS,
  STAGES,
} from '@winnow/api';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { addJob } from './add-job.ts';
import { saveCvPdf, saveCvText } from './ai/cv-import.ts';
import type { JackLink } from './connect/jack.ts';
import { applyDraft, discardDraft, editDraft, overview } from './connect/jack-sync.ts';
import {
  effectiveSettings,
  getSettings,
  getSources,
  type ServerAi,
  setSettings,
  setSources,
} from './library.ts';
import type { Runner } from './runs/runner.ts';
import { resolveEntry } from './scan/providers.ts';
import {
  confirmProfile,
  finishSetup,
  getSetup,
  saveSetup,
  setupActive,
  startSetup,
  updateSetup,
} from './setup.ts';
import type { Space } from './space.ts';
import { badRequest, HttpError, notFound, nowIso } from './util.ts';

const forbidden = (message: string) => new HttpError(403, 'forbidden', message);

export interface SpaceEnv {
  Variables: {
    space: Space;
    runner: Runner;
    user: { id: string; email: string; admin: boolean };
  };
}

const num = (v: string | undefined) => {
  if (v == null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/** Start Read CV, and remember the run while setup is open so its screens can follow it. */
function readCv(space: Space, runner: Runner, upload: string) {
  const runs = runner.enqueue({ kind: 'cv_import', upload });
  if (setupActive(space) && runs[0])
    saveSetup(space, { runs: { ...getSetup(space).runs, cv: runs[0].id } });
  return runs;
}

/** Draft profile or Suggest sources: one at a time; asking again while one runs returns that one. */
function startSetupRun(space: Space, runner: Runner, kind: 'profile_draft' | 'sources_suggest') {
  const state = getSetup(space);
  if (state.status === 'done') throw badRequest('Setup is finished. Use You › Set up again.');
  const slot = kind === 'profile_draft' ? 'draft' : 'sources';
  const busy = runner.store.list({ active: true }).find((r) => r.kind === kind);
  const run = busy ?? runner.enqueue({ kind })[0];
  return Response.json(
    saveSetup(space, {
      runs: { ...state.runs, [slot]: run?.id ?? null },
      ...(busy ? {} : slot === 'draft' ? { draft: null } : { suggestions: null }),
    }),
  );
}

/** The routes one signed-in person uses. `server.ts` resolves who they are and sets `space` and `runner`. */
export function spaceRoutes(
  ai: { get: () => ServerAi | null; set: (next: ServerAi) => void },
  jack: JackLink,
) {
  const app = new Hono<SpaceEnv>();

  // ── Jobs ──────────────────────────────────────────────────────────────────
  app.get('/jobs', (c) => {
    const q = c.req.query();
    const list = (q.list ?? 'inbox') as JobList;
    if (!LISTS.includes(list)) throw badRequest('Unknown list.');
    const query: JobQuery = {
      list,
      q: q.q,
      triage: (q.triage as TriageVerdict | 'none' | undefined) || undefined,
      source: q.source || undefined,
      withinDays: num(q.within),
      minScore: num(q.minScore),
      reason: ARCHIVE_REASONS.includes(q.reason as ArchiveReason)
        ? (q.reason as ArchiveReason)
        : undefined,
      stage: STAGES.includes(q.stage as Stage) ? (q.stage as Stage) : undefined,
      sort: JOB_SORTS.includes(q.sort as JobSort) ? (q.sort as JobSort) : undefined,
      cursor: q.cursor || undefined,
      limit: num(q.limit),
    };
    return c.json(c.var.space.jobs.query(query));
  });

  app.get('/jobs/counts', (c) => c.json(c.var.space.jobs.counts()));

  /** Distinct sources in a list, for the filter sheet. */
  app.get('/jobs/sources', (c) => {
    const rows = c.var.space.db
      .prepare(
        `SELECT DISTINCT json_extract(value, '$.source') AS s FROM jobs, json_each(jobs.sources) ORDER BY s`,
      )
      .all() as { s: string }[];
    return c.json(rows.map((r) => r.s).filter(Boolean));
  });

  app.get('/jobs/:id', (c) => c.json(c.var.space.jobs.detail(c.req.param('id'))));

  /** The tailored CV and letter: PDFs open in the browser, LaTeX sources download. */
  app.get('/jobs/:id/application/:file', (c) => {
    const jobs = c.var.space.jobs;
    const job = jobs.require(c.req.param('id'));
    const file = c.req.param('file') as ApplicationFile;
    const path = join(jobs.applicationDir, job.id, file);
    if (!APPLICATION_FILES.includes(file) || !job.application || !existsSync(path))
      throw notFound('That file');
    const name = `${file.startsWith('cv') ? 'CV' : 'Cover letter'} - ${job.company}`
      .replace(/[^\w .,&()-]+/g, '')
      .trim();
    const pdf = file.endsWith('.pdf');
    return c.body(readFileSync(path), 200, {
      'content-type': pdf ? 'application/pdf' : 'application/x-tex; charset=utf-8',
      'content-disposition': `${pdf ? 'inline' : 'attachment'}; filename="${name}.${pdf ? 'pdf' : 'tex'}"`,
      'cache-control': 'no-store',
    });
  });

  app.patch('/jobs/:id', async (c) => {
    const body = (await c.req.json()) as { notes?: string; stage?: Stage };
    const id = c.req.param('id');
    if (typeof body.notes === 'string') c.var.space.jobs.setNotes(id, body.notes.slice(0, 20_000));
    if (body.stage) {
      if (!STAGES.includes(body.stage)) throw badRequest('Unknown stage.');
      c.var.space.jobs.setStage(id, body.stage);
    }
    return c.json(c.var.space.jobs.require(id));
  });

  app.post('/jobs/move', async (c) => {
    const body = (await c.req.json()) as MoveRequest;
    if (!Array.isArray(body.ids) || !body.ids.length) throw badRequest('Pick at least one job.');
    if (body.reason && !ARCHIVE_REASONS.includes(body.reason)) throw badRequest('Unknown reason.');
    return c.json(c.var.space.jobs.move(body, 'you'));
  });

  // Clear whole lists so a new scan can find their jobs again. Not while a run might be using them.
  app.post('/jobs/reset', async (c) => {
    const { lists } = (await c.req.json()) as { lists?: unknown };
    if (!Array.isArray(lists) || !lists.length || lists.some((l) => !LISTS.includes(l)))
      throw badRequest('Pick at least one list.');
    if (c.var.runner.store.list({ active: true }).length)
      throw badRequest('Wait for the runs going now to finish, then reset.');
    const removed = c.var.space.jobs.reset([...new Set(lists as JobList[])]);
    return c.json({ removed, counts: c.var.space.jobs.counts() });
  });

  // Every job triage kept moves from Inbox to Shortlist; returns them for Undo.
  app.post('/jobs/shortlist-kept', (c) => {
    const ids = c.var.space.jobs.keptInInbox();
    if (!ids.length) throw badRequest('Triage hasn’t kept any Inbox jobs.');
    return c.json(c.var.space.jobs.move({ ids, to: 'shortlist' }, 'you'));
  });

  app.post('/jobs/restore', async (c) => {
    const body = (await c.req.json()) as { ids: string[] };
    if (!Array.isArray(body.ids) || !body.ids.length) throw badRequest('Pick at least one job.');
    return c.json(c.var.space.jobs.restore(body.ids));
  });

  app.post('/jobs/add', async (c) => {
    const body = (await c.req.json()) as AddJobRequest;
    return c.json(await addJob(c.var.space, c.var.runner, body));
  });

  // ── Runs ──────────────────────────────────────────────────────────────────
  app.get('/runs', (c) => {
    const store = c.var.runner.store;
    return c.json(
      c.req.query('active')
        ? store.list({ active: true })
        : store.list({ limit: num(c.req.query('limit')) ?? 100 }),
    );
  });

  app.post('/runs', async (c) => {
    const body = (await c.req.json()) as StartRunRequest;
    if (!RUN_KINDS.includes(body.kind)) throw badRequest('Unknown run kind.');
    return c.json(c.var.runner.enqueue(body));
  });

  app.get('/runs/:id', (c) => {
    const store = c.var.runner.store;
    const run = store.require(c.req.param('id'));
    return c.json({ run, log: store.logLines(run.id, num(c.req.query('after')) ?? 0) });
  });

  app.post('/runs/:id/cancel', (c) => c.json(c.var.runner.cancel(c.req.param('id'))));
  app.post('/runs/:id/retry', (c) => c.json(c.var.runner.retry(c.req.param('id'))));
  app.post('/runs/:id/resume', (c) => c.json(c.var.runner.resume(c.req.param('id'))));
  app.post('/runs/:id/dismiss', (c) => c.json(c.var.runner.dismiss(c.req.param('id'))));

  /** The latest triage run with archived jobs the person hasn't reviewed yet. */
  app.get('/triage/review', (c) => {
    const run = c.var.runner.store
      .list({ limit: 50 })
      .find((r) => r.kind === 'triage' && r.status === 'succeeded' && !r.reviewed);
    if (!run) return c.json(null);
    const archived = c.var.space.jobs
      .ids(
        "list = 'archive' AND archive_reason = 'triage' AND triage LIKE ?",
        `%"runId":"${run.id}"%`,
      )
      .map((id) => c.var.space.jobs.require(id));
    return c.json({ run, archived });
  });

  // ── Sources ───────────────────────────────────────────────────────────────
  app.get('/sources', (c) => c.json(getSources(c.var.space.db)));

  app.put('/sources', async (c) => {
    const body = (await c.req.json()) as Sources;
    if (
      !body ||
      !Array.isArray(body.companies) ||
      !Array.isArray(body.boards) ||
      !Array.isArray(body.queries) ||
      !body.rules
    )
      throw badRequest('Sources need companies, boards, queries and rules.');
    setSources(c.var.space.db, body, c.var.space.events);
    return c.json(getSources(c.var.space.db));
  });

  /** Which scanner reads a company, if any. */
  app.post('/sources/check', async (c) => {
    const body = (await c.req.json()) as { name?: string; careers_url?: string; api?: string };
    if (!body.careers_url && !body.api) throw badRequest('Give a careers page link.');
    const hit = await resolveEntry({
      name: body.name || 'Company',
      careers_url: body.careers_url,
      api: body.api,
    });
    return c.json(
      'error' in hit ? { ok: false, message: hit.error } : { ok: true, provider: hit.provider.id },
    );
  });

  /** Scan history counts per source for the Find page. */
  app.get('/scans', (c) => {
    const runs = c.var.runner.store
      .list({ limit: 200 })
      .filter((r) => ['scan_portals', 'scan_ats', 'scan_ai', 'scan_jack'].includes(r.kind));
    return c.json(runs.slice(0, 30));
  });

  // ── Profile and settings ──────────────────────────────────────────────────
  app.get('/profile', (c) =>
    c.json({ ...c.var.space.profile.get(), ready: c.var.space.profile.ready() }),
  );

  app.put('/profile', async (c) => {
    const body = (await c.req.json()) as Partial<ProfileDoc>;
    try {
      c.var.space.profile.set(body);
    } catch (e) {
      throw badRequest((e as Error).message);
    }
    return c.json({ ...c.var.space.profile.get(), ready: c.var.space.profile.ready() });
  });

  // One line for "Not on your CV", added from a gap on a job.
  app.post('/profile/extras', async (c) => {
    const { text } = (await c.req.json()) as { text?: unknown };
    if (typeof text !== 'string' || text.length > 1000) throw badRequest('Send one line of text.');
    try {
      c.var.space.profile.addExtra(text);
    } catch (e) {
      throw badRequest((e as Error).message);
    }
    return c.json({ ...c.var.space.profile.get(), ready: c.var.space.profile.ready() });
  });

  // A CV as a PDF: kept, its text checked here, then a Read CV run turns it into the Markdown CV.
  app.post('/profile/cv/pdf', async (c) => {
    const name = decodeURIComponent(c.req.header('x-file-name') ?? 'cv.pdf');
    const body = new Uint8Array(await c.req.arrayBuffer());
    const upload = await saveCvPdf(c.var.space.library, body, name);
    return c.json(readCv(c.var.space, c.var.runner, upload));
  });

  // A pasted CV goes through the same tidy-up as a PDF.
  app.post('/profile/cv/text', async (c) => {
    const body = (await c.req.json()) as { text?: string };
    const upload = saveCvText(c.var.space.library, String(body.text ?? ''));
    return c.json(readCv(c.var.space, c.var.runner, upload));
  });

  // ── Setup ─────────────────────────────────────────────────────────────────
  app.get('/setup', (c) => c.json(getSetup(c.var.space)));

  app.post('/setup/start', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { redo?: boolean };
    return c.json(startSetup(c.var.space, body.redo === true));
  });

  app.put('/setup', async (c) => {
    const body = (await c.req.json()) as Record<string, unknown>;
    return c.json(updateSetup(c.var.space, body));
  });

  // One follow-up on a "get to know you" answer, asked in the background while they carry on.
  app.post('/setup/followup', async (c) => {
    const body = (await c.req.json()) as { question?: string };
    const state = getSetup(c.var.space);
    const answer = state.answers.find((a) => a.key === body.question);
    if (!answer?.answer.trim()) return c.json(state);
    // Already asked, or being asked. A run that failed can be tried again.
    const prev = answer.followUpRun ? c.var.runner.store.get(answer.followUpRun) : null;
    if (prev && !['failed', 'cancelled', 'interrupted'].includes(prev.status)) return c.json(state);
    const [run] = c.var.runner.enqueue({
      kind: 'setup_followup',
      question: answer.key,
      answer: answer.answer,
    });
    const answers = state.answers.map((a) =>
      a.key === answer.key ? { ...a, followUp: null, followUpRun: run?.id ?? null } : a,
    );
    return c.json(saveSetup(c.var.space, { answers }));
  });

  app.post('/setup/draft', (c) => startSetupRun(c.var.space, c.var.runner, 'profile_draft'));
  app.post('/setup/sources', (c) => startSetupRun(c.var.space, c.var.runner, 'sources_suggest'));

  // Review confirmed: write profile.yml and the narrative.
  app.post('/setup/confirm', async (c) =>
    c.json(confirmProfile(c.var.space, await c.req.json(), c.var.user.email)),
  );

  // The last step: add the ticked sources, and start the first scan.
  app.post('/setup/finish', async (c) => {
    const body = (await c.req.json()) as { scan?: boolean };
    const setup = finishSetup(c.var.space, body);
    let runs: unknown[] = [];
    const sources = getSources(c.var.space.db);
    if (body.scan && (sources.companies.length || sources.boards.length))
      try {
        runs = c.var.runner.enqueue({ kind: 'scan_portals', options: { autoTriage: true } });
      } catch {
        // A Portals scan is already going; its triage picks up the new profile.
      }
    return c.json({ setup, runs });
  });

  app.get('/settings', (c) =>
    c.json({ ...effectiveSettings(c.var.space.db, ai.get()), aiEditable: c.var.user.admin }),
  );

  app.patch('/settings', async (c) => {
    const body = (await c.req.json()) as Partial<Settings>;
    // The AI command line and models are the server's: only an admin sets them, for everyone.
    if (body.cli || body.models) {
      if (!c.var.user.admin) throw forbidden('Only an admin can change the AI models.');
      const cur = effectiveSettings(c.var.space.db, ai.get());
      ai.set({
        cli: body.cli && ['opencode', 'claude', 'replay'].includes(body.cli) ? body.cli : cur.cli,
        models: { ...cur.models, ...(body.models ?? {}) },
      });
    }
    const patch: Partial<Settings> = {};
    if (typeof body.autoTriage === 'boolean') patch.autoTriage = body.autoTriage;
    if (typeof body.jackAuto === 'boolean') patch.jackAuto = body.jackAuto;
    if (Number.isInteger(body.aiConcurrency))
      patch.aiConcurrency = Math.min(Math.max(body.aiConcurrency as number, 1), 8);
    if (body.bands) patch.bands = { ...getSettings(c.var.space.db).bands, ...body.bands };
    if (body.weights && typeof body.weights === 'object') patch.weights = body.weights;
    setSettings(c.var.space.db, patch);
    return c.json({ ...effectiveSettings(c.var.space.db, ai.get()), aiEditable: c.var.user.admin });
  });

  // ── Connections ───────────────────────────────────────────────────────────
  // Jack only redirects to a loopback address, so the person pastes that address back here.
  app.get('/connections/jack', (c) => c.json(jack.status(c.var.space.db)));
  app.post('/connections/jack/start', async (c) => c.json(await jack.start(c.var.space.db)));
  app.post('/connections/jack/finish', async (c) => {
    const body = (await c.req.json()) as { url?: string };
    return c.json(await jack.finish(c.var.space.db, String(body.url ?? '')));
  });
  app.delete('/connections/jack', async (c) => {
    await jack.disconnect(c.var.space.db);
    discardDraft(c.var.space.db);
    return c.json(jack.status(c.var.space.db));
  });

  // What Jack has, and changes drafted from Winnow's profile for the person to send.
  app.get('/connections/jack/overview', async (c) => c.json(await overview(jack, c.var.space.db)));
  app.post('/connections/jack/draft', (c) => {
    const busy = c.var.runner.store.list({ active: true }).find((r) => r.kind === 'jack_update');
    return c.json(busy ? [busy] : c.var.runner.enqueue({ kind: 'jack_update' }));
  });
  app.put('/connections/jack/draft', async (c) => {
    editDraft(c.var.space.db, (await c.req.json()) as JackEditRequest);
    return c.json(await overview(jack, c.var.space.db));
  });
  app.delete('/connections/jack/draft', async (c) => {
    discardDraft(c.var.space.db);
    return c.json(await overview(jack, c.var.space.db));
  });
  app.post('/connections/jack/apply', async (c) => {
    const body = (await c.req.json()) as JackApplyRequest;
    return c.json(await applyDraft(jack, c.var.space.db, body));
  });

  // ── Live events ───────────────────────────────────────────────────────────
  app.get('/events', (c) => {
    const bus = c.var.space.events;
    return streamSSE(c, async (stream) => {
      const queue: unknown[] = [];
      let wake: (() => void) | null = null;
      let open = true;
      const unsubscribe = bus.subscribe((e) => {
        queue.push(e);
        wake?.();
      });
      stream.onAbort(() => {
        open = false;
        unsubscribe();
        wake?.();
      });
      await stream.write('retry: 3000\n\n');
      await stream.writeSSE({
        event: 'hello',
        data: JSON.stringify({ at: nowIso(), id: bus.latestId() }),
      });
      while (open) {
        if (!queue.length) {
          await new Promise<void>((resolve) => {
            wake = resolve;
            setTimeout(resolve, 25_000);
          });
          wake = null;
          if (!queue.length && open) await stream.write(': ping\n\n');
          continue;
        }
        const e = queue.shift() as { id: number; type: string };
        await stream.writeSSE({ id: String(e.id), event: e.type, data: JSON.stringify(e) });
      }
    });
  });

  return app;
}
