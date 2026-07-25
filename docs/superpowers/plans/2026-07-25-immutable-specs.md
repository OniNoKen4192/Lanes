# Immutable Specs / Append-Only Amendments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Original spec sections become immutable after dispatch; accepted deviations are recorded as append-only `## Amendments` entries, with the validator hashing only the spec body so the appendix can grow without tripping the tamper check.

**Architecture:** One `specBody()` helper + two hash-site changes in the validator; reviewer/TEMPLATE prose moves SPEC_UPDATE from old/new edits to appended amendment entries; three new tests.

**Tech Stack:** Plain Node ESM (zero deps), Markdown prompt files, node:test.

**Design spec:** `docs/superpowers/specs/2026-07-25-immutable-specs-design.md` (§ refs below).

## Global Constraints

- The amendments marker is the exact line `## Amendments` (`/^## Amendments[ \t]*$/m`). Everything above it is the immutable body; the validator hashes ONLY the body (§2).
- Amendments never widen machine enforcement — audit still keys on the dispatch-time state snapshot (§1.3). No change to Touch parsing, allowlists, or verdict logic.
- SPEC_UPDATE remains the reviewer→controller mechanism; its payload is now a complete §3-format amendment entry, never old/new edits.
- The five-status taxonomy sites, DONE-token absence, and all existing conformance invariants must stay green: bare `node --test` goes 36/36 → 39/39; selftest counts unchanged.
- Only these files change: `bin/lanes-validate.mjs`, `tests/validator.test.mjs`, `tests/conformance.test.mjs`, `agents/lanes-reviewer.md`, `templates/TEMPLATE.md`.

---

### Task 1: Validator — body-only hashing + behavioral tests

**Files:**
- Modify: `bin/lanes-validate.mjs`, `tests/validator.test.mjs`

- [ ] **Step 1: Add `specBody` and switch the two hash sites.** In `bin/lanes-validate.mjs`, insert immediately after the `parseSpec` function:

```js
// The immutable contract is everything ABOVE the "## Amendments" marker
// (design spec 2026-07-25-immutable-specs §2). Amendments are an
// append-only audit trail: hashing only the body lets the appendix grow
// without tripping spec_modified, while any edit to the original
// sections still trips it.
function specBody(text) {
  return text.split(/^## Amendments[ \t]*$/m)[0];
}
```

In `runGate`, replace:

```js
    spec_sha256: sha256(specText),
```

with:

```js
    spec_sha256: sha256(specBody(specText)),
```

In `runAudit`, replace:

```js
    spec_modified: sha256(specText) !== state.spec_sha256,
```

with:

```js
    spec_modified: sha256(specBody(specText)) !== state.spec_sha256,
```

- [ ] **Step 2: Add two behavioral tests** to `tests/validator.test.mjs` (same fixture idioms as the existing audit tests — own fixture per describe, gate first, then mutate, then audit):

| Test | Setup | Assert |
|---|---|---|
| `audit: appended amendments do not trip spec_modified` | golden gate on default fixture; then append to `docs/tasks/T1.md`: `"\n## Amendments\n\n### A1 — 2026-07-25 — accepted deviation\n- **Deviation**: example\n"`; also make an in-scope edit to `src/lib/thing.js` | audit: status 0, `verdict === "clean"`, `spec_modified === false` |
| `audit: body edit plus amendments still trips spec_modified` | golden gate; REPLACE the spec's `## Meta` line with `## Meta\n<!-- tampered -->` (a body edit) AND append the same amendments block | audit: status 2, `verdict === "violations"`, `spec_modified === true` |

- [ ] **Step 3: Run** — bare `node --test` → 38/38 (36 + 2); selftest green (counts unchanged).

- [ ] **Step 4: Commit** — `git add bin/lanes-validate.mjs tests/validator.test.mjs && git commit -m "feat: spec_modified hashes only the spec body — amendments append freely"`

---

### Task 2: Prose — reviewer + TEMPLATE amendments discipline, structural test

**Files:**
- Modify: `agents/lanes-reviewer.md`, `templates/TEMPLATE.md`, `tests/conformance.test.mjs`

- [ ] **Step 1: `agents/lanes-reviewer.md`** — three exact replacements:

(1) Phase 3 item 3 Accepted bullet — replace:

```
   - **Accepted** — the deviation is an improvement or a neutral
     necessity. The spec must then be updated to match reality so the
     audit trail stays truthful. You have no Write tool: emit the
     exact edit in the SPEC_UPDATE section of your verdict (file,
     old text, new text) for the controller to apply. Never mark a
     deviation accepted without its SPEC_UPDATE entry.
```

