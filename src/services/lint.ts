import fs from "node:fs/promises";
import path from "node:path";
import {
  LOADER_FILE,
  NOW_FILE,
  PROJECTS_FILE,
  LINE_LIMIT,
  BLOAT_EXEMPT,
  INACTIVE_SECTION_PATTERNS,
  ACTIVE_SECTION_PATTERNS,
  DOMAIN_PACK_LIMIT,
  WORKING_DIR,
  WORKING_INDEX_FILE,
  JOURNAL_FILE,
  JOURNAL_ARCHIVE_DIR,
  JOURNAL_ARCHIVE_INDEX,
  JOURNAL_LINE_LIMIT,
  JOURNAL_BYTE_LIMIT,
  BOOTSTRAP_TOKEN_LIMIT,
} from "../constants.js";
import { getStalenessThreshold } from "./brain.js";
import {
  activeBrainStore,
  revisionStoreModeEnabled,
} from "./active-brain-store.js";
import type { BrainStore, FileMetadata } from "./brain-store.js";
import {
  getBrainPaths,
  resolveBrain,
  stdioPrincipal,
  type BrainLintReachabilityMode,
} from "./registry.js";
import {
  analyzeBrainGraph,
  type BrainGraphAnalysis,
} from "./brain-graph.js";
import {
  summarizeCaptureQueue,
  type CaptureQueueStatus,
} from "./task-intake.js";

interface LintFileSnapshot {
  name: string;
  content: string;
  lines: number;
  bytes: number;
  lastModified: Date | null;
  staleDays: number | null;
}

export interface LintReport {
  bloat: { file: string; lines: number }[];
  stale: { file: string; days: number }[];
  orphans: string[];
  drift: string[];
  largeDomainPacks: { dir: string; count: number }[];
  unindexedWorkingBinaries: string[];
  journalRotation:
    | {
        lines: number;
        bytes: number;
        triggeredBy: "lines" | "bytes" | "both";
      }
    | null;
  captureQueue: CaptureQueueStatus | null;
  bootstrapBudget: {
    limitTokens: number;
    estimatedTokens: number;
    bytes: number;
    exceeded: boolean;
  };
  graphReachability:
    | (BrainGraphAnalysis & {
        mode: Exclude<BrainLintReachabilityMode, "legacy">;
        legacyOrphans: string[];
        addedFindings: string[];
        removedFindings: string[];
      })
    | null;
  orphanMode: BrainLintReachabilityMode;
  suggestedSemanticChecks: string[];
  warnings: string[];
}

function countLines(content: string): number {
  return content.split("\n").length;
}

function byteLength(content: string): number {
  return Buffer.byteLength(content, "utf-8");
}

function isBloatExempt(filename: string): boolean {
  const normalized = filename.replace(/\\/g, "/");
  return (
    BLOAT_EXEMPT.has(path.basename(normalized)) ||
    /^archive\/(?:JOURNAL|LOG)-\d{4}-\d{2}\.md$/i.test(normalized)
  );
}

function isFileMetadata(file: FileMetadata | string): file is FileMetadata {
  return typeof file !== "string";
}

async function listBrainMarkdownFiles(
  store: BrainStore,
  brainId: string
): Promise<LintFileSnapshot[]> {
  const entries = await store.listFiles(brainId, "brain");
  const files = await Promise.all(
    entries.map(async (entry) => {
      const name = isFileMetadata(entry) ? entry.name : entry;
      const content = await store.readFile(brainId, name);
      return {
        name,
        content,
        lines: isFileMetadata(entry) ? entry.lines : countLines(content),
        bytes: isFileMetadata(entry) ? entry.bytes : byteLength(content),
        lastModified: isFileMetadata(entry) ? entry.lastModified : null,
        staleDays: isFileMetadata(entry) ? entry.staleDays : null,
      };
    })
  );
  return files.sort((a, b) => a.name.localeCompare(b.name));
}

