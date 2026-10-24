import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { JackConnection, JackStart } from '@winnow/api';
import { type Db, kvGet, kvSet } from '../db.ts';
import { badRequest, HttpError, nowIso } from '../util.ts';

/**
 * Linking a person's Jack (Jack & Jill) account over OAuth, and calling Jack's MCP tools for them.
 *
 * Jack only accepts loopback redirects, and Winnow runs on another device than the person's browser. So
 * the redirect page fails to load on their device, they paste its address into Winnow, and the server
 * (which holds the PKCE verifier) swaps the code for tokens. The redirect string only has to match the
 * one registered; nothing needs to listen on it.
 */
export const JACK = {
  base: 'https://platform.jackandjill.ai',
  mcp: 'https://platform.jackandjill.ai/mcp/jack/v1/',
  redirect: 'http://127.0.0.1:8899/jack/callback',
  scope: 'jack',
};

/** How long a started sign-in waits for its pasted address. */
const PENDING_MS = 30 * 60_000;

interface Pending {
  state: string;
  verifier: string;
  expiresAt: string;
}

interface Tokens {
  access: string;
  refresh: string | null;
  /** Epoch ms. */
  expires: number;
}

interface Stored {
  tokens: string;
  connectedAt: string;
  problem: string | null;
}

const KV_PENDING = 'jack_pending';
const KV_LINK = 'jack_link';

type Fetch = typeof fetch;

export class JackLink {
  private key: Buffer;
  private clientFile: string;

  constructor(
    stateDir: string,
    private http: Fetch = fetch,
  ) {
    // The tokens are encrypted with a server key kept beside server.db, so a copied person's folder
    // (a backup, a moved account) carries no usable Jack access.
    const keyFile = join(stateDir, 'secret.key');
    if (!existsSync(keyFile))
      writeFileSync(keyFile, randomBytes(32).toString('base64'), { mode: 0o600 });
    this.key = Buffer.from(readFileSync(keyFile, 'utf8').trim(), 'base64');
    this.clientFile = join(stateDir, 'jack-client.json');
  }

