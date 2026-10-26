import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { findReconcileCandidates, compareClaims, sameMetric } = await import(
  path.join(__dirname, "..", "dist", "services", "reconcile.js")
);

const brain = (files) => findReconcileCandidates(new Map(Object.entries(files)));

test("flags the same fund quoted with different sizes in a hub and an entity file", () => {
  const report = brain({
    "01_identity.md":
      "- **[[nbgi|NBGI Ventures]]** — managing two venture funds (Fund I: €30M; Fund II: €60M committed capital).\n",
    "nbgi.md":
      "# NBGI\n\n- Funds: Fund I (€40M committed, 2001 vintage); Fund II (€60M committed, 2007 vintage)\n",
  });
  assert.equal(report.mode, "advisory");
  assert.equal(report.candidates.length, 1, JSON.stringify(report.candidates, null, 2));
  const [candidate] = report.candidates;
  assert.equal(candidate.subject, "nbgi");
  assert.equal(candidate.kind, "money");
  assert.equal(candidate.unit, "EUR");
  assert.ok(candidate.sharedTerms.includes("fund-i"));
  assert.deepEqual(
    [candidate.left.raw, candidate.right.raw].sort(),
    ["€30M", "€40M"]
  );
  assert.equal(candidate.left.file, "01_identity.md");
  assert.equal(candidate.left.line, 1);
});

test("consistent copies, approximations and neighbouring figures are not flagged", () => {
  const report = brain({
    "01_identity.md": [
      "- [[quanta|Quanta]]: Raised $360M+ across multiple rounds, including a $245M Series D.",
      "- [[quanta|Quanta]] scaled from ~30-person R&D team to ~260-person enterprise.",
    ].join("\n"),
    "quanta.md": [
      "# Quanta",
      "- Capital raised: $360M+ cumulative, including $245M Series D (largest round).",
      "- Team at peak: 260 people across 3 sites",
    ].join("\n"),
    "02_expertise.md": "- [[quanta|Quanta]]: $360M+ including $245M Series D.\n",
  });
  assert.deepEqual(report.candidates, []);
});

test("different qualifiers, valuations and periods are different metrics", () => {
  const report = brain({
    "a.md": [
      "# A",
      "- Fund II: €60M committed.",
      "- Series D raised $245M.",
      "- 2025 operating margin 76%.",
    ].join("\n"),
    "b.md": [
      "# B",
      "- [[a]] Fund I: €40M committed.",
      "- [[a]] Series D at $360M pre-money valuation.",
      "- [[a]] Q1 operating margin 84%.",
    ].join("\n"),
  });
  assert.deepEqual(report.candidates, [], JSON.stringify(report.candidates, null, 2));
});

test("dates and ranges are not counts", () => {
  const report = brain({
    "a.md": "# A\n\n- Filed 9 Dec 2016; refine after first 3–5 ingested samples.\n",
    "b.md": "# B\n\n- [[a]] Filed 30 Dec 2015; refine after first 2-3 ingested samples.\n",
  });
  assert.equal(report.claimsScanned, 0);
  assert.deepEqual(report.candidates, []);
});

test("operational and historical files are never compared", () => {
  const report = brain({
    "quanta.md": "# Quanta\n\n- Series A: £9M round.\n",
    "LOG.md": "- [[quanta]] Series A: £2.5M round (superseded).\n",
    "JOURNAL.md": "- [[quanta]] Series A: £3M round.\n",
    "archive/JOURNAL-2026-01.md": "- [[quanta]] Series A: £4M round.\n",
    ".brain-sync-recovery/op/original.md": "- [[quanta]] Series A: £5M round.\n",
  });
  assert.equal(report.filesScanned, 1);
  assert.deepEqual(report.candidates, []);
});

test("table cells use their column header, not sibling cells, as context", () => {
  const report = brain({
    "quanta.md": "# Quanta\n\n- Series A round size £9M.\n",
    "ref_deals.md": [
      "| Company | Round | Invested | Round size |",
      "|---|---|---|---|",
      "| [[quanta]] | Series A | £2.5M | £9M |",
      "| [[quanta]] | Series A extension | £1.1M | £6M |",
    ].join("\n"),
  });
  // £2.5M (Invested) must not be compared with the £9M round size.
  assert.ok(
    report.candidates.every((c) => c.left.raw !== "£2.5M" && c.right.raw !== "£2.5M"),
    JSON.stringify(report.candidates, null, 2)
  );
});

test("compareClaims honours bounds and tolerance", () => {
  const exact = (value) => ({ value, bound: "exact" });
  const lower = (value) => ({ value, bound: "lower" });
  const approx = (value) => ({ value, bound: "approx" });
  assert.equal(compareClaims(exact(100), exact(100.2)), null);
  assert.equal(compareClaims(exact(100), exact(110)), "different_values");
  assert.equal(compareClaims(approx(260), exact(250)), null);
  assert.equal(compareClaims(lower(360e6), exact(400e6)), null);
  assert.equal(compareClaims(lower(360e6), exact(300e6)), "different_values");
  assert.equal(compareClaims(lower(300e6), lower(360e6)), "different_lower_bounds");
  assert.equal(compareClaims({ value: 10, bound: "upper" }, lower(5)), null);
  assert.equal(compareClaims({ value: 4, bound: "upper" }, lower(5)), "different_values");
});

test("sameMetric needs a shared qualifier or two shared terms", () => {
  assert.deepEqual(sameMetric(["series-a", "led"], ["series-a"]), ["series-a"]);
  assert.equal(sameMetric(["acquired"], ["acquired", "kkr"]), null);
  assert.deepEqual(sameMetric(["bridges", "extension"], ["extension", "bridges"]), ["bridges", "extension"]);
  assert.equal(sameMetric(["fund-i", "committed", "funds"], ["fund-ii", "committed", "funds"]), null);
  assert.equal(sameMetric(["series-d", "raised"], ["series-d", "valuation"]), null);
});

test("candidate output is capped and reports the remainder", () => {
  const files = {};
  for (let i = 0; i < 6; i += 1) {
    files[`f${i}.md`] = `# F\n\n- [[acme]] Series A: $${i + 1}M round.\n`;
  }
  files["acme.md"] = "# Acme\n";
  const report = findReconcileCandidates(new Map(Object.entries(files)), 5);
  assert.equal(report.candidates.length, 5);
  assert.equal(report.omittedCandidates, 10);
});

test("a participant's portion is not compared with the round size", () => {
  const report = brain({
    "quanta.md": "# Quanta\n\n- Co-led £9M Series A + £6M extension + bridges.\n",
    "ref_track.md":
      "| Company | Invested |\n|---|---|\n| [[quanta]] | EUR6.83M (NBGI portion: £2.5M Series A + £1.1M extension + bridges) |\n",
  });
  assert.deepEqual(report.candidates, [], JSON.stringify(report.candidates, null, 2));
});
