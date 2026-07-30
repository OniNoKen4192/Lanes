# /lanes-config — Design

**Date:** 2026-07-29
**Status:** Approved (design review with Ken, 2026-07-29)
**Depends on:** config schema v1
(`2026-07-24-config-schema-design.md`), the Roundabout automation block
(`2026-07-25-roundabout-automation-design.md`), Claude failover
(`2026-07-26-claude-failover-design.md`).

## 1. Problem

The config now carries real operational knobs — the trust level, the
fix-round cap, the backend approval mode, the tier lists — and flipping
any of them means hand-editing `.lanes/config.json` and remembering to
re-validate. These are the fields you change *between runs*, not at
project setup, so they deserve a first-class surface: one slash command
that reads and sets them, with the write done deterministically and
fail-closed like every other Lanes mutation.

Structural fields (routing globs, resolved commands, pipeline paths,
review suite) stay hand-edited: they change rarely, they're derived
from or coupled to the repo's actual shape, and `/lanes-doctor` already
previews them.

Alongside this, one rename: the trust level between `verdicts` and
`highways` is renamed **`conveyor` → `roundabout`** (§4).

## 2. The knobs

Five knobs, each a short name mapped to one config key:

| Knob | Key | Values |
|---|---|---|
| `trust` | `automation.level` | `manual` \| `verdicts` \| `roundabout` \| `highways` |
| `fix-rounds` | `automation.max_fix_rounds` | integer ≥ 1 |
| `approval` | `backend.approval_mode` | `pilot` \| `automated` |
| `tiers` | `backend.tiers` | comma-separated tier names, non-empty |
| `failover` | `backend.failover_tiers` | comma-separated Claude aliases; `none` clears to `[]` |

This is the complete set. Adding a knob later is a spec change, not a
drive-by.

## 3. The CLI subcommand: `config get` / `config set`

`bin/lanes-validate.mjs` gains a `config` subcommand — the ONLY write
path for these knobs. The slash command never edits the JSON itself.

### `config get`

Prints a JSON report of all five knobs with their current values,
normalized exactly as `loadConfig` normalizes them (an absent
`automation` block reads as `level: "manual"`, `max_fix_rounds: 2`; an
absent `failover_tiers` reads as `[]`):

```json
{
  "trust": "manual",
  "fix_rounds": 2,
  "approval": "pilot",
  "tiers": ["gpt-5.3-codex", "gpt-5.3-codex-mini"],
  "failover": []
}
```

### `config set <knob> <value>`

1. Load the raw file (`JSON.parse` of `.lanes/config.json` — NOT the
   normalized view; normalization defaults must not leak into the file
   except as §3-edge below).
2. Parse the value per the knob: comma-split with each element trimmed
   for `tiers`/`failover` (empty elements are an error); the literal
   `none` for `failover` means `[]`; strict integer parse for
   `fix-rounds` (`"3"` → 3; `"3.5"`, `"three"` → error before any
   mutation).
3. Apply the mutation to the raw object.
4. Run the existing `validateConfig` on the result. Any error →
   print the validator's errors, exit 1, **file untouched**.
5. Write with 2-space indent and a trailing newline (the
   `/lanes-init` output shape).
6. Print a JSON report: `{ "knob": ..., "old": ..., "new": ... }`,
   where `old` is the normalized prior value (so flipping trust on a
   config with no `automation` block reports `"manual"` → the new
   level, not `null`).

Edge cases, all pinned:

- **Absent `automation` block** + setting `trust` or `fix-rounds`:
  create the block with the other field at its normalized default
  (e.g. `config set fix-rounds 3` on a block-less config writes
  `{ "level": "manual", "max_fix_rounds": 3 }`). Setting `trust
  manual` keeps/creates the block explicitly — an explicit statement,
  never a delete.
- **`failover none`** writes `"failover_tiers": []` — explicit, not a
  key deletion (absent and `[]` are semantically identical per the
  schema; the subcommand always leaves the explicit form).