  /** Winnow's OAuth client at Jack, registered once (dynamic client registration). */
  private async clientId(): Promise<string> {
    if (existsSync(this.clientFile))
      return (JSON.parse(readFileSync(this.clientFile, 'utf8')) as { client_id: string }).client_id;
    const res = await this.http(`${JACK.base}/jack/oauth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Winnow',
        client_uri: 'https://winnow.fitnerapp.com',
        redirect_uris: [JACK.redirect],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        scope: JACK.scope,
      }),
    });
    const body = (await res.json()) as { client_id?: string; error_description?: string };
    if (!res.ok || !body.client_id)
      throw new HttpError(
        503,
        'jack_unavailable',
        `Jack refused Winnow: ${body.error_description ?? res.status}`,
      );
    writeFileSync(this.clientFile, JSON.stringify(body, null, 2));
    return body.client_id;
  }

  status(db: Db): JackConnection {
    const link = kvGet<Stored | null>(db, KV_LINK, null);
    return {
      connected: !!link,
      connectedAt: link?.connectedAt ?? null,
      problem: link?.problem ?? null,
    };
  }

  /** A fresh sign-in link. Starting again replaces an earlier, unfinished one. */
  async start(db: Db): Promise<JackStart> {
    const b64 = (b: Buffer) => b.toString('base64url');
    const pending: Pending = {
      state: b64(randomBytes(16)),
      verifier: b64(randomBytes(32)),
      expiresAt: new Date(Date.now() + PENDING_MS).toISOString(),
    };
    const url = new URL(`${JACK.base}/jack/oauth/authorize`);
    for (const [k, v] of Object.entries({
      response_type: 'code',
      client_id: await this.clientId(),
      redirect_uri: JACK.redirect,
      scope: JACK.scope,
      state: pending.state,
      code_challenge: b64(createHash('sha256').update(pending.verifier).digest()),
      code_challenge_method: 'S256',
      resource: JACK.mcp,
    }))
      url.searchParams.set(k, v);
    kvSet(db, KV_PENDING, pending);
    return { url: url.toString(), expiresAt: pending.expiresAt };
  }

  /** Finish with the address the person pasted from the failed redirect page. */
  async finish(db: Db, pasted: string): Promise<JackConnection> {
    const pending = kvGet<Pending | null>(db, KV_PENDING, null);
    if (!pending || pending.expiresAt < nowIso())
      throw badRequest('That sign-in has expired. Tap Connect to start again.');
    const params = parsePasted(pasted);
    if (params.error)
      throw badRequest(
        params.error === 'access_denied'
          ? 'Jack says you didn’t approve Winnow. Tap Connect to try again.'
          : `Jack said: ${params.errorDescription ?? params.error}`,
      );
    if (!params.code)
      throw badRequest(
        'That doesn’t look like the address from the error page. It starts with http://127.0.0.1 and has code= in it.',
      );
    if (params.state && params.state !== pending.state)
      throw badRequest(
        'That address is from a different sign-in. Paste the one from this sign-in.',
      );
    const tokens = await this.token({
      grant_type: 'authorization_code',
      code: params.code,
      redirect_uri: JACK.redirect,
      code_verifier: pending.verifier,
    });
    db.prepare('DELETE FROM kv WHERE key = ?').run(KV_PENDING);
    kvSet(db, KV_LINK, { tokens: this.seal(tokens), connectedAt: nowIso(), problem: null });
    return this.status(db);
  }

  async disconnect(db: Db) {
    const link = kvGet<Stored | null>(db, KV_LINK, null);
    db.prepare('DELETE FROM kv WHERE key IN (?, ?)').run(KV_LINK, KV_PENDING);
    if (!link) return;
    // Revoke on Jack's side too. Forgetting the tokens here already ends Winnow's access.
    try {
      const t = this.open(link.tokens);
      await this.http(`${JACK.base}/jack/oauth/revoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          token: t.refresh ?? t.access,
          client_id: await this.clientId(),
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      // Jack being unreachable doesn't keep anyone connected.
    }
  }

  /** Call one of Jack's MCP tools for this person. Returns the tool's result. */
  async call(db: Db, tool: string, args: Record<string, unknown> = {}): Promise<McpToolResult> {
    const token = await this.accessToken(db);
    try {
      const result = await mcpCall(this.http, token, tool, args);
      if (this.status(db).problem) this.markProblem(db, null);
      return result;
    } catch (e) {
      // Only a refused sign-in needs the person to reconnect. A tool error or Jack being down doesn't.
      if (e instanceof HttpError && e.code === 'jack_signed_out') this.markProblem(db, e.message);
      throw e;
    }
  }

  async tools(db: Db): Promise<unknown> {
    return mcpRequest(this.http, await this.accessToken(db), 'tools/list', {});
  }

  private async accessToken(db: Db): Promise<string> {
    const link = kvGet<Stored | null>(db, KV_LINK, null);
    if (!link) throw badRequest('Connect your Jack account first.');
    const t = this.open(link.tokens);
    if (t.expires - Date.now() > 60_000) return t.access;
    if (!t.refresh) {
      this.markProblem(db, 'Jack’s sign-in ran out. Connect again.');
      throw badRequest('Jack’s sign-in ran out. Connect again.');
    }
    try {
      const next = await this.token({ grant_type: 'refresh_token', refresh_token: t.refresh });
      // Some servers rotate refresh tokens, others keep the old one.
      const merged = { ...next, refresh: next.refresh ?? t.refresh };
      kvSet(db, KV_LINK, { ...link, tokens: this.seal(merged), problem: null });
      return merged.access;
    } catch (e) {
      // Jack refused the refresh token. A network failure leaves the link as it is.
      if (e instanceof HttpError)
        this.markProblem(db, 'Jack no longer accepts Winnow’s access. Connect again.');
      throw e;
    }
  }

