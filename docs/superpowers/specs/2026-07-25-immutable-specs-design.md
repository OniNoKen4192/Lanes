# Lanes — immutable specs, append-only amendments (design spec)

**Date:** 2026-07-25
**Status:** approved (Ken delegated design decisions for the remaining
slices)
**Author:** Claude, under Ken's standing direction
**Resolves:** issue [#8](https://github.com/OniNoKen4192/Lanes/issues/8)

## 1. What this is

Accepted deviations currently rewrite the original spec in place
(reviewer Phase 3 item 3 emits SPEC_UPDATE as old-text/new-text edits the
controller applies). The original contract is destroyed — the audit trail
becomes a polished history that forgets how the task changed. This slice
keeps original specs immutable after dispatch and records reality as
**append-only amendments**.

Decisions (mine, per the standing delegation):

1. **Appendix, not sidecar.** Amendments live in a `## Amendments`
   section at the end of the spec file itself — the contract stays one
   file (one dispatch input, one review input, one audit trail). The
   section is created at first use; emitted specs do not include it.
2. **The immutability boundary is machine-enforced.** The validator
   hashes only the **spec body** — everything above the `## Amendments`
   marker. Appending amendments never trips the audit's `spec_modified`
   tamper check; editing the original sections still does. The marker is
   the exact line `## Amendments` (regex `^## Amendments[ \t]*$`,
   multiline).
3. **Amendments are the human record, not enforcement input.** The
   audit's Touch/scope enforcement keys on the dispatch-time snapshot in
   `.lanes/state/` exactly as before; an amendment documents what the
   reviewer accepted (and why) for humans and future re-dispatches — it
   never widens what the machinery permits.
4. **SPEC_UPDATE stays as the mechanism** (the reviewer still has no
   Write tool; the controller still applies it) but its payload becomes
   a complete amendment entry to append, never an edit to the sections
   above the marker.

## 2. Validator change

New helper:

```js
function specBody(text) {
  return text.split(/^## Amendments[ \t]*$/m)[0];
}
```

- `gate` records `spec_sha256: sha256(specBody(specText))`.
- `audit` computes `spec_modified` as
  `sha256(specBody(specText)) !== state.spec_sha256`.

The gate (and `worktree create`) parse the spec from `specBody(...)` as
well — the parsed contract and the hashed contract are the same region,
so Meta/Touch sections below the marker hit the existing fail-closed
refusals instead of being silently enforced-from. The gate additionally
records `spec_appendix_sha256` (hash from the marker down, `""` when
absent) and the audit reports `spec_appendix_modified` as an
informational field: a controller-applied amendment between rounds
legitimately changes it, so the reviewer rules on it rather than the
verdict tripping automatically — but a delegate-authored appendix now
has a deterministic tell.

## 3. Amendment entry format

Appended under `## Amendments` (section created at first use), one `###`
entry per accepted deviation, numbered in order:

```markdown
## Amendments

### A1 — <YYYY-MM-DD> — accepted deviation
- **Original sha256**: <spec_sha256 from .lanes/state/<task-id>.json>
- **Verdict ref**: <verdict (APPROVE/FIX) + task id + reviewer>
- **Deviation**: <what was done differently than the original contract>
- **Reason accepted**: <the reviewer's rationale>
- **Affected paths**: <paths involved>
- **Acceptance criteria**: <replacement criteria if changed, else "unchanged">
```

This carries every field the issue calls for: original-content hash,
reason, reviewer identity/verdict reference, affected paths, timestamp,
replacement acceptance criteria. The effective contract is the original
body plus the ordered amendments.

## 4. Prose changes

- **`agents/lanes-reviewer.md`**
  - Phase 3 item 3 (Accepted): original sections are immutable after
    dispatch; reality is recorded by appending an amendment — SPEC_UPDATE
    carries the complete entry for the controller to append under
    `## Amendments` (created at first use). Never old/new edits.
  - Phase 5 `SPEC_UPDATE` field: documents the §3 entry format inline.
  - Hard Rules "ONE file exception": appending the amendment is the one
    spec-file change, via the controller, never edits above the marker.
- **`templates/TEMPLATE.md`**
  - Reviewer Checklist item 4: accepted ⇒ appended amendment entry
    (original sections immutable), rejected ⇒ delta spec.
  - New short section after the template block: "Amendments (created at
    first use — not authored at emission)" explaining the marker, the
    append-only rule, the body-only hash, and that machine enforcement
    keys on dispatch-time state.
- No changes to `/lanes-emit` (its no-overwrite guard already stands),
  the skill, or README.

## 5. Conformance tests

Behavioral (`tests/validator.test.mjs`):

1. Appending a `## Amendments` section (with an entry) to a dispatched
   spec does **not** trip `spec_modified`; audit verdict stays `clean`.
2. Editing the body *and* appending amendments still trips
   `spec_modified` (`violations`).

Structural (`tests/conformance.test.mjs`, one new test): the reviewer
file references `## Amendments` and `Original sha256`; `TEMPLATE.md`
contains the `## Amendments` guidance section and the word `immutable`
in Reviewer Checklist item 4.

## 6. Out of scope

- Amendment-aware re-dispatch (a future gate could verify the recorded
  original hash chain) — YAGNI until re-dispatch of amended specs is a
  real flow.
- Signing/attestation of amendments; controller-applied append is
  trusted exactly as much as controller-applied edits were.
