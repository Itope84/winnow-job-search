import { join } from 'node:path';
import { type Db, openDb } from './db.ts';
import { EventBus } from './events.ts';
import { JobStore } from './jobs.ts';
import { ensureLibrary, Profile } from './library.ts';

/** Everything that belongs to one person: their folder, database, events, jobs and profile. */
export interface Space {
  userId: string;
  library: string;
  db: Db;
  events: EventBus;
  jobs: JobStore;
  profile: Profile;
}

export function openSpace(usersDir: string, userId: string): Space {
  const library = join(usersDir, userId);
  ensureLibrary(library);
  const db = openDb(library);
  const events = new EventBus(db);
  return {
    userId,
    library,
    db,
    events,
    jobs: new JobStore(db, events, library),
    profile: new Profile(library, events),
  };
}
