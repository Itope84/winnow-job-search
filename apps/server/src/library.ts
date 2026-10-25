import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProfileDoc, Rules, Settings, Sources } from '@winnow/api';
import { DEFAULT_BANDS } from '@winnow/api';
import { parse as parseYaml } from 'yaml';
import { type Db, kvGet, kvSet } from './db.ts';
import type { EventBus } from './events.ts';
import { writeFileAtomic } from './util.ts';

export const EMPTY_RULES: Rules = {
  title: { positive: [], negative: [] },
  location: { alwaysAllow: [], allow: [], block: [] },
  salary: { min: 0, max: 0, currency: '' },
  maxAgeDays: null,
};

export const EMPTY_SOURCES: Sources = {
  companies: [],
  boards: [],
  queries: [],
  rules: EMPTY_RULES,
};

export const DEFAULT_SETTINGS: Settings = {
  cli: 'opencode',
  models: { default: null, scan: null, triage: null, score: null },
  aiConcurrency: 3,
  autoTriage: true,
  jackAuto: false,
  bands: DEFAULT_BANDS,
  weights: {},
};

/** Paths inside one person's library folder. */
export function libraryPaths(library: string) {
  const profileDir = join(library, 'profile');
  return {
    root: library,
    profileDir,
    cv: join(profileDir, 'cv.md'),
    narrative: join(profileDir, 'narrative.md'),
    profileYaml: join(profileDir, 'profile.yml'),
    runsDir: join(library, 'runs'),
  };
}

export function ensureLibrary(library: string) {
  const p = libraryPaths(library);
  for (const dir of [p.root, p.profileDir, p.runsDir]) mkdirSync(dir, { recursive: true });
  return p;
}

const read = (file: string) => (existsSync(file) ? readFileSync(file, 'utf8') : '');

/** CV, narrative and profile.yml live as files so skills can read them directly. */
export class Profile {
  private p: ReturnType<typeof libraryPaths>;

  constructor(
    library: string,
    private events?: EventBus,
  ) {
    this.p = ensureLibrary(library);
  }

  get(): ProfileDoc {
    return {
      cv: read(this.p.cv),
      narrative: read(this.p.narrative),
      profileYaml: read(this.p.profileYaml),
    };
  }

  set(doc: Partial<ProfileDoc>) {
    if (doc.profileYaml !== undefined) {
      try {
        parseYaml(doc.profileYaml);
      } catch (e) {
        throw Object.assign(new Error(`Profile YAML: ${(e as Error).message}`), { status: 400 });
      }
      writeFileAtomic(this.p.profileYaml, doc.profileYaml);
    }
    if (doc.cv !== undefined) writeFileAtomic(this.p.cv, doc.cv);
    if (doc.narrative !== undefined) writeFileAtomic(this.p.narrative, doc.narrative);
    this.events?.emit('profile.changed', {});
  }

  /** profile.yml parsed, or an empty object. */
  parsed(): Record<string, unknown> {
    try {
      return (parseYaml(read(this.p.profileYaml)) as Record<string, unknown>) ?? {};
    } catch {
      return {};
    }
  }

  ready(): { cv: boolean; profile: boolean } {
    return {
      cv: read(this.p.cv).trim().length > 200,
      profile: read(this.p.profileYaml).trim().length > 0,
    };
  }
}

export function getSources(db: Db): Sources {
  const s = kvGet<Sources>(db, 'sources', EMPTY_SOURCES);
  return { ...EMPTY_SOURCES, ...s, rules: { ...EMPTY_RULES, ...s.rules } };
}

export function setSources(db: Db, sources: Sources, events?: EventBus) {
  kvSet(db, 'sources', sources);
  events?.emit('sources.changed', {});
}

export function getSettings(db: Db): Settings {
  const s = kvGet<Partial<Settings>>(db, 'settings', {});
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    models: { ...DEFAULT_SETTINGS.models, ...(s.models ?? {}) },
    bands: { ...DEFAULT_SETTINGS.bands, ...(s.bands ?? {}) },
  };
}

export function setSettings(db: Db, patch: Partial<Settings>): Settings {
  const next = { ...getSettings(db), ...patch };
  kvSet(db, 'settings', next);
  return next;
}

/** The AI command line and models: one set for the whole server, which only an admin changes. */
export type ServerAi = Pick<Settings, 'cli' | 'models'>;

/** A person's settings with the server's AI choice laid over their own. */
export function effectiveSettings(db: Db, ai: ServerAi | null): Settings {
  const own = getSettings(db);
  return ai ? { ...own, cli: ai.cli, models: { ...own.models, ...ai.models } } : own;
}
