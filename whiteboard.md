# Whiteboard

Parking lot for feature ideas and future development. Nothing here is committed work — it's a place to capture thoughts so they don't get lost. When an idea graduates, move it to a plan/issue and delete it from here.

## How to use

- Add ideas under **Ideas** with a short name, a one-liner, and any context worth keeping.
- Don't over-polish entries; a rough note beats a lost idea.
- Periodically triage: promote, park longer, or drop.

## Ideas

### Backend exhaustion failover
- **What:** What the pipeline does when the DELEGATE backend runs out of subscription usage entirely (usage cap, not a per-tier blip) — today every task RATE_LIMITEDs down the tier list and then parks, which stalls whole conveyor/highway runs for hours.
- **Why:** Codex caps reset on a schedule; a run that parks everything at 2pm and could have resumed at 5pm — or flowed to a cheaper alternative — wastes the whole point of unattended mode.
- **Notes:**
  - Detection already exists (`ratelimit_signal` → RATE_LIMITED → tier fallback → park after last tier); the missing piece is what happens NEXT.
  - Candidate shapes: (a) park-and-resume — record the cap window, run report says when to resume, maybe a `/lanes-resume`; (b) fallback backend chain — config lists a second backend behind the seam (the seam was built for this); (c) fallback to an in-session subagent implementer on a cheaper Claude tier — no MCP needed, keeps flowing, spends Claude quota instead.
  - Open: which shape (or a declared ladder of them), where it's declared in config, and how the safety floor applies (same gate/audit machinery regardless of who implements).
  - Brainstorm started 2026-07-25 (context: `agents/lanes-implementer.md` SEAM block + RATE_LIMITED taxonomy reviewed); parked before the first clarifying question.
- **Added:** 2026-07-25

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

## Dropped

Ideas considered and passed on, with a one-line reason — so we don't re-litigate them later.