function extractFileReferencesFromContent(content: string): Set<string> {
  const refs = new Set<string>();

  // Match backtick-quoted filenames like `01_identity.md`
  const backtickPattern = /`([^`]+\.md)`/g;
  let match: RegExpExecArray | null;
  while ((match = backtickPattern.exec(content)) !== null) {
    refs.add(match[1]);
  }

  // Match directory references like `Reference_ERS_Brain_Context/`
  const dirPattern = /`([A-Za-z_][A-Za-z0-9_-]*\/)`/g;
  while ((match = dirPattern.exec(content)) !== null) {
    refs.add(match[1]);
  }

  return refs;
}

/**
 * Scan `working/` for non-markdown, non-.gitkeep files and verify each is
 * registered in `working/INDEX.md` with a `## {filename}` H2 section. Binaries
 * aren't indexed by brain_search, so the INDEX entry is what makes them
 * discoverable from inside a Brain session.
 */
async function findUnindexedWorkingBinaries(
  brainId?: string
): Promise<{ files: string[]; warning?: string }> {
  if (revisionStoreModeEnabled()) {
    return {
      files: [],
      warning:
        "Working binary index check skipped: active Brain store is revision-backed, so hosted lint can inspect synced Markdown only. Run local brain_lint to scan unsynced working/ binaries.",
    };
  }

  const { brainDir } = await getBrainPaths(brainId);
  const workingDir = path.join(brainDir, WORKING_DIR);
  let entries: string[];
  try {
    entries = await fs.readdir(workingDir);
  } catch {
    return { files: [] };
  }

  const binaries = entries.filter((name) => {
    if (name === WORKING_INDEX_FILE) return false;
    if (name === ".gitkeep" || name === ".DS_Store") return false;
    if (name.toLowerCase().endsWith(".md")) return false;
    return true;
  });

  if (binaries.length === 0) return { files: [] };

  let indexContent = "";
  try {
    indexContent = await fs.readFile(
      path.join(workingDir, WORKING_INDEX_FILE),
      "utf-8"
    );
  } catch {
    // INDEX.md missing entirely — every binary is unindexed.
    return { files: binaries.map((b) => `${WORKING_DIR}/${b}`) };
  }

  const indexedFilenames = new Set<string>();
  const h2Pattern = /^##\s+(.+?)\s*$/gm;
  let match: RegExpExecArray | null;
  while ((match = h2Pattern.exec(indexContent)) !== null) {
    indexedFilenames.add(match[1].trim());
  }

  const unindexed: string[] = [];
  for (const binary of binaries) {
    if (!indexedFilenames.has(binary)) {
      unindexed.push(`${WORKING_DIR}/${binary}`);
    }
  }
  return { files: unindexed };
}

/**
 * Check whether `JOURNAL.md` has grown past the rotation threshold. JOURNAL is
 * a durable narrative timeline; once it crosses ~500 lines or ~80 KB the
 * rotation procedure in `brain/archive/INDEX.md` should be run to move older
 * entries into a numbered archive segment. Size-triggered so cadence auto-
 * scales with actual usage volume.
 */
function checkJournalRotation(
  content: string | undefined
): LintReport["journalRotation"] {
  if (content === undefined) return null;

  const lines = countLines(content);
  const bytes = byteLength(content);
  const overLines = lines > JOURNAL_LINE_LIMIT;
  const overBytes = bytes > JOURNAL_BYTE_LIMIT;
  if (!overLines && !overBytes) return null;

  const triggeredBy: "lines" | "bytes" | "both" =
    overLines && overBytes ? "both" : overLines ? "lines" : "bytes";
  return { lines, bytes, triggeredBy };
}

/**
 * Locate the projects file by name, number-agnostically. Brains number their
 * files differently (the canonical default is PROJECTS_FILE = 03_projects.md; the
 * JEM Brain deliberately uses 05_projects.md), so drift detection must not hardcode
 * a single number. Matches `projects.md` or `NN_projects.md`; prefers the configured
 * PROJECTS_FILE default when present, else the lowest-sorted match. Returns undefined
 * when the Brain has no projects file (e.g. a Brain that keeps projects in a folder),
 * which simply skips drift.
 */
