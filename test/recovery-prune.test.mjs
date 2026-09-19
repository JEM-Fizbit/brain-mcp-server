import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  mutateLocalFile, recoveryUsage, planRecoveryPrune, applyRecoveryPrune, inspectLocalRecovery,
} from "../dist/sync/recoverable-file.js";
import { contentHash } from "../dist/sync/hash.js";

async function fixture(fn) {
  const root = await fs.mkdtemp("/tmp/brain-recovery-prune-test-");
  try { await fn(root); } finally { await fs.rm(root, { recursive: true, force: true }); }
}
const DAY = 86_400_000;
const recoveryDir = (root) => path.join(root, ".brain-sync-recovery");
async function age(root, days) {
  const past = new Date(Date.now() - days * DAY);
  for (const entry of await fs.readdir(recoveryDir(root))) {
    await fs.utimes(path.join(recoveryDir(root), entry, "intent.json"), past, past);
  }
}
const hostedHas = (set) => (filename, hash) => set.has(`${filename}\0${hash}`);

test("recovery usage reports entries, bytes and percent of the tighter budget", () => fixture(async (root) => {
  const empty = await recoveryUsage(root);
  assert.deepEqual(empty, { entries: 0, bytes: 0, entryLimit: 10000, byteLimit: 268435456, percent: 0 });
  await fs.writeFile(path.join(root, "a.md"), "base");
  await mutateLocalFile(root, "a.md", "remote", contentHash("base"));
  const usage = await recoveryUsage(root);
  assert.equal(usage.entries, 1);
  assert.ok(usage.bytes > 0);
  assert.equal(usage.percent, Math.ceil(Math.max(1 / 10000, usage.bytes / 268435456) * 100));
}));

test("a completed record whose original matches hosted history is redundant; a divergent original is retained", () => fixture(async (root) => {
  await fs.writeFile(path.join(root, "clean.md"), "base");
  await mutateLocalFile(root, "clean.md", "remote", contentHash("base"));
  await fs.writeFile(path.join(root, "edited.md"), "base");
  const fd = await fs.open(path.join(root, "edited.md"), "r+");
  try {
    await mutateLocalFile(root, "edited.md", "remote", contentHash("base"));
    await fd.truncate(0); await fd.write("late manual", 0, "utf8"); await fd.sync();
  } finally { await fd.close(); }
  await age(root, 30);
  const plan = await planRecoveryPrune(root, {
    olderThanMs: 7 * DAY,
    hostedHas: hostedHas(new Set([`clean.md\0${contentHash("base")}`, `edited.md\0${contentHash("base")}`])),
  });
  const byFile = Object.fromEntries(plan.map((p) => [p.filename, p]));
  assert.equal(byFile["clean.md"].verdict, "redundant");
  assert.equal(byFile["edited.md"].verdict, "retain");
  assert.equal(byFile["edited.md"].reason, "divergent_original");
}));

test("records are retained when too recent, absent from hosted history, or incomplete", () => fixture(async (root) => {
  await fs.writeFile(path.join(root, "recent.md"), "base");
  await mutateLocalFile(root, "recent.md", "remote", contentHash("base"));
  const recent = await planRecoveryPrune(root, { olderThanMs: 7 * DAY, hostedHas: () => true });
  assert.equal(recent[0].verdict, "retain");
  assert.equal(recent[0].reason, "too_recent");

  await age(root, 30);
  const unknown = await planRecoveryPrune(root, { olderThanMs: 7 * DAY, hostedHas: () => false });
  assert.equal(unknown[0].reason, "not_in_hosted_history");

  const intentPath = path.join(recoveryDir(root), (await fs.readdir(recoveryDir(root)))[0], "intent.json");
  const intent = JSON.parse(await fs.readFile(intentPath, "utf8"));
  await fs.writeFile(intentPath, JSON.stringify({ ...intent, complete: false }));
  await age(root, 30);
  const incomplete = await planRecoveryPrune(root, { olderThanMs: 7 * DAY, hostedHas: () => true });
  assert.equal(incomplete[0].reason, "incomplete");
}));

test("a creation record with no displaced original is redundant once old enough", () => fixture(async (root) => {
  await mutateLocalFile(root, "new.md", "remote", null);
  await age(root, 30);
  const plan = await planRecoveryPrune(root, { olderThanMs: 7 * DAY, hostedHas: () => false });
  assert.equal(plan[0].verdict, "redundant");
  assert.equal(plan[0].reason, "nothing_displaced");
}));

test("apply removes only redundant records and never touches retained ones", () => fixture(async (root) => {
  await fs.writeFile(path.join(root, "clean.md"), "base");
  await mutateLocalFile(root, "clean.md", "remote", contentHash("base"));
  await fs.writeFile(path.join(root, "edited.md"), "base");
  const fd = await fs.open(path.join(root, "edited.md"), "r+");
  try {
    await mutateLocalFile(root, "edited.md", "remote", contentHash("base"));
    await fd.truncate(0); await fd.write("late manual", 0, "utf8"); await fd.sync();
  } finally { await fd.close(); }
  await age(root, 30);
  const plan = await planRecoveryPrune(root, { olderThanMs: 7 * DAY, hostedHas: () => true });
  const removed = await applyRecoveryPrune(root, plan);
  assert.equal(removed.length, 1);
  const remaining = await fs.readdir(recoveryDir(root));
  assert.equal(remaining.length, 1);
  const observations = await inspectLocalRecovery(root);
  assert.equal(observations.length, 1);
  assert.equal(observations[0].filename, "edited.md");
  assert.equal((await recoveryUsage(root)).entries, 1);
}));
