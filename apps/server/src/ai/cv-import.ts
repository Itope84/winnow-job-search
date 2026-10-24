import { execFile } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RunCtx, RunOutput } from '../runs/runner.ts';
import { getSetup, saveSetup, setupActive } from '../setup.ts';
import { HttpError, nowIso } from '../util.ts';
import { runSkill } from './run-skill.ts';

const MAX_PDF = 10 * 1024 * 1024;

export const uploadsDir = (library: string) => join(library, 'profile', 'uploads');

/** The text layer of a PDF, read with `pdftotext -layout` (poppler). */
export function pdfText(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'pdftotext',
      ['-layout', '-enc', 'UTF-8', path, '-'],
      { timeout: 30_000, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout) => {
        if (!err) return resolve(stdout);
        if ((err as NodeJS.ErrnoException).code === 'ENOENT')
          return reject(
            new HttpError(503, 'no_pdftotext', 'This server can’t read PDFs: install poppler.'),
          );
        reject(new HttpError(422, 'bad_pdf', 'That PDF couldn’t be read.'));
      },
    );
  });
}

/**
 * Keep an uploaded CV PDF and its text in `profile/uploads/`, refusing files that aren't PDFs or have no
 * text layer (scans), which would only waste a paid run. Returns the stored file's name.
 */
export async function saveCvPdf(library: string, body: Uint8Array, name: string): Promise<string> {
  if (body.byteLength > MAX_PDF) throw new HttpError(422, 'too_big', 'Use a PDF under 10 MB.');
  if (Buffer.from(body.subarray(0, 5)).toString('latin1') !== '%PDF-')
    throw new HttpError(422, 'not_pdf', 'That file isn’t a PDF.');
  const dir = uploadsDir(library);
  mkdirSync(dir, { recursive: true });
  const safe =
    name
      .replace(/\.pdf$/i, '')
      .replace(/[^\w.-]+/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '')
      .slice(0, 60) || 'cv';
  const file = `${Date.now()}-${safe}.pdf`;
  const path = join(dir, file);
  writeFileSync(path, body);
  const text = await pdfText(path);
  if (text.replace(/\s+/g, '').length < 200)
    throw new HttpError(
      422,
      'scanned_pdf',
      'This PDF has no text to read (it looks scanned). Export it from Word or Docs as a PDF, or paste the text.',
    );
  writeFileSync(path.replace(/\.pdf$/, '.txt'), text);
  return file;
}

/** Keep a pasted CV in `profile/uploads/` so a Read CV run can tidy it. Returns the stored file's name. */
export function saveCvText(library: string, text: string): string {
  if (text.replace(/\s+/g, '').length < 200)
    throw new HttpError(422, 'too_short', 'That’s too short for a CV. Paste all of it.');
  if (text.length > 200_000) throw new HttpError(422, 'too_big', 'That’s too long for a CV.');
  const dir = uploadsDir(library);
  mkdirSync(dir, { recursive: true });
  const file = `${Date.now()}-pasted-cv.txt`;
  writeFileSync(join(dir, file), text);
  return file;
}

/**
 * Read CV: an uploaded PDF's text, or a pasted CV, becomes the Markdown CV. The CV it replaces is kept in
 * uploads/. During setup, Pre-fill follows so the forms fill in from it.
 */
export async function cvImport(ctx: RunCtx): Promise<RunOutput> {
  const upload = String(ctx.runs.params(ctx.run.id).upload ?? '');
  const pdf = upload.endsWith('.pdf');
  const textFile = join(uploadsDir(ctx.space.library), upload.replace(/\.pdf$/, '.txt'));
  if (!/^[\w.-]+\.(pdf|txt)$/.test(upload) || !existsSync(textFile))
    throw new Error('The uploaded CV is gone. Upload it again.');
  const fileName = pdf ? upload.replace(/^\d+-/, '') : 'your pasted CV';
  ctx.step(`Turning ${fileName} into Markdown`);
  const { value } = await runSkill(ctx, {
    skill: 'cv-markdown',
    input: { fileName, textFile: 'cv.txt' },
    files: { 'cv.txt': readFileSync(textFile, 'utf8').slice(0, 60_000) },
    task: 'Turn the CV text in input.json into Markdown.',
    model: ctx.settings.models.default,
    timeoutMs: 6 * 60_000,
    validate: (v) => {
      const md = (v as { markdown?: unknown })?.markdown;
      if (typeof md !== 'string' || md.trim().length < 200)
        throw new Error('result.json needs the CV as "markdown".');
      return md.trim();
    },
    web: false,
  });
  const current = ctx.space.profile.get().cv;
  if (current.trim()) {
    const backup = join(
      uploadsDir(ctx.space.library),
      `cv-before-${nowIso().replace(/[:.]/g, '-')}.md`,
    );
    writeFileSync(backup, current);
  }
  ctx.space.profile.set({ cv: `${value}\n` });
  if (pdf)
    copyFileSync(
      join(uploadsDir(ctx.space.library), upload),
      join(ctx.space.library, 'profile', 'cv.pdf'),
    );
  if (setupActive(ctx.space)) {
    const [next] = ctx.enqueue({ kind: 'profile_prefill' });
    const runs = getSetup(ctx.space).runs;
    if (next) saveSetup(ctx.space, { runs: { ...runs, prefill: next.id } });
  }
  return { summary: `CV updated from ${fileName}`, result: { upload } };
}