function resolveProjectsFile(allFiles: string[]): string | undefined {
  const candidates = allFiles.filter((name) => /(^|_)projects\.md$/i.test(name));
  if (candidates.length === 0) return undefined;
  if (candidates.includes(PROJECTS_FILE)) return PROJECTS_FILE;
  return [...candidates].sort()[0];
}

export async function runLint(brainId?: string): Promise<LintReport> {
  const { brain: lintBrain } = await resolveBrain(brainId, stdioPrincipal());
  const resolvedBrainId = lintBrain.id;
  const store = activeBrainStore();
  const files = await listBrainMarkdownFiles(store, resolvedBrainId);
  const allFiles = files.map((file) => file.name);
  const fileContentMap = new Map(files.map((file) => [file.name, file.content]));
  const now = Date.now();

  const bloat: LintReport["bloat"] = [];
  const stale: LintReport["stale"] = [];
  const fileLinesMap = new Map<string, number>();

  // Check bloat and staleness for all files
  for (const file of files) {
    const { name, lines } = file;
    fileLinesMap.set(name, lines);

    if (lines > LINE_LIMIT && !isBloatExempt(name)) {
      bloat.push({ file: name, lines });
    }

    const daysSinceModified = file.lastModified
      ? Math.floor((now - file.lastModified.getTime()) / (1000 * 60 * 60 * 24))
      : file.staleDays;
    const threshold = getStalenessThreshold(name);
    if (daysSinceModified !== null && daysSinceModified > threshold) {
      stale.push({ file: name, days: daysSinceModified });
    }
  }

  // Orphan detection: files not referenced in 00_loader.md
  const loaderContent = fileContentMap.get(LOADER_FILE);
  const loaderRefs = loaderContent
    ? extractFileReferencesFromContent(loaderContent)
    : new Set<string>();
  const legacyOrphans: string[] = [];
  const warnings: string[] = [];
  if (!loaderContent) {
    warnings.push(`Orphan check skipped: ${LOADER_FILE} was not found.`);
  }
  for (const name of allFiles) {
    const base = path.basename(name);
    const dir = path.dirname(name);

    // Skip the loader itself and LOG.md
    if (base === LOADER_FILE || base === "LOG.md") continue;

    // Check if file is referenced directly or via its directory
    const isReferenced =
      loaderRefs.has(name) ||
      loaderRefs.has(base) ||
      (dir !== "." && loaderRefs.has(dir + "/"));

    if (!isReferenced) {
      legacyOrphans.push(name);
    }
  }

  const orphanMode = lintBrain.lint?.reachability_mode ?? "legacy";
  const graphMode: "graph_shadow" | "graph" | null =
    orphanMode === "legacy" ? null : orphanMode;
  const graph =
    graphMode === null
      ? null
      : analyzeBrainGraph(fileContentMap, lintBrain.lint);
  const graphReachability = graph
    ? {
        ...graph,
        mode: graphMode!,
        legacyOrphans,
        addedFindings: graph.unreachable.filter(
          (filename) => !legacyOrphans.includes(filename)
        ),
        removedFindings: legacyOrphans.filter(
          (filename) => !graph.unreachable.includes(filename)
        ),
      }
    : null;
  const orphans =
    orphanMode === "graph" && graphReachability
      ? graphReachability.unreachable
      : legacyOrphans;

  const bootstrapContent = [
    fileContentMap.get(LOADER_FILE),
    fileContentMap.get(NOW_FILE),
  ]
    .filter((content): content is string => content !== undefined)
    .join("\n");
  const bootstrapBytes = byteLength(bootstrapContent);
  const bootstrapEstimatedTokens = Math.ceil(bootstrapBytes / 4);
  const bootstrapBudget: LintReport["bootstrapBudget"] = {
    limitTokens: BOOTSTRAP_TOKEN_LIMIT,
    estimatedTokens: bootstrapEstimatedTokens,
    bytes: bootstrapBytes,
    exceeded: bootstrapEstimatedTokens > BOOTSTRAP_TOKEN_LIMIT,
  };

  // Drift detection: check NOW.md mentions against Active project sections
  const drift: string[] = [];
  const nowContent = fileContentMap.get(NOW_FILE);
  const projectsFileName = resolveProjectsFile(allFiles);
  const projectsContent = projectsFileName
    ? fileContentMap.get(projectsFileName)
    : undefined;
  if (nowContent && projectsContent) {
    const nowLower = nowContent.toLowerCase();
    const lines = projectsContent.split("\n");

    // First pass: build {section: [project headings]} map.
    const sections = new Map<string, string[]>();
    let currentSection = "";
    for (const line of lines) {
      const h2Match = line.match(/^##\s+(.+)/);
      if (h2Match) {
        currentSection = h2Match[1].trim();
        if (!sections.has(currentSection)) sections.set(currentSection, []);
        continue;
      }
      const h3Match = line.match(/^###\s+(.+)/);
      if (!h3Match || !currentSection) continue;
      const project = h3Match[1].trim();
      if (project.length <= 3 || project.includes("---")) continue;
      sections.get(currentSection)!.push(project);
    }

    const activeSections = [...sections.keys()].filter((name) =>
      ACTIVE_SECTION_PATTERNS.some((p) => p.test(name))
    );

    const checkProject = (project: string) => {
      const projectLower = project.toLowerCase();
      const segments = projectLower
        .split(/\s*[—–\-\(\),\/]\s*/)
        .map((s) => s.trim())
        .filter((s) => s.length > 3);
      const mentioned = segments.some((seg) => nowLower.includes(seg));
      if (!mentioned) {
        drift.push(
          `Project "${project}" in 05_projects.md not mentioned in NOW.md — still active?`
        );
      }
    };

    if (activeSections.length > 0) {
      // Active-section scoping: only drift-check projects under Active sections.
      for (const section of activeSections) {
        for (const project of sections.get(section)!) checkProject(project);
      }
    } else {
      // Defensive fallback: no parseable Active section. Warn and use the
      // legacy inactive-section filter so drift checks still surface signal
      // rather than crashing or going silent.
      warnings.push(
        "Drift check: no Active section found in 05_projects.md (expected a heading matching /active/i). " +
          "Falling back to legacy filter — every project not under an inactive section will be drift-checked. " +
          "Add an Active section header to 05_projects.md to silence this warning."
      );
      for (const [section, projects] of sections) {
        if (INACTIVE_SECTION_PATTERNS.some((p) => p.test(section))) continue;
        for (const project of projects) checkProject(project);
      }
    }
  }

  // Unindexed working binaries
  const workingBinaryCheck = await findUnindexedWorkingBinaries(resolvedBrainId);
  const unindexedWorkingBinaries = workingBinaryCheck.files;
  if (workingBinaryCheck.warning) warnings.push(workingBinaryCheck.warning);

  // Journal rotation threshold
  const journalRotation = checkJournalRotation(fileContentMap.get(JOURNAL_FILE));
  const captureQueue = summarizeCaptureQueue(fileContentMap.get("TASKS.md"));

  // Large domain packs
  const largeDomainPacks: LintReport["largeDomainPacks"] = [];
  const dirCounts = new Map<string, number>();
  for (const name of allFiles) {
    const dir = path.dirname(name);
    if (dir !== ".") {
      dirCounts.set(dir, (dirCounts.get(dir) || 0) + 1);
    }
  }
  for (const [dir, count] of dirCounts) {
    if (count > DOMAIN_PACK_LIMIT) {
      largeDomainPacks.push({ dir, count });
    }
  }

  // Suggested semantic checks for Claude to perform
  const suggestedSemanticChecks: string[] = [];
  if (stale.length > 0) {
    suggestedSemanticChecks.push(
      `Review stale files for outdated claims: ${stale.map((s) => s.file).join(", ")}`
    );
  }
  if (bloat.length > 0) {
    suggestedSemanticChecks.push(
      `Consider splitting bloated files: ${bloat.map((b) => `${b.file} (${b.lines} lines)`).join(", ")}`
    );
  }
  if (captureQueue) {
    suggestedSemanticChecks.push(
      `Triage TASKS.md Capture / Triage Queue: ${captureQueue.openCount} open item(s), ${captureQueue.staleCount} stale.`
    );
  }
  if (bootstrapBudget.exceeded) {
    suggestedSemanticChecks.push(
      `Review ${LOADER_FILE} and ${NOW_FILE} for progressive-disclosure moves; the combined bootstrap exceeds ${BOOTSTRAP_TOKEN_LIMIT} estimated tokens.`
    );
  }

  return {
    bloat,
    stale,
    orphans,
    drift,
    largeDomainPacks,
    unindexedWorkingBinaries,
    journalRotation,
    captureQueue,
    bootstrapBudget,
    graphReachability,
    orphanMode,
    suggestedSemanticChecks,
    warnings,
  };
}

export function formatLintReport(report: LintReport): string {
  const sections: string[] = ["# Brain Lint Report\n"];

  // Summary
  const issueCount =
    report.bloat.length +
    report.stale.length +
    report.orphans.length +
    report.drift.length +
    report.largeDomainPacks.length +
    report.unindexedWorkingBinaries.length +
    (report.journalRotation ? 1 : 0) +
    (report.captureQueue ? 1 : 0) +
    (report.bootstrapBudget.exceeded ? 1 : 0) +
    (report.graphReachability?.diagnostics.length || 0);

  sections.push(
    issueCount === 0
      ? "**All clear** — no structural issues detected.\n"
      : `**${issueCount} issue(s) found:**\n`
  );

  // Warnings (e.g. drift fallback when no Active section is parseable)
  if (report.warnings.length > 0) {
    sections.push("## Warnings");
    for (const w of report.warnings) {
      sections.push(`- ${w}`);
    }
    sections.push("");
  }

  // Bloat
  if (report.bloat.length > 0) {
    sections.push(`## Bloat (files exceeding ${LINE_LIMIT} lines)`);
    for (const { file, lines } of report.bloat) {
      sections.push(`- ${file}: ${lines} lines`);
    }
    sections.push("");
  }

  // Stale
  if (report.stale.length > 0) {
    sections.push("## Stale files");
    for (const { file, days } of report.stale) {
      sections.push(`- ${file}: ${days} days since last modification`);
    }
    sections.push("");
  }

  // Bootstrap budget
  sections.push("## Bootstrap budget");
  sections.push(
    `- ${LOADER_FILE} + ${NOW_FILE}: ${report.bootstrapBudget.estimatedTokens} estimated tokens (${report.bootstrapBudget.bytes} bytes); limit ${report.bootstrapBudget.limitTokens}.`
  );
  sections.push(
    report.bootstrapBudget.exceeded
      ? "- **Review required:** budget exceeded; lint never auto-fixes structural files."
      : "- Within the provisional budget."
  );
  sections.push("");

  // Orphans
  if (report.orphans.length > 0) {
    sections.push(
      report.orphanMode === "graph"
        ? "## Orphans (graph-unreachable)"
        : "## Orphans (legacy loader-reference check)"
    );
    for (const file of report.orphans) {
      sections.push(`- ${file}`);
    }
    sections.push("");
  }

  if (report.graphReachability) {
    const graph = report.graphReachability;
    sections.push(
      graph.mode === "graph_shadow"
        ? "## Graph reachability shadow"
        : "## Graph reachability"
    );
    sections.push(`- Roots: ${graph.roots.join(", ")}`);
    sections.push(`- Legacy orphans: ${graph.legacyOrphans.length}`);
    sections.push(`- Graph-unreachable: ${graph.unreachable.length}`);
    sections.push(`- Added findings: ${graph.addedFindings.length}`);
    for (const filename of graph.addedFindings) sections.push(`  - ${filename}`);
    sections.push(`- Removed findings: ${graph.removedFindings.length}`);
    for (const filename of graph.removedFindings) sections.push(`  - ${filename}`);
    sections.push(`- Exemptions used: ${graph.exempted.length}`);
    for (const filename of graph.exempted) sections.push(`  - ${filename}`);
    sections.push(`- Edge diagnostics: ${graph.diagnostics.length}`);
    for (const diagnostic of graph.diagnostics) {
      sections.push(
        `  - ${diagnostic.code}: ${diagnostic.source} -> ${diagnostic.target} (${diagnostic.syntax})`
      );
    }
    if (graph.mode === "graph_shadow") {
      sections.push("- Shadow mode is advisory: legacy orphans remain the enforced report set and graph findings cannot alter fix plans.");
    }
    sections.push("");
  }

  // Drift
  if (report.drift.length > 0) {
    sections.push("## Drift");
    for (const item of report.drift) {
      sections.push(`- ${item}`);
    }
    sections.push("");
  }

  // Journal rotation
  if (report.journalRotation) {
    const { lines, bytes, triggeredBy } = report.journalRotation;
    const kb = (bytes / 1024).toFixed(1);
    const limitKb = (JOURNAL_BYTE_LIMIT / 1024).toFixed(0);
    const reason =
      triggeredBy === "lines"
        ? `${lines} lines (threshold ${JOURNAL_LINE_LIMIT})`
        : triggeredBy === "bytes"
        ? `${kb} KB (threshold ${limitKb} KB)`
        : `${lines} lines and ${kb} KB (thresholds ${JOURNAL_LINE_LIMIT} lines / ${limitKb} KB)`;
    sections.push(
      "## Journal rotation due",
      `- ${JOURNAL_FILE} has reached ${reason}.`,
      `- Run the rotation procedure in \`${JOURNAL_ARCHIVE_DIR}/${JOURNAL_ARCHIVE_INDEX}\`: cut ≈30 days back at a date header, move older entries into \`${JOURNAL_ARCHIVE_DIR}/JOURNAL-YYYY-NN.md\`, register the segment in \`${JOURNAL_ARCHIVE_DIR}/${JOURNAL_ARCHIVE_INDEX}\` with date range + one-line summary, and log the rotation in LOG.md as an UPDATE op.`,
      ""
    );
  }

  // Capture / triage queue
  if (report.captureQueue) {
    const {
      openCount,
      staleCount,
      oldestOpenDays,
      staleItems,
      thresholdDays,
      thresholdCount,
    } = report.captureQueue;
    sections.push(
      "## Capture / Triage Queue",
      `- TASKS.md has ${openCount} open item${openCount === 1 ? "" : "s"} awaiting triage.`,
      `- Thresholds: ${thresholdDays}+ days old or ${thresholdCount}+ open items.`,
      oldestOpenDays === null
        ? "- Oldest open item age: unknown."
        : `- Oldest open item age: ${oldestOpenDays} day${oldestOpenDays === 1 ? "" : "s"}.`
    );
    if (staleCount > 0) {
      sections.push(`- Stale open items (${staleCount}):`);
      for (const item of staleItems.slice(0, 10)) {
        sections.push(`  - ${item.date}: ${item.title} (${item.days} days)`);
      }
      if (staleItems.length > 10) {
        sections.push(`  - ...and ${staleItems.length - 10} more.`);
      }
    }
    sections.push("");
  }

  // Unindexed working binaries
  if (report.unindexedWorkingBinaries.length > 0) {
    sections.push(
      "## Unindexed working binaries (missing from working/INDEX.md)"
    );
    for (const file of report.unindexedWorkingBinaries) {
      sections.push(`- ${file}`);
    }
    sections.push(
      "",
      "Add a `## <filename>` section to `working/INDEX.md` describing each binary (purpose, key terms, schema, how to read/edit). Without it, brain_search cannot discover the artifact.",
      ""
    );
  }

  // Large domain packs
  if (report.largeDomainPacks.length > 0) {
    sections.push(`## Large domain packs (>${DOMAIN_PACK_LIMIT} files)`);
    for (const { dir, count } of report.largeDomainPacks) {
      sections.push(`- ${dir}/: ${count} files`);
    }
    sections.push("");
  }

  // Suggested semantic checks
  sections.push("## Suggested next steps (for Claude)");
  for (const check of report.suggestedSemanticChecks) {
    sections.push(`- ${check}`);
  }

  return sections.join("\n");
}