- **Failover aliases are not validated** beyond being non-empty
  strings — consistent with the schema ("they evolve with the
  platform").
- **Unknown knob** → error listing the five knob names, exit 1.
- **No `.lanes/config.json`** → the existing `loadConfig` refusals
  apply verbatim (not-a-Lanes-project error; legacy `config.md`
  pointer to `/lanes-doctor`).
- `config` with no subaction, or `set` with a missing argument →
  usage error, exit 1.

The CLI usage string gains
`config <get | set <knob> <value>>`.

## 4. The rename: `conveyor` → `roundabout`

The trust ladder becomes `manual | verdicts | roundabout | highways`.
Rationale: road-trip naming — a roundabout is road furniture; a
conveyor is not. The ladder's old nickname "the Roundabout trust
ladder" collides with the level name and is renamed to just **"the
trust ladder"** wherever live docs use it.

- **Validator**: the `automation.level` enum accepts `roundabout`,
  refuses `conveyor` — with a targeted hint when the rejected value is
  exactly `"conveyor"`: name the rename and the fix (edit
  `.lanes/config.json`, `automation.level` → `"roundabout"`). No
  schema version bump: one renamed enum value does not invalidate the
  vocabulary, and the hint IS the migration. `/lanes-doctor` needs no
  new machinery — the failing `schema` check surfaces the hint.
- **Live-surface sweep** (every non-historical `conveyor` mention):
  `bin/lanes-validate.mjs`, `commands/lanes-run.md`,
  `commands/lanes-highway.md`, `agents/lanes-stream-planner.md`,
  `agents/lanes-claude-implementer.md`, `skills/lanes/SKILL.md`,
  `templates/config.example.md`, `README.md`, `docs/USER-GUIDE.md`,
  and both test files.
- **Untouched**: everything under `docs/superpowers/specs/` and
  `docs/superpowers/plans/` (historical records), `whiteboard.md`,
  `docs/RELEASING.md`'s generation names, and code comments that cite
  historical spec *filenames*.

## 5. The command: `/lanes-config`

`commands/lanes-config.md` — a thin wrapper over the subcommand.

- **`/lanes-config`** (no argument): run `config get`, render the
  five knobs as a readable table — knob, current value, allowed
  values.
- **`/lanes-config <knob> <value>`**: run `config set`, then echo
  old → new and state plainly what the new value authorizes or
  changes. For `trust`, one line per the ladder's own definitions
  (e.g. roundabout: "`/lanes-run <plan>` now drives the whole task
  graph end-to-end; security-routed and attention-matched work still
  parks, REJECT still stops for a human"). For `failover`, name the
  quota consequence ("declaring failover tiers IS the
  pre-authorization to spend Claude quota on DELEGATE-routed work").
- **Applies immediately** — no confirmation prompt. Typing the
  command is the explicit human decision; the trust ladder is
  declared trust.
- On a `config set` failure, render the subcommand's error verbatim
  and stop — the file was not modified; there is nothing to undo.

Hard rules:

- The command never edits `.lanes/config.json` itself — the
  subcommand is the only write path, and its validation is the only
  gate.
- Never touches anything else: no source, no specs, no state, no
  other config keys.
- Not a Lanes project → report it and point at `/lanes-init`; never
  scaffold.

## 6. Deliverables

1. **Validator**: `config get` / `config set` per §3; the enum rename
   + `conveyor` hint per §4; usage string.
2. **Command**: `commands/lanes-config.md` per §5.
3. **Rename sweep**: the live surfaces listed in §4.
4. **Docs**: README command list + user guide gain `/lanes-config`;
   `templates/config.example.md` notes on the `automation` and
   `backend` blocks that the operational knobs are flippable via
   `/lanes-config`.
5. **Tests**:
   - Validator suite: `get` output shape (normalized defaults on a
     minimal config); each knob's set round-trip; invalid value
     leaves the file byte-identical and exits 1; absent-`automation`
     creation with defaults; `failover none` → `[]`; comma parsing
     with trim; strict integer refusals; unknown knob; the
     `conveyor` hint text.
   - Conformance: command-file needles for `/lanes-config` (the
     only-write-path rule, immediate-apply statement, the five knob
     names); no live surface outside the historical set matches
     `conveyor` (a sweep-completeness needle); VOCAB updated only in
     its `automation.level` allowed-values expectation, key names
     unchanged.

## 7. YAGNI — explicitly not building

- No generic `config set <any.json.path>` — five knobs, closed set.
- No structural-field editing (routing, commands, pipeline,
  review_suite, project).
- No confirmation prompts, no interactive wizard.
- No `conveyor` compatibility alias in the schema.
- No schema version bump.
- No `/lanes-trust` or other per-knob commands.
- No validation of Claude alias spellings in `failover`.
