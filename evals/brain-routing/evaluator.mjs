import fs from "node:fs/promises";
import path from "node:path";
import {
  scoreSearchCandidate,
  searchMarkdownFiles,
} from "../../dist/search-ranking.js";

function textMatchesQuery(text, query) {
  return Boolean(
    scoreSearchCandidate(
      {
        filename: "fixture.md",
        lineNumber: 1,
        line: String(text || ""),
        scope: "brain",
      },
      query
    )
  );
}

function allBrainText(brain) {
  return Object.values(brain?.files || {}).join("\n");
}

function bootstrapText(brain) {
  return [brain?.files?.["00_loader.md"], brain?.files?.["NOW.md"]]
    .filter((value) => typeof value === "string")
    .join("\n");
}

function hasFile(brain, filename) {
  return typeof brain?.files?.[filename] === "string";
}

function searchFiles(brain, search) {
  return searchMarkdownFiles(brain?.files || {}, search.query, {
    maxResults: search.max_results || 500,
    includeOperational: search.include_operational === true,
    scope: "brain",
  });
}

function registryHasCanonicalFor(registry, brainId, canonicalFor) {
  const brain = registry?.brains?.find((candidate) => candidate.id === brainId);
  const values = brain?.metadata?.canonical_for || [];
  return Array.isArray(values) && values.includes(canonicalFor);
}

function emptyAssertionSummary() {
  return {
    policyMarkers: { total: 0, passed: 0, failed: 0 },
    signposts: { total: 0, passed: 0, failed: 0 },
    search: { total: 0, passed: 0, failed: 0 },
  };
}

function recordAssertion(summary, lane, passed) {
  summary[lane].total += 1;
  summary[lane][passed ? "passed" : "failed"] += 1;
}

function evaluateCase(testCase, context) {
  const startedAt = performance.now();
  const expected = testCase.expected || {};
  const brainId = expected.brain_id;
  const brain = context.brains?.[brainId];
  const failures = [];
  const assertions = emptyAssertionSummary();
  let routeAssertions = 0;
  let routeAssertionsPassed = 0;

  if (!brainId) {
    failures.push("Expected brain_id is required.");
  } else if (!brain) {
    failures.push(`Expected Brain ${brainId} to be available.`);
  }

  for (const filename of expected.route_files || []) {
    const passed = hasFile(brain, filename);
    routeAssertions += 1;
    if (passed) routeAssertionsPassed += 1;
    recordAssertion(assertions, "signposts", passed);
    if (!passed) {
      failures.push(`Expected route file ${filename} to exist in ${brainId}.`);
    }
  }

  const bootstrap = bootstrapText(brain);
  for (const term of expected.loader_must_contain || expected.signposts || []) {
    const passed = textMatchesQuery(bootstrap, term);
    recordAssertion(assertions, "signposts", passed);
    if (!passed) {
      failures.push(`Expected ${brainId} bootstrap to contain signpost "${term}".`);
    }
  }

  if (expected.canonical_for) {
    const passed = registryHasCanonicalFor(
      context.registry,
      brainId,
      expected.canonical_for
    );
    recordAssertion(assertions, "signposts", passed);
    if (!passed) {
      failures.push(
        `Expected registry Brain ${brainId} to be canonical for ${expected.canonical_for}.`
      );
    }
  }

  const text = allBrainText(brain);
  const policyMarkers = [...(expected.policy_markers || [])];
  if (expected.allow_store_non_secret_identifier) {
    policyMarkers.push("stable non secret account identifiers");
  }
  if (expected.refuse_secret_storage) {
    policyMarkers.push("passwords", "tokens", "mfa secrets", "private keys");
  }
  if (expected.fallback_disclosure_required) {
    policyMarkers.push("fallback", "may lag");
  }
  for (const marker of policyMarkers) {
    const passed = textMatchesQuery(text, marker);
    recordAssertion(assertions, "policyMarkers", passed);
    if (!passed) {
      failures.push(`Expected ${brainId} policy marker "${marker}".`);
    }
  }

  let searchResults = [];
  if (expected.search) {
    searchResults = searchFiles(brain, expected.search);
    const hits = new Set(searchResults.map((result) => result.filename));
    for (const filename of expected.search.must_hit_files || []) {
      const passed = hits.has(filename);
      recordAssertion(assertions, "search", passed);
      if (!passed) {
        failures.push(
          `Search query "${expected.search.query}" did not hit required file ${filename} in ${brainId}.`
        );
      }
    }
  }

  return {
    id: testCase.id,
    category: testCase.category || "uncategorized",
    prompt: testCase.prompt,
    status: failures.length === 0 ? "pass" : "fail",
    failures,
    assertions,
    metrics: {
      followUpReads: new Set(expected.route_files || []).size,
      routeAssertions,
      routeAssertionsPassed,
      searchResultCount: searchResults.length,
      searchMechanisms: Array.from(
        new Set(searchResults.map((result) => result.mechanism))
      ).sort(),
      durationMs: Number((performance.now() - startedAt).toFixed(3)),
    },
  };
}

