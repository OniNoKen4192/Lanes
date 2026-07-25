// Structural conformance suite for the Lanes plugin sources.
// Never imports bin/lanes-validate.mjs (it executes its CLI at module
// bottom) — source-level invariants are asserted textually via read().
// One test() per spec item (docs/superpowers/specs/
// 2026-07-25-conformance-suite-design.md §5); test names cite the item.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { read, repoRoot } from "./helpers.mjs";

function listMdFiles(dir) {
  return fs
    .readdirSync(path.join(repoRoot, dir))
    .filter((f) => f.endsWith(".md"))
    .map((f) => `${dir}/${f}`)
    .sort();
}

// Recursively lists every file under `relDir`, as repo-relative,
// forward-slash paths.
function walkFiles(relDir) {
  const out = [];
  (function rec(dirAbs, prefix) {
    for (const entry of fs.readdirSync(dirAbs, { withFileTypes: true })) {
      const childAbs = path.join(dirAbs, entry.name);
      const childRel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) rec(childAbs, childRel);
      else out.push(`${relDir}/${childRel}`);
    }
  })(path.join(repoRoot, relDir), "");
  return out;
}

// ------------------------------------------------------------- §5.1

test("§5.1 plugin manifest", () => {
  const manifest = JSON.parse(read(".claude-plugin/plugin.json"));
  assert.equal(manifest.name, "lanes");
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.ok(
    typeof manifest.description === "string" && manifest.description.trim().length > 0,
    "manifest description should be non-empty"
  );
});

// ------------------------------------------------------------- §5.2

test("§5.2 hooks lockstep", () => {
  const hooks = JSON.parse(read("hooks/hooks.json"));
  assert.equal(hooks.hooks.PreToolUse.length, 1);
  const pre = hooks.hooks.PreToolUse[0];
  const config = JSON.parse(read("templates/config.example.json"));
  assert.equal(pre.matcher, config.backend.dispatch_tool);
  const command = pre.hooks[0].command;
  assert.ok(command.includes("hooks/lanes-dispatch-gate.mjs"), "hook command should reference the dispatch gate script");
  assert.ok(fs.existsSync(path.join(repoRoot, "hooks/lanes-dispatch-gate.mjs")), "hooks/lanes-dispatch-gate.mjs should exist");
});

// ------------------------------------------------------------- §5.3

test("§5.3 frontmatter", () => {
  const agentFiles = listMdFiles("agents");
  const commandFiles = listMdFiles("commands");
  const skillFile = "skills/lanes/SKILL.md";
  const nameRequired = new Set([...agentFiles, skillFile]);

  for (const f of [...agentFiles, ...commandFiles, skillFile]) {
    const content = read(f);
    assert.ok(content.startsWith("---\n"), `${f} should start with a --- frontmatter fence`);
    const closeIdx = content.indexOf("\n---", 4);
    assert.ok(closeIdx !== -1, `${f} frontmatter should be closed with a second ---`);
    const front = content.slice(0, closeIdx);
    const descMatch = front.match(/^description:\s*(.*)$/m);
    assert.ok(descMatch, `${f} frontmatter should contain description:`);
    const descValue = descMatch[1].trim();
    if (descValue === "" || descValue === ">") {
      const after = front.slice(front.indexOf(descMatch[0]) + descMatch[0].length);
      const nextLine = after.split("\n")[1] ?? "";
      assert.ok(
        nextLine.trim().length > 0,
        `${f} frontmatter description: should have non-empty content on the following line`
      );
    } else {
      assert.ok(descValue.length > 0, `${f} frontmatter description: should be non-empty`);
    }
    if (nameRequired.has(f)) {
      assert.ok(front.includes("name:"), `${f} frontmatter should contain name:`);
    }
  }
});

// ------------------------------------------------------------- §5.4

test("§5.4 cross-references resolve", () => {
  const files = [...listMdFiles("agents"), ...listMdFiles("commands"), "skills/lanes/SKILL.md", ...listMdFiles("templates")];
  const re = /\$\{CLAUDE_PLUGIN_ROOT\}\/([A-Za-z0-9_\-./]+)/g;
  let checked = 0;
  for (const f of files) {
    const content = read(f);
    for (const m of content.matchAll(re)) {
      checked++;
      let captured = m[1];
      captured = captured.replace(/\.$/, "");
      assert.ok(
        fs.existsSync(path.join(repoRoot, captured)),
        `${f}: \${CLAUDE_PLUGIN_ROOT}/${captured} should resolve to an existing file`
      );
    }
  }
  assert.ok(checked > 0, "expected at least one ${CLAUDE_PLUGIN_ROOT}/... cross-reference to check");
});