with:

```
   - **Accepted** — the deviation is an improvement or a neutral
     necessity. The original spec sections are IMMUTABLE after
     dispatch: reality is recorded by APPENDING an amendment, never by
     rewriting the contract — a polished history that forgets how the
     task changed is worse than the deviation it hides. You have no
     Write tool: emit the complete amendment entry in the SPEC_UPDATE
     section of your verdict for the controller to append under the
     spec's `## Amendments` section (created at the file's end on
     first use). Never mark a deviation accepted without its
     SPEC_UPDATE entry.
```

(2) Phase 5 SPEC_UPDATE field — replace:

```
    SPEC_UPDATE: <exact edits for accepted deviations: file, old text,
      new text — or "none">
```

with:

```
    SPEC_UPDATE: <for each accepted deviation, the complete amendment
      entry to APPEND under the spec's `## Amendments` section — or
      "none". Append-only: never edits to the sections above the
      marker. Entry format:

      ### A<n> — <YYYY-MM-DD> — accepted deviation
      - **Original sha256**: <spec_sha256 from .lanes/state/<task-id>.json>
      - **Verdict ref**: <this verdict + task id + lanes-reviewer>
      - **Deviation**: <what was done differently>
      - **Reason accepted**: <why>
      - **Affected paths**: <paths involved>
      - **Acceptance criteria**: <replacement criteria, or "unchanged">>
```

(3) Hard Rules ONE-file exception — replace:

```
- **The ONE file exception:** accepted deviations require the spec
  file to be updated — but via SPEC_UPDATE instructions in your
  verdict for the controller to apply, never by you.
```

with:

```
- **The ONE file exception:** accepted deviations require an amendment
  APPENDED to the spec file — but via the SPEC_UPDATE entry in your
  verdict for the controller to append, never by you, and never as an
  edit to the sections above the `## Amendments` marker. The validator
  hashes only the content above the marker, so appended amendments
  never trip the audit's `spec_modified` tamper check — a body edit
  still does.
```

- [ ] **Step 2: `templates/TEMPLATE.md`** — two exact replacements:

(1) Reviewer Checklist item 4 — replace:

```
4. DEVIATIONS section reviewed: each deviation either accepted (and the spec
   file updated to match) or rejected (task returns to fixer with a delta spec)
```

with:

```
4. DEVIATIONS section reviewed: each deviation either accepted (recorded
   as an appended `## Amendments` entry — the original sections are
   immutable after dispatch) or rejected (task returns to fixer with a
   delta spec)
```

(2) Insert a new section between the template block's closing `----` separator line (the `---` after the closing ` ```` ` fence) and `## Planner Emission Rules (for the planner, KEEP lane)` — i.e. replace:

```
## Planner Emission Rules (for the planner, KEEP lane)
```

with:

```
## Amendments (created at first use — never authored at emission)

Emitted specs do not include an `## Amendments` section. The first
accepted deviation creates it at the end of the file; every entry is
appended by the controller from the reviewer's SPEC_UPDATE, and the
sections above the marker are never edited after dispatch. The
validator hashes only the content above the marker (`spec_sha256` in
the baseline record), so appending amendments never trips the audit's
`spec_modified` tamper check — editing the original contract still
does. Machine enforcement (the audit's Touch snapshot) keys on
dispatch-time state; amendments are the human-readable record of how
the contract evolved: hash of the original, verdict reference, the
deviation, the acceptance rationale, affected paths, and replacement
acceptance criteria when they changed.

## Planner Emission Rules (for the planner, KEEP lane)
```

- [ ] **Step 3: Structural test** — append one test to `tests/conformance.test.mjs` (same idioms; name it `§5.12 amendments discipline`):

- reviewer file: includes `` `## Amendments` `` and `Original sha256` and does NOT include `old text,\n      new text` (the retired edit-format phrase — assert `!content.includes("old text,")`).
- `templates/TEMPLATE.md`: includes `## Amendments (created at first use` and Reviewer Checklist item 4 includes `immutable`.

- [ ] **Step 4: Run** — bare `node --test` → 39/39; selftest green.

- [ ] **Step 5: Commit** — `git add agents/lanes-reviewer.md templates/TEMPLATE.md tests/conformance.test.mjs && git commit -m "feat: append-only spec amendments — reviewer + TEMPLATE discipline, conformance pin"`
