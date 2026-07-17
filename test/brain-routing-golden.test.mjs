import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");
const goldenPath = path.join(repoRoot, "evals", "brain-routing", "golden.json");
const fixturePath = path.join(
  repoRoot,
  "evals",
  "brain-routing",
  "fixtures",
  "server-foundation.json"
);

test("brain routing golden set covers diverse Brain behavior surfaces", async () => {
  const golden = JSON.parse(await fs.readFile(goldenPath, "utf-8"));
  const categories = new Set(golden.map((testCase) => testCase.category));

  assert.ok(golden.length >= 20, "golden set should cover at least 20 prompts");
  assert.deepEqual(
    [
      "account_identifier",
      "cross_brain_authority",
      "cross_brain_fallback",
      "forbidden_secret",
      "personal_contact",
      "private_personal",
      "project_routing",
      "source_escalation",
      "task_routing",
      "work_contact",
      "working_artifact",
    ].filter((category) => !categories.has(category)),
    []
  );

  for (const testCase of golden) {
    assert.ok(testCase.id, "case id is required");
    assert.ok(testCase.prompt, `prompt is required for ${testCase.id}`);
    assert.ok(testCase.expected?.brain_id, `expected brain_id is required for ${testCase.id}`);
    assert.ok(
      testCase.expected.route_files?.length ||
        testCase.expected.loader_must_contain?.length ||
        testCase.expected.search ||
        testCase.expected.canonical_for,
      `at least one assertion is required for ${testCase.id}`
    );
  }
});

test("brain routing eval command is wired as a read-only script", async () => {
  const packageJson = JSON.parse(
    await fs.readFile(path.join(repoRoot, "package.json"), "utf-8")
  );
  const runner = await fs.readFile(
    path.join(repoRoot, "scripts", "eval-brain-routing.mjs"),
    "utf-8"
  );

  assert.equal(
    packageJson.scripts["eval:brain:routing"],
    "npm run build && node scripts/eval-brain-routing.mjs"
  );
  assert.match(runner, /evaluateBrainRoutingGolden/);
  assert.match(runner, /--fixtures/);
  assert.doesNotMatch(runner, /writeFile|appendFile|brain_update_file|brain_log|brain_commit/);
});

test("frozen server-foundation fixture separates policy, signpost, and production-search assertions", async () => {
  const fixture = JSON.parse(await fs.readFile(fixturePath, "utf-8"));
  assert.ok(fixture.cases.length >= 3);
  assert.ok(fixture.brains["ai-brain-jem"]);
  assert.ok(fixture.brains["ers-brain"]);
  assert.ok(
    fixture.cases.some((testCase) => testCase.expected.refuse_secret_storage)
  );
  assert.ok(fixture.cases.some((testCase) => testCase.expected.search));
});
