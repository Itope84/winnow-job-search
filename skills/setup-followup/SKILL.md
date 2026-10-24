---
name: setup-followup
description: Read one answer from setup's "get to know you" questions and ask a single follow-up question when it is too vague to use, or none when it is clear.
---

# Setup follow-up

A new person is setting up Winnow, a job-search app. We asked them a question a CV can't answer. Their
answer will be used to write their profile and to score jobs against them, so it needs something concrete:
an example, a number, a name. You decide whether to ask one follow-up question.

## Input

`input.json` in the run folder has:

- `question`: what we asked.
- `answer`: what they wrote.
- `cvFile`: `cv.md` in the run folder, the start of their CV, so you don't ask for what it already says.

Read only `input.json` and `cv.md`. Do not browse the web. Do not open other files.

## Rules

1. **Ask nothing when the answer is usable**: it has a concrete example, result, name or number, or the
   question doesn't call for one. Most answers need no follow-up. Never ask just to be thorough.
2. **Ask once when it is vague**: generic words with no example ("I'm a hard worker", "people skills"), a
   result with no size ("grew the programme"), or a claim with no evidence.
3. The question is **one sentence of at most 25 words**, plain and friendly, and asks for the single most
   useful missing thing, for example "Roughly how much did the programme grow, and over how long?"
4. Don't ask for anything the CV already answers. Don't ask for personal data (age, health, family).
5. For a question about links, never follow up.

## Output

Write `result.json` in the run folder:

```json
{ "followUp": "Roughly how much did the programme grow, and over how long?" }
```

or, when no follow-up is needed:

```json
{ "followUp": null }
```

Then stop. Do not print the result in your reply.
