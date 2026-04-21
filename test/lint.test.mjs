import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "brain-lint-test-"));
process.env.BRAIN_DIR = tmpDir;

const { runLint } = await import(
  path.join(__dirname, "..", "dist", "services", "lint.js")
);

async function writeFixture(files) {
  const entries = await fs.readdir(tmpDir);
  for (const name of entries) {
    await fs.rm(path.join(tmpDir, name), { recursive: true, force: true });
  }
  for (const [name, content] of Object.entries(files)) {
    const full = path.join(tmpDir, name);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, "utf-8");
  }
}

const longBody = (lines) => Array.from({ length: lines }, (_, i) => `- line ${i + 1}`).join("\n");

test("bloat check exempts LOG.md and SOURCES.md", async () => {
  await writeFixture({
    "00_loader.md": "# Loader\n\nReferences: `01_identity.md`\n",
    "NOW.md": "# NOW\n",
    "LOG.md": longBody(250),
    "SOURCES.md": longBody(250),
    "01_identity.md": longBody(250),
  });

  const report = await runLint();
  const bloated = report.bloat.map((b) => b.file);

  assert.ok(!bloated.includes("LOG.md"), "LOG.md must not be flagged for bloat");
  assert.ok(!bloated.includes("SOURCES.md"), "SOURCES.md must not be flagged for bloat");
  assert.ok(bloated.includes("01_identity.md"), "content files must still be flagged");
});

test("drift check only flags projects under Active section", async () => {
  await writeFixture({
    "00_loader.md": "# Loader\n",
    "NOW.md": "# NOW\n\n- Working on Social-Creator-Claude this week.\n",
    "05_projects.md": [
      "# Projects",
      "",
      "## Software — Active Development",
      "",
      "### Social-Creator-Claude",
      "Active project mentioned in NOW.md.",
      "",
      "### MILADVector-Forgotten",
      "Active project NOT mentioned in NOW.md — should flag.",
      "",
      "## Live & Stable (Maintenance Mode)",
      "",
      "### PromptalisStable",
      "Stable, not in NOW.md — should NOT flag.",
      "",
      "## Concept / Early Stage",
      "",
      "### AethermereConcept",
      "Concept, not in NOW.md — should NOT flag.",
      "",
      "## Infrastructure & Tools",
      "",
      "### AIBrainInfra",
      "Infra, not in NOW.md — should NOT flag.",
      "",
      "## Content & Knowledge Management",
      "",
      "### SubstackContent",
      "Content, not in NOW.md — should NOT flag.",
      "",
    ].join("\n"),
  });

  const report = await runLint();
  const drift = report.drift.join("\n");

  assert.match(drift, /MILADVector-Forgotten/, "active project missing from NOW.md should flag");
  assert.doesNotMatch(drift, /Social-Creator-Claude/, "active project present in NOW.md should not flag");
  assert.doesNotMatch(drift, /PromptalisStable/, "stable project should not flag");
  assert.doesNotMatch(drift, /AethermereConcept/, "concept project should not flag");
  assert.doesNotMatch(drift, /AIBrainInfra/, "infrastructure project should not flag");
  assert.doesNotMatch(drift, /SubstackContent/, "content project should not flag");
});

test("drift falls back with warning when no Active section is present", async () => {
  await writeFixture({
    "00_loader.md": "# Loader\n",
    "NOW.md": "# NOW\n\n- Working on KnownProject.\n",
    "05_projects.md": [
      "# Projects",
      "",
      "## Random Heading One",
      "",
      "### KnownProject",
      "",
      "### UnknownProject",
      "",
    ].join("\n"),
  });

  const report = await runLint();
  assert.ok(Array.isArray(report.warnings), "report.warnings should exist");
  assert.ok(
    report.warnings.some((w) => /active/i.test(w)),
    "should warn that no Active section was found"
  );
  const drift = report.drift.join("\n");
  assert.match(drift, /UnknownProject/, "fallback should use prior behaviour and flag unmentioned projects");
});
