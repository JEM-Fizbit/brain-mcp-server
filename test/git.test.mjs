import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "brain-git-test-"));
const workTree = path.join(tmpRoot, "brain");
const upstream = path.join(tmpRoot, "upstream.git");

process.env.BRAIN_DIR = workTree;

async function git(cwd, ...args) {
  const { stdout } = await exec("git", args, { cwd });
  return stdout.trim();
}

async function writeFile(rel, content) {
  const full = path.join(workTree, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, "utf-8");
}

async function setupRepo({ withUpstream = true } = {}) {
  await fs.rm(workTree, { recursive: true, force: true });
  await fs.rm(upstream, { recursive: true, force: true });
  await fs.mkdir(workTree, { recursive: true });

  await git(workTree, "init", "-b", "main");
  await git(workTree, "config", "user.email", "test@example.com");
  await git(workTree, "config", "user.name", "Test");
  await git(workTree, "config", "commit.gpgsign", "false");

  await writeFile("seed.md", "seed\n");
  await git(workTree, "add", "-A");
  await git(workTree, "commit", "-m", "seed");

  if (withUpstream) {
    await exec("git", ["init", "--bare", "-b", "main", upstream]);
    await git(workTree, "remote", "add", "origin", upstream);
    await git(workTree, "push", "-u", "origin", "main");
  }
}

const { commit } = await import(
  path.join(__dirname, "..", "dist", "services", "git.js")
);

before(async () => {});

after(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

test("changes present + push=true → commits and pushes", async () => {
  await setupRepo();
  await writeFile("note.md", "hello\n");

  const result = await commit("add note", true);

  assert.match(result, /^Committed [a-f0-9]+: 1 files? changed\. Pushed to origin\.$/);

  const ahead = await git(workTree, "rev-list", "--count", "@{u}..HEAD");
  assert.equal(ahead, "0", "local should be in sync with remote after push");
});

test("changes present + push=false → commits without pushing", async () => {
  await setupRepo();
  await writeFile("note.md", "hello\n");

  const result = await commit("add note", false);

  assert.match(result, /^Committed [a-f0-9]+: 1 files? changed\. Not pushed\.$/);

  const ahead = await git(workTree, "rev-list", "--count", "@{u}..HEAD");
  assert.equal(ahead, "1", "one local commit should remain unpushed");
});

test("no changes + push=true + local ahead → pushes existing commits", async () => {
  await setupRepo();

  await writeFile("queued.md", "queued\n");
  await commit("queued change", false);

  const result = await commit("ignored message", true);

  assert.match(
    result,
    /^No new changes\. Pushed 1 existing local commit to origin\.$/
  );

  const ahead = await git(workTree, "rev-list", "--count", "@{u}..HEAD");
  assert.equal(ahead, "0", "local should be in sync after push");
});

test("no changes + push=true + multiple commits ahead → pluralises correctly", async () => {
  await setupRepo();

  await writeFile("a.md", "a\n");
  await commit("a", false);
  await writeFile("b.md", "b\n");
  await commit("b", false);

  const result = await commit("ignored", true);

  assert.match(
    result,
    /^No new changes\. Pushed 2 existing local commits to origin\.$/
  );
});

test("no changes + push=true + in sync → reports nothing to push", async () => {
  await setupRepo();

  const result = await commit("ignored", true);

  assert.equal(result, "No changes to commit; nothing to push.");
});

test("no changes + push=false → unchanged behaviour", async () => {
  await setupRepo();

  const result = await commit("anything", false);

  assert.equal(result, "No changes to commit.");
});

test("no changes + push=true + no upstream → reports missing upstream", async () => {
  await setupRepo({ withUpstream: false });

  const result = await commit("ignored", true);

  assert.match(result, /no upstream configured/i);
});
