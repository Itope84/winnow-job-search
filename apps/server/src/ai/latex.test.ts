import { describe, expect, it } from 'vitest';
import { layoutProblems, pageFills, texErrors, textProblems } from './latex.ts';

describe('checking a compiled CV', () => {
  it('keeps the compiler’s error lines and drops its download notes', () => {
    const out = [
      'note: downloading moderncv.cls',
      'note: Running TeX ...',
      'error: cv.tex:42: Undefined control sequence',
      'error: halted on potentially-recoverable error as specified',
    ].join('\n');
    expect(texErrors(out)).toBe(
      'error: cv.tex:42: Undefined control sequence\nerror: halted on potentially-recoverable error as specified',
    );
  });

  it('flags en-dash dates, lost glyphs and a missing email', () => {
    const problems = textProblems('Acme 2024–2026\nGlobex 2022 – Present\n(cid:12)', [
      'ada@example.com',
    ]);
    expect(problems).toHaveLength(3);
    expect(problems[1]).toMatch(/2024–2026, 2022 – Present/);
    expect(problems[2]).toMatch(/ada@example.com/);
    expect(textProblems('Acme 2024-2026 · ada@example.com', ['ada@example.com'])).toEqual([]);
  });

  it('measures how far down each page the text reaches, and flags a page that ends early', () => {
    const bbox = `<page width="595" height="842"><word yMax="100">a</word></page>
<page width="595" height="842"><word yMin="60" yMax="80">b</word><word yMax="421">c</word><word yMax="800">2/2</word></page>`;
    expect(pageFills(bbox)).toEqual([0.12, 0.5]);
    expect(pageFills('')).toEqual([]);
    expect(layoutProblems([0.62, 0.4])[0]).toMatch(/^Page 1 ends at 62%/);
    expect(layoutProblems([0.95, 0.4])).toEqual([]);
  });
});
