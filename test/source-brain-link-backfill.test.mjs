import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectSourceBrainLinkDeclarations,
  parseDeclaredBrainLinks,
} from "../scripts/lib/source-brain-link-backfill.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repoRoot, "scripts/backfill-source-brain-links-postgres.mjs");

test("parseDeclaredBrainLinks returns reviewed relation declarations", () => {
  const links = parseDeclaredBrainLinks(
    "sources/research/example.md",
    [
      "# Example",
      "",
      "## Brain links",
      "",
      "- [Learning](../../brain/07_interests_learning.md) — context",
      "- [Claims](../../brain/ref_claims.md) — evidence",
      "",
      "## Source URLs",
    ].join("\n")
  );
  assert.deepEqual(links, [
    {
      brainFilename: "07_interests_learning.md",
      label: "Learning",
      relation: "context",
      anchor: "",
    },
    {
      brainFilename: "ref_claims.md",
      label: "Claims",
      relation: "supports",
      anchor: "",
    },
  ]);
});

test("parseDeclaredBrainLinks rejects missing, empty, or escaping declarations", () => {
  assert.throws(
    () => parseDeclaredBrainLinks("sources/research/example.md", "# Example\n"),
    /missing a ## Brain links section/
  );
  assert.throws(
    () =>
      parseDeclaredBrainLinks(
        "sources/research/example.md",
        "# Example\n\n## Brain links\n"
      ),
    /has no declared Brain links/
  );
  assert.throws(
    () =>
      parseDeclaredBrainLinks(
        "sources/research/example.md",
        "## Brain links\n\n- [Escape](../../../outside.md) — context\n"
      ),
    /escapes the Brain Markdown root/
  );
});

test("backfill collection excludes source indexes and README files", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "source-backfill-"));
  await fs.mkdir(path.join(root, "brain"), { recursive: true });
  await fs.mkdir(path.join(root, "sources", "company"), { recursive: true });
  await fs.writeFile(path.join(root, "brain", "company.md"), "# Company\n");
  const declaration = [
    "# Evidence",
    "",
    "## Brain links",
    "",
    "- [Company](../../brain/company.md) — evidence",
    "",
  ].join("\n");
  await fs.writeFile(path.join(root, "sources", "README.md"), "# Sources\n");
  await fs.writeFile(path.join(root, "sources", "company", "INDEX.md"), "# Index\n");
  await fs.writeFile(path.join(root, "sources", "company", "evidence.md"), declaration);

  const declarations = await collectSourceBrainLinkDeclarations(root);
  assert.equal(declarations.length, 1);
  assert.equal(declarations[0].companionPath, "sources/company/evidence.md");
});

test("backfill CLI requires an expected project ref even in dry-run mode", () => {
  const result = spawnSync(
    process.execPath,
    [cliPath, "--brain-root", repoRoot, "--brain-id", "ai-brain-jem"],
    {
      encoding: "utf-8",
      env: {
        ...process.env,
        BRAIN_SOURCE_REFERENCE_DATABASE_URL:
          "postgresql://runtime.fakeprojectref@aws-0.example.invalid:6543/postgres",
        BRAIN_REVISION_DATABASE_URL: "",
      },
    }
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--expected-project-ref/);
});

test("backfill CLI rejects a mismatched project ref before connecting", () => {
  const result = spawnSync(
    process.execPath,
    [
      cliPath,
      "--brain-root",
      repoRoot,
      "--brain-id",
      "ai-brain-jem",
      "--expected-project-ref",
      "differentprojectref",
    ],
    {
      encoding: "utf-8",
      env: {
        ...process.env,
        BRAIN_SOURCE_REFERENCE_DATABASE_URL:
          "postgresql://runtime.fakeprojectref@aws-0.example.invalid:6543/postgres",
        BRAIN_REVISION_DATABASE_URL: "",
      },
    }
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /does not match --expected-project-ref/);
  assert.doesNotMatch(result.stderr, /ENOTFOUND|ECONN/);
});
