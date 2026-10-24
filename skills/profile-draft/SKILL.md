---
name: profile-draft
description: Draft a new person's profile (headline, story, superpowers, proof points, role notes) and the narrative Markdown that triage and scoring read, from their CV and setup answers. Adds no facts.
---

# Profile draft

A new person is setting up Winnow, a job-search app. Triage and scoring judge every job against two
things: their CV and their profile. You write the first draft of the profile from their CV and what they
told us in setup. They review and edit it before it is saved.

## Input

`input.json` in the run folder has:

- `cvFile`: `cv.md`, the CV in Markdown, a file in the run folder. Read all of it.
- `about`: name, city, country, right to work, links.
- `want`: target `roles` (each `{ title, fit }`, where fit is `dream`, `good` or `stretch`), `level`,
  `workTypes`, `places`, `currency`, `salaryTarget`, `salaryMin`, `dealBreakers`.
- `answers`: the "get to know you" questions, each `{ question, answer, followUp, followUpAnswer }`.
  Any of them may be empty.

Read only `input.json` and `cv.md`. Do not browse the web. Do not open other files.

## Rules

1. **Add no facts.** Every employer, number, result and skill you write comes from the CV or the answers.
   If a section has nothing to go on, keep it short rather than invent. Don't inflate ("led" when the CV
   says "supported").
2. **Use their words** where they gave them, tidied for grammar.
3. **Write plainly**: short sentences, no buzzwords ("passionate", "results-driven", "dynamic").
4. **headline**: one complete phrase of at most 15 words saying what they do and what makes them
   distinct. Shorter beats cramming in a second result.
5. **story**: 2 to 4 sentences: where they have been, what they are good at, and what they want next and
   why. This is the story employers hear.
6. **superpowers**: 3 to 5, each one line with its evidence ("Wins institutional grants: $250K FIFA
   Education Fund").
7. **proofPoints**: up to 6 of their strongest results, each a short `name` and a `metric` that states
   the number or outcome. Only results with something concrete.
8. **roleNotes**: for each target role title, exactly as given, one line on why they fit it and what to
   lead with.
9. **narrative**: Markdown with these sections, in this order:
   - `## Who I am`: the story, in the first person.
   - `## North Star`: the roles they want, by fit, and the level.
   - `## Strengths and proof`: the superpowers as bullets, then any proof point they don't already
     mention. Never say the same result twice.
   - `## How to pitch me`: one bullet per target role: what to emphasise for that kind of role.
   - `## What I want`: places, work type, pay target and minimum, as given.
   - `## Deal-breakers`: as bullets, as given, plus anything from "what drains you" that rules a job out.
   - `## Work I'm proud of`: their links as bullets, only if they gave any.

## Output

Write `result.json` in the run folder:

```json
{
  "headline": "Grants manager who turns funder relationships into multi-year programmes",
  "story": "…",
  "superpowers": ["…"],
  "proofPoints": [{ "name": "FIFA Education Fund", "metric": "$250,000 grant won" }],
  "roleNotes": { "Grants Manager": "…" },
  "narrative": "## Who I am\n\n…"
}
```

Then stop. Do not print the result in your reply.
