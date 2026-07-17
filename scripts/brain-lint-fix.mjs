#!/usr/bin/env node
/**
 * Operator entrypoint for the mechanical `brain_lint` fixes.
 *
 * This is the delegation target for the Brain Monitor "Apply lint fixes"
 * action: it runs the same `applyLintFixes` orchestrator the hosted MCP tool
 * uses, against the locally configured Brain (BRAIN_DIR / BRAIN_ID), through the
 * governed store write path. It is DRY-RUN by default; pass --apply to write.
 *
 *   node scripts/brain-lint-fix.mjs                 # preview (writes nothing)
 *   node scripts/brain-lint-fix.mjs --apply         # apply the fixes
 *   node scripts/brain-lint-fix.mjs --brain ers-brain --apply
 *
 * Exit code is 0 on success (including a clean no-op), 1 on error.
 */
import { loadLocalEnv } from "./lib/load-local-env.mjs";

loadLocalEnv();

const argv = process.argv.slice(2);
const apply = argv.includes("--apply");
const brainFlagIdx = argv.indexOf("--brain");
const brainId =
  (brainFlagIdx !== -1 ? argv[brainFlagIdx + 1] : undefined) ||
  process.env.BRAIN_ID ||
  "ai-brain-jem";

const { applyLintFixes } = await import("../dist/services/lint-apply.js");
const { brainDate } = await import("../dist/services/date.js");

try {
  const summary = await applyLintFixes(brainId, brainDate(), { dryRun: !apply });

  const header = summary.dryRun
    ? `brain_lint fixes — DRY RUN for ${brainId} (nothing written; re-run with --apply)`
    : summary.applied
      ? `brain_lint fixes — APPLIED for ${brainId}`
      : `brain_lint fixes — nothing to fix for ${brainId}`;
  console.log(header);

  const line = (label, items) => {
    if (items.length === 0) return;
    console.log(`  ${label}: ${items.length}`);
    for (const item of items.slice(0, 10)) console.log(`    - ${item}`);
    if (items.length > 10) console.log(`    - ...and ${items.length - 10} more.`);
  };
  line("Completed tasks relocated to Done", summary.tasksRelocated);
  line("Done items date-stamped", summary.doneStamped);
  line("Old Done items archived", summary.doneArchived);
  if (!summary.dryRun && summary.filesWritten.length > 0) {
    console.log(`  Files written: ${summary.filesWritten.join(", ")}`);
  }
} catch (error) {
  console.error(`brain-lint-fix failed: ${String(error?.message || error)}`);
  process.exitCode = 1;
}
