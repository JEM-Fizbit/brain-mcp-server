import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "brain-inbox-test-"));
const brainDir = path.join(tmpRoot, "brain");
const inboxDir = path.join(tmpRoot, "inbox");

process.env.BRAIN_DIR = brainDir;
delete process.env.BRAIN_PLATFORM_CONFIG;

const { scanInbox } = await import(
  path.join(__dirname, "..", "dist", "services", "inbox.js")
);

after(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

test("inbox scan ignores placeholder files but reports real ingest candidates", async () => {
  await fs.mkdir(brainDir, { recursive: true });
  await fs.mkdir(inboxDir, { recursive: true });
  await fs.writeFile(path.join(inboxDir, "README.md"), "# inbox\n", "utf-8");
  await fs.writeFile(path.join(inboxDir, ".DS_Store"), "", "utf-8");
  await fs.writeFile(path.join(inboxDir, ".gitkeep"), "", "utf-8");
  await fs.writeFile(path.join(inboxDir, "proposal.md"), "# Proposal\n", "utf-8");

  const files = await scanInbox();

  assert.deepEqual(
    files.map((file) => file.name),
    ["proposal.md"]
  );
});
