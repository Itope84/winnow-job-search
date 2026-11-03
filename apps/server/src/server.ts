import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import type { Health, Me, RunKind, Settings } from '@winnow/api';
import { type Context, Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { claudeAdapter } from './adapters/claude.ts';
import { opencodeAdapter } from './adapters/opencode.ts';
import { replayAdapter } from './adapters/replay.ts';
import type { CliAdapter } from './adapters/types.ts';
import { cvImport } from './ai/cv-import.ts';
import { findPortalRun } from './ai/find-portal.ts';
import { installSkills } from './ai/run-skill.ts';
import { score } from './ai/score.ts';
import { aiSearch } from './ai/search.ts';
import { profileDraft, profilePrefill, setupFollowup, sourcesSuggest } from './ai/setup-runs.ts';
import { tailor } from './ai/tailor.ts';
import { triage } from './ai/triage.ts';
import { type SpaceEnv, spaceRoutes } from './app.ts';
import { type ServerConfig, VERSION } from './config.ts';
import { JackLink } from './connect/jack.ts';
import { jackAutoTick } from './connect/jack-auto.ts';
import { jackScan } from './connect/jack-scan.ts';
import { jackDraft } from './connect/jack-sync.ts';
import { openDb } from './db.ts';
import { getSettings, type ServerAi } from './library.ts';
import { type Executor, Runner } from './runs/runner.ts';
import { Slots } from './runs/slots.ts';
import { atsScanner } from './scan/ats.ts';
import { captureMany, closeBrowser } from './scan/capture.ts';
import { openFeeds } from './scan/feeds.ts';
import { scanPortals } from './scan/portals.ts';
import { getSetup } from './setup.ts';
import { openSpace, type Space } from './space.ts';
import { type UserRow, Users } from './users.ts';
import { HttpError } from './util.ts';

const COOKIE = 'winnow_session';

export interface Shared {
  config: ServerConfig;
  users: Users;
  slots: Slots;
}

/** The server: sign-in, one space and runner per person, the API under /api, and the web app. */
export function createServer(config: ServerConfig) {
  const users = new Users(config.stateDir);
  openFeeds(config.stateDir, join(config.stateDir, 'ats-companies'));
  const slots = new Slots({ scan: config.maxRuns.scan, ai: config.maxRuns.ai });
  const spaces = new Map<string, { space: Space; runner: Runner }>();
  const jack = new JackLink(config.stateDir);

  const adapters = {
    opencode: opencodeAdapter(),
    claude: claudeAdapter(),
    replay: config.replayDir ? replayAdapter(config.replayDir) : null,
  };
  const adapterFor = (settings: Settings): CliAdapter => {
    if (adapters.replay) return adapters.replay;
    return settings.cli === 'claude' ? adapters.claude : adapters.opencode;
  };

  const executors: Record<RunKind, Executor> = {
    scan_portals: scanPortals,
    scan_ats: atsScanner(join(config.stateDir, 'ats-companies')),
    scan_ai: aiSearch,
    triage,
    score,
    cv_import: cvImport,
    profile_prefill: profilePrefill,
    setup_followup: setupFollowup,
    profile_draft: profileDraft,
    sources_suggest: sourcesSuggest,
    scan_jack: jackScan(jack),
    jack_update: jackDraft(jack),
    tailor,
    find_portal: findPortalRun,
    capture: async (ctx) => {
      await captureMany(ctx, ctx.run.jobIds);
      const read = ctx.run.jobIds.filter((id) => ctx.space.jobs.get(id)?.hasJd).length;
      return { summary: `Read ${read} of ${ctx.run.jobIds.length}` };
    },
  };

  // One AI choice for the whole server. Seeded once from the first admin's own settings.
  const serverAi = () => users.serverSetting<ServerAi>('ai');
  if (!serverAi()) {
    const admin = users.list().find((u) => u.admin && !u.disabled);
    if (admin) {
      const db = openDb(join(config.usersDir, admin.id));
      const own = getSettings(db);
      db.close();
      users.setServerSetting('ai', { cli: own.cli, models: own.models });
    }
  }

  function spaceFor(userId: string) {
    let entry = spaces.get(userId);
    if (!entry) {
      const space = openSpace(config.usersDir, userId);
      installSkills(config.skillsDir, space.library);
      const runner = new Runner(space, slots, executors, adapterFor, config.skillsDir, serverAi);
      runner.start();
      entry = { space, runner };
      spaces.set(userId, entry);
    }
    return entry;
  }

  // Start every person's runner so queued and interrupted runs show up straight away.
  for (const u of users.list()) if (!u.disabled) spaceFor(u.id);

  // Checking Jack for people who turned it on. Each person's own schedule lives in their database.
  const jackTimer = setInterval(() => {
    for (const u of users.list()) {
      if (u.disabled) continue;
      const { space, runner } = spaceFor(u.id);
      void jackAutoTick(space, runner, jack);
    }
  }, 60_000);
  jackTimer.unref();

  const api = new Hono<SpaceEnv & { Variables: { user: UserRow } }>();

  api.onError((err, c) => {
    if (err instanceof HttpError)
      return c.json({ error: err.code, message: err.message }, err.status);
    const status = (err as { status?: number }).status;
    if (status === 400) return c.json({ error: 'bad_request', message: err.message }, 400);
    if (err instanceof SyntaxError)
      return c.json({ error: 'bad_json', message: 'The request body was not valid JSON.' }, 400);
    console.error(err);
    return c.json({ error: 'server_error', message: 'Something went wrong on the server.' }, 500);
  });

  api.get('/health', async (c) => {
    const adapter = adapters.replay ?? adapters.opencode;
    const det = await adapter.detect();
    const body: Health = {
      ok: true,
      name: 'winnow',
      version: VERSION,
      cli: { id: adapter.id, ...det },
    };
    return c.json(body);
  });

  // Secure cookies when the request reached the tunnel over HTTPS; plain ones on localhost and the LAN.
  const cookieOpts = (c: Context) => ({
    httpOnly: true,
    sameSite: 'Lax' as const,
    secure: config.secureCookies || c.req.header('x-forwarded-proto') === 'https',
    path: '/',
    maxAge: 90 * 86_400,
  });

  api.post('/auth/login', async (c) => {
    const body = (await c.req.json()) as { username?: string; email?: string; password?: string };
    const who = body.username ?? body.email;
    if (!who || !body.password)
      throw new HttpError(400, 'bad_request', 'Enter your username or email, and your password.');
    const { user, token } = await users.login(who, body.password);
    setCookie(c, COOKIE, token, cookieOpts(c));
    return c.json(toMe(user, spaceFor(user.id).space));
  });

  api.post('/auth/logout', (c) => {
    users.logout(getCookie(c, COOKIE));
    deleteCookie(c, COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  api.get('/auth/invite', (c) => {
    const user = users.inviteUser(c.req.query('token') ?? '');
    if (!user)
      throw new HttpError(404, 'bad_invite', 'This invite link has expired or was already used.');
    return c.json({ username: user.id, email: user.email, name: user.name });
  });

  api.post('/auth/accept', async (c) => {
    const body = (await c.req.json()) as { token?: string; password?: string };
    const user = await users.acceptInvite(body.token ?? '', body.password ?? '');
    const { token } = await users.login(user.id, body.password ?? '');
    setCookie(c, COOKIE, token, cookieOpts(c));
    return c.json(toMe(user, spaceFor(user.id).space));
  });

  // Everything below needs a signed-in person.
  api.use('*', async (c, next) => {
    const user = users.session(getCookie(c, COOKIE));
    if (!user) throw new HttpError(401, 'signed_out', 'Sign in to continue.');
    // Writes must come from the app (a header other sites can't send without asking first).
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && c.req.header('x-winnow') !== '1')
      throw new HttpError(403, 'forbidden', 'Missing app header.');
    const { space, runner } = spaceFor(user.id);
    c.set('user', user);
    c.set('space', space);
    c.set('runner', runner);
    await next();
  });

  api.get('/me', (c) => c.json(toMe(c.var.user, c.var.space)));

  api.post('/me/password', async (c) => {
    const body = (await c.req.json()) as { current?: string; password?: string };
    await users.login(c.var.user.id, body.current ?? '');
    await users.setPassword(c.var.user.id, body.password ?? '');
    const { token } = await users.login(c.var.user.id, body.password ?? '');
    setCookie(c, COOKIE, token, cookieOpts(c));
    return c.json({ ok: true });
  });

  api.get('/admin/users', (c) => {
    if (!c.var.user.admin) throw new HttpError(403, 'forbidden', 'Only admins can see people.');
    return c.json(users.list());
  });

  api.post('/admin/users', async (c) => {
    if (!c.var.user.admin) throw new HttpError(403, 'forbidden', 'Only admins can invite people.');
    const body = (await c.req.json()) as { id?: string; email?: string; name?: string };
    const user = users.add({ id: body.id ?? '', email: body.email ?? '', name: body.name ?? '' });
    spaceFor(user.id);
    return c.json({ user, invite: users.invite(user.id) });
  });

  api.post('/admin/users/:id/invite', (c) => {
    if (!c.var.user.admin) throw new HttpError(403, 'forbidden', 'Only admins can reset sign-ins.');
    const id = c.req.param('id');
    if (!users.get(id)) throw new HttpError(404, 'not_found', 'No such person.');
    return c.json({ invite: users.invite(id) });
  });

  api.route(
    '/',
    spaceRoutes(
      { get: serverAi, set: (next) => users.setServerSetting('ai', next) },
      jack,
      join(config.stateDir, 'ats-companies'),
    ),
  );

  // ── One origin: the API under /api and the web app everywhere else ─────────
  const app = new Hono();
  app.route('/api', api);
  app.all('/api/*', (c) => c.json({ error: 'not_found', message: 'No such endpoint.' }, 404));
  const index = join(config.webDir, 'index.html');
  if (existsSync(index)) {
    app.use('*', async (c, next) => {
      await next();
      if (c.req.path === '/sw.js' || c.res.headers.get('Content-Type')?.includes('text/html'))
        c.res.headers.set('Cache-Control', 'no-cache');
    });
    app.use('*', serveStatic({ root: config.webDir }));
    app.get('*', (c) => c.html(readFileSync(index, 'utf8')));
  } else {
    app.get('*', (c) =>
      c.text(
        'Winnow API is running. Build the app with `pnpm build:web` to serve it from here.',
        200,
      ),
    );
  }

  return {
    app,
    users,
    slots,
    async close() {
      clearInterval(jackTimer);
      for (const { runner, space } of spaces.values()) {
        runner.close();
        space.db.close();
      }
      users.close();
      await closeBrowser();
    },
  };
}

function toMe(u: UserRow, space: Space): Me {
  // Setting up again keeps today's profile working, so the app doesn't treat it as unfinished.
  const s = getSetup(space);
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    admin: u.admin,
    setup: s.redo ? 'done' : s.status,
  };
}
