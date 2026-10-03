import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { mutateLocalFile, inspectLocalRecovery } from "../dist/sync/recoverable-file.js";
import { contentHash } from "../dist/sync/hash.js";

async function fixture(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "brain-publication-test-"));
  try { await fn(root); } finally { await fs.rm(root, { recursive: true, force: true }); }
}

for (const base of [null, "old bytes"]) test(`publication has an independent single-link inode (${base === null ? "creation" : "replacement"})`, () => fixture(async root => {
  const target = path.join(root, "governance", "specification.md");
  await fs.mkdir(path.dirname(target));
  if (base !== null) await fs.writeFile(target, base);
  const content = "# Specification\n\nUnicode: £ ✓\n";
  const result = await mutateLocalFile(root, "governance/specification.md", content, base === null ? null : contentHash(base));
  assert.equal(result.ok, true);
  const replacement = path.join(path.dirname(result.recoveryPath), "replacement.md");
  const [canonicalStat, retainedStat] = await Promise.all([fs.stat(target), fs.stat(replacement)]);
  assert.notEqual(canonicalStat.ino, retainedStat.ino);
  assert.equal(canonicalStat.nlink, 1);
  assert.equal(retainedStat.nlink, 1);
  assert.equal(await fs.readFile(target, "utf8"), content);
  assert.equal(await fs.readFile(replacement, "utf8"), content);
  await fs.writeFile(target, "later canonical edit");
  assert.equal(await fs.readFile(replacement, "utf8"), content, "retained publication bytes cannot change with the canonical file");
  assert.deepEqual((await fs.readdir(path.dirname(target))).sort(), ["specification.md"]);
}));

test("publication source is outside the Brain namespace and disappears after atomic installation", t => fixture(async root => {
  const target = path.join(root, "topic.md");
  const link = fs.link;
  let source;
  t.mock.method(fs, "link", async (a, b) => {
    if (b === target) {
      source = a;
      assert.ok(!a.startsWith(root + path.sep));
      assert.equal(await fs.readFile(a, "utf8"), "complete bytes");
    }
    return link(a, b);
  });
  assert.equal((await mutateLocalFile(root, "topic.md", "complete bytes", null)).ok, true);
  await assert.rejects(fs.stat(source), { code: "ENOENT" });
  await assert.rejects(fs.stat(path.dirname(source)), { code: "ENOENT" });
}));

test("cross-device publication refuses before displacing the reviewed inode", t => fixture(async root => {
  const target = path.join(root, "topic.md");
  await fs.writeFile(target, "manual");
  const before = await fs.stat(target);
  t.mock.method(fs, "link", async () => { throw Object.assign(new Error("cross-device publication"), { code: "EXDEV" }); });
  await assert.rejects(mutateLocalFile(root, "topic.md", "remote", contentHash("manual")), { code: "EXDEV" });
  assert.equal((await fs.stat(target)).ino, before.ino);
  assert.equal(await fs.readFile(target, "utf8"), "manual");
}));

test("a competing pathname wins atomic publication without changing retained originals", t => fixture(async root => {
  const target = path.join(root, "topic.md");
  await fs.writeFile(target, "base");
  const link = fs.link;
  t.mock.method(fs, "link", async (a, b) => {
    if (b === target) await fs.writeFile(target, "concurrent save", { flag: "wx" });
    return link(a, b);
  });
  const result = await mutateLocalFile(root, "topic.md", "remote", contentHash("base"));
  assert.equal(result.ok, false);
  assert.equal(await fs.readFile(target, "utf8"), "concurrent save");
  assert.equal(await fs.readFile(result.recoveryPath, "utf8"), "base");
}));

test("late displaced-descriptor edits survive and are detected during independent publication", t => fixture(async root => {
  const target = path.join(root, "topic.md");
  await fs.writeFile(target, "base");
  const fd = await fs.open(target, "r+");
  const link = fs.link;
  t.mock.method(fs, "link", async (a, b) => {
    if (b === target) { await fd.truncate(0); await fd.write("late manual", 0, "utf8"); await fd.sync(); }
    return link(a, b);
  });
  try {
    const result = await mutateLocalFile(root, "topic.md", "remote", contentHash("base"));
    assert.equal(result.ok, false);
    assert.equal(result.currentHash, contentHash("late manual"));
    assert.equal(await fs.readFile(result.recoveryPath, "utf8"), "late manual");
    assert.equal(await fs.readFile(target, "utf8"), "remote");
    assert.equal((await inspectLocalRecovery(root))[0].contentHash, contentHash("late manual"));
  } finally { await fd.close(); }
}));

test("interrupted displacement restores an independent inode and keeps late original writes observable", t => fixture(async root => {
  const target = path.join(root, "topic.md");
  await fs.writeFile(target, "base");
  const fd = await fs.open(target, "r+");
  const rename = fs.rename;
  t.mock.method(fs, "rename", async (a, b) => {
    await rename(a, b);
    if (a === target) throw new Error("interrupted after displacement");
  });
  try {
    await assert.rejects(mutateLocalFile(root, "topic.md", "remote", contentHash("base")), /interrupted/);
    t.mock.restoreAll();
    await inspectLocalRecovery(root);
    const operation = (await fs.readdir(path.join(root, ".brain-sync-recovery")))[0];
    const original = path.join(root, ".brain-sync-recovery", operation, "original.md");
    assert.notEqual((await fs.stat(target)).ino, (await fs.stat(original)).ino);
    assert.equal((await fs.stat(target)).nlink, 1);
    assert.equal(await fs.readFile(target, "utf8"), "base");
    await fd.truncate(0); await fd.write("late original save", 0, "utf8"); await fd.sync();
    assert.equal(await fs.readFile(target, "utf8"), "base");
    assert.equal((await inspectLocalRecovery(root))[0].contentHash, contentHash("late original save"));
  } finally { await fd.close(); }
}));
