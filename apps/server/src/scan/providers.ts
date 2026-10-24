import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { SourceEntry } from '@winnow/api';
import type { Offer } from './intake.ts';

/** The career-ops provider plugins, vendored unchanged under `vendor/career-ops/providers`. */
export const PROVIDERS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../vendor/career-ops/providers',
);

export interface Provider {
  id: string;
  detect?(entry: SourceEntry): { url: string } | null;
  fetch(entry: SourceEntry, ctx: unknown): Promise<Offer[]>;
}

type Registry = {
  loadProviders(dir: string): Promise<Map<string, Provider>>;
  resolveProvider(
    entry: SourceEntry,
    providers: Map<string, Provider>,
    opts?: { skipIds?: string[] },
  ): { provider: Provider } | { error: string } | null;
};

let cache: Promise<{
  providers: Map<string, Provider>;
  registry: Registry;
  makeHttpCtx: () => unknown;
}> | null = null;

export function loadProviders() {
  cache ??= (async () => {
    const registry = (await import(
      pathToFileURL(join(PROVIDERS_DIR, '_registry.mjs')).href
    )) as Registry;
    const http = (await import(pathToFileURL(join(PROVIDERS_DIR, '_http.mjs')).href)) as {
      makeHttpCtx: () => unknown;
    };
    const providers = await registry.loadProviders(PROVIDERS_DIR);
    return { providers, registry, makeHttpCtx: http.makeHttpCtx };
  })();
  return cache;
}

/** Which provider reads an entry, or why none can. */
export async function resolveEntry(
  entry: SourceEntry,
): Promise<{ provider: Provider } | { error: string }> {
  const { providers, registry } = await loadProviders();
  const hit = registry.resolveProvider(entry, providers, { skipIds: ['local-parser'] });
  if (!hit)
    return { error: 'No scanner supports this careers page yet. AI search can still cover it.' };
  return hit;
}

/**
 * Whether an entry really works: a scanner reads it and its jobs load (none is fine). Catches dead
 * links and wrong slugs, which a pattern match alone lets through.
 */
export async function probeEntry(entry: SourceEntry, timeoutMs = 20_000): Promise<string | null> {
  const hit = await resolveEntry(entry);
  if ('error' in hit) return hit.error;
  const { makeHttpCtx } = await loadProviders();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      hit.provider.fetch(entry, makeHttpCtx()),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('timed out')), timeoutMs);
      }),
    ]);
    return null;
  } catch (e) {
    return `Its jobs didn’t load: ${(e as Error).message}`;
  } finally {
    clearTimeout(timer);
  }
}

/** Whether a web page answers (any status below 400, after redirects). */
export async function pageAnswers(url: string, timeoutMs = 12_000): Promise<boolean> {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': 'Mozilla/5.0 (Winnow job search; careers page check)' },
    });
    await res.body?.cancel();
    return res.status < 400;
  } catch {
    return false;
  }
}
