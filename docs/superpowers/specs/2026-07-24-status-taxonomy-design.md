# Lanes — implementer status taxonomy split (design spec)

**Date:** 2026-07-24
**Status:** approved (brainstorming), ready for implementation planning
**Author:** Ken + Claude
**Resolves:** issue [#6](https://github.com/OniNoKen4192/Lanes/issues/6)

## 1. What this is

`STATUS: DONE` carries two incompatible meanings. Per
`agents/lanes-implementer.md` Phase 4, DONE requires acceptance +
regression passing and zero scope violations — **or** violations exist but
are fully listed under DEVIATIONS. So DONE means "the delegate finished
typing," not "the task satisfied its contract." The reviewer's intake
(`agents/lanes-reviewer.md` Phase 1 item 2) accepts *only* DONE, so
deviations must ride inside DONE to reach the deviation-ruling machinery —
the coupling that makes this a lockstep change across files.

This slice splits the status so each value means exactly one thing, and
widens the reviewer's intake to match. Prose-only change; no validator or
hook code is touched.

## 2. The taxonomy

| Status | Meaning | Routes to |
|---|---|---|
| `IMPLEMENTED` | Acceptance + regression pass, audit verdict `clean`, `DEVIATIONS: none` | Reviewer |
| `IMPLEMENTED_WITH_DEVIATIONS` | Work finished; deviations (scope violations, interface mismatches, anything done differently than specified) fully listed for reviewer ruling | Reviewer |
| `BLOCKED` | Spec gap, environment failure, or the backend declared the spec unsatisfiable | Planner |
| `BACKEND_FAILURE` | The dispatch tool (or reply tool) errored or crashed in a way that does not match the project's `ratelimit_signal`. A dispatch denied by the Lanes gate is the gate firing — Phase 1 BLOCKED, not a backend failure | Dispatcher |
| `RATE_LIMITED` | The dispatch tool's response matches the project's `ratelimit_signal` | Dispatcher |

Decisions settled in brainstorming:

1. **`BACKEND_FAILURE` is included.** Today a backend error that is not a
   rate limit folds into BLOCKED, which routes to the planner — but a
   crashed backend is not a spec problem. It routes to the dispatcher,
   like RATE_LIMITED (do not retry, do not fall back to implementing it
   yourself; the dispatcher owns rerouting).
2. **Name is `IMPLEMENTED_WITH_DEVIATIONS`** (over CONTRACT_VIOLATION):
   it mirrors the existing DEVIATIONS report field and states exactly
   what the reviewer will find. Some accepted deviations (justified
   interface tweaks) are not "violations."

## 3. Consistency rule (the actual bug fix)

- `IMPLEMENTED` **requires** `DEVIATIONS: none`.
- `IMPLEMENTED_WITH_DEVIATIONS` **requires** a non-empty DEVIATIONS list.

A report violating this pairing is malformed. The reviewer treats it as an
intake refusal (REJECT with a routing reason), exactly as it refuses
BLOCKED today. `APPROVE` remains the only state in the whole pipeline that
means "accepted work."

## 4. Lockstep changes (seven surfaces)

1. **`agents/lanes-implementer.md`** — Phase 4 status line becomes the
   five statuses; the STATUS rules are rewritten so the "OR violations
   exist but are fully listed under DEVIATIONS" clause moves out of the
   pass state into `IMPLEMENTED_WITH_DEVIATIONS`. The existing
   RATE_LIMITED rule gains its `BACKEND_FAILURE` sibling (same
   report-immediately / never-retry / never-self-implement posture,
   distinguished by the `ratelimit_signal` match). The "implementation
   done but acceptance failing after one fix attempt" case stays BLOCKED.
   The Hard Rule "Never mark DONE on the backend's word alone" becomes
   "Never report either IMPLEMENTED status on the backend's word alone."
   Phase 1's BLOCKED usages are already correct and unchanged.
2. **`agents/lanes-reviewer.md`** — Phase 1 item 2 accepts
   `IMPLEMENTED` **and** `IMPLEMENTED_WITH_DEVIATIONS`; the refusal
   message routes BLOCKED to the planner and
   BACKEND_FAILURE / RATE_LIMITED to the dispatcher. New intake check:
   the §3 pairing rule (mismatch → refusal). The frontmatter
   `description` updates from "STATUS: DONE" to the two reviewable
   statuses.
3. **`templates/TEMPLATE.md`** — the Report Format block's STATUS line
   becomes the five statuses. The Implementer Validation Rules prose
   ("Refuse the spec (STATUS: BLOCKED, …)") is still correct — unchanged.
4. **`commands/lanes-emit.md`** — verified: its only status surface is
   the "Report Format: copied verbatim from TEMPLATE.md" rule, so it
   inherits the change with no edit. Re-verify with the §6 grep sweep.
5. **`skills/lanes/SKILL.md`** — the pipeline-overview mention of
   ``DONE` / `BLOCKED` / `RATE_LIMITED`` (agent list, item 3) becomes the
   five statuses; item 4's "a `DONE` report" becomes "an
   `IMPLEMENTED` / `IMPLEMENTED_WITH_DEVIATIONS` report".
6. **`README.md`** — the same prose update in pipeline step 3 (step 4
   never named the implementer statuses).
7. **`templates/config.example.md`** — the `ratelimit_signal` comment's
   "instead of reporting a false BLOCKED" becomes "instead of getting a
   false BACKEND_FAILURE".

Wherever the taxonomy is enumerated, the list is byte-identical:
`IMPLEMENTED | IMPLEMENTED_WITH_DEVIATIONS | BLOCKED | BACKEND_FAILURE |
RATE_LIMITED`.

## 5. Out of scope

- Conformance-suite assertion that the vocabularies stay in sync across
  files — that is #4's job; this spec's §6 grep sweep is the manual seed.
- Validator changes — none needed. The `audit` verdict (`clean` |
  `violations`) is already what the implementer consults to choose
  between the two IMPLEMENTED variants.
- Reviewer verdict taxonomy (APPROVE / FIX / REJECT) — untouched.

## 6. Testing

Prose-only change; verification is a repo-wide grep sweep:

- `STATUS: DONE` and `DONE |` appear nowhere in the plugin sources
  (`agents/`, `commands/`, `skills/`, `templates/`, `README.md`).
  Historical specs/plans under `docs/superpowers/` are records of past
  work and are exempt.
- The five-status enumeration is byte-identical at every site that lists
  it (implementer Phase 4, TEMPLATE.md Report Format).
- The reviewer intake names all five statuses: two accepted, three
  refused with their routing.
