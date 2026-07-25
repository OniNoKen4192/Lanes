# Path-matching semantics (normative)

How a changed or Touch-listed path is matched against the glob patterns
in `.lanes/config.json` (`routing.security_routed`, `routing.do_not_touch`) and in task
specs. `bin/lanes-validate.mjs` implements exactly these rules; its
`selftest` subcommand runs the examples table below as test vectors.
Agents never re-derive glob matches by judgment — the validator's output
is the matching authority.

## Rules

1. **Normalization.** Paths are repo-relative (relative to the git
   toplevel, not `app_subdir`). `\` is normalized to `/`. A leading `./`
   is stripped; trailing `/` is stripped. A path containing `..` or an
   absolute path is refused outright (it escapes the repo). So is any
   path containing `:` — repo-relative paths never legally contain a
   colon (this also rejects Windows drive-relative forms like
   `C:temp/x` and NTFS alternate data streams).
2. **Case-insensitive.** Matching ignores case. A security deny-list
   must not be dodgeable via `SRC/Auth.ts` on the case-insensitive
   filesystems most users run (Windows, macOS).
3. **Dialect.**
   - `*` matches within one segment (never crosses `/`).
   - `?` matches exactly one non-`/` character.
   - `**` crosses segments; a `**/` component (leading or mid-pattern)
     also matches zero segments.
   - `dir/**` matches everything strictly beneath `dir`, not `dir` itself.
   - A **literal pattern** (no `*`/`?`) matches the named path itself
     **and everything beneath it** — `prisma/migrations` behaves like
     gitignore's directory rule. A literal file pattern therefore matches
     only itself (`.env` does not match `.env.example`).
4. **Renames/copies.** Git `R*`/`C*` statuses contribute **both** sides
   as changed paths. A rename into a forbidden directory trips the gate,
   and so does a rename out of one.
5. **Symlinks.** A symlink is matched by its link path, not its target.
   A Touch path that is a symlink resolving outside the repo is a gate
   refusal.
6. **Submodules.** Submodule paths are opaque. A Touch path inside a
   submodule is a gate refusal — Lanes does not operate across submodule
   boundaries.
7. **Precedence.** Deny beats allow: a path matching `security_routed`
   or `do_not_touch` is forbidden even if it also matches a spec's Touch
   list or a pipeline allowlist entry.

## Examples (= `selftest` vectors)

| Pattern | Path | Match? | Rule |
|---|---|---|---|
| `src/auth.ts` | `src/auth.ts` | yes | literal |
| `src/auth.ts` | `SRC/Auth.ts` | yes | 2 (case) |
| `src/auth.ts` | `src/auth.ts.bak` | no | literal ≠ prefix |
| `prisma/migrations` | `prisma/migrations` | yes | 3 (literal dir: itself) |
| `prisma/migrations` | `prisma/migrations/0001/m.sql` | yes | 3 (literal dir: beneath) |
| `prisma/migrations` | `prisma/migrations2/x.sql` | no | segment boundary |
| `prisma/migrations/**` | `prisma/migrations/0001/m.sql` | yes | 3 (`**`) |
| `prisma/migrations/**` | `prisma/migrations` | no | 3 (`/**` strictly beneath) |
| `src/components/ui/**` | `src\components\ui\button.tsx` | yes | 1 (`\` → `/`) |
| `*.md` | `README.md` | yes | 3 (`*`) |
| `*.md` | `docs/README.md` | no | 3 (`*` ≠ `/`) |
| `**/*.test.ts` | `src/lib/x.test.ts` | yes | 3 (`**`) |
| `**/*.test.ts` | `x.test.ts` | yes | 3 (leading `**/` = zero segs) |
| `src/?pi.ts` | `src/api.ts` | yes | 3 (`?`) |
| `src/?pi.ts` | `src/a/pi.ts` | no | 3 (`?` ≠ `/`) |
| `.env` | `.env` | yes | literal |
| `.env` | `.env.example` | no | literal ≠ prefix |