  private async token(form: Record<string, string>): Promise<Tokens> {
    const res = await this.http(`${JACK.base}/jack/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...form, client_id: await this.clientId(), resource: JACK.mcp }),
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };
    if (!res.ok || !body.access_token) {
      const why = body.error_description ?? body.error ?? `HTTP ${res.status}`;
      throw badRequest(
        body.error === 'invalid_grant'
          ? 'That address has expired or was already used. Tap Connect to start again.'
          : `Jack refused the sign-in: ${why}`,
      );
    }
    return {
      access: body.access_token,
      refresh: body.refresh_token ?? null,
      expires: Date.now() + (body.expires_in ?? 3600) * 1000,
    };
  }

  private markProblem(db: Db, problem: string | null) {
    const link = kvGet<Stored | null>(db, KV_LINK, null);
    if (link) kvSet(db, KV_LINK, { ...link, problem });
  }

  private seal(t: Tokens): string {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([c.update(JSON.stringify(t), 'utf8'), c.final()]);
    return [iv, c.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
  }

  private open(sealed: string): Tokens {
    const [iv, tag, data] = sealed.split('.').map((s) => Buffer.from(s, 'base64'));
    const d = createDecipheriv('aes-256-gcm', this.key, iv as Buffer);
    d.setAuthTag(tag as Buffer);
    return JSON.parse(
      Buffer.concat([d.update(data as Buffer), d.final()]).toString('utf8'),
    ) as Tokens;
  }
}

/** The pasted text: the whole redirect address, or just its query, or a bare code. */
export function parsePasted(text: string): {
  code?: string;
  state?: string;
  error?: string;
  errorDescription?: string;
} {
  const s = text.trim();
  const query = s.includes('?') ? s.slice(s.indexOf('?') + 1) : s.includes('=') ? s : '';
  if (!query) return s && !/\s/.test(s) ? { code: s } : {};
  const p = new URLSearchParams(query.split('#')[0]);
  return {
    code: p.get('code') ?? undefined,
    state: p.get('state') ?? undefined,
    error: p.get('error') ?? undefined,
    errorDescription: p.get('error_description') ?? undefined,
  };
}

// ── MCP over streamable HTTP (Jack's server is stateless: one request per call) ─────────────

export interface McpToolResult {
  content?: { type: string; text?: string }[];
  structuredContent?: unknown;
  isError?: boolean;
}

/** A tool result's data: its structured content, or its text parsed as JSON. */
export function structured(result: McpToolResult): Record<string, unknown> {
  if (result.structuredContent && typeof result.structuredContent === 'object')
    return result.structuredContent as Record<string, unknown>;
  try {
    const parsed = JSON.parse(result.content?.map((c) => c.text ?? '').join('') ?? '');
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function mcpRequest(
  http: Fetch,
  token: string,
  method: string,
  params: unknown,
): Promise<unknown> {
  const res = await http(JACK.mcp, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-06-18',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  if (res.status === 401)
    throw new HttpError(
      409,
      'jack_signed_out',
      'Jack no longer accepts Winnow’s access. Connect again.',
    );
  // A streamed answer: the JSON-RPC response is the last data line.
  const data = text.includes('data:')
    ? (text
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim())
        .pop() ?? '')
    : text;
  let body: { result?: unknown; error?: { message?: string } };
  try {
    body = JSON.parse(data);
  } catch {
    throw new HttpError(503, 'jack_unavailable', `Jack answered with HTTP ${res.status}.`);
  }
  if (body.error) throw new HttpError(503, 'jack_error', `Jack: ${body.error.message ?? 'error'}`);
  return body.result;
}

async function mcpCall(http: Fetch, token: string, tool: string, args: Record<string, unknown>) {
  const result = (await mcpRequest(http, token, 'tools/call', {
    name: tool,
    arguments: args,
  })) as McpToolResult;
  if (result?.isError)
    throw new HttpError(
      503,
      'jack_error',
      `Jack: ${result.content?.map((c) => c.text).join(' ') || `${tool} failed`}`,
    );
  return result;
}