// ------------------------------------------------------------- §5.5

test("§5.5 config vocabulary sync", () => {
  const VOCAB = {
    project: ["app_subdir", "command_prefix"],
    commands: ["test", "lint", "typecheck", "acceptance_runner"],
    backend: ["name", "dispatch_tool", "reply_tool", "approval_mode", "tiers", "ratelimit_signal"],
    routing: ["security_routed", "do_not_touch"],
    review_suite: ["suite_command", "id_pattern", "id_index", "route_map"],
    pipeline: ["plans_dir", "tasks_dir", "ledger"],
    automation: ["level", "max_fix_rounds"],
  };

  // (a) templates/config.example.json key paths equal VOCAB exactly.
  const config = JSON.parse(read("templates/config.example.json"));
  const expectedTop = ["schema_version", ...Object.keys(VOCAB)].sort();
  assert.deepEqual(Object.keys(config).sort(), expectedTop, "config.example.json top-level keys should match VOCAB exactly");
  for (const [block, fields] of Object.entries(VOCAB)) {
    assert.deepEqual(
      Object.keys(config[block]).sort(),
      [...fields].sort(),
      `config.example.json block '${block}' keys should match VOCAB exactly`
    );
  }

  // (b) validator's SCHEMA_V1 declares the same block/field names.
  const src = read("bin/lanes-validate.mjs");
  const schemaMatch = src.match(/const SCHEMA_V1 = \{([\s\S]*?)\n\};/);
  assert.ok(schemaMatch, "expected to find a SCHEMA_V1 = { ... }; block in the validator source");
  const schemaText = schemaMatch[1];
  for (const block of Object.keys(VOCAB)) {
    assert.ok(schemaText.includes(block), `SCHEMA_V1 should contain block name '${block}'`);
  }
  for (const fields of Object.values(VOCAB)) {
    for (const field of fields) {
      assert.ok(schemaText.includes(field), `SCHEMA_V1 should contain field name '${field}'`);
    }
  }
  const blockNames = new Set(Object.keys(VOCAB));
  const allFields = new Set(Object.values(VOCAB).flat());
  const candidates = [...schemaText.matchAll(/^\s{2,}([a-z_]+):/gm)].map((m) => m[1]);
  assert.ok(candidates.length > 0, "expected to extract at least one candidate key from SCHEMA_V1");
  for (const c of candidates) {
    assert.ok(
      blockNames.has(c) || allFields.has(c),
      `SCHEMA_V1 candidate key '${c}' is not a known VOCAB block or field name`
    );
  }

  // (c) templates/config.example.md has a heading for every block plus schema_version.
  const configMd = read("templates/config.example.md");
  assert.ok(configMd.includes("## `schema_version`"), "config.example.md should have a '## `schema_version`' heading");
  for (const block of Object.keys(VOCAB)) {
    assert.ok(configMd.includes(`## \`${block}\``), `config.example.md should have a '## \`${block}\`' heading`);
  }

  // (d) commands/lanes-doctor.md's migration maps every legacy field name.
  const doctorMd = read("commands/lanes-doctor.md");
  const legacyFields = [
    "app_subdir",
    "command_prefix",
    "test",
    "lint",
    "typecheck",
    "acceptance_runner",
    "dispatch_tool",
    "reply_tool",
    "approval_mode",
    "tiers",
    "ratelimit_signal",
    "security_routed",
    "do_not_touch",
    "review_suite",
    "plans_dir",
    "tasks_dir",
    "ledger",
  ];
  for (const field of legacyFields) {
    assert.ok(doctorMd.includes(field), `lanes-doctor.md should mention legacy field '${field}'`);
  }
  assert.ok(doctorMd.includes("schema_version: 1"), "lanes-doctor.md should mention 'schema_version: 1'");

  // (e) commands/lanes-init.md names every required block.
  const initMd = read("commands/lanes-init.md");
  for (const block of ["project", "commands", "backend", "routing", "pipeline", "review_suite"]) {
    assert.ok(initMd.includes(`\`${block}\``), `lanes-init.md should mention '\`${block}\`'`);
  }
  assert.ok(initMd.includes("schema_version: 1"), "lanes-init.md should mention 'schema_version: 1'");
});

