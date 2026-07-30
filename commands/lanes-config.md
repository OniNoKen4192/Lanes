---
description: >
  Read and set the five operational knobs in `.lanes/config.json`:
  `trust` (automation.level), `fix-rounds` (automation.max_fix_rounds),
  `approval` (backend.approval_mode), `tiers` (backend.tiers), and
  `failover` (backend.failover_tiers). No argument shows current
  values; `<knob> <value>` sets one — validated before the write,
  applied immediately, fail-closed.
argument-hint: [<knob> <value>]
---

# /lanes-config [<knob> <value>] — the operational knobs

Run from the root of a Lanes project. These are the settings you flip
between runs; structural config (routing globs, commands, pipeline
paths, review_suite, project) is hand-edited and checked by
`/lanes-doctor` — never changed from here.

## No argument — show the knobs

Run (Bash):

    node "${CLAUDE_PLUGIN_ROOT}/bin/lanes-validate.mjs" config get

Render its JSON as a table — knob, current value, allowed values:

| Knob | Sets | Allowed |
|---|---|---|
| `trust` | `automation.level` | `manual` \| `verdicts` \| `roundabout` \| `highways` |
| `fix-rounds` | `automation.max_fix_rounds` | integer ≥ 1 |
| `approval` | `backend.approval_mode` | `pilot` \| `automated` |
| `tiers` | `backend.tiers` | comma-separated tier names, best→cheapest |
| `failover` | `backend.failover_tiers` | comma-separated Claude aliases, or `none` |

On error, render the subcommand's reason verbatim and stop — when
there is no config, point at `/lanes-init`.

## `<knob> <value>` — set one

Run (Bash), quoting the value:

    node "${CLAUDE_PLUGIN_ROOT}/bin/lanes-validate.mjs" config set <knob> "<value>"

Apply immediately — typing the command IS the explicit human decision;
never ask for confirmation. On `ok: true`, report old → new, then
state plainly what the new value means:

- `trust manual` — every stage change is a human handoff again.
- `trust verdicts` — reviewer verdicts are acted on unattended
  (APPROVE → merge + clean up; FIX → re-dispatch up to the cap).
  REJECT still always stops for a human.
- `trust roundabout` — `/lanes-run <plan>` now drives the whole task
  graph end-to-end; security-routed and attention-matched work still
  parks, REJECT still stops for a human.
- `trust highways` — `/lanes-highway <feature>` may run the full
  two-level stream orchestration; includes everything `roundabout`
  authorizes.
- `fix-rounds N` — a task now gets N FIX rounds before parking as
  needs-human.
- `approval pilot` / `approval automated` — the DELEGATE backend asks
  on-request / never asks.
- `tiers …` — the DELEGATE tier ladder, best→cheapest.
- `failover …` — declaring failover tiers IS the pre-authorization to
  spend Claude quota on DELEGATE-routed work when the backend's tiers
  are exhausted; `failover none` revokes it.

On `ok: false`, render the reason verbatim and stop — the file was not
modified; there is nothing to undo.

## Hard rules

- Never edit `.lanes/config.json` yourself — the `config set`
  subcommand is the ONLY write path, and its validation is the only
  gate. If it refuses, fix the value; never hand-edit around it.
- The five knobs are the complete set; never change any other config
  key from this command.
- Never touch anything else: no source, no specs, no `.lanes/state/`.
- Not a Lanes project → report it and point at `/lanes-init`; never
  scaffold.
