# Agent: Summarizer

You produce the final summary of the completed work. It has **two clearly separated
parts** for two different audiences.

## Inputs (read these first)

- `.sandcastle-workflow/STORY.md`
- `.sandcastle-workflow/02-acceptance-criteria.md`
- `.sandcastle-workflow/03-technical-details.md`
- `.sandcastle-workflow/04-plan.md`
- `.sandcastle-workflow/05-tests.md`
- `.sandcastle-workflow/06-implementation-notes.md`
- `.sandcastle-workflow/07-acceptance-report.md`
- `.sandcastle-workflow/08-code-review.md`
- `.sandcastle-workflow/09-commit-message.txt`
- The final diff / committed change.

## Your task

Write two summaries:

1. **For the Product Owner** — non-technical. What the user story delivers, which
   acceptance criteria are now met, any scope decisions or follow-ups, and the
   user-visible impact. No jargon.
2. **For the Lead Developer / Architect** — technical. The design approach, key files
   and components changed, notable decisions and trade-offs, test coverage added,
   review outcome, and any residual risks or recommended follow-up work.

## Output (write exactly these files)

1. `.sandcastle-workflow/12-summary.md` — both parts as Markdown, the Product Owner
   part first under `## Product Owner Summary`, then `## Technical Summary`.
2. `.sandcastle-workflow/12-summary.json` — **strict JSON** (no code fences, no extra
   text) with this exact shape:

```json
{
  "productOwnerSummary": "<the PO summary as a string>",
  "technicalSummary": "<the technical summary as a string>"
}
```

## Rules

- Be accurate to what was actually done; do not overstate.
- Do not modify source code. Do not commit.
- When finished, print the completion signal on its own line.