// ------------------------------------------------------------- §5.6

test("§5.6 status taxonomy lockstep", () => {
  const ENUM = "IMPLEMENTED | IMPLEMENTED_WITH_DEVIATIONS | BLOCKED | BACKEND_FAILURE | RATE_LIMITED";
  const count = (text, needle) => text.split(needle).length - 1;

  assert.equal(count(read("agents/lanes-implementer.md"), ENUM), 1, "implementer should enumerate the taxonomy exactly once");
  assert.equal(count(read("templates/TEMPLATE.md"), ENUM), 1, "TEMPLATE.md should enumerate the taxonomy exactly once");
  assert.equal(count(read("agents/lanes-reviewer.md"), ENUM), 0, "reviewer should never enumerate the taxonomy");

  // Standalone-DONE check.
  const files = [
    ...walkFiles("agents"),
    ...walkFiles("commands"),
    ...walkFiles("skills"),
    ...walkFiles("templates"),
    "README.md",
  ];
  for (const f of files) {
    const content = read(f);
    assert.ok(!/\bDONE\b/.test(content), `${f} should not contain a standalone DONE token`);
  }

  // Pairing rule presence.
  const implementer = read("agents/lanes-implementer.md");
  assert.ok(implementer.includes('DEVIATIONS is "none"'), 'implementer should contain DEVIATIONS is "none"');
  assert.ok(implementer.includes("DEVIATIONS must be non-empty"), "implementer should contain DEVIATIONS must be non-empty");

  const reviewer = read("agents/lanes-reviewer.md");
  assert.ok(
    reviewer.includes('IMPLEMENTED requires DEVIATIONS "none"'),
    'reviewer should contain IMPLEMENTED requires DEVIATIONS "none"'
  );
  assert.ok(
    reviewer.includes("requires a non-empty DEVIATIONS list"),
    "reviewer should contain requires a non-empty DEVIATIONS list"
  );
});

// ------------------------------------------------------------- §5.7

test("§5.7 config-path sweep", () => {
  const allowed = new Set(["commands/lanes-doctor.md", "bin/lanes-validate.mjs", "templates/config.example.md"]);
  const files = [
    ...walkFiles("agents"),
    ...walkFiles("commands"),
    ...walkFiles("skills"),
    ...walkFiles("templates"),
    ...walkFiles("bin"),
    ...walkFiles("hooks"),
    "README.md",
    "docs/PATH-MATCHING.md",
  ];
  let sawAllowed = 0;
  for (const f of files) {
    const content = read(f);
    if (content.includes(".lanes/config.md")) {
      assert.ok(allowed.has(f), `${f} should not mention .lanes/config.md — only the sanctioned migration/hint surfaces may`);
      sawAllowed++;
    }
  }
  assert.equal(sawAllowed, allowed.size, "expected exactly the sanctioned files to mention .lanes/config.md");
});

// ------------------------------------------------------------- §5.8

test("§5.8 template shape", () => {
  const template = read("templates/TEMPLATE.md");
  const fenceMatch = template.match(/````markdown\n([\s\S]*?)\n````/);
  assert.ok(fenceMatch, "expected to find the ````markdown ... ```` fenced template block");
  const section = fenceMatch[1];
  const headings = [
    "## Meta",
    "## Objective",
    "## Context",
    "## Files",
    "### Touch",
    "### Do NOT touch",
    "## Interfaces",
    "## Constraints",
    "## Acceptance",
    "## Out of Scope",
    "## Report Format",
  ];
  for (const heading of headings) {
    const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matches = section.match(new RegExp("^" + escaped + "$", "gm")) || [];
    assert.equal(matches.length, 1, `expected exactly one '${heading}' heading in the fenced template, found ${matches.length}`);
  }
});

// ------------------------------------------------------------- §5.9

