# Whiteboard

Parking lot for feature ideas and future development. Nothing here is committed work — it's a place to capture thoughts so they don't get lost. When an idea graduates, move it to a plan/issue and delete it from here.

## How to use

- Add ideas under **Ideas** with a short name, a one-liner, and any context worth keeping.
- Don't over-polish entries; a rough note beats a lost idea.
- Periodically triage: promote, park longer, or drop.

## Ideas

### v3: Highways
- **What:** A new topology on top of Lanes — Fable takes a feature, breaks it into parallel work streams, and dispatches one planner/orchestrator Fable subagent per stream. Each of those then feeds its stream into Lanes.
- **Why:** Lanes controls cost, which is what makes this affordable. Fanning out frontier orchestrators would normally be prohibitive; because each stream's implementation work drops to a DELEGATE backend, you can afford frontier judgment at the head of every stream.
- **Notes:**
  - Two-level structure: top-level Fable does decomposition into streams; per-stream Fable subagent does planning/orchestration; Lanes handles routing and execution within the stream.
  - Open: how streams are cut so they're genuinely independent, and what happens at the merge points where they aren't.
  - Open: whether review stays per-stream or there's a top-level integration review across streams.
  - Depends on Roundabout (graduated 2026-07-25) — parallel streams stop being a win if each one still needs a human at every handoff.
- **Added:** 2026-07-24

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

## Dropped

Ideas considered and passed on, with a one-line reason — so we don't re-litigate them later.
