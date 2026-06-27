import fs from "node:fs/promises";
import path from "node:path";

function normalizeText(value) {
  return String(value || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function queryTokens(query) {
  return normalizeText(query)
    .split(" ")
    .filter((token) => token.length > 2);
}

function textMatchesQuery(text, query) {
  const normalizedText = normalizeText(text);
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return true;
  if (normalizedText.includes(normalizedQuery)) return true;

  const compactText = normalizedText.replace(/\s+/g, "");
  const compactQuery = normalizedQuery.replace(/\s+/g, "");
  if (compactQuery && compactText.includes(compactQuery)) return true;

  const tokens = queryTokens(query);
  return tokens.length > 0 && tokens.every((token) => normalizedText.includes(token));
}

function allBrainText(brain) {
  return Object.values(brain?.files || {}).join("\n");
}

function hasFile(brain, filename) {
  return Boolean(brain?.files?.[filename]);
}

function searchFiles(brain, query) {
  const hits = [];
  for (const [filename, content] of Object.entries(brain?.files || {})) {
    if (textMatchesQuery(content, query)) {
      hits.push(filename);
    }
  }
  return hits;
}

function registryHasCanonicalFor(registry, brainId, canonicalFor) {
  const brain = registry?.brains?.find((candidate) => candidate.id === brainId);
  const values = brain?.metadata?.canonical_for || [];
  return Array.isArray(values) && values.includes(canonicalFor);
}

function evaluateCase(testCase, context) {
  const expected = testCase.expected || {};
  const brainId = expected.brain_id;
  const brain = context.brains?.[brainId];
  const failures = [];

  if (!brainId) {
    failures.push("Expected brain_id is required.");
  } else if (!brain) {
    failures.push(`Expected Brain ${brainId} to be available.`);
  }

  for (const filename of expected.route_files || []) {
    if (!hasFile(brain, filename)) {
      failures.push(`Expected route file ${filename} to exist in ${brainId}.`);
    }
  }

  const text = allBrainText(brain);
  for (const term of expected.loader_must_contain || []) {
    if (!textMatchesQuery(text, term)) {
      failures.push(`Expected ${brainId} content to contain "${term}".`);
    }
  }

  if (expected.canonical_for && !registryHasCanonicalFor(context.registry, brainId, expected.canonical_for)) {
    failures.push(`Expected registry Brain ${brainId} to be canonical for ${expected.canonical_for}.`);
  }

  if (expected.allow_store_non_secret_identifier) {
    const marker = "stable non secret account identifiers";
    if (!textMatchesQuery(text, marker)) {
      failures.push(`Expected ${brainId} to distinguish stable non-secret identifiers.`);
    }
  }

  if (expected.refuse_secret_storage) {
    const secretMarkers = ["passwords", "tokens", "mfa secrets", "private keys"];
    for (const marker of secretMarkers) {
      if (!textMatchesQuery(text, marker)) {
        failures.push(`Expected ${brainId} to reject storing ${marker}.`);
      }
    }
  }

  if (expected.fallback_disclosure_required) {
    const fallbackMarkers = ["fallback", "may lag"];
    for (const marker of fallbackMarkers) {
      if (!textMatchesQuery(text, marker)) {
        failures.push(`Expected ${brainId} to require fallback disclosure marker "${marker}".`);
      }
    }
  }

  if (expected.search) {
    const hits = searchFiles(brain, expected.search.query);
    for (const filename of expected.search.must_hit_files || []) {
      if (!hits.includes(filename)) {
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
  };
}

export function evaluateBrainRoutingGolden({ cases, brains, registry }) {
  const evaluatedCases = cases.map((testCase) =>
    evaluateCase(testCase, { brains, registry })
  );
  const failed = evaluatedCases.filter((testCase) => testCase.status === "fail").length;
  return {
    status: failed === 0 ? "pass" : "fail",
    summary: {
      total: evaluatedCases.length,
      passed: evaluatedCases.length - failed,
      failed,
    },
    cases: evaluatedCases,
  };
}

export function summarizeBrainRoutingResults(results) {
  const status = results.status.toUpperCase();
  const lines = [
    `${status} ${results.summary.passed}/${results.summary.total} brain-routing cases`,
  ];
  for (const testCase of results.cases.filter((candidate) => candidate.status === "fail")) {
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
        const relativePath = path.relative(rootDir, fullPath).split(path.sep).join("/");
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