test("§5.9 MATCH_VECTORS ↔ PATH-MATCHING.md", () => {
  function sourceVectors() {
    const src = read("bin/lanes-validate.mjs");
    const block = src.match(/const MATCH_VECTORS = \[([\s\S]*?)\n\];/)[1];
    const rows = block
      .split("\n")
      .map((l) => l.replace(/\/\/.*$/, "").trim())
      .filter((l) => l.startsWith("["))
      .map((l) => l.replace(/,\s*$/, ""));
    return rows.map((r) => JSON.parse(r));
  }

  function docVectors() {
    const md = read("docs/PATH-MATCHING.md");
    const section = md.split(/^## Examples.*$/m)[1];
    const out = [];
    for (const m of section.matchAll(/^\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|\s*(yes|no)\s*\|/gm)) {
      out.push([m[1], m[2], m[3] === "yes"]);
    }
    return out;
  }

  const src = sourceVectors();
  const doc = docVectors();
  assert.ok(src.length > 0, "expected MATCH_VECTORS to be non-empty");
  assert.ok(doc.length > 0, "expected PATH-MATCHING.md examples to be non-empty");
  assert.equal(src.length, doc.length, "MATCH_VECTORS and PATH-MATCHING.md examples should have the same length");

  const srcSet = src.map((r) => JSON.stringify(r)).sort();
  const docSet = doc.map((r) => JSON.stringify(r)).sort();
  assert.deepEqual(srcSet, docSet, "MATCH_VECTORS and PATH-MATCHING.md examples should be set-equal");
});

// ------------------------------------------------------------ §5.10

test("§5.10 routing representation", () => {
  const routing = read("templates/ROUTING.md");
  assert.ok(routing.includes("**(a)"), "ROUTING.md should contain hard rule (a)");
  assert.ok(routing.includes("**(b)"), "ROUTING.md should contain hard rule (b)");
  assert.ok(routing.includes("**(c)"), "ROUTING.md should contain hard rule (c)");

  const reviewer = read("agents/lanes-reviewer.md");
  assert.ok(reviewer.includes("automatic REJECT"), "reviewer should contain the automatic REJECT language");
  assert.ok(reviewer.includes("security_routed"), "reviewer should reference security_routed");

  const template = read("templates/TEMPLATE.md");
  assert.ok(template.includes("Model hint: keep"), "TEMPLATE.md should contain 'Model hint: keep'");
  assert.ok(template.includes("security_routed"), "TEMPLATE.md Emission Rule 7 should reference security_routed");

  const emit = read("commands/lanes-emit.md");
  assert.ok(emit.includes("ROUTING.md"), "lanes-emit.md should name ROUTING.md");
  assert.ok(emit.includes("routing authority"), "lanes-emit.md should call ROUTING.md the routing authority");
});

// ------------------------------------------------------------ §5.11

test("§5.11 fixture leakage", () => {
  const files = [
    ...walkFiles("agents"),
    ...walkFiles("commands"),
    ...walkFiles("skills"),
    "templates/TEMPLATE.md",
    "templates/ROUTING.md",
    "README.md",
  ];
  for (const f of files) {
    const content = read(f);
    assert.ok(!/wisconsin-ice-exchange/i.test(content), `${f} should not mention wisconsin-ice-exchange`);
    assert.ok(!/\bWIX\b/.test(content), `${f} should not mention the WIX token`);
  }
});

// ------------------------------------------------------------ §5.12

test("§5.12 amendments discipline", () => {
  // Reviewer file: includes `## Amendments` and `Original sha256` and
  // does NOT include the retired `old text, new text` edit format
  const reviewer = read("agents/lanes-reviewer.md");
  assert.ok(reviewer.includes("`## Amendments`"), "reviewer should reference `## Amendments`");
  assert.ok(reviewer.includes("Original sha256"), "reviewer should reference 'Original sha256'");
  assert.ok(!reviewer.includes("old text,"), "reviewer should not include the retired edit-format phrase 'old text,'");

  // TEMPLATE.md: includes ## Amendments (created at first use and
  // Reviewer Checklist item 4 includes 'immutable'
  const template = read("templates/TEMPLATE.md");
  assert.ok(
    template.includes("## Amendments (created at first use"),
    "TEMPLATE.md should include the '## Amendments (created at first use' section"
  );
  assert.ok(
    template.includes("immutable after dispatch"),
    "Reviewer Checklist item 4 should include 'immutable after dispatch'"
  );
});
