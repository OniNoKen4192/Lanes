# Releasing

Lanes versions track the road-trip feature generations: the **major** is
the current generation (1 = the original pipeline, 2 = Roundabout,
3 = Highways), the **minor** bumps once per feature wave inside a
generation, and the **patch** bumps for fix-only releases. History for
the record: 3.0.0 = Highways, 3.1.0 = Claude failover, 3.2.0 = Rest stop
(versions before 3.2.0 were never published — the manifests sat at 0.1.0
until 2026-07-26).

Per release, in the same commit as (or immediately after) the merge:

1. Bump `version` in BOTH `.claude-plugin/plugin.json` and
   `.claude-plugin/marketplace.json` — a conformance test fails if they
   differ. The marketplace uses this field to tell installed copies an
   update exists; an unbumped version ships silent updates to no one.
2. Commit and push, then tag and publish the release:

       git tag v<version>
       git push origin v<version>
       gh release create v<version> --title "v<version> — <wave name>" --notes "<what shipped, in a few lines>"
