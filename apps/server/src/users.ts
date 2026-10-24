import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { promisify } from 'node:util';
import { HttpError, nowIso } from './util.ts';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const SESSION_DAYS = 90;
const INVITE_DAYS = 14;

export interface UserRow {
  id: string;
  email: string;
  name: string;
  admin: boolean;
  disabled: boolean;
  hasPassword: boolean;
  created: string;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 32, SCRYPT);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, saltB64, keyB64] = stored.split('$');
  if (algo !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scryptAsync(password, Buffer.from(saltB64, 'base64'), expected.length, SCRYPT);
  return key.length === expected.length && timingSafeEqual(key, expected);
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export function validPassword(password: string): string | null {
  if (password.length < 10) return 'Use at least 10 characters.';
  if (password.length > 200) return 'That password is too long.';
  return null;
}

/** The server-wide users table, sessions and invites (`_winnow/server.db`). */
export class Users {
  readonly db: DatabaseSync;
  private failures = new Map<string, { count: number; until: number }>();

  constructor(stateDir: string | ':memory:') {
    this.db = new DatabaseSync(stateDir === ':memory:' ? ':memory:' : join(stateDir, 'server.db'));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 3000;
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        name TEXT NOT NULL,
        password TEXT,
        admin INTEGER NOT NULL DEFAULT 0,
        disabled INTEGER NOT NULL DEFAULT 0,
        created TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created TEXT NOT NULL,
        expires TEXT NOT NULL,
        last_seen TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS server_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS invites (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created TEXT NOT NULL,
        expires TEXT NOT NULL,
        used TEXT
      );
    `);
  }

  /** A server-wide setting (JSON), or null when never set. */
  serverSetting<T>(key: string): T | null {
    const row = this.db.prepare('SELECT value FROM server_settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row ? (JSON.parse(row.value) as T) : null;
  }

  setServerSetting(key: string, value: unknown) {
    this.db
      .prepare(
        'INSERT INTO server_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      )
      .run(key, JSON.stringify(value));
  }

  list(): UserRow[] {
    const rows = this.db.prepare('SELECT * FROM users ORDER BY created').all() as Record<
      string,
      unknown
    >[];
    return rows.map(toUser);
  }

  get(id: string): UserRow | null {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? toUser(row) : null;
  }

  byEmail(email: string): UserRow | null {
    const row = this.db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim()) as
      | Record<string, unknown>
      | undefined;
    return row ? toUser(row) : null;
  }

  add(input: { id: string; email: string; name: string; admin?: boolean }): UserRow {
    if (!/^[a-z0-9][a-z0-9-]{1,31}$/.test(input.id))
      throw new HttpError(
        400,
        'bad_id',
        'Use 2–32 lower-case letters, digits or dashes for the id.',
      );
    if (!/^[^\s@]+@[^\s@]+$/.test(input.email))
      throw new HttpError(400, 'bad_email', 'That email address looks wrong.');
    if (this.get(input.id)) throw new HttpError(409, 'exists', `User ${input.id} already exists.`);
    if (this.byEmail(input.email))
      throw new HttpError(409, 'exists', `${input.email} already has an account.`);
    this.db
      .prepare('INSERT INTO users (id, email, name, admin, created) VALUES (?, ?, ?, ?, ?)')
      .run(
        input.id,
        input.email.trim(),
        input.name.trim() || input.id,
        input.admin ? 1 : 0,
        nowIso(),
      );
    return this.get(input.id) as UserRow;
  }

  async setPassword(id: string, password: string) {
    const problem = validPassword(password);
    if (problem) throw new HttpError(400, 'weak_password', problem);
    this.db
      .prepare('UPDATE users SET password = ? WHERE id = ?')
      .run(await hashPassword(password), id);
    // Changing a password signs out every other session.
    this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  }

  setEmail(id: string, email: string) {
    if (!/^[^\s@]+@[^\s@]+$/.test(email))
      throw new HttpError(400, 'bad_email', 'That email address looks wrong.');
    const other = this.byEmail(email);
    if (other && other.id !== id)
      throw new HttpError(409, 'exists', `${email} already has an account.`);
    this.db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email.trim(), id);
  }

  setDisabled(id: string, disabled: boolean) {
    this.db.prepare('UPDATE users SET disabled = ? WHERE id = ?').run(disabled ? 1 : 0, id);
    if (disabled) this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  }

  /** A one-time link token that lets the person set their password. */
  invite(id: string): string {
    const token = randomBytes(24).toString('base64url');
    const expires = new Date(Date.now() + INVITE_DAYS * 86_400_000).toISOString();
    this.db
      .prepare('INSERT INTO invites (token_hash, user_id, created, expires) VALUES (?, ?, ?, ?)')
      .run(hashToken(token), id, nowIso(), expires);
    return token;
  }

  inviteUser(token: string): UserRow | null {
    const row = this.db
      .prepare('SELECT user_id, expires, used FROM invites WHERE token_hash = ?')
      .get(hashToken(token)) as
      | { user_id: string; expires: string; used: string | null }
      | undefined;
    if (!row || row.used || row.expires < nowIso()) return null;
    const user = this.get(row.user_id);
    return user && !user.disabled ? user : null;
  }

  async acceptInvite(token: string, password: string): Promise<UserRow> {
    const user = this.inviteUser(token);
    if (!user) throw new HttpError(400, 'bad_invite', 'This invite link has expired or was used.');
    await this.setPassword(user.id, password);
    this.db
      .prepare('UPDATE invites SET used = ? WHERE token_hash = ?')
      .run(nowIso(), hashToken(token));
    return user;
  }

  /** Sign in with a username (the user id) or an email, either case. */
  async login(identifier: string, password: string): Promise<{ user: UserRow; token: string }> {
    const key = identifier.trim().toLowerCase();
    const fail = this.failures.get(key);
    if (fail && fail.until > Date.now())
      throw new HttpError(429, 'too_many', 'Too many attempts. Try again in a few minutes.');
    const row = this.db
      .prepare(
        key.includes('@')
          ? 'SELECT * FROM users WHERE email = ?'
          : 'SELECT * FROM users WHERE lower(id) = ?',
      )
      .get(key) as Record<string, unknown> | undefined;
    const ok =
      row && !row.disabled && typeof row.password === 'string'
        ? await verifyPassword(password, row.password)
        : false;
    if (!ok || !row) {
      const count = (fail?.count ?? 0) + 1;
      this.failures.set(key, { count, until: count >= 5 ? Date.now() + 5 * 60_000 : 0 });
      throw new HttpError(401, 'bad_login', 'That username or email and password don’t match.');
    }
    this.failures.delete(key);
    const token = randomBytes(32).toString('base64url');
    const now = nowIso();
    const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();
    this.db
      .prepare(
        'INSERT INTO sessions (token_hash, user_id, created, expires, last_seen) VALUES (?, ?, ?, ?, ?)',
      )
      .run(hashToken(token), row.id as string, now, expires, now);
    return { user: toUser(row), token };
  }

  /** The signed-in user for a session token, extending the session as it is used. */
  session(token: string | undefined): UserRow | null {
    if (!token) return null;
    const hash = hashToken(token);
    const row = this.db
      .prepare('SELECT user_id, expires, last_seen FROM sessions WHERE token_hash = ?')
      .get(hash) as { user_id: string; expires: string; last_seen: string } | undefined;
    if (!row || row.expires < nowIso()) return null;
    const user = this.get(row.user_id);
    if (!user || user.disabled) return null;
    if (Date.now() - Date.parse(row.last_seen) > 3_600_000) {
      const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();
      this.db
        .prepare('UPDATE sessions SET last_seen = ?, expires = ? WHERE token_hash = ?')
        .run(nowIso(), expires, hash);
    }
    return user;
  }

  /** Delete an account with its sessions and invites. Their library is the caller's to move. */
  remove(id: string) {
    this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    this.db.prepare('DELETE FROM invites WHERE user_id = ?').run(id);
    this.db.prepare('DELETE FROM users WHERE id = ?').run(id);
  }

  logout(token: string | undefined) {
    if (token) this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
  }

  close() {
    this.db.close();
  }
}

function toUser(row: Record<string, unknown>): UserRow {
  return {
    id: row.id as string,
    email: row.email as string,
    name: row.name as string,
    admin: Boolean(row.admin),
    disabled: Boolean(row.disabled),
    hasPassword: typeof row.password === 'string' && row.password.length > 0,
    created: row.created as string,
  };
}
