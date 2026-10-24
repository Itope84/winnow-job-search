import { createHash, randomBytes } from 'node:crypto';
import { renameSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export class HttpError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 503,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new HttpError(404, 'not_found', `${what} not found.`);
export const badRequest = (message: string) => new HttpError(400, 'bad_request', message);
export const conflict = (message: string) => new HttpError(409, 'conflict', message);

export const nowIso = () => new Date().toISOString();
export const today = () => nowIso().slice(0, 10);

/** Sortable unique id: time prefix plus randomness. */
export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${randomBytes(5).toString('hex')}`;
}

export const sha1 = (text: string) => createHash('sha1').update(text).digest('hex');

/** Resolve `rel` under `root`, refusing anything that escapes it. */
export function safeJoin(root: string, rel: string): string {
  const full = resolve(root, rel);
  const back = relative(resolve(root), full);
  if (back === '..' || back.startsWith(`..${sep}`) || isAbsolute(back)) throw notFound('File');
  return full;
}

export function writeFileAtomic(path: string, text: string) {
  const tmp = `${path}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

export function writeJsonAtomic(path: string, value: unknown) {
  writeFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

/** Parse JSON stored in a TEXT column, falling back when it is empty or broken. */
export function parseJson<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

/**
 * The canonical form of a posting URL, used to merge duplicates: lower-case host, no tracking parameters,
 * no trailing slash, no fragment. Greenhouse's `gh_jid` stays because it identifies the job.
 */
export function canonicalUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    u.hash = '';
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|ref$|refid$|trk|src$|source$|gh_src$|lever-|fbclid|gclid|mc_)/i.test(key))
        u.searchParams.delete(key);
    }
    let s = u.toString();
    if (s.endsWith('/')) s = s.slice(0, -1);
    return s;
  } catch {
    return raw.trim();
  }
}

/** Company + role key for merging the same job seen under two links. */
export function fingerprint(company: string, role: string, location = ''): string {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/\(.*?\)/g, ' ')
      .replace(/\b(inc|ltd|llc|limited|plc|gmbh|the|uk|us)\b/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  return `${norm(company)}|${norm(role)}|${norm(location).split(' ').slice(0, 2).join(' ')}`;
}

export function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
