#!/usr/bin/env node
// PreToolUse hook on the DELEGATE dispatch tool (v1: mcp__codex__codex).
// Contract (design spec §4): a Lanes dispatch prompt's FIRST LINE is a
// "LANES-SPEC: <path>" header. With that header, run the gate and deny on
// failure (fail closed). Without it, allow untouched — this hook must
// never break unrelated codex use (e.g. a prompt that merely quotes the
// header syntax somewhere past line 1 must not be misidentified).

import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

function deny(reason) {
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  }));
  process.exit(0);
}

const chunks = [];
for await (const c of process.stdin) chunks.push(c);

let input;
try {
  input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
} catch {
  process.exit(0); // unidentifiable input — cannot be tied to a Lanes dispatch
}

try {
  const prompt = String(input?.tool_input?.prompt ?? "");
  const header = prompt.match(/^LANES-SPEC:[ \t]*(.+?)[ \t]*(?:\r?\n|$)/);
  if (!header) process.exit(0); // not a Lanes dispatch — allow untouched

  const specPath = header[1];
  const validator = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "lanes-validate.mjs");
  try {
    execFileSync(process.execPath, [validator, "gate", "--spec", specPath], {
      encoding: "utf8",
      cwd: input.cwd || process.cwd(),
      timeout: 30_000,
    });
    process.exit(0); // gate passed — allow
  } catch (err) {
    const out = String(err.stdout || "").trim();
    let reason = "Lanes gate: validator failed to run — dispatch denied (fail closed)";
    if (out) {
      try { reason = `Lanes gate: ${JSON.parse(out).reason || out}`; }
      catch { reason = `Lanes gate: ${out}`; }
    }
    deny(reason);
  }
} catch (err) {
  deny(`Lanes gate: hook error — dispatch denied (fail closed): ${String((err && err.message) || err)}`);
}
