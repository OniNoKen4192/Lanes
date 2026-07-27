---
description: >
  Close out a session: summarize what it did, update the project's
  records with the human ruling on every change (whiteboard triage,
  loose ends), prepend a triplog entry (permanent what/decided/why
  memory), and write the resume seed the next session's pointer hook
  announces. Works in any git repo — .lanes/config.json adds
  Lanes-specific findings but is never required.
---

# /lanes-rest-stop — session close-out

Behavior spec: `docs/superpowers/specs/2026-07-26-rest-stop-design.md`
§2–§5. This is a guided ritual — the human is present by definition,
and every record update is confirmed by the human before it is written.
No silent triage, no silent summary, no silent seed.

Two artifacts divide the work: the **triplog** answers "what happened
and why" (permanent, newest-first); the **seed** answers "what do I do
right now" (one rolling file, replaced every rest-stop). Git history is
the archive of old seeds.

## Preconditions

1. A git repository — the summary is built from git evidence; refuse
   outside one.
2. `.lanes/config.json` is NOT required. This command is deliberately
   config-optional — the one Lanes command useful before `/lanes-init`.
   Config present: the gather step adds the pipeline ledger and task
   worktrees. Config absent or invalid: skip those findings and
   proceed; never refuse over the config.

## Procedure

1. **Gather** (read-only, in this order):
   - Session commits: `git log` from the previous seed's `HEAD at
     close` (read `.lanes/seed.md` if it exists) to the current HEAD.
     No previous seed → ask the human for the session's starting point
     (a ref, or "everything from today").
   - Working-tree state: dirty files (`git status --porcelain`) and
     unpushed commits (`git log @{u}..` where an upstream exists).
   - Leftover task worktrees under `.lanes/worktrees/` (config present
     only) — each one is parked or abandoned work worth surfacing.
   - `whiteboard.md` at the repo root, if present — entries to triage.
   - `triplog.md` at the repo root, if present — created on the first
     run otherwise.
   - Uncommitted Highways run docs
     (`docs/superpowers/highways/*-run.md`, untracked or modified).
   - The pipeline ledger named by the config, if present — the
     session's task outcomes.
2. **Summarize.** Draft the session summary from the gathered evidence
   and present it. The human corrects it; their version wins.
3. **Whiteboard triage** (only if `whiteboard.md` exists). Propose a
   disposition for each entry — graduate (name the destination), keep
   parked, or drop (name the reason) — and let the human rule on each.
   Apply only the rulings; an unruled entry stays exactly as it was.
4. **Loose ends.** Present the dirty/unpushed/parked findings. For
   each, the human chooses: handle it now (they act, or direct you
   outside this command's writes) or record it in the seed. The
   command never resolves a loose end itself and never touches a
   worktree.
5. **Triplog entry.** Draft the entry (format below), present it,
   apply corrections, then prepend it to `triplog.md` directly beneath
   the preamble. First run: create the file with the preamble shown
   below, then the entry.
6. **Seed.** Write `.lanes/seed.md` fresh (format below) — replaced
   wholesale, never appended.
7. **Commit the records** locally: the touched record files ONLY
   (`triplog.md`, `.lanes/seed.md`, and `whiteboard.md` when triage
   changed it), staged by explicit path, one commit, message
   `docs: rest stop YYYY-MM-DD`. **Never push to a remote** —
   publishing is the human's decision, as everywhere in Lanes.

## Triplog format

First-run preamble:

```markdown
# Triplog

Session-by-session project memory, newest first: what shipped, what
was decided and why, what was left loose. Written by /lanes-rest-stop;
the dated specs remain the deep record each entry links to.
```

Entry (prepended beneath the preamble):

```markdown
## YYYY-MM-DD — <one-line session title>

**Shipped:** <commit range> — <prose summary of what landed>

**Decisions:**
- <decision>: <why — the reasoning, and what was rejected>

**Loose ends:** <parked/deferred items with paths — or "none">
```

The Decisions list is the load-bearing section: design forks taken,
adjudications, alternatives rejected and why — mined from the
session's specs, review verdicts, and conversation, confirmed by the
human. Link to spec files instead of restating them.

## Seed format

```markdown
# Seed — YYYY-MM-DD

**HEAD at close:** <sha>

**Where we left off:** <one paragraph>

**Parked:** <items with paths and reasons — or "none">

**See:** triplog.md (<date> entry) for the session narrative.

**First action on resume:** <one concrete action>
```

The `# Seed — YYYY-MM-DD` heading is load-bearing (the SessionStart
pointer hook parses the date from it), and `HEAD at close` is the next
rest-stop's commit-range floor.

## Hard rules

- Every record update is confirmed by the human before it is written.
- Read-only outside the record files: never modify source, specs,
  plans, config, or anything under `.lanes/` other than `seed.md`;
  never touch a worktree.
- Never push to a remote.
- A missing or invalid `.lanes/config.json` is never a refusal —
  degrade to the generic gather set.
