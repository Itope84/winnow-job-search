import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { kvGet, openDb } from '../db.ts';
import { JACK, JackLink, parsePasted } from './jack.ts';

/** A stand-in for Jack's OAuth and MCP endpoints. */
function fakeJack() {
  const calls: { url: string; body: string }[] = [];
  let issued = 0;
  let expiresIn = 3600;
  const http = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? String(init.body) : '';
    calls.push({ url, body });
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    if (url.endsWith('/jack/oauth/register')) return json({ client_id: 'jjkc_test' }, 201);
    if (url.endsWith('/jack/oauth/token')) {
      const form = new URLSearchParams(body);
      if (form.get('grant_type') === 'authorization_code' && form.get('code') !== 'good-code')
        return json({ error: 'invalid_grant' }, 400);
      issued++;
      return json({
        access_token: `access-${issued}`,
        refresh_token: `refresh-${issued}`,
        expires_in: expiresIn,
      });
    }
    if (url.endsWith('/jack/oauth/revoke')) return json({});
    if (url === JACK.mcp) {
      const auth = new Headers(init?.headers).get('authorization');
      const req = JSON.parse(body) as { id: number; params: { name: string } };
      if (req.params.name === 'refused') return json({ error: 'invalid_token' }, 401);
      const text = `${req.params.name} with ${auth}`;
      return new Response(
        `event: message\ndata: ${JSON.stringify({
          jsonrpc: '2.0',
          id: req.id,
          result: { content: [{ type: 'text', text }], isError: req.params.name === 'broken' },
        })}\n\n`,
        { headers: { 'content-type': 'text/event-stream' } },
      );
    }
    return json({ error: 'not_found' }, 404);
  }) as typeof fetch;
  return {
    http,
    calls,
    setExpiresIn: (s: number) => {
      expiresIn = s;
    },
  };
}

function setup() {
  const stateDir = mkdtempSync(join(tmpdir(), 'winnow-jack-'));
  const jack = fakeJack();
  const link = new JackLink(stateDir, jack.http);
  const db = openDb(stateDir, ':memory:');
  return { stateDir, jack, link, db };
}

const pastedFor = (url: string, code = 'good-code') => {
  const state = new URL(url).searchParams.get('state');
  return `${JACK.redirect}?code=${code}&state=${state}`;
};

describe('Connect Jack', () => {
  it('reads the pasted address in its usual shapes', () => {
    expect(parsePasted(' http://127.0.0.1:8899/jack/callback?code=abc&state=xyz ')).toEqual({
      code: 'abc',
      state: 'xyz',
      error: undefined,
      errorDescription: undefined,
    });
    expect(parsePasted('code=abc&state=xyz').code).toBe('abc');
    expect(parsePasted('abc123').code).toBe('abc123');
    expect(parsePasted('?error=access_denied').error).toBe('access_denied');
    expect(parsePasted('some words here')).toEqual({});
  });

  it('registers once, signs in with the pasted address, and keeps the tokens encrypted', async () => {
    const { stateDir, jack, link, db } = setup();
    const start = await link.start(db);
    const url = new URL(start.url);
    expect(url.searchParams.get('redirect_uri')).toBe(JACK.redirect);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('resource')).toBe(JACK.mcp);
    await link.start(db);
    expect(jack.calls.filter((c) => c.url.endsWith('/register'))).toHaveLength(1);
    expect(JSON.parse(readFileSync(join(stateDir, 'jack-client.json'), 'utf8')).client_id).toBe(
      'jjkc_test',
    );

    // The second start replaced the first, so only its address works.
    await expect(link.finish(db, pastedFor(start.url))).rejects.toThrow(/different sign-in/);
    const again = await link.start(db);
    const status = await link.finish(db, pastedFor(again.url));
    expect(status).toMatchObject({ connected: true, problem: null });

    const token = jack.calls.find((c) => c.url.endsWith('/token'));
    const form = new URLSearchParams(token?.body);
    expect(form.get('code_verifier')).toBeTruthy();
    expect(form.get('redirect_uri')).toBe(JACK.redirect);
    // No token in the clear in the database.
    const stored = JSON.stringify(kvGet(db, 'jack_link', null));
    expect(stored).not.toContain('access-1');
    expect(stored).not.toContain('refresh-1');
  });

  it('explains a bad paste, an expired code and a denied approval', async () => {
    const { link, db } = setup();
    await expect(link.finish(db, 'x')).rejects.toThrow(/expired/);
    const start = await link.start(db);
    await expect(link.finish(db, 'hello there')).rejects.toThrow(/127\.0\.0\.1/);
    await expect(link.finish(db, `${JACK.redirect}?error=access_denied`)).rejects.toThrow(
      /didn’t approve/,
    );
    await expect(link.finish(db, pastedFor(start.url, 'stale'))).rejects.toThrow(/expired or was/);
    expect(link.status(db).connected).toBe(false);
  });

  it('calls tools, refreshes a token about to run out, and disconnects', async () => {
    const { jack, link, db } = setup();
    jack.setExpiresIn(30);
    const start = await link.start(db);
    await link.finish(db, pastedFor(start.url));
    const result = await link.call(db, 'get_account_status');
    // The first token had 30 seconds left, so the call used a refreshed one.
    expect(result.content?.[0]?.text).toBe('get_account_status with Bearer access-2');
    const refresh = jack.calls.filter((c) => c.url.endsWith('/token')).at(-1);
    expect(new URLSearchParams(refresh?.body).get('refresh_token')).toBe('refresh-1');

    await link.disconnect(db);
    expect(link.status(db).connected).toBe(false);
    const revoke = jack.calls.find((c) => c.url.endsWith('/revoke'));
    expect(new URLSearchParams(revoke?.body).get('token')).toBe('refresh-2');
    await expect(link.call(db, 'get_profile')).rejects.toThrow(/Connect your Jack account/);
  });

  it('asks to reconnect only when Jack refuses the sign-in', async () => {
    const { link, db } = setup();
    const start = await link.start(db);
    await link.finish(db, pastedFor(start.url));
    // A tool failing (a missing argument, say) says nothing about the connection.
    await expect(link.call(db, 'broken')).rejects.toThrow(/broken/);
    expect(link.status(db).problem).toBeNull();
    await expect(link.call(db, 'refused')).rejects.toThrow(/Connect again/);
    expect(link.status(db).problem).toMatch(/Connect again/);
    // A call that works again clears it.
    await link.call(db, 'get_profile');
    expect(link.status(db).problem).toBeNull();
  });

  it('keeps the server key between restarts', async () => {
    const { stateDir, jack, db } = setup();
    const first = new JackLink(stateDir, jack.http);
    const start = await first.start(db);
    await first.finish(db, pastedFor(start.url));
    const key = readFileSync(join(stateDir, 'secret.key'), 'utf8');
    const second = new JackLink(stateDir, jack.http);
    expect((await second.call(db, 'get_profile')).content?.[0]?.text).toContain('access-1');
    expect(readFileSync(join(stateDir, 'secret.key'), 'utf8')).toBe(key);
  });
});
