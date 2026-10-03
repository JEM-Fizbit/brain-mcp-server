import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { refreshLintCache, hostedLintFingerprint, readLintCache, writeLintCache } from "../scripts/lib/lint-cache.mjs";

const NOW = Date.parse("2026-10-02T22:00:00Z");
function report(brainId = "ers-brain", issueCount = 0) {
  return { version: 2, brainId, checkedAt: new Date(NOW).toISOString(), issueCount,
    report: { bloat: [], stale: [], orphans: [], drift: [], largeDomainPacks: [], unindexedWorkingBinaries: [] } };
}
async function fixture(t, overrides = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lint-cache-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return { file: path.join(dir, "hosted-lint-report.json"), brainId: "ers-brain",
    source: "doctor_hosted", getFingerprint: async () => "current", assess: async () => report(), now: () => NOW, ...overrides };
}

test("legacy Sep8 cache and prose receipt cannot suppress a current hosted assessment", async t => {
  let runs = 0;
  const f = await fixture(t, { assess: async () => { runs++; return report(); } });
  await writeLintCache(f.file, { ...report(), checkedAt: "2026-09-08T00:00:00Z", issueCount: 100 });
  const result = await refreshLintCache(f);
  assert.equal(runs, 1);
  assert.equal(result.issueCount, 0);
  assert.equal(result.source, "doctor_hosted");
  assert.equal(result.observation.state, "fresh");
  assert.equal(result.checkedAt, new Date(NOW).toISOString());
});

test("unchanged verified content reuses newer structured findings and original assessment timestamp", async t => {
  const f = await fixture(t);
  const previous = { ...report("ers-brain", 7), fingerprint: "current", source: "cockpit_hosted" };
  await writeLintCache(f.file, previous);
  f.assess = () => { throw new Error("must not run"); };
  const result = await refreshLintCache(f);
  assert.equal(result.issueCount, 7);
  assert.equal(result.checkedAt, previous.checkedAt);
  assert.equal(result.source, "cockpit_hosted");
  assert.equal(result.observation.state, "fresh");
});

for (const [name, previous] of [
  ["changed content", { fingerprint: "old" }],
  ["one-day expiry", { fingerprint: "current", checkedAt: new Date(NOW - 86400000).toISOString() }],
  ["future cache timestamp", { fingerprint: "current", checkedAt: new Date(NOW + 1000).toISOString() }],
  ["incomplete structured report", { fingerprint: "current", report: {} }],
]) test(`${name} recomputes instead of claiming a cached all-clear`, async t => {
  let runs = 0;
  const f = await fixture(t, { assess: async () => { runs++; return report("ers-brain", 4); } });
  await writeLintCache(f.file, { ...report(), ...previous });
  assert.equal((await refreshLintCache(f)).issueCount, 4);
  assert.equal(runs, 1);
});

test("hosted failure retains historical results with failed observation, never refreshes checkedAt", async t => {
  const f = await fixture(t, { getFingerprint: () => { throw new Error("private db error"); } });
  const old = { ...report("ers-brain", 9), checkedAt: "2026-09-08T00:00:00Z", source: "cockpit_hosted" };
  await writeLintCache(f.file, old);
  const result = await refreshLintCache(f);
  assert.equal(result.checkedAt, old.checkedAt);
  assert.equal(result.issueCount, 9);
  assert.equal(result.observation.state, "failed");
  assert.doesNotMatch(JSON.stringify(result), /private db error/);
});

test("no prior result plus failure stays unassessed, not zero findings", async t => {
  const f = await fixture(t, { assess: () => { throw new Error("failed"); } });
  const result = await refreshLintCache(f);
  assert.equal(result.checkedAt, null);
  assert.equal(result.issueCount, undefined);
  assert.equal(result.observation.state, "failed");
});

test("content changes during assessment reject candidate and preserve old timestamp", async t => {
  let checks = 0;
  const f = await fixture(t, { getFingerprint: async () => ++checks === 1 ? "before" : "after" });
  const old = { ...report("ers-brain", 8), checkedAt: "2026-09-08T00:00:00Z" };
  await writeLintCache(f.file, old);
  const result = await refreshLintCache(f);
  assert.equal(result.issueCount, 8);
  assert.equal(result.checkedAt, old.checkedAt);
  assert.equal(result.observation.state, "stale");
  assert.equal(result.observation.reason, "content_changed_during_assessment");
});

