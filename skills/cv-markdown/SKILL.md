---
name: cv-markdown
description: Turn the text pulled out of a CV PDF into a clean Markdown CV, keeping every fact and adding none.
---

# CV to Markdown

You turn a CV that was uploaded as a PDF into clean Markdown. Triage and scoring read this file to judge
jobs against the candidate, so it must say exactly what the PDF says: no more, no less.

## Input

`input.json` in the run folder has:

- `fileName`: the name of the uploaded PDF.
- `textFile`: `cv.txt`, a file in the run folder with the text pulled out of the CV (by
  `pdftotext -layout` for a PDF, or as pasted). Read all of it. Columns may be side by side, lines may be broken
  mid-sentence, and page headers, footers and page numbers may repeat.

Read only `input.json` and `cv.txt`. Do not search them; read them. Do not browse the web. Do not open other files.

## Rules

1. **Keep every fact.** Every job, employer, date, title, place, qualification, skill, number, link and
   achievement in the text appears in your Markdown, in the same words where possible. Do not summarise,
   shorten, improve, translate or reorder within a section.
2. **Add nothing.** No skills, dates, results or wording that the text does not contain. If something is
   unreadable, leave it out rather than guess.
3. **Fix only the layout:** join lines broken mid-sentence, separate columns that were run together, drop
   repeated page headers, footers and page numbers, and turn bullet characters (•, ▪, –, ◦) into `- `.
4. **Structure:**
   - `# Full Name`, then one line of contact details separated by ` · ` (email, phone, place, links).
   - `## Section` for each section the CV has (for example Summary, Experience, Education, Skills,
     Certifications), in the CV's own order and with its own names.
   - Each role in Experience: `### Title, Employer` then a line `Place · Start – End` (whatever parts the
     CV gives), then its bullets.
   - Plain Markdown only: headings, paragraphs, `- ` bullets, `**bold**` where the CV uses it, links. No
     tables, HTML or code blocks.

## Output

Write `result.json` in the run folder:

```json
{ "markdown": "# Ada Lovelace\n\nada@example.org · London\n\n## Experience\n..." }
```

Then stop. Do not print the CV in your reply.
