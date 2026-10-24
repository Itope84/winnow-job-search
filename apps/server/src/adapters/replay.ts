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
    | { delay?: number; writeFrom: { path: string; template: 'triage-keep-all' | 'score' } }
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
          };
          const out =
            step.writeFrom.template === 'triage-keep-all'
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
