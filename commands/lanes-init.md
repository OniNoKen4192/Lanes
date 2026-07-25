---
description: >
  Onboarding entry point for the Lanes cross-model pipeline. Inspects the
  current project (package manifest, verification commands, source tree,
  existing conventions) and drafts `.lanes/config.json` — the one per-project
  file every other Lanes command and agent reads. Refuses below a named
  readiness floor instead of guessing; interviews you only on what
  inspection could not settle; never overwrites an existing config.
---

# /lanes-init — inspect a project, draft its Lanes config

No argument. Run this once, from the root of the project you want Lanes to
operate on. It reads; it does not modify your source. Its only writes are
`.lanes/config.json` (and, optionally, a starter `AGENTS.md`) — both gated by
the no-clobber rule in Phase 3.

## The discipline (read before doing anything)

**Infer what you can read, ask about the residue, never guess a
security-routed list into existence.** Every field in the emitted config
is either (a) read directly off the repo, (b) proposed from a pattern
match and then confirmed by the user, or (c) asked for directly because
nothing in the repo settles it. A field never reaches the output file by
invention. If Phase 1 can't find evidence for something, Phase 2 asks —
it does not fill the blank with a plausible-looking default.

Follow the four phases below in order. Where they conflict with your
instincts, the procedure wins.

## Phase 0 — readiness floor (refuse below it)

Before reading anything else, check the project against three requirements.
**All three must hold, or write nothing.**

1. **A recognized package manifest exists at or near the repo root.**
   Look for one of (this list is illustrative, not exhaustive — recognize
   the equivalent for whatever stack you find): `package.json`,
   `pyproject.toml` / `setup.cfg`, `Cargo.toml`, `go.mod`, `Gemfile`,
   `pom.xml` / `build.gradle`, `composer.json`.
2. **At least one runnable verification command is derivable from that
   manifest** — a test script, task, or documented command you can point
   at (it does not need to pass yet; it needs to exist and be nameable).
3. **A non-trivial source tree** — more than just the manifest plus a
   README. There must be real source files for inspection to read.

If **any** of the three is missing, stop immediately:

- Write nothing — no `.lanes/` directory, no `AGENTS.md`, nothing.
- Report exactly which of the three requirements failed (name it, don't
  just say "not ready").
- Print the greenfield path, verbatim:

  > Lanes needs a formed project. Build the walking skeleton first with
  > superpowers (brainstorming → writing-plans → executing-plans) until
  > you have a manifest, a test command, and real source — then re-run
  > `/lanes-init`.

Do not proceed to Phase 1 in this case, and do not offer to "start
anyway" — the floor exists precisely so Lanes never routes work against
guessed facts.

## Phase 1 — inspect

With the floor cleared, read the project before asking anything. Everything
found here is a **proposal** for Phase 2 to confirm, not a final answer.

