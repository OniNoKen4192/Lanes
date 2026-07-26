# Whiteboard

Parking lot for feature ideas and future development. Nothing here is committed work — it's a place to capture thoughts so they don't get lost. When an idea graduates, move it to a plan/issue and delete it from here.

## How to use

- Add ideas under **Ideas** with a short name, a one-liner, and any context worth keeping.
- Don't over-polish entries; a rough note beats a lost idea.
- Periodically triage: promote, park longer, or drop.

## Ideas

### /rest-stop
- **What:** A session close-out command: summarize what the session did, update the project's records (whiteboard triage, ledger, memory/docs that drifted), and write a **seed** for the next session — where we left off, what's parked, and the first action to take on resume.
- **Why:** Session endings are ad hoc today — the summary, whiteboard updates, and "remember where we were" all depend on someone thinking to do them. A command makes the ritual reliable, and the seed turns cold starts into warm ones.
- **Notes:**
  - Fits the road-trip naming (lanes → roundabout → highways → rest stop).
  - Open: where the seed lives (a dated file in the repo? `.lanes/`? the whiteboard itself?) and whether the next session reads it automatically or on request.
  - Open: scope — Lanes-plugin surface (project-agnostic, ships to everyone) vs. personal workflow tooling; if plugin, what "update the project" concretely means across arbitrary repos.
  - Overlaps with what a Highways review doc does for one run — this is the same idea for a whole session.
- **Added:** 2026-07-26

<!-- Template:
### Idea name
- **What:** one-line description
- **Why:** the problem or opportunity it addresses
- **Notes:** rough thoughts, open questions, links
- **Added:** YYYY-MM-DD
-->

## Graduated

Ideas that moved on to real planning (link to where they went).

- **Roundabout (v2)** → `docs/superpowers/specs/2026-07-25-roundabout-automation-design.md` (declared-trust automation ladder + `/lanes-run`). Graduated 2026-07-25.
- **Highways (v3)** → `docs/superpowers/specs/2026-07-25-highways-streams-design.md` (two-level stream orchestration: stream map + `/lanes-highway` + `routing.attention`). Graduated 2026-07-25.
- **Claude failover** → `docs/superpowers/specs/2026-07-26-claude-failover-design.md` (declared `backend.failover_tiers` + `lanes-claude-implementer` re-dispatch in unattended runs). Graduated 2026-07-26.

## Dropped

Ideas considered and passed on, with a one-line reason — so we don't re-litigate them later.