function aggregateAssertions(cases) {
  const summary = emptyAssertionSummary();
  for (const testCase of cases) {
    for (const lane of Object.keys(summary)) {
      summary[lane].total += testCase.assertions[lane].total;
      summary[lane].passed += testCase.assertions[lane].passed;
      summary[lane].failed += testCase.assertions[lane].failed;
    }
  }
  return summary;
}

function bootstrapMetrics(brains) {
  return Object.fromEntries(
    Object.entries(brains || {}).map(([brainId, brain]) => {
      const content = bootstrapText(brain);
      const bytes = Buffer.byteLength(content, "utf-8");
      return [brainId, { bytes, estimatedTokens: Math.ceil(bytes / 4) }];
    })
  );
}

function percentile(values, fraction) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * fraction) - 1)
  );
  return Number(sorted[index].toFixed(3));
}

export function evaluateBrainRoutingGolden({ cases, brains, registry }) {
  const evaluatedCases = cases.map((testCase) =>
    evaluateCase(testCase, { brains, registry })
  );
  const failed = evaluatedCases.filter(
    (testCase) => testCase.status === "fail"
  ).length;
  const durationValues = evaluatedCases.map((testCase) => testCase.metrics.durationMs);
  const routeAssertions = evaluatedCases.reduce(
    (sum, testCase) => sum + testCase.metrics.routeAssertions,
    0
  );
  const routeAssertionsPassed = evaluatedCases.reduce(
    (sum, testCase) => sum + testCase.metrics.routeAssertionsPassed,
    0
  );
  return {
    status: failed === 0 ? "pass" : "fail",
    summary: {
      total: evaluatedCases.length,
      passed: evaluatedCases.length - failed,
      failed,
      assertions: aggregateAssertions(evaluatedCases),
      bootstrap: bootstrapMetrics(brains),
      routeFiles: {
        total: routeAssertions,
        passed: routeAssertionsPassed,
        failed: routeAssertions - routeAssertionsPassed,
      },
      followUpReads: {
        total: evaluatedCases.reduce(
          (sum, testCase) => sum + testCase.metrics.followUpReads,
          0
        ),
        average:
          evaluatedCases.length === 0
            ? 0
            : Number(
                (
                  evaluatedCases.reduce(
                    (sum, testCase) => sum + testCase.metrics.followUpReads,
                    0
                  ) / evaluatedCases.length
                ).toFixed(3)
              ),
      },
      latencyMs: {
        p50: percentile(durationValues, 0.5),
        p95: percentile(durationValues, 0.95),
        max: durationValues.length
          ? Number(Math.max(...durationValues).toFixed(3))
          : 0,
      },
    },
    cases: evaluatedCases,
  };
}

export function summarizeBrainRoutingResults(results) {
  const status = results.status.toUpperCase();
  const policy = results.summary.assertions.policyMarkers;
  const signposts = results.summary.assertions.signposts;
  const search = results.summary.assertions.search;
  const lines = [
    `${status} ${results.summary.passed}/${results.summary.total} brain-routing cases`,
    `Policy markers: ${policy.passed}/${policy.total}; signposts: ${signposts.passed}/${signposts.total}; search: ${search.passed}/${search.total}`,
    `Follow-up reads: ${results.summary.followUpReads.total} total (${results.summary.followUpReads.average} average)`,
    `Route files: ${results.summary.routeFiles.passed}/${results.summary.routeFiles.total}; evaluator latency p95: ${results.summary.latencyMs.p95} ms`,
  ];
  for (const [brainId, metrics] of Object.entries(results.summary.bootstrap)) {
    lines.push(
      `Bootstrap ${brainId}: ${metrics.estimatedTokens} estimated tokens (${metrics.bytes} bytes)`
    );
  }
  for (const testCase of results.cases.filter(
    (candidate) => candidate.status === "fail"
  )) {
    lines.push(`- ${testCase.id}: ${testCase.failures.join("; ")}`);
  }
  return lines.join("\n");
}

export async function readMarkdownTree(rootDir) {
  const files = {};

  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        const relativePath = path
          .relative(rootDir, fullPath)
          .split(path.sep)
          .join("/");
        files[relativePath] = await fs.readFile(fullPath, "utf-8");
      }
    }
  }

  await walk(rootDir);
  return { files };
}

export async function readJsonFile(filename) {
  return JSON.parse(await fs.readFile(filename, "utf-8"));
}