test("simultaneous assessments serialize; waiting reader cannot overwrite latest result", async t => {
  let unblock, started;
  const entered = new Promise(resolve => { started = resolve; });
  const blocked = new Promise(resolve => { unblock = resolve; });
  const f = await fixture(t, { assess: async () => { started(); await blocked; return report("ers-brain", 3); } });
  const first = refreshLintCache(f);
  await entered;
  const second = await refreshLintCache({ ...f, assess: async () => report("ers-brain", 99) });
  assert.equal(second.observation.state, "unobserved");
  unblock(); await first;
  assert.equal((await readLintCache(f.file, "ers-brain")).issueCount, 3);
});

test("explicit refresh is not suppressed by an unchanged fingerprint", async t => {
  const f = await fixture(t, { force: true, source: "cockpit_hosted", assess: async () => report("ers-brain", 1) });
  await writeLintCache(f.file, { ...report(), fingerprint: "current" });
  assert.equal((await refreshLintCache(f)).issueCount, 1);
});

test("cache reads never leak findings from the other Brain", async t => {
  const f = await fixture(t);
  await writeLintCache(f.file, report("ai-brain-jem", 77));
  assert.equal(await readLintCache(f.file, "ers-brain"), null);
});

test("hosted fingerprint query is owner scoped, content-free and separates brain/config/binding/revisions", async () => {
  let rows = [{ filename: "NOW.md", revision_id: "a" }];
  const pool = { query: async (sql, params) => {
    assert.match(sql, /brain_id = \$1/);
    assert.match(sql, /not like 'sources\/%'/);
    assert.doesNotMatch(sql, /r\.\*|r\.content/);
    assert.equal(params.length, 1);
    return { rows };
  } };
  const fingerprint = (id = "ers-brain", binding = "ers", config = "graph") => hostedLintFingerprint(pool, id, binding, config);
  const initial = await fingerprint();
  assert.notEqual(await fingerprint("ai-brain-jem"), initial);
  assert.notEqual(await fingerprint("ers-brain", "jem"), initial);
  assert.notEqual(await fingerprint("ers-brain", "ers", "legacy"), initial);
  rows = [{ filename: "NOW.md", revision_id: "b" }];
  assert.notEqual(await fingerprint(), initial);
  rows = [];
  assert.notEqual(await fingerprint(), initial);
});

test("older assessment can never replace a newer valid report", async t => {
  const f = await fixture(t, { force: true, assess: async () => ({ ...report(), checkedAt: "2026-09-08T00:00:00Z" }) });
  await writeLintCache(f.file, { ...report("ers-brain", 11), fingerprint: "current" });
  const result = await refreshLintCache(f);
  assert.equal(result.issueCount, 11);
  assert.equal(result.checkedAt, new Date(NOW).toISOString());
  assert.equal(result.observation.reason, "older_assessment_rejected");
});


test("new task-fix policy invalidates an unchanged hosted cache from the old policy", async t => {
  const heads = [{filename: "TASKS.md", revision_id: "unchanged"}];
  const pool = {query: async () => ({rows: heads})};
  const oldFingerprint = crypto.createHash("sha256").update(JSON.stringify({
    version: 1, brainId: "ers-brain", binding: "ers", lintConfig: "graph", heads,
  })).digest("hex");
  let runs = 0;
  const f = await fixture(t, {
    getFingerprint: () => hostedLintFingerprint(pool, "ers-brain", "ers", "graph"),
    assess: async () => {runs++; return {...report(), automaticFixCount: 0};},
  });
  await writeLintCache(f.file, {...report(), fingerprint: oldFingerprint, automaticFixCount: 2});
  const result = await refreshLintCache(f);
  assert.equal(runs, 1);
  assert.equal(result.automaticFixCount, 0);
  assert.equal(result.observation.state, "fresh");
});
