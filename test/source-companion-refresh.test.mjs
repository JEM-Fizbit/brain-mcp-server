import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  addOriginalArtifactSection,
  assertCompanionPath,
  assertCompanionRefreshScope,
  inventoryCompanions,
  loadMonitorProfile,
  planCompanionRefresh,
  projectRefFromDatabaseUrl,
} from "../scripts/lib/source-companion-refresh.mjs";

test("original artifact section is inserted before backlinks and remains idempotent", () => {
  const input = "# Source\n\nBody\n\n## Brain links\n\n- [Context](../../brain/context.md)\n";
  const output = addOriginalArtifactSection(input, ["[Open original PDF](./source.pdf)"]);
  assert.match(output, /## Original artifact\n\n- \[Open original PDF\]\(\.\/source\.pdf\)/);
  assert.ok(output.indexOf("## Original artifact") < output.indexOf("## Brain links"));
  assert.equal(addOriginalArtifactSection(output, ["[Open original PDF](./source.pdf)"]), output);
});

test("companion refresh path is restricted to sources Markdown inside the Brain root", () => {
  const root = "/tmp/brain";
  assert.equal(
    assertCompanionPath(root, "sources/cv/example.md").relativePath,
    "sources/cv/example.md"
  );
  assert.throws(() => assertCompanionPath(root, "brain/01_identity.md"), /Invalid/);
  assert.throws(() => assertCompanionPath(root, "sources/cv/example.pdf"), /Invalid/);
  assert.throws(() => assertCompanionPath(root, "sources/../secret.md"), /Invalid/);
});

test("companion inventory hashes exact bytes and refresh plan is idempotent", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "source-refresh-"));
  const relativePath = "sources/cv/example.md";
  await fs.mkdir(path.join(root, "sources", "cv"), { recursive: true });
  await fs.writeFile(path.join(root, relativePath), "# Example\n", "utf8");
  const inventory = await inventoryCompanions(root, [relativePath, relativePath]);
  assert.equal(inventory.length, 1);
  assert.equal(inventory[0].byteSize, 10);

  const unchanged = planCompanionRefresh(inventory, [
    {
      companion_path: relativePath,
      content_sha256: inventory[0].contentSha256,
      artifact_id: "old",
    },
  ]);
  assert.equal(unchanged[0].state, "unchanged");

  const missingHostedText = planCompanionRefresh(inventory, [
    {
      companion_path: relativePath,
      content_sha256: inventory[0].contentSha256,
      artifact_id: "pointer-only",
      text_available: false,
    },
  ]);
  assert.equal(missingHostedText[0].state, "refresh_required");

  const changed = planCompanionRefresh(inventory, [
    { companion_path: relativePath, content_sha256: "different", artifact_id: "old" },
  ]);
  assert.equal(changed[0].state, "refresh_required");
  assert.equal(planCompanionRefresh(inventory, [])[0].state, "unregistered");
});

test("project reference guard understands direct and pooler Supabase URLs", () => {
  assert.equal(
    projectRefFromDatabaseUrl("postgresql://postgres:secret@db.abcdefghijkl.supabase.co:5432/postgres"),
    "abcdefghijkl"
  );
  assert.equal(
    projectRefFromDatabaseUrl("postgresql://postgres.abcdefghijkl:secret@aws-0-eu.pooler.supabase.com:6543/postgres"),
    "abcdefghijkl"
  );
});

test("companion refresh scope supports an explicitly bound ERS Brain", () => {
  assert.deepEqual(
    assertCompanionRefreshScope({
      brainId: "ers-brain",
      actualProjectRef: "omnwbcdtmtvxasgdmvwr",
      expectedProjectRef: "omnwbcdtmtvxasgdmvwr",
      apply: true,
    }),
    {
      brainId: "ers-brain",
      actualProjectRef: "omnwbcdtmtvxasgdmvwr",
      expectedProjectRef: "omnwbcdtmtvxasgdmvwr",
    }
  );
});

test("companion refresh scope fails closed on a project mismatch or unguarded apply", () => {
  assert.throws(
    () =>
      assertCompanionRefreshScope({
        brainId: "ers-brain",
        actualProjectRef: "gfipcidoyrtgngauzijy",
        expectedProjectRef: "omnwbcdtmtvxasgdmvwr",
        apply: true,
      }),
    /does not match/
  );
  assert.throws(
    () =>
      assertCompanionRefreshScope({
        brainId: "ers-brain",
        actualProjectRef: "omnwbcdtmtvxasgdmvwr",
        expectedProjectRef: undefined,
        apply: true,
      }),
    /required in apply mode/
  );
});

test("owner-only Brain Monitor config resolves the exact Brain database binding", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "monitor-profile-"));
  const configPath = path.join(root, "brain-menubar-config.json");
  await fs.writeFile(
    configPath,
    JSON.stringify({
      brains: [
        {
          brainId: "ai-brain-jem",
          env: {
            BRAIN_REVISION_DATABASE_URL:
              "postgresql://brain_runtime.gfipcidoyrtgngauzijy:secret@pooler.example/postgres",
            BRAIN_EXPECTED_SUPABASE_PROJECT_REF: "gfipcidoyrtgngauzijy",
          },
        },
      ],
    })
  );
  const profile = await loadMonitorProfile(configPath, "ai-brain-jem");
  assert.equal(profile.expectedProjectRef, "gfipcidoyrtgngauzijy");
  assert.match(profile.databaseUrl, /brain_runtime\.gfipcidoyrtgngauzijy/);
  await assert.rejects(() => loadMonitorProfile(configPath, "ers-brain"), /not found/);
});
