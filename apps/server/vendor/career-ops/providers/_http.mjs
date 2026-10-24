// HTTP transport helpers shared across providers.
// Files prefixed with _ are never loaded as providers by scan.mjs.

// Connection reuse (HTTP keep-alive).
//
// Node's global fetch opens a fresh TCP+TLS connection per request by default.
// A reverse ATS scan makes tens of thousands of requests to only FOUR hosts, so
// that is tens of thousands of redundant TLS handshakes — pure latency on work
// that is already latency-bound (lever answers a live board in 7-12s).
//
// Applied once, globally, because every provider goes through plain `fetch`;
// threading a dispatcher through 50+ call sites would be the same effect for
// far more churn.
//
// DYNAMIC import inside try/catch, deliberately. `undici` is not a declared
// dependency of this project — Node's fetch is built on a bundled copy that is
// NOT importable by that name — so a static `import ... from 'undici'` makes
// this module fail to load outright and takes every provider down with it.
// (Confirmed the hard way: ERR_MODULE_NOT_FOUND on first attempt.) Where the
// package does happen to be resolvable, connections get reused; where it does
// not, fetch behaves exactly as before.
try {
  const { Agent, setGlobalDispatcher } = await import('undici');
  setGlobalDispatcher(new Agent({
    keepAliveTimeout: 30_000,
    keepAliveMaxTimeout: 60_000,
    connections: 64,
    pipelining: 1,
  }));
} catch {
  // Not installed, or already configured — fetch still works, just without
  // connection reuse. Never worth failing a scan over.
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (compatible; career-ops/1.3)';

/**
 * Browser-like User-Agent for providers that must clear WAF/CDN bot
 * management blocking the default career-ops UA outright (seen live:
 * Glints' firewall, Geico's Cloudflare-gated Workday tenant). Shared so
 * every provider working around such a block bumps one constant instead
 * of drifting Chrome versions independently per file.
 */
export const BROWSER_LIKE_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function fetchWithTimeout(url, { timeoutMs = DEFAULT_TIMEOUT_MS, headers = {}, method = 'GET', body = null, redirect = 'follow' } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: { 'user-agent': DEFAULT_USER_AGENT, ...headers },
      body,
      redirect,
      signal: controller.signal,
    });
    if (!res.ok) {
      const responseText = await res.text().catch(() => '');
      // WAF/CDN challenge pages (seen live: Workday 429s) carry no actionable
      // text — HTML markup or a generic interstitial message, not worth
      // parsing or displaying. The status code and its standard reason
      // phrase are what a log line needs; the raw body is still attached as
      // err.body for callers that want to inspect it.
      const err = new Error(`HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`);
      err.status = res.status;
      err.body = responseText;
      err.retryAfter = res.headers.get('retry-after');
      throw err;
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson(url, opts = {}) {
  const res = await fetchWithTimeout(url, opts);
  return await res.json();
}

export async function fetchText(url, opts = {}) {
  const res = await fetchWithTimeout(url, opts);
  return await res.text();
}

export function makeHttpCtx() {
  return {
    transport: 'http',
    fetchJson,
    fetchText,
  };
}
