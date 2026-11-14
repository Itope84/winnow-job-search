import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { AdapterEvent, CliAdapter, RunRequest } from './types.ts';

/**
 * A script the replay adapter plays instead of calling a CLI. Steps run in order; `delay` is in ms.
 * `write` paths are relative to the run folder, the way a real skill writes its result.
 */
export interface ReplayScript {
  steps: Array<
    | { delay?: number; event: AdapterEvent }
    | { delay?: number; write: { path: string; content: string } }
    | {
        delay?: number;
        writeFrom: {
          path: string;
          template: 'triage-keep-all' | 'score' | 'study-triage' | 'study-score';
        };
      }
  >;
  exitCode?: number;
}

/**
 * Plays recorded scripts from `dir`: `<kind>.json`. Used by tests and demo mode, so no tokens are spent.
 * Two built-in templates read the run's `input.json` and answer for every job in it.
 */
export function replayAdapter(dir: string): CliAdapter {
  return {
    id: 'replay',
    label: 'Replay',
    detect: async () => ({ installed: true, version: 'replay' }),
    async run(req: RunRequest, onEvent: (e: AdapterEvent) => void) {
      const meta = req.meta ?? { kind: 'unknown', phase: 'start', folder: req.cwd };
      const file = join(dir, `${meta.kind}.json`);
      const sessionId = `replay-${randomUUID()}`;
      onEvent({ type: 'session', sessionId });
      if (!existsSync(file)) {
        onEvent({
          type: 'result',
          ok: false,
          text: null,
          error: `No replay script for ${meta.kind}`,
          costUsd: null,
        });
        return { exitCode: 1, sessionId, cancelled: false };
      }
      const script = JSON.parse(readFileSync(file, 'utf8')) as ReplayScript;
      for (const step of script.steps) {
        if (step.delay) await sleep(step.delay, req.signal);
        if (req.signal.aborted) return { exitCode: null, sessionId, cancelled: true };
        if ('event' in step) onEvent(step.event);
        else if ('write' in step) {
          const path = join(meta.folder, step.write.path);
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, step.write.content);
        } else if ('writeFrom' in step) {
          const input = JSON.parse(readFileSync(join(meta.folder, 'input.json'), 'utf8')) as {
            jobs?: { id: string }[];
            job?: { id: string };
            items?: { id: string; kind: string; title: string; org: string }[];
          };
          const template = step.writeFrom.template;
          if (template === 'study-triage' || template === 'study-score') {
            writeFileSync(
              join(meta.folder, step.writeFrom.path),
              JSON.stringify(studyReplay(template, input), null, 2),
            );
            if (template === 'study-score')
              writeFileSync(join(meta.folder, 'report.md'), '# Replay\n\nA replayed report.\n');
            continue;
          }
          const out =
            template === 'triage-keep-all'
              ? {
                  results: (input.jobs ?? []).map((j, i) => ({
                    id: j.id,
                    verdict: i % 3 === 2 ? 'discard' : 'keep',
                    reason:
                      i % 3 === 2
                        ? 'Replay: outside your target roles'
                        : 'Replay: fits your targets',
                  })),
                }
              : {
                  score: 4.2,
                  summary: 'Replay: a good fit with one gap.',
                  dimensions: [
                    { key: 'cv', label: 'CV match', score: 4.4, note: 'Replay' },
                    { key: 'north_star', label: 'North Star fit', score: 4.3, note: 'Replay' },
                    { key: 'comp', label: 'Comp', score: 4.0, note: 'Replay' },
                    { key: 'culture', label: 'Culture', score: 4.1, note: 'Replay' },
                    { key: 'red_flags', label: 'Red flags', score: 4.2, note: 'Replay' },
                  ],
                  hardStops: [],
                  gaps: ['Replay gap'],
                  strengths: ['Replay strength'],
                  nextStep: 'Replay: apply this week.',
                  legitimacy: 'High Confidence',
                  archetype: 'Replay',
                  comp: null,
                };
          writeFileSync(join(meta.folder, step.writeFrom.path), JSON.stringify(out, null, 2));
          if (step.writeFrom.template === 'score')
            writeFileSync(
              join(meta.folder, 'report.md'),
              '# Evaluation: Replay\n\nA replayed report.\n',
            );
        }
      }
      onEvent({
        type: 'result',
        ok: (script.exitCode ?? 0) === 0,
        text: null,
        error: null,
        costUsd: 0,
      });
      return { exitCode: script.exitCode ?? 0, sessionId, cancelled: false };
    },
  };
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    });
  });
}

/** Facts a replayed scholarship skill reads off a page: a UK scholarship naming one school. */
const REPLAY_FACTS = {
  kind: 'scholarship',
  shape: 'many_schools',
  funding: 'full',
  covers: 'Tuition, living costs and flights',
  countries: ['United Kingdom'],
  level: 'Master’s',
  subject: 'Any',
  university: null,
  intake: 'September 2027',
  deadlines: { scholarship: '2099-01-15', admission: null },
  round: 'open',
  eligibility: { status: 'eligible', who: 'Replay', fails: [], todos: ['Replay: IELTS 6.5'] },
  schools: ['University of Replay'],
  essays: ['Why this subject? (500 words)'],
  documents: ['Transcript', 'Two references'],
  tuition: null,
  length: null,
  officialUrl: null,
};

/**
 * Scholarship triage and score, replayed: every third item is discarded as not eligible; programmes
 * keep their kind and sit at the University of Replay, so a scholarship naming it links to them.
 */
function studyReplay(
  template: 'study-triage' | 'study-score',
  input: { items?: { id: string; kind: string; title: string; org: string }[] },
) {
  const facts = (kind: string) =>
    kind === 'programme'
      ? {
          ...REPLAY_FACTS,
          kind: 'programme',
          shape: null,
          funding: 'fees',
          university: 'University of Replay',
          schools: [],
          deadlines: { scholarship: null, admission: '2099-03-01' },
        }
      : REPLAY_FACTS;
  if (template === 'study-triage')
    return {
      results: (input.items ?? []).map((it, i) => ({
        id: it.id,
        verdict: i % 3 === 2 ? 'discard' : 'keep',
        reason: i % 3 === 2 ? 'Replay: not eligible' : 'Replay: fits your subjects',
        title: it.title,
        org: it.kind === 'programme' ? 'University of Replay' : it.org,
        facts:
          i % 3 === 2
            ? {
                ...facts(it.kind),
                eligibility: {
                  status: 'ineligible',
                  who: 'Replay',
                  fails: ['Replay: needs 2 years’ work'],
                  todos: [],
                },
              }
            : facts(it.kind),
      })),
    };
  return {
    score: 4.3,
    summary: 'Replay: a strong fit you can apply for.',
    dimensions: [
      { key: 'eligibility', label: 'Eligibility', score: 5, note: 'Replay' },
      { key: 'fit', label: 'Subject fit', score: 4.4, note: 'Replay' },
      { key: 'funding', label: 'Funding', score: 5, note: 'Replay' },
      { key: 'odds', label: 'Odds', score: 3.2, note: 'Replay' },
      { key: 'place', label: 'Place', score: 5, note: 'Replay' },
      { key: 'effort', label: 'Effort and timing', score: 3.5, note: 'Replay' },
    ],
    hardStops: [],
    gaps: ['Replay: book IELTS'],
    strengths: ['Replay strength'],
    nextStep: 'Replay: ask two referees this week.',
    legitimacy: 'High Confidence',
    archetype: 'Replay',
    comp: 'Full funding',
    facts: { ...REPLAY_FACTS, deadlines: { scholarship: '2099-02-01', admission: null } },
  };
}