- **Manifest → stack, package manager, script names.** Read the manifest
  found in Phase 0. Extract whatever it exposes about the toolchain
  (declared scripts/tasks, package manager lockfile if present — e.g. a
  `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `poetry.lock`,
  `Cargo.lock`, `Gemfile.lock`, etc. — language version markers) and map
  named scripts onto the config's verification
  fields: `test`, `lint`, `typecheck`, `acceptance_runner` (usually the
  same command as `test` unless the project distinguishes "run everything"
  from "run one target").
- **`app_subdir` / `command_prefix`.** Locate the manifest/app root: is the
  repo root itself the app, or does the real manifest live one level down
  (a workspace layout with the actual app in a subdirectory)? Propose
  `app_subdir` accordingly (empty string if the repo root IS the app) and
  derive `command_prefix` from it (a `cd <app_subdir> &&` prefix, or empty).
- **Security-routed candidates.** Grep the source tree for filenames and
  paths that suggest authentication, authorization, session handling, or a
  data-model/schema boundary: names containing `auth`, `authz`, or
  `session`; ORM/data-model definition files (for example a schema
  definition file, a `models.py`, or an equivalent models file for your
  stack's ORM); and any `migrations/` directory. Collect the matches into a
  **proposed** `security_routed` list — do not write it to the config yet;
  Phase 2 confirms it.
- **Do-not-touch candidates.** Skim the README/CONTRIBUTING (if present)
  for explicit "do not touch" notes, and look for the common categories
  that belong here regardless of what the docs say: a checked-in
  lockfile, `.env` / `.env.example`, and any vendored/pinned UI-primitive
  directory. Propose these as a starting `do_not_touch` list.
- **Existing conventions.** Check for an existing `AGENTS.md` or
  `CLAUDE.md` at the repo root. If one exists, read it for conventions
  worth carrying forward (stack facts, standing exclusions) — do not
  overwrite it in Phase 3 either way; the no-write-to-AGENTS.md-if-present
  rule is separate from and in addition to the `.lanes/config.json`
  no-clobber rule.
- **Review suite.** Look for an end-to-end / UX test directory or a
  documented workflow-ID coverage table distinct from the unit test
  command already found. If one exists, propose a `review_suite` block
  (suite command, ID pattern, coverage-index doc); if none exists, propose
  omitting the `review_suite` block entirely — it is optional and the
  reviewer stage degrades gracefully without it.
- **Pipeline locations.** Check whether the repo already has a
  `docs/superpowers/` or `.superpowers/sdd/` layout in use. If so, propose
  `plans_dir` / `tasks_dir` / `ledger` matching that existing layout;
  otherwise propose the documented defaults (see `config.example.md`).

## Phase 2 — residue interview (one question at a time)

Ask **only** what Phase 1 could not settle from evidence. Do not present a
long form; ask sequentially, one question at a time, and let each answer
inform whether the next question is even still needed. Cover, in this
order:

1. **Security-routed list.** Show the proposed list from Phase 1 (or say
   plainly that nothing matched). Ask the user to confirm, trim, or add to
   it. Never finalize this list without an explicit confirmation — this is
   the one field the discipline calls out by name: it is proposed, never
   assumed.
2. **Backend + tiers.** Confirm the delegate backend and its tier names.
   Default to the backend and the three example tier names already shown
   in `config.example.json` (best → cheapest), and offer to rename the tiers
   to whatever labels the user prefers.
3. **`app_subdir` / `command_prefix`.** Confirm the Phase 1 proposal, or
   ask directly if Phase 1 found no clear single app root (e.g. more than
   one plausible manifest, or an ambiguous workspace layout).
4. **Review suite.** Confirm whether the Phase 1 proposal (include or
   omit) is correct. If the user says a review suite applies but Phase 1
   found no candidate, ask for the suite command and its ID/coverage
   source directly.
5. **Approval mode.** Ask whether the delegate backend should run in
   `pilot` mode (asks on-request before acting) or `automated` mode (never
   asks) — this is a policy choice, not something inferable from the repo.

If Phase 1 already produced a confident, unambiguous answer for one of
these (for example, a single obvious manifest root with no workspace
ambiguity), it is fine to state the inferred value and ask for a quick
confirm rather than an open question — but still confirm it. Skip a
question's open-ended form only when there is truly nothing to ask (e.g.
Phase 1 found no e2e suite AND the user has already confirmed "omit").

## Phase 3 — emit + confirm

**No-clobber, checked first.** If `.lanes/config.json` already exists in
this repo, **do not overwrite it.** Report that it already exists and
stop — the same rule the emitter observes for individual spec files. This
check happens before any writing, not after drafting. (A repo with only a
legacy Markdown config is not a clobber case — it has no `config.json`; note
that `/lanes-doctor` also offers a direct migration, and proceed only if
the user prefers a fresh init.)

With the floor clear and no existing config in the way:

1. Read `${CLAUDE_PLUGIN_ROOT}/templates/config.example.json` in full — it
   is the output shape and the frozen field-name contract — and
   `${CLAUDE_PLUGIN_ROOT}/templates/config.example.md`, the field-by-field
   reference explaining what each key means. Resolve them via Bash, e.g.
   `cat "${CLAUDE_PLUGIN_ROOT}/templates/config.example.json"`.
2. Write `.lanes/config.json` as a schema-v1 JSON file in exactly the
   `config.example.json` shape (`schema_version: 1` and the `project`,
   `commands`, `backend`, `routing`, `pipeline` blocks; `review_suite` and
   `automation` are the two blocks that may be omitted entirely when Phase 2
   confirms there is no suite), with the illustrative example values replaced by
   this project's inferred-and-confirmed values from Phases 1–2. JSON
   carries no comments — the guidance lives in `config.example.md`; do
   not try to embed commentary. `backend.ratelimit_signal` is an array of
   substrings. `""` is allowed for `commands.lint` / `commands.typecheck`
   when the project has no such step.
3. **`AGENTS.md`.** If the repo has no `AGENTS.md` (Phase 1), offer to
   write a starter stub — not a full architecture document. The stub
   states the stack, the verification commands, and the standing
   do-not-touch list, and points at `.lanes/config.json` as the source of
   truth for pipeline parameters. Do **not** fabricate architecture prose,
   history, or design rationale you have no evidence for; leave explicit
   `TODO` markers for sections only the user can fill in. If an
   `AGENTS.md` already exists, leave it untouched — offer only to note
   where it should reference `.lanes/config.json`, and let the user apply
   that edit themselves.
4. Show the full draft of `.lanes/config.json` (and the `AGENTS.md` stub,
   if offered and accepted) before finishing.
5. Print next steps, in this order: review the draft; commit `.lanes/` and
   `AGENTS.md`; run `/lanes-doctor` to verify the config against the
   repo; then plan your first effort — lane assignment happens during
   `writing-plans`, per the lanes skill.

## Report format

End with:

1. **Readiness result** — pass, or the exact missing requirement(s) plus
   the greenfield path (Phase 0).
2. **Inspection findings** — what was read and what was proposed from it
   (manifest facts, `app_subdir`, security-routed candidates, do-not-touch
   candidates, existing `AGENTS.md`/review-suite findings), for each item
   that was actually available in Phase 1.
3. **Interview answers** — each Phase 2 question actually asked and the
   confirmed answer; note any question skipped because Phase 1 already
   settled it with a quick confirm rather than an open ask.
4. **Files written** — `.lanes/config.json` path, and `AGENTS.md` path if
   a stub was written; or, on the no-clobber path, the single line
   reporting that `.lanes/config.json` already existed and nothing was
   written.
5. **Next steps** — the Phase 3 message verbatim.
