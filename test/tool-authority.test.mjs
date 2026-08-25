import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(__dirname, "..");
const { TOOL_MINIMUM_ROLES, assertToolRole } = await import(
  path.join(repo, "dist", "services", "tool-authority.js")
);

test("every registered Brain tool has exactly one declared minimum role", async () => {
  const files = (await fs.readdir(path.join(repo, "src", "tools")))
    .filter((name) => name.endsWith(".ts"));
  const names = new Set();
  for (const file of files) {
    const source = await fs.readFile(path.join(repo, "src", "tools", file), "utf-8");
    for (const match of source.matchAll(/server\.tool\(\s*[\r\n ]*"(brain_[a-z_]+)"/g)) {
      names.add(match[1]);
    }
  }
  assert.deepEqual([...Object.keys(TOOL_MINIMUM_ROLES)].sort(), [...names].sort());
});

test("role matrix keeps readers read-only and identity administration outside MCP", () => {
  const context = (role) => ({ brainId: "ers-brain", brain: {}, role, principal: {} });
  assert.doesNotThrow(() => assertToolRole(context("reader"), "brain_read_file"));
  assert.throws(() => assertToolRole(context("reader"), "brain_update_file"), /requires member/);
  assert.doesNotThrow(() => assertToolRole(context("member"), "brain_update_file"));
  assert.throws(() => assertToolRole(context("member"), "brain_delete_file"), /requires admin/);
  assert.doesNotThrow(() => assertToolRole(context("admin"), "brain_resolve_conflict"));
  assert.ok(!Object.keys(TOOL_MINIMUM_ROLES).some((name) => /role|grant|access/.test(name)));
});

test("every declared tool is exercised across reader, member, admin, and owner", () => {
  const rank = { reader: 0, member: 1, admin: 2, owner: 3 };
  for (const [tool, minimum] of Object.entries(TOOL_MINIMUM_ROLES)) {
    for (const role of Object.keys(rank)) {
      const context = { brainId: "ers-brain", brain: {}, role, principal: {} };
      if (rank[role] >= rank[minimum]) {
        assert.doesNotThrow(() => assertToolRole(context, tool), `${role} should be allowed to call ${tool}`);
      } else {
        assert.throws(() => assertToolRole(context, tool), new RegExp(`requires ${minimum}`), `${role} should be denied ${tool}`);
      }
    }
  }
});
