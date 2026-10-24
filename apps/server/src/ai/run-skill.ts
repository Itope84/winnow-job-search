import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RunCtx } from '../runs/runner.ts';
import { clip } from '../util.ts';

const PROGRESS = /\[winnow\]\s*(\d+)\s*\/\s*(\d+)\s*([^\n]*)/i;

const SYSTEM = `You are running unattended inside Winnow, a job-search app. Nobody can answer questions mid-run.
Work only inside the current folder. Never ask for confirmation. Never print secrets.
When the skill says to write a file, write exactly that file, in exactly the format it gives.`;

/** Copy the repo's skills into the person's library, so a CLI that may only read its own folder can open them. */
export function installSkills(skillsDir: string, library: string) {
  const target = join(library, '_skills');
  rmSync(target, { recursive: true, force: true });
  if (existsSync(skillsDir)) cpSync(skillsDir, target, { recursive: true });
}

export interface SkillRun<T> {
  skill:
    | 'triage'
    | 'score'
    | 'ai-search'
    | 'cv-markdown'
    | 'profile-prefill'
    | 'setup-followup'
    | 'profile-draft'
    | 'sources-suggest'
    | 'jack-update';
  /** Folder name under `runs/`; defaults to the run id. */
  folder?: string;
  input: unknown;
  /**
   * Long text the skill reads as its own files in the run folder (name → content). OpenCode's read tool
   * cuts very long lines, so a CV squeezed into one JSON string line can't be read whole.
   */
  files?: Record<string, string>;
  /** Extra instructions after the skill pointer (the task itself). */
  task: string;
  model: string | null;
  timeoutMs: number;
  /** Check and shape `result.json`; throw with a plain message when it's wrong. */
  validate: (value: unknown) => T;
  /** Write tools may touch only this folder; web tools only when allowed. */
  web: boolean;
}

/**
 * Run one skill through the person's CLI and return its validated `result.json`. Reads progress lines as
 * they stream and stops the CLI as soon as a valid result exists (OpenCode often stays alive after it has
 * answered).
 */
export async function runSkill<T>(
  ctx: RunCtx,
  spec: SkillRun<T>,
): Promise<{ value: T; folder: string }> {
  const library = ctx.space.library;
  const folder = join(library, 'runs', spec.folder ?? ctx.run.id);
  mkdirSync(folder, { recursive: true });
  const resultFile = join(folder, 'result.json');
  rmSync(resultFile, { force: true });
  writeFileSync(join(folder, 'input.json'), JSON.stringify(spec.input, null, 2));
  for (const [name, content] of Object.entries(spec.files ?? {}))
    writeFileSync(join(folder, name), content);
  const skillPath = `_skills/${spec.skill}/SKILL.md`;
  if (!existsSync(join(library, skillPath))) throw new Error(`The ${spec.skill} skill is missing.`);

  const prompt = `Read ${join(library, skillPath)} and follow it exactly.

Run folder: ${folder}/
Input: ${folder}/input.json${Object.keys(spec.files ?? {})
    .map((f) => `, ${folder}/${f}`)
    .join('')}
Write your answer to: ${folder}/result.json

Everything you need is in those files. Do not look at any other folder.

${spec.task}`;

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  ctx.signal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), spec.timeoutMs);
  // `got`, not the value itself, says a valid result exists: a skill may answer null (no follow-up).
  let value: T | null = null;
  let got = false;
  let lastError: string | null = null;
  const tryRead = () => {
    if (got || !existsSync(resultFile)) return;
    try {
      value = spec.validate(JSON.parse(readFileSync(resultFile, 'utf8')));
      got = true;
      controller.abort();
    } catch (e) {
      lastError = (e as Error).message;
    }
  };
  const poll = setInterval(tryRead, 1500);
  ctx.setModel(spec.model);
  ctx.log('info', `${ctx.adapter.label}${spec.model ? ` · ${spec.model}` : ''} · ${spec.skill}`);

  try {
    await ctx.adapter.run(
      {
        cwd: library,
        prompt,
        system: SYSTEM,
        resume: null,
        model: spec.model,
        // `chat`: read anywhere in the library, write only in the run folder, web tools on.
        policy: 'chat',
        writeScope: folder,
        signal: controller.signal,
        meta: { kind: spec.skill, phase: 'start', folder },
      },
      (e) => {
        switch (e.type) {
          case 'tool':
            ctx.log('tool', e.summary);
            ctx.step(e.summary);
            break;
          case 'text': {
            const m = PROGRESS.exec(e.text);
            if (m) {
              ctx.progress(Number(m[1]), Number(m[2]), 'steps');
              if (m[3]?.trim()) ctx.step(m[3].replace(/^[:\s-]+/, '').trim());
            }
            ctx.log('text', clip(e.text, 2000));
            break;
          }
          case 'stderr':
            ctx.log('stderr', e.text);
            break;
          case 'result':
            ctx.addCost(e.costUsd);
            if (!e.ok && e.error) lastError = e.error;
            break;
        }
      },
    );
  } finally {
    clearInterval(poll);
    clearTimeout(timer);
    ctx.signal.removeEventListener('abort', onAbort);
  }
  tryRead();
  if (ctx.signal.aborted && !got) throw new Error('Cancelled');
  if (!got) {
    if (!existsSync(resultFile))
      throw new Error(
        controller.signal.aborted
          ? `${ctx.adapter.label} ran out of time before writing its result.`
          : `${ctx.adapter.label} finished without writing its result.${lastError ? ` ${lastError}` : ''}`,
      );
    throw new Error(`The result file was not usable: ${lastError ?? 'unknown problem'}`);
  }
  return { value: value as T, folder };
}
